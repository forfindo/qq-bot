import { Context, Effect, Layer, Schema } from 'effect';
import { SchemaAgent, SchemaProvider, SchemaTool } from '@/schema';
import { TaskTool } from '@/tool/tools/task';
import { ReadTool } from '@/tool/tools/read';
import path from 'path';
import z from 'zod';
import { pathToFileURL } from 'url';
import { Config } from '@/config';
import { Agent } from '@/agent';
import * as Truncate from '@/tool/truncate';
import { PlanExitTool } from '@/tool/tools/plan';
import { QuestionTool } from '@/tool/tools/question';
import { TodoWriteTool } from '@/tool/tools/todo';
import { WebFetchTool } from '@/tool/tools/webfetch';
import { WebSearchTool } from '@/tool/tools/websearch';
import { ShellTool } from '@/tool/tools/shell';
import { GlobTool } from '@/tool/tools/glob';
import { WriteTool } from '@/tool/tools/write';
import { EditTool } from '@/tool/tools/edit';
import { GrepTool } from '@/tool/tools/grep';
import { ApplyPatchTool } from '@/tool/tools/apply-patch';
import { SkillTool } from '@/tool/tools/skill';
import { EffectRunner, InstanceContext, ServiceState } from '@/instance';
import { InvalidTool } from '@/tool/tools/invalid';
import { Permission } from '@/permission';
import { init, type ToolContext, type ToolDefinition } from '@/tool/tool';
import type { JSONSchema7, JSONSchema7Definition } from '@ai-sdk/provider';
import { Glob } from '@/utils';
import { Flag } from '@/flag';
import { AppFileSystem, Ripgrep } from '@/file';
import { FetchHttpClient } from 'effect/unstable/http';
import { CrossSpawnSpawner } from '@/process';
import { Database } from '@/database';
import { Event } from '@/event';
import { BackgroundJob } from '@/background';
import { Question } from '@/question';
import { Instruction, Session, Todo } from '@/session';
import { Skill } from '@/skill';

export const webSearchEnabled = (
  providerID: SchemaProvider.ProviderID,
  flags = { exa: false, parallel: false }
) => {
  return providerID === SchemaProvider.ProviderID.opencode || flags.exa || flags.parallel;
};

const isCustomTool = (value: unknown): value is ToolDefinition => {
  return (
    typeof value === 'object' &&
    value !== null &&
    'args' in value &&
    'description' in value &&
    'execute' in value
  );
};

const isZodType = (value: unknown): value is z.ZodType => {
  return typeof value === 'object' && value !== null && '_zod' in value;
};

const isJsonSchemaObject = (value: unknown): value is Record<string, unknown> => {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
};

const isJsonSchemaDefinition = (value: unknown): value is JSONSchema7Definition => {
  return (
    typeof value === 'boolean' ||
    (typeof value === 'object' && value !== null && !Array.isArray(value))
  );
};

const legacyJsonSchema = (entries: [string, unknown][]): JSONSchema7 => {
  const properties = Object.fromEntries(
    entries.filter((entry): entry is [string, JSONSchema7Definition] =>
      isJsonSchemaDefinition(entry[1])
    )
  );
  return {
    type: 'object',
    properties,
    required: Object.keys(properties)
  };
};

const normalizeZodJsonSchema = (value: unknown): unknown => {
  if (Array.isArray(value)) {
    return value.map(item => normalizeZodJsonSchema(item));
  }
  if (typeof value !== 'object' || value === null) {
    return value;
  }
  return Object.fromEntries(
    Object.entries(value)
      .filter(
        entry =>
          !(
            (entry[0] === 'exclusiveMaximum' || entry[0] === 'exclusiveMinimum') &&
            typeof entry[1] === 'boolean'
          )
      )
      .map(([key, item]) => [key, normalizeZodJsonSchema(item)])
  );
};

const zodJsonSchema = (schema: z.ZodType): JSONSchema7 => {
  const result = normalizeZodJsonSchema(z.toJSONSchema(schema, { io: 'input' }));
  if (!isJsonSchemaObject(result)) {
    throw new Error('plugin tool Zod schema produced a non-object JSON Schema');
  }
  const { $defs, ...rest } = result;
  return $defs && isJsonSchemaObject($defs)
    ? { ...rest, definitions: $defs as JSONSchema7['definitions'] }
    : rest;
};

type TaskDef = SchemaTool.InferDef<typeof TaskTool>;
type ReadDef = SchemaTool.InferDef<typeof ReadTool>;

type State = {
  custom: SchemaTool.Def[];
  builtin: SchemaTool.Def[];
  task: TaskDef;
  read: ReadDef;
};

export interface Interface {
  readonly ids: () => Effect.Effect<string[]>;
  readonly all: () => Effect.Effect<SchemaTool.Def[]>;
  readonly named: () => Effect.Effect<{ task: TaskDef; read: ReadDef }>;
  readonly tools: (model: {
    providerID: SchemaProvider.ProviderID;
    modelID: SchemaProvider.ModelID;
    agent: SchemaAgent.Info;
  }) => Effect.Effect<SchemaTool.Def[]>;
}

export class Service extends Context.Service<Service, Interface>()('@openchat/ToolRegistry') {}

export const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const config = yield* Config.Service;
    const agents = yield* Agent.Service;
    const truncate = yield* Truncate.Service;
    const fs = yield* AppFileSystem.Service;

    const invalid = yield* InvalidTool;
    const task = yield* TaskTool;
    const read = yield* ReadTool;
    const question = yield* QuestionTool;
    const todo = yield* TodoWriteTool;
    const webfetch = yield* WebFetchTool;
    const websearch = yield* WebSearchTool;
    const shell = yield* ShellTool;
    const globtool = yield* GlobTool;
    const writetool = yield* WriteTool;
    const edit = yield* EditTool;
    const greptool = yield* GrepTool;
    const patchtool = yield* ApplyPatchTool;
    const skilltool = yield* SkillTool;
    const plan = yield* PlanExitTool;
    const agent = yield* Agent.Service;

    const state = yield* ServiceState.make<State>(
      Effect.fn('ToolRegistry.state')(function* (ctx) {
        const custom: SchemaTool.Def[] = [];

        function fromPlugin(id: string, def: ToolDefinition): SchemaTool.Def {
          // Plugin tools still expose Zod args publicly; keep that compatibility
          // boxed at the registry boundary and give the LLM the original JSON Schema.
          // Normalize missing args to `{}` once — pre-1.14.49 the code was
          // `z.object(def.args)` and Zod silently tolerated undefined (#27451, #27630).
          const args = def.args ?? {};
          const entries = Object.entries(args);
          const allZod = entries.every(entry => isZodType(entry[1]));
          const zodParams = allZod ? z.object(args) : void 0;
          const jsonSchema = zodParams ? zodJsonSchema(zodParams) : legacyJsonSchema(entries);
          const parameters = zodParams
            ? Schema.declare<unknown>((u): u is unknown => zodParams.safeParse(u).success)
            : Schema.Unknown;
          return {
            id,
            parameters,
            jsonSchema,
            description: def.description,
            execute: (args: Schema.Schema.Type<typeof parameters>, toolCtx) =>
              Effect.gen(function* () {
                // Bridge the host's Effect-based `ask` into a Promise-returning
                // function for the plugin to make sure context persists
                const bridge = yield* EffectRunner.make();
                const pluginCtx: ToolContext = {
                  ...toolCtx,
                  ask: req => bridge.promise(toolCtx.ask(req)),
                  directory: yield* InstanceContext.getDirectory(ctx.uid)
                };
                // @ts-ignore
                const result = yield* Effect.promise(() => def.execute(args, pluginCtx));
                const output = typeof result === 'string' ? result : result.output;
                const metadata = typeof result === 'string' ? {} : (result.metadata ?? {});
                const attachments = typeof result === 'string' ? void 0 : result.attachments;
                const info = yield* agent.get(toolCtx.agent);
                const out = yield* truncate.output(output, {}, info);
                return {
                  title: typeof result === 'string' ? '' : (result.title ?? ''),
                  output: out.truncated ? out.content : output,
                  attachments,
                  metadata: {
                    ...metadata,
                    truncated: out.truncated,
                    ...(out.truncated && { outputPath: out.outputPath })
                  }
                };
              }).pipe(
                Effect.provideService(AppFileSystem.Service, fs),
                Effect.withSpan('Tool.execute', {
                  attributes: {
                    'tool.name': id,
                    'session.id': toolCtx.sessionID,
                    'message.id': toolCtx.messageID,
                    ...(toolCtx.callID ? { 'tool.call_id': toolCtx.callID } : {})
                  }
                })
              )
          };
        }

        const dirs = yield* config.directories();
        const matches = dirs.flatMap(dir =>
          Glob.scanSync('{tool,tools}/*.js', {
            cwd: dir,
            absolute: true,
            dot: true,
            symlink: true
          })
        );
        if (matches.length) {
          yield* config.waitForDependencies();
        }
        for (const match of matches) {
          const namespace = path.basename(match, path.extname(match));
          // `match` is an absolute filesystem path from `Glob.scanSync(..., { absolute: true })`.
          // Import it as `file://` so Node on Windows accepts the dynamic import.
          const mod = (yield* Effect.promise(() => import(pathToFileURL(match).href))) as object;
          for (const [id, def] of Object.entries(mod)) {
            if (!isCustomTool(def)) {
              continue;
            }
            custom.push(fromPlugin(id === 'default' ? namespace : `${namespace}_${id}`, def));
          }
        }

        const tool = yield* Effect.all({
          invalid: init(invalid),
          shell: init(shell),
          read: init(read),
          glob: init(globtool),
          grep: init(greptool),
          edit: init(edit),
          write: init(writetool),
          task: init(task),
          fetch: init(webfetch),
          todo: init(todo),
          search: init(websearch),
          skill: init(skilltool),
          patch: init(patchtool),
          question: init(question),
          plan: init(plan)
        });

        return {
          custom,
          builtin: [
            tool.invalid,
            tool.question,
            tool.shell,
            tool.read,
            tool.glob,
            tool.grep,
            tool.edit,
            tool.write,
            tool.task,
            tool.fetch,
            tool.todo,
            tool.search,
            tool.skill,
            tool.patch,
            ...(Flag.EXPERIMENTAL_PLAN_MODE ? [tool.plan] : [])
          ],
          task: tool.task,
          read: tool.read
        };
      })
    );

    const all: Interface['all'] = Effect.fn('ToolRegistry.all')(function* () {
      const s = yield* ServiceState.get(state);
      return [...s.builtin, ...s.custom] as SchemaTool.Def[];
    });

    const ids: Interface['ids'] = Effect.fn('ToolRegistry.ids')(function* () {
      return (yield* all()).map(tool => tool.id);
    });

    const describeTask = Effect.fn('ToolRegistry.describeTask')(function* (
      agent: SchemaAgent.Info
    ) {
      const items = (yield* agents.list()).filter(item => item.mode !== 'primary');
      const filtered = items.filter(
        item => Permission.evaluate('task', item.name, agent.permission).action !== 'deny'
      );
      const list = filtered.toSorted((a, b) => a.name.localeCompare(b.name));
      const description = list
        .map(
          item =>
            `- ${item.name}: ${item.description ?? 'This subagent should only be called manually by the user.'}`
        )
        .join('\n');
      return ['Available agent types and the tools they have access to:', description].join('\n');
    });

    const tools: Interface['tools'] = Effect.fn('ToolRegistry.tools')(function* (input) {
      const filtered = (yield* all()).filter(tool => {
        if (tool.id === WebSearchTool.id) {
          return webSearchEnabled(input.providerID, {
            exa: Flag.ENABLE_EXA,
            parallel: Flag.ENABLE_PARALLEL
          });
        }

        const usePatch =
          input.modelID.includes('gpt-') &&
          !input.modelID.includes('oss') &&
          !input.modelID.includes('gpt-4');
        if (tool.id === ApplyPatchTool.id) {
          return usePatch;
        }
        if (tool.id === EditTool.id || tool.id === WriteTool.id) {
          return !usePatch;
        }

        return true;
      });

      return yield* Effect.forEach(
        filtered,
        Effect.fnUntraced(function* (tool: SchemaTool.Def) {
          const output = {
            description: tool.description,
            parameters: tool.parameters,
            jsonSchema: tool.jsonSchema
          };
          const jsonSchema =
            output.parameters === tool.parameters || output.jsonSchema !== tool.jsonSchema
              ? output.jsonSchema
              : void 0;
          return {
            id: tool.id,
            description: [
              output.description,
              tool.id === TaskTool.id ? yield* describeTask(input.agent) : void 0
            ]
              .filter(Boolean)
              .join('\n'),
            parameters: output.parameters,
            jsonSchema,
            execute: tool.execute,
            formatValidationError: tool.formatValidationError
          };
        }),
        { concurrency: 'unbounded' }
      );
    });

    const named: Interface['named'] = Effect.fn('ToolRegistry.named')(function* () {
      const s = yield* ServiceState.get(state);
      return { task: s.task, read: s.read };
    });

    return Service.of({ ids, all, named, tools });
  })
);

export const defaultLayer = layer.pipe(
  Layer.provide(Config.defaultLayer),
  Layer.provide(Agent.defaultLayer),
  Layer.provide(Question.defaultLayer),
  Layer.provide(Todo.defaultLayer),
  Layer.provide(Skill.defaultLayer),
  Layer.provide(Truncate.defaultLayer),
  Layer.provide(Session.defaultLayer),
  Layer.provide(AppFileSystem.defaultLayer),
  Layer.provide(FetchHttpClient.layer),
  Layer.provide(CrossSpawnSpawner.defaultLayer),
  Layer.provide(Event.defaultLayer),
  Layer.provide(Database.defaultLayer),
  Layer.provide(BackgroundJob.layer),
  Layer.provide(Ripgrep.defaultLayer),
  Layer.provide(Instruction.defaultLayer)
);
