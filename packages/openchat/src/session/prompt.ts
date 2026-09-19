import {
  Cause,
  Context,
  DateTime,
  Effect,
  Exit,
  Latch,
  Layer,
  Option,
  Schema,
  Scope,
  Stream,
  Types
} from 'effect';
import {
  SchemaAgent,
  SchemaCommand,
  SchemaImage,
  SchemaMessage,
  SchemaPermission,
  SchemaProvider,
  SchemaSession,
  SchemaTool
} from '@/schema';
import { Event } from '@/event';
import * as SessionStatus from './status';
import * as Session from './session';
import * as SessionProcessor from './processor';
import * as SessionCompaction from './compaction';
import * as Instruction from './instruction';
import * as SessionRunState from './run-state';
import * as SessionReminder from './reminder';
import * as SystemPrompt from './system-prompt';
import * as Message from './message';
import { Agent } from '@/agent';
import { Provider, ProviderTransform } from '@/provider';
import { Command } from '@/command';
import { Config, ConfigMarkdown } from '@/config';
import { Permission } from '@/permission';
import { AppFileSystem } from '@/file';
import { MCP } from '@/mcp';
import { ToolRegistry, Truncate } from '@/tool';
import { Image } from '@/image';
import { ChildProcess, ChildProcessSpawner } from 'effect/unstable/process';
import { LLM } from '@/session/index';
import { Encrypto, JsonSchemaTool, Log, ProcessUtil, ShellUtil } from '@/utils';
import { fileURLToPath, pathToFileURL } from 'url';
import { NamedError } from '@/utils/error';
import { Flag } from '@/flag';
import { TaskTool, type TaskPromptOps } from '@/tool/tools/task';
import path from 'path';
import os from 'os';
import { ulid } from 'ulid';
import { EffectRunner, InstanceContext } from '@/instance';
import MAX_STEPS from './prompt/max-steps.md';
import { type Tool as AITool, tool, jsonSchema, type ToolExecutionOptions, asSchema } from 'ai';
import type { JSONSchema7 } from '@ai-sdk/provider';
import { ShellToolID } from '@/tool/shell/id';
import { CrossSpawnSpawner } from '@/process';

const log = Log.create({ service: 'session.prompt' });

const STRUCTURED_OUTPUT_DESCRIPTION = `Use this tool to return your final response in the requested structured format.

IMPORTANT:
- You MUST call this tool exactly once at the end of your response
- The input must be valid JSON matching the required schema
- Complete all necessary research and tool calls BEFORE calling this tool
- This tool provides your final answer - no further actions are taken after calling it`;

const bashRegex = /!`([^`]+)`/g;
// Match [Image N] as single token, quoted strings, or non-space sequences
const argsRegex = /(?:\[Image\s+\d+\]|"[^"]*"|'[^']*'|[^\s"']+)/gi;
const placeholderRegex = /\$(\d+)/g;
const quoteTrimRegex = /^["']|["']$/g;
const STRUCTURED_OUTPUT_SYSTEM_PROMPT = `IMPORTANT: The user has requested structured output. You MUST use the StructuredOutput tool to provide your final response. Do NOT respond with plain text - you MUST call the StructuredOutput tool with your answer formatted according to the schema.`;
const decodeMessageInfo = Schema.decodeUnknownExit(SchemaMessage.Info);
const decodeMessagePart = Schema.decodeUnknownExit(SchemaMessage.Part);

export const createStructuredOutputTool = (input: {
  schema: Record<string, unknown>;
  onSuccess: (output: unknown) => void;
}): AITool => {
  // Remove $schema property if present (not needed for tool input)
  const { $schema: _, ...toolSchema } = input.schema;

  return tool({
    description: STRUCTURED_OUTPUT_DESCRIPTION,
    inputSchema: jsonSchema(toolSchema as JSONSchema7),
    execute(args) {
      // AI SDK validates args against inputSchema before calling execute()
      input.onSuccess(args);
      return {
        output: 'Structured output captured successfully.',
        title: 'Structured Output',
        metadata: { valid: true }
      };
    },
    toModelOutput({ output }) {
      return {
        type: 'text',
        // eslint-disable-next-line
        value: output.output
      };
    }
  });
};

export interface Interface {
  readonly cancel: (sessionID: SchemaSession.SessionID) => Effect.Effect<void>;
  readonly prompt: (
    input: SchemaSession.PromptInput
  ) => Effect.Effect<SchemaMessage.WithParts, SchemaImage.Error>;
  readonly loop: (input: SchemaSession.LoopInput) => Effect.Effect<SchemaMessage.WithParts>;
  readonly shell: (
    input: SchemaSession.ShellInput
  ) => Effect.Effect<SchemaMessage.WithParts, SchemaSession.BusyError>;
  readonly command: (
    input: SchemaSession.CommandInput
  ) => Effect.Effect<SchemaMessage.WithParts, SchemaImage.Error>;
  readonly resolvePromptParts: (
    template: string
  ) => Effect.Effect<SchemaSession.PromptInput['parts']>;
}

export class Service extends Context.Service<Service, Interface>()('@openchat/SessionPrompt') {}

export const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const event = yield* Event.Service;
    const status = yield* SessionStatus.Service;
    const sessions = yield* Session.Service;
    const agents = yield* Agent.Service;
    const provider = yield* Provider.Service;
    const processor = yield* SessionProcessor.Service;
    const compaction = yield* SessionCompaction.Service;
    const commands = yield* Command.Service;
    const config = yield* Config.Service;
    const permission = yield* Permission.Service;
    const fsys = yield* AppFileSystem.Service;
    const mcp = yield* MCP.Service;
    const registry = yield* ToolRegistry.Service;
    const truncate = yield* Truncate.Service;
    const image = yield* Image.Service;
    const spawner = yield* ChildProcessSpawner.ChildProcessSpawner;
    const scope = yield* Scope.Scope;
    const instruction = yield* Instruction.Service;
    const state = yield* SessionRunState.Service;
    const sys = yield* SystemPrompt.Service;
    const llm = yield* LLM.Service;

    const runner = Effect.fn('SessionPrompt.runner')(function* () {
      return yield* EffectRunner.make();
    });

    const agentNotFound = Effect.fnUntraced(function* (
      agentName: string | undefined,
      input: { sessionID: SchemaSession.SessionID }
    ) {
      const available = (yield* agents.list()).filter(a => !a.hidden).map(a => a.name);
      const hint = available.length ? ` Available agents: ${available.join(', ')}` : '';
      const error = new NamedError.Unknown({
        message: `Agent not found: "${agentName}".${hint}`
      });
      yield* event.publish(SchemaSession.Events.Error, {
        sessionID: input.sessionID,
        error: error.toObject()
      });
      throw error;
    });

    const resolvePromptParts = Effect.fn('SessionPrompt.resolvePromptParts')(
      function* (template: string) {
        const workspace = yield* InstanceContext.workspace;
        const parts: Types.DeepMutable<SchemaSession.PromptInput['parts']> = [
          { type: 'text', text: template }
        ];
        const files = ConfigMarkdown.files(template);
        const seen = new Set<string>();

        yield* Effect.forEach(
          files,
          Effect.fnUntraced(function* (match) {
            const name = match[1]!;
            if (!name) {
              return;
            }
            if (seen.has(name)) {
              return;
            }
            seen.add(name);

            const filepath = name.startsWith('~/')
              ? path.join(os.homedir(), name.slice(2))
              : path.resolve(workspace, name);

            const info = yield* fsys.stat(filepath).pipe(Effect.option);
            if (Option.isNone(info)) {
              const found = yield* agents.get(name);
              if (found) {
                parts.push({ type: 'agent', name: found.name });
              }
              return;
            }
            const stat = info.value;
            parts.push({
              type: 'file',
              url: pathToFileURL(filepath).href,
              filename: name,
              mime: stat.type === 'Directory' ? 'application/x-directory' : 'text/plain'
            });
          }),
          { concurrency: 'unbounded', discard: true }
        );
        return parts;
      },
      Effect.provideService(AppFileSystem.Service, fsys)
    );

    const ops = () => {
      return {
        cancel: (sessionID: SchemaSession.SessionID) => cancel(sessionID),
        resolvePromptParts: (template: string) => resolvePromptParts(template),
        prompt: (input: SchemaSession.PromptInput) => prompt(input).pipe(Effect.catch(Effect.die))
      } satisfies TaskPromptOps;
    };

    const title = Effect.fn('SessionPrompt.ensureTitle')(function* (input: {
      session: SchemaSession.SessionInfo;
      history: SchemaMessage.WithParts[];
      providerID: SchemaProvider.ProviderID;
      modelID: SchemaProvider.ModelID;
    }) {
      if (input.session.parentID) {
        return;
      }
      if (!Session.isDefaultTitle(input.session.title)) {
        return;
      }

      const real = (m: SchemaMessage.WithParts) =>
        m.info.role === 'user' && !m.parts.every(p => 'synthetic' in p && p.synthetic);
      const idx = input.history.findIndex(real);
      if (idx === -1) {
        return;
      }
      if (input.history.filter(real).length !== 1) {
        return;
      }

      const context = input.history.slice(0, idx + 1);
      const firstUser = context[idx];
      if (!firstUser || firstUser.info.role !== 'user') {
        return;
      }
      const firstInfo = firstUser.info;

      const subtasks = firstUser.parts.filter(
        (p): p is SchemaMessage.SubtaskPart => p.type === 'subtask'
      );
      const onlySubtasks = subtasks.length > 0 && firstUser.parts.every(p => p.type === 'subtask');

      const ag = yield* agents.get('title');
      if (!ag) {
        return;
      }
      const mdl = ag.model
        ? yield* provider.getModel(ag.model.providerID, ag.model.modelID)
        : ((yield* provider.getSmallModel(input.providerID)) ??
          (yield* provider.getModel(input.providerID, input.modelID)));
      const msgs = onlySubtasks
        ? [{ role: 'user' as const, content: subtasks.map(p => p.prompt).join('\n') }]
        : yield* Message.toModelMessagesEffect(context, mdl);
      const text = yield* llm
        .stream({
          agent: ag,
          user: firstInfo,
          system: [],
          small: true,
          tools: {},
          model: mdl,
          sessionID: input.session.id,
          retries: 2,
          messages: [
            { role: 'user', content: 'Generate a title for this conversation:\n' },
            ...msgs
          ]
        })
        .pipe(
          Stream.filter(
            (e): e is Extract<LLM.StreamEvent, { type: 'text-delta' }> => e.type === 'text-delta'
          ),
          Stream.map(e => e.text),
          Stream.mkString,
          Effect.orDie
        );
      const cleaned = text
        .replace(/<think>[\s\S]*?<\/think>\s*/g, '')
        .split('\n')
        .map(line => line.trim())
        .find(line => line.length > 0);
      if (!cleaned) {
        return;
      }
      const t = cleaned.length > 100 ? cleaned.substring(0, 97) + '...' : cleaned;
      yield* sessions.setTitle({ sessionID: input.session.id, title: t }).pipe(
        Effect.catchCause(cause => {
          log.error('failed to generate title', { error: Cause.squash(cause) });
          return Effect.void;
        })
      );
    });

    const getModel = Effect.fn('SessionPrompt.getModel')(function* (
      providerID: SchemaProvider.ProviderID,
      modelID: SchemaProvider.ModelID,
      sessionID: SchemaSession.SessionID
    ) {
      const exit = yield* provider.getModel(providerID, modelID).pipe(Effect.exit);
      if (Exit.isSuccess(exit)) {
        return exit.value;
      }
      const err = Cause.squash(exit.cause);
      if (SchemaProvider.ModelNotFoundError.isInstance(err)) {
        const hint = err.suggestions?.length ? ` Did you mean: ${err.suggestions.join(', ')}?` : '';
        yield* event.publish(SchemaSession.Events.Error, {
          sessionID,
          error: new NamedError.Unknown({
            message: `Model not found: ${err.providerID}/${err.modelID}.${hint}`
          }).toObject()
        });
      }
      return yield* Effect.die(err);
    });

    const handleSubtask = Effect.fn('SessionPrompt.handleSubtask')(function* (input: {
      task: SchemaMessage.SubtaskPart;
      model: SchemaProvider.Model;
      lastUser: SchemaMessage.User;
      sessionID: SchemaSession.SessionID;
      session: SchemaSession.SessionInfo;
      msgs: SchemaMessage.WithParts[];
    }) {
      const { task, model, lastUser, sessionID, session, msgs } = input;
      const promptOps = ops();
      const { task: taskTool } = yield* registry.named();
      const taskModel = task.model
        ? yield* getModel(task.model.providerID, task.model.modelID, sessionID)
        : model;
      const assistantMessage: SchemaMessage.Assistant = yield* sessions.updateMessage({
        id: SchemaMessage.MessageID.ascending(),
        role: 'assistant',
        parentID: lastUser.id,
        sessionID,
        mode: task.agent,
        agent: task.agent,
        variant: lastUser.model.variant,
        cost: 0,
        tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
        modelID: taskModel.id,
        providerID: taskModel.providerID,
        time: { created: Date.now() }
      });
      let part: SchemaMessage.ToolPart = yield* sessions.updatePart({
        id: SchemaMessage.PartID.ascending(),
        messageID: assistantMessage.id,
        sessionID: assistantMessage.sessionID,
        type: 'tool',
        callID: ulid(),
        tool: TaskTool.id,
        state: {
          status: 'running',
          input: {
            prompt: task.prompt,
            description: task.description,
            subagent_type: task.agent,
            command: task.command
          },
          time: { start: Date.now() }
        }
      });
      const taskArgs = {
        prompt: task.prompt,
        description: task.description,
        subagent_type: task.agent,
        command: task.command
      };
      const taskAgent = yield* agents.get(task.agent);
      if (!taskAgent) {
        const available = (yield* agents.list()).filter(a => !a.hidden).map(a => a.name);
        const hint = available.length ? ` Available agents: ${available.join(', ')}` : '';
        const error = new NamedError.Unknown({
          message: `Agent not found: "${task.agent}".${hint}`
        });
        yield* event.publish(SchemaSession.Events.Error, { sessionID, error: error.toObject() });
        throw error;
      }

      let error: Error | undefined;
      const taskAbort = new AbortController();
      const result = yield* taskTool
        .execute(taskArgs, {
          agent: task.agent,
          messageID: assistantMessage.id,
          sessionID,
          abort: taskAbort.signal,
          callID: part.callID,
          extra: { bypassAgentCheck: true, promptOps },
          messages: msgs,
          metadata: (val: { title?: string; metadata?: Record<string, unknown> }) =>
            Effect.gen(function* () {
              part = yield* sessions.updatePart({
                ...part,
                type: 'tool',
                state: { ...part.state, ...val }
              } satisfies SchemaMessage.ToolPart);
            }),
          ask: (req: SchemaPermission.AskInput) =>
            permission
              .ask({
                ...req,
                sessionID,
                ruleset: Permission.merge(taskAgent.permission, session.permission ?? [])
              })
              .pipe(Effect.orDie)
        })
        .pipe(
          Effect.catchCause(cause => {
            const defect = Cause.squash(cause);
            error = defect instanceof Error ? defect : new Error(String(defect));
            log.error('subtask execution failed', {
              error,
              agent: task.agent,
              description: task.description
            });
            return Effect.void;
          }),
          Effect.onInterrupt(() =>
            Effect.gen(function* () {
              taskAbort.abort();
              assistantMessage.finish = 'tool-calls';
              assistantMessage.time.completed = Date.now();
              yield* sessions.updateMessage(assistantMessage);
              if (part.state.status === 'running') {
                yield* sessions.updatePart({
                  ...part,
                  state: {
                    status: 'error',
                    error: 'Cancelled',
                    time: { start: part.state.time.start, end: Date.now() },
                    metadata: part.state.metadata,
                    input: part.state.input
                  }
                } satisfies SchemaMessage.ToolPart);
              }
            })
          )
        );

      const attachments = result?.attachments?.map(attachment => ({
        ...attachment,
        id: SchemaMessage.PartID.ascending(),
        sessionID,
        messageID: assistantMessage.id
      }));
      assistantMessage.finish = 'tool-calls';
      assistantMessage.time.completed = Date.now();
      yield* sessions.updateMessage(assistantMessage);

      if (result && part.state.status === 'running') {
        yield* sessions.updatePart({
          ...part,
          state: {
            status: 'completed',
            input: part.state.input,
            title: result.title,
            metadata: result.metadata,
            output: result.output,
            attachments,
            time: { ...part.state.time, end: Date.now() }
          }
        } satisfies SchemaMessage.ToolPart);
      }

      if (!result) {
        yield* sessions.updatePart({
          ...part,
          state: {
            status: 'error',
            error: error ? `Tool execution failed: ${error.message}` : 'Tool execution failed',
            time: {
              start: part.state.status === 'running' ? part.state.time.start : Date.now(),
              end: Date.now()
            },
            metadata: part.state.status === 'pending' ? void 0 : part.state.metadata,
            input: part.state.input
          }
        } satisfies SchemaMessage.ToolPart);
      }

      if (!task.command) {
        return;
      }

      const summaryUserMsg: SchemaMessage.User = {
        id: SchemaMessage.MessageID.ascending(),
        sessionID,
        role: 'user',
        time: { created: Date.now() },
        agent: lastUser.agent,
        model: lastUser.model
      };
      yield* sessions.updateMessage(summaryUserMsg);
      yield* sessions.updatePart({
        id: SchemaMessage.PartID.ascending(),
        messageID: summaryUserMsg.id,
        sessionID,
        type: 'text',
        text: 'Summarize the task tool output above and continue with your task.',
        synthetic: true
      } satisfies SchemaMessage.TextPart);
    });

    const lastAssistant = Effect.fnUntraced(function* (sessionID: SchemaSession.SessionID) {
      const match = yield* sessions
        .findMessage(sessionID, m => m.info.role !== 'user')
        .pipe(Effect.orDie);
      if (Option.isSome(match)) {
        return match.value;
      }
      const msgs = yield* sessions.messages({ sessionID, limit: 1 }).pipe(Effect.orDie);
      if (msgs.length > 0) {
        return msgs[0]!;
      }
      throw new Error('Impossible');
    });

    const resolveTools = Effect.fn('SessionPrompt.resolveTools')(function* (input: {
      agent: SchemaAgent.Info;
      model: SchemaProvider.Model;
      session: SchemaSession.SessionInfo;
      tools?: Record<string, boolean>;
      processor: Pick<SessionProcessor.Handle, 'message' | 'updateToolCall' | 'completeToolCall'>;
      bypassAgentCheck: boolean;
      messages: SchemaMessage.WithParts[];
    }) {
      const tools: Record<string, AITool> = {};
      const run = yield* runner();
      const promptOps: TaskPromptOps = ops();

      const context = (
        args: Record<string, unknown>,
        options: ToolExecutionOptions
      ): SchemaTool.Context => ({
        sessionID: input.session.id,
        abort: options.abortSignal!,
        messageID: input.processor.message.id,
        callID: options.toolCallId,
        extra: { model: input.model, bypassAgentCheck: input.bypassAgentCheck, promptOps },
        agent: input.agent.name,
        messages: input.messages,
        metadata: val =>
          input.processor.updateToolCall(options.toolCallId, match => {
            if (!['running', 'pending'].includes(match.state.status)) {
              return match;
            }
            return {
              ...match,
              state: {
                title: val.title,
                metadata: val.metadata,
                status: 'running',
                input: args,
                time: { start: Date.now() }
              }
            };
          }),
        ask: req =>
          permission
            .ask({
              ...req,
              sessionID: input.session.id,
              tool: { messageID: input.processor.message.id, callID: options.toolCallId },
              ruleset: Permission.merge(input.agent.permission, input.session.permission ?? [])
            })
            .pipe(Effect.orDie)
      });

      for (const item of yield* registry.tools({
        modelID: SchemaProvider.ModelID.make(input.model.api.id),
        providerID: input.model.providerID,
        agent: input.agent
      })) {
        const schema = ProviderTransform.schema(input.model, JsonSchemaTool.fromTool(item));
        tools[item.id] = tool({
          description: item.description,
          inputSchema: jsonSchema(schema),
          execute(args: Record<string, unknown>, options) {
            return run.promise(
              Effect.gen(function* () {
                const ctx = context(args, options);
                const result = yield* item.execute(args, ctx);
                const output = {
                  ...result,
                  attachments: result.attachments?.map(attachment => ({
                    ...attachment,
                    id: SchemaMessage.PartID.ascending(),
                    sessionID: ctx.sessionID,
                    messageID: input.processor.message.id
                  }))
                };
                if (options.abortSignal?.aborted) {
                  yield* input.processor.completeToolCall(options.toolCallId, output);
                }
                return output;
              })
            );
          }
        });
      }

      for (const [key, item] of Object.entries(yield* mcp.tools())) {
        const execute = item.execute;
        if (!execute) {
          continue;
        }

        const schema = yield* Effect.promise(() =>
          Promise.resolve(asSchema(item.inputSchema).jsonSchema)
        );
        const transformed = ProviderTransform.schema(input.model, schema);
        item.inputSchema = jsonSchema(transformed);
        item.execute = (args: Record<string, unknown>, opts) =>
          run.promise(
            Effect.gen(function* () {
              const ctx = context(args, opts);
              const result = (yield* Effect.gen(function* () {
                yield* ctx.ask({ permission: key, metadata: {}, patterns: ['*'], always: ['*'] });
                // eslint-disable-next-line @typescript-eslint/no-unsafe-return
                return yield* Effect.promise(() => execute(args, opts));
              }).pipe(
                Effect.withSpan('Tool.execute', {
                  attributes: {
                    'tool.name': key,
                    'tool.call_id': opts.toolCallId,
                    'session.id': ctx.sessionID,
                    'message.id': input.processor.message.id
                  }
                })
              )) as {
                content: { type: string; [key: string]: unknown }[];
                metadata: Record<string, unknown>;
              };

              const textParts: string[] = [];
              const attachments: Omit<SchemaMessage.FilePart, 'id' | 'sessionID' | 'messageID'>[] =
                [];
              for (const contentItem of result.content) {
                if (contentItem.type === 'text') {
                  textParts.push(contentItem.text as string);
                } else if (contentItem.type === 'image') {
                  attachments.push({
                    type: 'file',
                    mime: contentItem.mimeType as string,
                    url: `data:${contentItem.mimeType as string};base64,${contentItem.data as string}`
                  });
                } else if (contentItem.type === 'resource') {
                  const { resource } = contentItem as unknown as {
                    resource: Record<string, string>;
                  };
                  if (resource.text) {
                    textParts.push(resource.text);
                  }
                  if (resource.blob) {
                    attachments.push({
                      type: 'file',
                      mime: resource.mimeType ?? 'application/octet-stream',
                      url: `data:${resource.mimeType ?? 'application/octet-stream'};base64,${resource.blob}`,
                      filename: resource.uri
                    });
                  }
                }
              }

              const truncated = yield* truncate.output(textParts.join('\n\n'), {}, input.agent);
              const metadata = {
                ...result.metadata,
                truncated: truncated.truncated,
                ...(truncated.truncated && { outputPath: truncated.outputPath })
              };

              const output = {
                title: '',
                metadata,
                output: truncated.content,
                attachments: attachments.map(attachment => ({
                  ...attachment,
                  id: SchemaMessage.PartID.ascending(),
                  sessionID: ctx.sessionID,
                  messageID: input.processor.message.id
                })),
                content: result.content
              };
              if (opts.abortSignal?.aborted) {
                yield* input.processor.completeToolCall(opts.toolCallId, output);
              }
              return output;
            })
          );
        tools[key] = item;
      }

      return tools;
    });

    const runLoop: (sessionID: SchemaSession.SessionID) => Effect.Effect<SchemaMessage.WithParts> =
      Effect.fn('SessionPrompt.run')(function* (sessionID: SchemaSession.SessionID) {
        let structured: unknown;
        let step = 0;
        const session = yield* sessions.get(sessionID).pipe(Effect.orDie);

        while (true) {
          yield* status.set(sessionID, { type: 'busy' });
          log.info('loop', { step });

          let msgs = yield* Message.filterCompactedEffect(sessionID);

          const {
            user: lastUser,
            assistant: lastAssistant,
            finished: lastFinished,
            tasks
          } = Message.latest(msgs);

          if (!lastUser) {
            throw new Error('No user message found in stream. This should never happen.');
          }

          const lastAssistantMsg = msgs.findLast(
            msg => msg.info.role === 'assistant' && msg.info.id === lastAssistant?.id
          );
          // Some providers return "stop" even when the assistant message contains tool calls.
          // Keep the loop running so tool results can be sent back to the model.
          // Skip provider-executed tool parts — those were fully handled within the
          // provider's stream (e.g. DWS Agent Platform) and don't need a re-loop.
          const hasToolCalls =
            lastAssistantMsg?.parts.some(
              part => part.type === 'tool' && !part.metadata?.providerExecuted
            ) ?? false;

          if (
            lastAssistant?.finish &&
            !['tool-calls'].includes(lastAssistant.finish) &&
            !hasToolCalls &&
            lastUser.id < lastAssistant.id
          ) {
            log.info('exiting loop');
            break;
          }

          step++;
          if (step === 1) {
            yield* title({
              session,
              modelID: lastUser.model.modelID,
              providerID: lastUser.model.providerID,
              history: msgs
            }).pipe(Effect.ignore, Effect.forkIn(scope));
          }

          const model = yield* getModel(
            lastUser.model.providerID,
            lastUser.model.modelID,
            sessionID
          );
          const task = tasks.pop();

          if (task?.type === 'subtask') {
            yield* handleSubtask({ task, model, lastUser, sessionID, session, msgs });
            continue;
          }

          if (task?.type === 'compaction') {
            const result = yield* compaction.process({
              messages: msgs,
              parentID: lastUser.id,
              sessionID,
              auto: task.auto,
              overflow: task.overflow
            });
            if (result === 'stop') {
              break;
            }
            continue;
          }

          if (
            lastFinished &&
            lastFinished.summary !== true &&
            (yield* compaction.isOverflow({ tokens: lastFinished.tokens, model }))
          ) {
            yield* compaction.create({
              sessionID,
              agent: lastUser.agent,
              model: lastUser.model,
              auto: true
            });
            continue;
          }

          const agent = yield* agents.get(lastUser.agent);
          if (!agent) {
            const available = (yield* agents.list()).filter(a => !a.hidden).map(a => a.name);
            const hint = available.length ? ` Available agents: ${available.join(', ')}` : '';
            const error = new NamedError.Unknown({
              message: `Agent not found: "${lastUser.agent}".${hint}`
            });
            yield* event.publish(SchemaSession.Events.Error, {
              sessionID,
              error: error.toObject()
            });
            throw error;
          }
          const maxSteps = agent.steps ?? Infinity;
          const isLastStep = step >= maxSteps;
          msgs = yield* SessionReminder.apply({ messages: msgs, agent, session }).pipe(
            Effect.provideService(AppFileSystem.Service, fsys),
            Effect.provideService(Session.Service, sessions)
          );

          const msg: SchemaMessage.Assistant = {
            id: SchemaMessage.MessageID.ascending(),
            parentID: lastUser.id,
            role: 'assistant',
            mode: agent.name,
            agent: agent.name,
            variant: lastUser.model.variant,
            cost: 0,
            tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
            modelID: model.id,
            providerID: model.providerID,
            time: { created: Date.now() },
            sessionID
          };
          yield* sessions.updateMessage(msg);

          const finalizeInterruptedAssistant = Effect.gen(function* () {
            if (msg.time.completed) {
              return;
            }
            msg.error ??= SchemaMessage.fromError(new DOMException('Aborted', 'AbortError'), {
              providerID: msg.providerID,
              aborted: true
            });
            msg.time.completed = Date.now();
            yield* sessions.updateMessage(msg);
          });

          const handle = yield* processor
            .create({
              assistantMessage: msg,
              sessionID,
              model
            })
            .pipe(Effect.onInterrupt(() => finalizeInterruptedAssistant));

          const outcome: 'break' | 'continue' = yield* Effect.gen(function* () {
            const lastUserMsg = msgs.findLast(m => m.info.role === 'user');
            const bypassAgentCheck = lastUserMsg?.parts.some(p => p.type === 'agent') ?? false;

            const tools = yield* resolveTools({
              agent,
              session,
              model,
              tools: lastUser.tools,
              processor: handle,
              bypassAgentCheck,
              messages: msgs
            });

            if (lastUser.format?.type === 'json_schema') {
              tools['StructuredOutput'] = createStructuredOutputTool({
                schema: lastUser.format.schema,
                onSuccess(output) {
                  structured = output;
                }
              });
            }

            if (step > 1 && lastFinished) {
              for (const m of msgs) {
                if (m.info.role !== 'user' || m.info.id <= lastFinished.id) {
                  continue;
                }
                for (const p of m.parts) {
                  if (p.type !== 'text' || p.ignored || p.synthetic) {
                    continue;
                  }
                  if (!p.text.trim()) {
                    continue;
                  }
                  p.text = [
                    '<system-reminder>',
                    'The user sent the following message:',
                    p.text,
                    '',
                    'Please address this message and continue with your tasks.',
                    '</system-reminder>'
                  ].join('\n');
                }
              }
            }

            const [skills, env, instructions, modelMsgs] = yield* Effect.all([
              sys.skills(agent),
              sys.environment(model),
              instruction.system().pipe(Effect.orDie),
              Message.toModelMessagesEffect(msgs, model)
            ]);
            const system = [...env, ...instructions, ...(skills ? [skills] : [])];
            const format = lastUser.format ?? { type: 'text' as const };
            if (format.type === 'json_schema') {
              system.push(STRUCTURED_OUTPUT_SYSTEM_PROMPT);
            }
            const result = yield* handle.process({
              user: lastUser,
              agent,
              permission: session.permission,
              sessionID,
              parentSessionID: session.parentID,
              system,
              messages: [
                ...modelMsgs,
                ...(isLastStep ? [{ role: 'assistant' as const, content: MAX_STEPS }] : [])
              ],
              tools,
              model,
              toolChoice: format.type === 'json_schema' ? 'required' : void 0
            });

            if (structured !== void 0) {
              handle.message.structured = structured;
              handle.message.finish = handle.message.finish ?? 'stop';
              yield* sessions.updateMessage(handle.message);
              return 'break' as const;
            }

            const finished =
              handle.message.finish && !['tool-calls', 'unknown'].includes(handle.message.finish);
            if (finished && !handle.message.error) {
              if (format.type === 'json_schema') {
                handle.message.error = new SchemaMessage.StructuredOutputError({
                  message: 'Model did not produce structured output',
                  retries: 0
                }).toObject();
                yield* sessions.updateMessage(handle.message);
                return 'break' as const;
              }
            }

            if (result === 'stop') {
              return 'break' as const;
            }
            if (result === 'compact') {
              yield* compaction.create({
                sessionID,
                agent: lastUser.agent,
                model: lastUser.model,
                auto: true,
                overflow: !handle.message.finish
              });
            }
            return 'continue' as const;
          }).pipe(
            Effect.ensuring(instruction.clear(handle.message.id)),
            Effect.onInterrupt(() => finalizeInterruptedAssistant)
          );
          if (outcome === 'break') {
            break;
          }
        }

        yield* compaction.prune({ sessionID }).pipe(Effect.ignore, Effect.forkIn(scope));
        return yield* lastAssistant(sessionID);
      }, Effect.orDie);

    const loop: (input: SchemaSession.LoopInput) => Effect.Effect<SchemaMessage.WithParts> =
      Effect.fn('SessionPrompt.loop')(function* (input: SchemaSession.LoopInput) {
        return yield* state.ensureRunning(
          input.sessionID,
          lastAssistant(input.sessionID),
          runLoop(input.sessionID)
        );
      });

    const currentModel = Effect.fnUntraced(function* (sessionID: SchemaSession.SessionID) {
      const current = yield* sessions.get(sessionID).pipe(Effect.orDie);
      if (current?.model) {
        return {
          providerID: SchemaProvider.ProviderID.make(current.model.providerID),
          modelID: SchemaProvider.ModelID.make(current.model.id),
          ...(current.model.variant && current.model.variant !== 'default'
            ? { variant: current.model.variant }
            : {})
        };
      }
      const match = yield* sessions
        .findMessage(sessionID, m => m.info.role === 'user' && !!m.info.model)
        .pipe(Effect.orDie);
      if (Option.isSome(match) && match.value.info.role === 'user') {
        return match.value.info.model;
      }
      return yield* provider.defaultModel();
    });

    const createUserMessage = Effect.fn('SessionPrompt.createUserMessage')(function* (
      input: SchemaSession.PromptInput
    ) {
      const agentName = input.agent;
      const ag = agentName ? yield* agents.get(agentName) : yield* agents.defaultInfo();
      if (!ag) {
        return yield* agentNotFound(agentName, input);
      }
      const model = input.model ?? ag.model ?? (yield* currentModel(input.sessionID));
      const same =
        ag.model && model.providerID === ag.model.providerID && model.modelID === ag.model.modelID;
      const full =
        !input.variant && ag.variant && same
          ? yield* provider.getModel(model.providerID, model.modelID).pipe(
              Effect.catchIf(
                (e): e is SchemaProvider.ModelNotFoundError =>
                  SchemaProvider.ModelNotFoundError.isInstance(e),
                () => Effect.succeed(void 0)
              )
            )
          : void 0;
      const variant =
        input.variant ?? (ag.variant && full?.variants?.[ag.variant] ? ag.variant : void 0);

      const info: SchemaMessage.User = {
        id: input.messageID ?? SchemaMessage.MessageID.ascending(),
        role: 'user',
        sessionID: input.sessionID,
        time: { created: Date.now() },
        tools: input.tools,
        agent: ag.name,
        model: {
          providerID: model.providerID,
          modelID: model.modelID,
          variant
        },
        system: input.system,
        format: input.format
      };

      const current = yield* sessions.get(input.sessionID).pipe(Effect.orDie);
      if (current?.agent !== info.agent) {
        yield* event.publish(SchemaSession.DurableEvent.AgentSwitched, {
          messageID: info.id,
          sessionID: input.sessionID,
          timestamp: DateTime.makeUnsafe(info.time.created),
          agent: info.agent
        });
      }
      if (
        current?.model?.providerID !== info.model.providerID ||
        current.model.id !== info.model.modelID ||
        (current.model.variant === 'default' ? void 0 : current.model.variant) !==
          info.model.variant
      ) {
        yield* event.publish(SchemaSession.DurableEvent.ModelSwitched, {
          messageID: info.id,
          sessionID: input.sessionID,
          timestamp: DateTime.makeUnsafe(info.time.created),
          model: {
            modelID: SchemaProvider.ModelID.make(info.model.modelID),
            providerID: SchemaProvider.ProviderID.make(info.model.providerID),
            variant: SchemaProvider.VariantID.make(info.model.variant ?? 'default')
          }
        });
      }

      yield* Effect.addFinalizer(() => instruction.clear(info.id));

      type Draft<T> = T extends SchemaMessage.Part ? Omit<T, 'id'> & { id?: string } : never;
      const assign = (part: Draft<SchemaMessage.Part>): SchemaMessage.Part => ({
        ...part,
        id: part.id ? SchemaMessage.PartID.make(part.id) : SchemaMessage.PartID.ascending()
      });

      const resolvePart: (
        part: SchemaSession.PromptInput['parts'][number]
      ) => Effect.Effect<Draft<SchemaMessage.Part>[]> = Effect.fn('SessionPrompt.resolveUserPart')(
        function* (part) {
          if (part.type === 'file') {
            if (part.source?.type === 'resource') {
              const { clientName, uri } = part.source;
              log.info('mcp resource', { clientName, uri, mime: part.mime });
              const pieces: Draft<SchemaMessage.Part>[] = [
                {
                  messageID: info.id,
                  sessionID: input.sessionID,
                  type: 'text',
                  synthetic: true,
                  text: `Reading MCP resource: ${part.filename} (${uri})`
                }
              ];
              const exit = yield* mcp.readResource(clientName, uri).pipe(Effect.exit);
              if (Exit.isSuccess(exit)) {
                const content = exit.value;
                if (!content) {
                  throw new Error(`Resource not found: ${clientName}/${uri}`);
                }
                const items = Array.isArray(content.contents)
                  ? content.contents
                  : [content.contents];
                for (const c of items) {
                  if ('text' in c && c.text) {
                    pieces.push({
                      messageID: info.id,
                      sessionID: input.sessionID,
                      type: 'text',
                      synthetic: true,
                      text: c.text
                    });
                  } else if ('blob' in c && c.blob) {
                    const mime = 'mimeType' in c ? c.mimeType : part.mime;
                    pieces.push({
                      messageID: info.id,
                      sessionID: input.sessionID,
                      type: 'text',
                      synthetic: true,
                      text: `[Binary content: ${mime}]`
                    });
                  }
                }
                pieces.push({ ...part, messageID: info.id, sessionID: input.sessionID });
              } else {
                const error = Cause.squash(exit.cause);
                log.error('failed to read MCP resource', { error, clientName, uri });
                const message = error instanceof Error ? error.message : String(error);
                pieces.push({
                  messageID: info.id,
                  sessionID: input.sessionID,
                  type: 'text',
                  synthetic: true,
                  text: `Failed to read MCP resource ${part.filename}: ${message}`
                });
              }
              return pieces;
            }
            const url = new URL(part.url);
            switch (url.protocol) {
              case 'data:':
                if (part.mime === 'text/plain') {
                  return [
                    {
                      messageID: info.id,
                      sessionID: input.sessionID,
                      type: 'text',
                      synthetic: true,
                      text: `Called the Read tool with the following input: ${JSON.stringify({ filePath: part.filename })}`
                    },
                    {
                      messageID: info.id,
                      sessionID: input.sessionID,
                      type: 'text',
                      synthetic: true,
                      text: Encrypto.decodeDataUrl(part.url)
                    },
                    { ...part, messageID: info.id, sessionID: input.sessionID }
                  ];
                }
                break;
              case 'file:': {
                log.info('file', { mime: part.mime });
                const filepath = fileURLToPath(part.url);
                const mime = (yield* fsys.isDir(filepath)) ? 'application/x-directory' : part.mime;

                const { read } = yield* registry.named();
                const execRead = (
                  args: Parameters<typeof read.execute>[0],
                  extra?: SchemaTool.Context['extra']
                ) => {
                  const controller = new AbortController();
                  return read
                    .execute(args, {
                      sessionID: input.sessionID,
                      abort: controller.signal,
                      agent: input.agent!,
                      messageID: info.id,
                      extra: { bypassCwdCheck: true, ...extra },
                      messages: [],
                      metadata: () => Effect.void,
                      ask: () => Effect.void
                    })
                    .pipe(Effect.onInterrupt(() => Effect.sync(() => controller.abort())));
                };

                if (mime === 'text/plain') {
                  let offset: number | undefined;
                  let limit: number | undefined;
                  const range = {
                    start: url.searchParams.get('start'),
                    end: url.searchParams.get('end')
                  };
                  if (range.start != null) {
                    const start = parseInt(range.start);
                    const end = range.end ? parseInt(range.end) : void 0;
                    offset = Math.max(start, 1);
                    if (end) {
                      limit = end - (offset - 1);
                    }
                  }
                  const args = { filePath: filepath, offset, limit };
                  const pieces: Draft<SchemaMessage.Part>[] = [
                    {
                      messageID: info.id,
                      sessionID: input.sessionID,
                      type: 'text',
                      synthetic: true,
                      text: `Called the Read tool with the following input: ${JSON.stringify(args)}`
                    }
                  ];
                  const exit = yield* provider
                    .getModel(info.model.providerID, info.model.modelID)
                    .pipe(
                      Effect.flatMap(mdl => execRead(args, { model: mdl })),
                      Effect.exit
                    );
                  if (Exit.isSuccess(exit)) {
                    const result = exit.value;
                    pieces.push({
                      messageID: info.id,
                      sessionID: input.sessionID,
                      type: 'text',
                      synthetic: true,
                      text: result.output
                    });
                    if (result.attachments?.length) {
                      pieces.push(
                        ...result.attachments.map(a => ({
                          ...a,
                          synthetic: true,
                          filename: a.filename ?? part.filename,
                          messageID: info.id,
                          sessionID: input.sessionID
                        }))
                      );
                    } else {
                      pieces.push({
                        ...part,
                        mime,
                        messageID: info.id,
                        sessionID: input.sessionID
                      });
                    }
                  } else {
                    const error = Cause.squash(exit.cause);
                    log.error('failed to read file', { error });
                    const message = error instanceof Error ? error.message : String(error);
                    yield* event.publish(SchemaSession.Events.Error, {
                      sessionID: input.sessionID,
                      error: new NamedError.Unknown({ message }).toObject()
                    });
                    pieces.push({
                      messageID: info.id,
                      sessionID: input.sessionID,
                      type: 'text',
                      synthetic: true,
                      text: `Read tool failed to read ${filepath} with the following error: ${message}`
                    });
                  }
                  return pieces;
                }

                if (mime === 'application/x-directory') {
                  const args = { filePath: filepath };
                  const exit = yield* execRead(args).pipe(Effect.exit);
                  if (Exit.isFailure(exit)) {
                    const error = Cause.squash(exit.cause);
                    log.error('failed to read directory', { error });
                    const message = error instanceof Error ? error.message : String(error);
                    yield* event.publish(SchemaSession.Events.Error, {
                      sessionID: input.sessionID,
                      error: new NamedError.Unknown({ message }).toObject()
                    });
                    return [
                      {
                        messageID: info.id,
                        sessionID: input.sessionID,
                        type: 'text',
                        synthetic: true,
                        text: `Read tool failed to read ${filepath} with the following error: ${message}`
                      }
                    ];
                  }
                  return [
                    {
                      messageID: info.id,
                      sessionID: input.sessionID,
                      type: 'text',
                      synthetic: true,
                      text: `Called the Read tool with the following input: ${JSON.stringify(args)}`
                    },
                    {
                      messageID: info.id,
                      sessionID: input.sessionID,
                      type: 'text',
                      synthetic: true,
                      text: exit.value.output
                    },
                    { ...part, mime, messageID: info.id, sessionID: input.sessionID }
                  ];
                }

                return [
                  {
                    messageID: info.id,
                    sessionID: input.sessionID,
                    type: 'text',
                    synthetic: true,
                    text: `Called the Read tool with the following input: {"filePath":"${filepath}"}`
                  },
                  {
                    id: part.id,
                    messageID: info.id,
                    sessionID: input.sessionID,
                    type: 'file',
                    url:
                      `data:${mime};base64,` +
                      Buffer.from(
                        yield* fsys.readFile(filepath).pipe(Effect.catch(Effect.die))
                      ).toString('base64'),
                    mime,
                    filename: part.filename!,
                    source: part.source
                  }
                ];
              }
            }
          }

          if (part.type === 'agent') {
            const perm = Permission.evaluate('task', part.name, ag.permission);
            const hint = perm.action === 'deny' ? ' . Invoked by user; guaranteed to exist.' : '';
            return [
              { ...part, messageID: info.id, sessionID: input.sessionID },
              {
                messageID: info.id,
                sessionID: input.sessionID,
                type: 'text',
                synthetic: true,
                text:
                  ' Use the above message and context to generate a prompt and call the task tool with subagent: ' +
                  part.name +
                  hint
              }
            ];
          }

          return [{ ...part, messageID: info.id, sessionID: input.sessionID }];
        }
      );

      const resolvedParts = yield* Effect.forEach(input.parts, resolvePart, {
        concurrency: 'unbounded'
      }).pipe(Effect.map(x => x.flat().map(assign)));

      const parts = yield* Effect.forEach(resolvedParts, part =>
        part.type === 'file' && part.mime.startsWith('image/')
          ? image.normalize(part).pipe(
              Effect.catchIf(
                error => error instanceof SchemaImage.ResizerUnavailableError,
                () => Effect.succeed(part)
              )
            )
          : Effect.succeed(part)
      );

      const parsed = decodeMessageInfo(info, { errors: 'all', propertyOrder: 'original' });
      if (Exit.isFailure(parsed)) {
        log.error('invalid user message before save', {
          sessionID: input.sessionID,
          messageID: info.id,
          agent: info.agent,
          model: info.model,
          cause: Cause.pretty(parsed.cause)
        });
      }
      parts.forEach((part, index) => {
        const p = decodeMessagePart(part, { errors: 'all', propertyOrder: 'original' });
        if (Exit.isSuccess(p)) {
          return;
        }
        log.error('invalid user part before save', {
          sessionID: input.sessionID,
          messageID: info.id,
          partID: part.id,
          partType: part.type,
          index,
          cause: Cause.pretty(p.cause),
          part
        });
      });

      yield* sessions.updateMessage(info);
      for (const part of parts) {
        yield* sessions.updatePart(part);
      }
      const nextPrompt = parts.reduce(
        (result, part) => {
          if (part.type === 'text') {
            if (part.synthetic) {
              result.synthetic.push(part.text);
            } else {
              result.text.push(part.text);
            }
          }
          if (part.type === 'file') {
            result.files.push(
              new SchemaSession.FileAttachment({
                uri: part.url,
                mime: part.mime,
                name: part.filename,
                source: part.source
                  ? new SchemaSession.Source({
                      start: part.source.text.start,
                      end: part.source.text.end,
                      text: part.source.text.value
                    })
                  : void 0
              })
            );
          }
          if (part.type === 'agent') {
            result.agents.push(
              new SchemaSession.AgentAttachment({
                name: part.name,
                source: part.source
                  ? new SchemaSession.Source({
                      start: part.source.start,
                      end: part.source.end,
                      text: part.source.value
                    })
                  : void 0
              })
            );
          }
          return result;
        },
        {
          text: [] as string[],
          files: [] as SchemaSession.FileAttachment[],
          agents: [] as SchemaSession.AgentAttachment[],
          synthetic: [] as string[]
        }
      );
      // TODO(v2): Temporary dual-write while migrating session messages to v2 events.
      if (Flag.EXPERIMENTAL_EVENT_SYSTEM) {
        yield* event.publish(SchemaSession.DurableEvent.Prompted, {
          sessionID: input.sessionID,
          messageID: info.id,
          timestamp: DateTime.makeUnsafe(info.time.created),
          prompt: {
            text: nextPrompt.text.join('\n'),
            files: nextPrompt.files,
            agents: nextPrompt.agents
          },
          delivery: 'steer'
        });
      }
      for (const text of nextPrompt.synthetic) {
        // TODO(v2): Temporary dual-write while migrating session messages to v2 events.
        if (Flag.EXPERIMENTAL_EVENT_SYSTEM) {
          yield* event.publish(SchemaSession.DurableEvent.Synthetic, {
            messageID: info.id,
            sessionID: input.sessionID,
            timestamp: DateTime.makeUnsafe(info.time.created),
            text
          });
        }
      }
      return { info, parts };
    }, Effect.scoped);

    const shellImpl = Effect.fn('SessionPrompt.shellImpl')(
      function* (input: SchemaSession.ShellInput, ready?: Latch.Latch) {
        return yield* Effect.uninterruptibleMask(restore =>
          Effect.gen(function* () {
            const markReady = ready ? ready.open.pipe(Effect.asVoid) : Effect.void;
            const { msg, part, cwd } = yield* Effect.gen(function* () {
              const directory = yield* InstanceContext.directory;
              const agent = yield* agents.get(input.agent);
              if (!agent) {
                const available = (yield* agents.list()).filter(a => !a.hidden).map(a => a.name);
                const hint = available.length ? ` Available agents: ${available.join(', ')}` : '';
                const error = new NamedError.Unknown({
                  message: `Agent not found: "${input.agent}".${hint}`
                });
                yield* event.publish(SchemaSession.Events.Error, {
                  sessionID: input.sessionID,
                  error: error.toObject()
                });
                throw error;
              }
              const model = input.model ?? agent.model ?? (yield* currentModel(input.sessionID));
              const userMsg: SchemaMessage.User = {
                id: input.messageID ?? SchemaMessage.MessageID.ascending(),
                sessionID: input.sessionID,
                time: { created: Date.now() },
                role: 'user',
                agent: input.agent,
                model: { providerID: model.providerID, modelID: model.modelID }
              };
              yield* sessions.updateMessage(userMsg);
              const userPart: SchemaMessage.Part = {
                type: 'text',
                id: SchemaMessage.PartID.ascending(),
                messageID: userMsg.id,
                sessionID: input.sessionID,
                text: 'The following tool was executed by the user',
                synthetic: true
              };
              yield* sessions.updatePart(userPart);

              const msg: SchemaMessage.Assistant = {
                id: SchemaMessage.MessageID.ascending(),
                sessionID: input.sessionID,
                parentID: userMsg.id,
                mode: input.agent,
                agent: input.agent,
                cost: 0,
                time: { created: Date.now() },
                role: 'assistant',
                tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
                modelID: model.modelID,
                providerID: model.providerID
              };
              yield* sessions.updateMessage(msg);
              const callID = ulid();
              const started = Date.now();
              const part: SchemaMessage.ToolPart = {
                type: 'tool',
                id: SchemaMessage.PartID.ascending(),
                messageID: msg.id,
                sessionID: input.sessionID,
                tool: ShellToolID,
                callID: ulid(),
                state: {
                  status: 'running',
                  time: { start: started },
                  input: { command: input.command }
                }
              };
              yield* sessions.updatePart(part);
              if (Flag.EXPERIMENTAL_EVENT_SYSTEM) {
                yield* event.publish(SchemaSession.DurableEvent.Shell.Started, {
                  messageID: msg.id,
                  sessionID: input.sessionID,
                  timestamp: DateTime.makeUnsafe(started),
                  callID,
                  command: input.command
                });
              }
              return { msg, part, cwd: directory };
            }).pipe(Effect.ensuring(markReady));

            const cfg = yield* config.get();
            const sh = ShellUtil.preferred(cfg.shell);
            const args = ShellUtil.args(sh, input.command, cwd);
            let output = '';
            let aborted = false;

            const finish = Effect.uninterruptible(
              Effect.gen(function* () {
                if (aborted) {
                  output +=
                    '\n\n' + ['<metadata>', 'User aborted the command', '</metadata>'].join('\n');
                }
                const completed = Date.now();
                if (Flag.EXPERIMENTAL_EVENT_SYSTEM) {
                  yield* event.publish(SchemaSession.DurableEvent.Shell.Ended, {
                    sessionID: input.sessionID,
                    timestamp: DateTime.makeUnsafe(completed),
                    callID: part.callID,
                    output
                  });
                }
                if (!msg.time.completed) {
                  msg.time.completed = completed;
                  yield* sessions.updateMessage(msg);
                }
                if (part.state.status === 'running') {
                  part.state = {
                    status: 'completed',
                    time: { ...part.state.time, end: completed },
                    input: part.state.input,
                    title: '',
                    metadata: { output, description: '' },
                    output
                  };
                  yield* sessions.updatePart(part);
                }
              })
            );

            const exit = yield* restore(
              Effect.gen(function* () {
                const cmd = ChildProcess.make(sh, args, {
                  cwd,
                  extendEnv: true,
                  env: { TERM: 'dumb' },
                  stdin: 'ignore',
                  forceKillAfter: '3 seconds'
                });
                const handle = yield* spawner.spawn(cmd);
                yield* Stream.runForEach(Stream.decodeText(handle.all), chunk =>
                  Effect.gen(function* () {
                    output += chunk;
                    if (part.state.status === 'running') {
                      part.state.metadata = { output, description: '' };
                      yield* sessions.updatePart(part);
                    }
                  })
                );
                yield* handle.exitCode;
              }).pipe(Effect.scoped, Effect.orDie)
            ).pipe(Effect.exit);

            if (
              Exit.isFailure(exit) &&
              Cause.hasInterrupts(exit.cause) &&
              !Cause.hasDies(exit.cause)
            ) {
              aborted = true;
            }
            yield* finish;

            if (Exit.isFailure(exit) && !aborted && !Cause.hasInterruptsOnly(exit.cause)) {
              return yield* Effect.failCause(exit.cause);
            }

            return { info: msg, parts: [part] };
          })
        );
      },
      Effect.provideService(AppFileSystem.Service, fsys)
    );

    const cancel = Effect.fn('SessionPrompt.cancel')(function* (
      sessionID: SchemaSession.SessionID
    ) {
      log.info('cancel', { 'session.id': sessionID });
      yield* state.cancel(sessionID);
    });

    const prompt: (
      input: SchemaSession.PromptInput
    ) => Effect.Effect<SchemaMessage.WithParts, SchemaImage.Error> = Effect.fn(
      'SessionPrompt.prompt'
    )(function* (input: SchemaSession.PromptInput) {
      const session = yield* sessions.get(input.sessionID).pipe(Effect.orDie);
      const message = yield* createUserMessage(input);
      yield* sessions.touch(input.sessionID);

      const permissions: SchemaPermission.Ruleset = [];
      for (const [t, enabled] of Object.entries(input.tools ?? {})) {
        permissions.push({ permission: t, action: enabled ? 'allow' : 'deny', pattern: '*' });
      }
      if (permissions.length > 0) {
        session.permission = permissions;
        yield* sessions.setPermission({ sessionID: session.id, permission: permissions });
      }

      if (input.noReply === true) {
        return message;
      }
      return yield* loop({ sessionID: input.sessionID });
    });

    const command = Effect.fn('SessionPrompt.command')(function* (
      input: SchemaSession.CommandInput
    ) {
      log.info('command', {
        sessionID: input.sessionID,
        command: input.command,
        agent: input.agent
      });
      const cmd = yield* commands.get(input.command);
      if (!cmd) {
        const available = (yield* commands.list()).map(c => c.name);
        const hint = available.length ? ` Available commands: ${available.join(', ')}` : '';
        const error = new NamedError.Unknown({
          message: `Command not found: "${input.command}".${hint}`
        });
        yield* event.publish(SchemaSession.Events.Error, {
          sessionID: input.sessionID,
          error: error.toObject()
        });
        throw error;
      }
      const agentName = cmd.agent ?? input.agent;

      const raw = input.arguments.match(argsRegex) ?? [];
      const args = raw.map(arg => arg.replace(quoteTrimRegex, ''));
      const templateCommand = yield* Effect.promise(async () => cmd.template);

      const placeholders = templateCommand.match(placeholderRegex) ?? [];
      let last = 0;
      for (const item of placeholders) {
        const value = Number(item.slice(1));
        if (value > last) {
          last = value;
        }
      }

      const withArgs = templateCommand.replaceAll(placeholderRegex, (_: string, index) => {
        const position = Number(index);
        const argIndex = position - 1;
        if (argIndex >= args.length) {
          return '';
        }
        if (position === last) {
          return args.slice(argIndex).join(' ');
        }
        return args[argIndex]!;
      });
      const usesArgumentsPlaceholder = templateCommand.includes('$ARGUMENTS');
      let template = withArgs.replaceAll('$ARGUMENTS', input.arguments);

      if (placeholders.length === 0 && !usesArgumentsPlaceholder && input.arguments.trim()) {
        template = template + '\n\n' + input.arguments;
      }

      const shellMatches = ConfigMarkdown.shell(template);
      if (shellMatches.length > 0) {
        const cfg = yield* config.get();
        const sh = ShellUtil.preferred(cfg.shell);
        const results = yield* Effect.promise(() =>
          Promise.all(
            shellMatches.map(
              async ([, cmd]) => (await ProcessUtil.text([cmd!], { shell: sh, nothrow: true })).text
            )
          )
        );
        let index = 0;
        template = template.replace(bashRegex, () => results[index++]!);
      }
      template = template.trim();

      const taskModel = yield* Effect.gen(function* () {
        if (cmd.model) {
          return Provider.parseModel(cmd.model);
        }
        if (cmd.agent) {
          const cmdAgent = yield* agents.get(cmd.agent);
          if (cmdAgent?.model) {
            return cmdAgent.model;
          }
        }
        if (input.model) {
          return Provider.parseModel(input.model);
        }
        return yield* currentModel(input.sessionID);
      });

      yield* getModel(taskModel.providerID, taskModel.modelID, input.sessionID);

      const agent = agentName ? yield* agents.get(agentName) : yield* agents.defaultInfo();
      if (!agent) {
        return yield* agentNotFound(agentName, input);
      }

      const templateParts = yield* resolvePromptParts(template);
      const isSubtask =
        (agent.mode === 'subagent' && cmd.subtask !== false) || cmd.subtask === true;
      const parts = isSubtask
        ? [
            {
              type: 'subtask' as const,
              agent: agent.name,
              description: cmd.description ?? '',
              command: input.command,
              model: { providerID: taskModel.providerID, modelID: taskModel.modelID },
              prompt: templateParts.find(y => y.type === 'text')?.text ?? ''
            }
          ]
        : [...templateParts, ...(input.parts ?? [])];

      const userAgent = isSubtask
        ? (input.agent ?? (yield* agents.defaultInfo()).name)
        : agent.name;
      const userModel = isSubtask
        ? input.model
          ? Provider.parseModel(input.model)
          : yield* currentModel(input.sessionID)
        : taskModel;

      const result = yield* prompt({
        sessionID: input.sessionID,
        messageID: input.messageID,
        model: userModel,
        agent: userAgent,
        parts,
        variant: input.variant
      });
      yield* event.publish(SchemaCommand.Events.Executed, {
        name: input.command,
        sessionID: input.sessionID,
        arguments: input.arguments,
        messageID: result.info.id
      });
      return result;
    });

    const shell: (
      input: SchemaSession.ShellInput
    ) => Effect.Effect<SchemaMessage.WithParts, SchemaSession.BusyError> = Effect.fn(
      'SessionPrompt.shell'
    )(function* (input: SchemaSession.ShellInput) {
      const ready = yield* Latch.make();
      return yield* state.startShell(
        input.sessionID,
        lastAssistant(input.sessionID),
        shellImpl(input, ready),
        ready
      );
    });

    return Service.of({
      cancel,
      prompt,
      loop,
      shell,
      command,
      resolvePromptParts
    });
  })
);

export const defaultLayer = layer.pipe(
  Layer.provide(SessionStatus.defaultLayer),
  Layer.provide(Session.defaultLayer),
  Layer.provide(Provider.defaultLayer),
  Layer.provide(SessionProcessor.defaultLayer),
  Layer.provide(SessionCompaction.defaultLayer),
  Layer.provide(Command.defaultLayer),
  Layer.provide(Config.defaultLayer),
  Layer.provide(Permission.defaultLayer),
  Layer.provide(AppFileSystem.defaultLayer),
  Layer.provide(MCP.defaultLayer),
  Layer.provide(ToolRegistry.defaultLayer),
  Layer.provide(Truncate.defaultLayer),
  Layer.provide(Image.defaultLayer),
  Layer.provide(Instruction.defaultLayer),
  Layer.provide(SessionRunState.defaultLayer),
  Layer.provide(
    Layer.mergeAll(
      Agent.defaultLayer,
      SystemPrompt.defaultLayer,
      LLM.defaultLayer,
      CrossSpawnSpawner.defaultLayer,
      Event.defaultLayer
    )
  )
);
