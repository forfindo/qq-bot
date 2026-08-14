import { Context, Effect, Layer } from 'effect';
import { SchemaAgent } from '@/schema';
import { Config } from '@/config';
import { Skill } from '@/skill';
import { Provider } from '@/provider';
import { ModuleState } from '@/instance';
import { Truncate } from '@/tool';
import path from 'path';
import { Global } from '@/utils';
import { Permission } from '@/permission';
import { AppFileSystem } from '@/file-system';
import PROMPT_EXPLORE from './prompt/explore.md';
import PROMPT_COMPACTION from './prompt/compaction.md';
import PROMPT_TITLE from './prompt/title.md';
import PROMPT_SUMMARY from './prompt/summary.md';
import { mergeDeep, pipe, values, sortBy } from 'remeda';

interface State {
  agents: Record<string, SchemaAgent.Info>;
}

export interface Interface {
  readonly get: (agent: string) => Effect.Effect<SchemaAgent.Info | undefined>;
  readonly list: () => Effect.Effect<SchemaAgent.Info[]>;
  readonly defaultInfo: () => Effect.Effect<SchemaAgent.Info>;
  readonly defaultAgent: () => Effect.Effect<string>;
}

export class Service extends Context.Service<Service, Interface>()('@openchat/Agent') {}

export const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const config = yield* Config.Service;
    const skill = yield* Skill.Service;

    const state = yield* ModuleState.make<State>(
      Effect.fn('Agent.state')(function* () {
        const cfg = yield* config.get();
        const skillDir = yield* skill.dirs();
        const whitelistedDirs = [
          Truncate.GLOB,
          path.join(Global.Path.tmp, '*'),
          ...skillDir.map(dir => path.join(dir, '*'))
        ];
        const readonlyExternalDirectory = {
          '*': 'ask',
          ...Object.fromEntries(whitelistedDirs.map(dir => [dir, 'allow']))
        } satisfies Record<string, 'allow' | 'ask' | 'deny'>;

        const defaults = Permission.fromConfig({
          '*': 'allow',
          doom_loop: 'ask',
          external_directory: readonlyExternalDirectory,
          question: 'deny',
          plan_enter: 'deny',
          plan_exit: 'deny',
          // mirrors github.com/github/gitignore Node.gitignore pattern for .env files
          read: {
            '*': 'allow',
            '*.env': 'ask',
            '*.env.*': 'ask',
            '*.env.example': 'allow'
          }
        });

        const user = Permission.fromConfig(cfg.permission ?? {});

        const agents: Record<string, SchemaAgent.Info> = {
          build: {
            name: 'build',
            description: 'The default agent. Executes tools based on configured permissions.',
            options: {},
            permission: Permission.merge(
              defaults,
              Permission.fromConfig({
                question: 'allow',
                plan_enter: 'allow'
              }),
              user
            ),
            mode: 'primary',
            native: true
          },
          // Ready to open to general users, not allowed to exit this mode
          plan: {
            name: 'plan',
            description: 'Plan mode. Disallows all edit tools.',
            options: {},
            permission: Permission.merge(
              defaults,
              Permission.fromConfig({
                question: 'allow',
                plan_exit: 'deny',
                external_directory: {
                  [path.join(Global.Path.data, 'plans', '*')]: 'allow'
                },
                edit: {
                  '*': 'deny',
                  [path.join('.openchat', 'plans', '*.md')]: 'allow'
                }
              }),
              user
            ),
            mode: 'primary',
            native: true
          },
          general: {
            name: 'general',
            description: `General-purpose agent for researching complex questions and executing multi-step tasks. Use this agent to execute multiple units of work in parallel.`,
            permission: Permission.merge(
              defaults,
              Permission.fromConfig({
                todowrite: 'deny'
              }),
              user
            ),
            options: {},
            mode: 'subagent',
            native: true
          },
          explore: {
            name: 'explore',
            permission: Permission.merge(
              defaults,
              Permission.fromConfig({
                '*': 'deny',
                grep: 'allow',
                glob: 'allow',
                list: 'allow',
                bash: 'allow',
                webfetch: 'allow',
                websearch: 'allow',
                read: 'allow',
                external_directory: readonlyExternalDirectory
              }),
              user
            ),
            description: `Fast agent specialized for exploring the file system. Use this when you need to quickly find files by patterns (eg. "src/components/**/*.tsx"), search code for keywords (eg. "API endpoints"), or answer questions about the codebase (eg. "how do API endpoints work?"). When calling this agent, specify the desired thoroughness level: "quick" for basic searches, "medium" for moderate exploration, or "very thorough" for comprehensive analysis across multiple locations and naming conventions.`,
            prompt: PROMPT_EXPLORE,
            options: {},
            mode: 'subagent',
            native: true
          },
          compaction: {
            name: 'compaction',
            mode: 'primary',
            native: true,
            hidden: true,
            prompt: PROMPT_COMPACTION,
            permission: Permission.merge(
              defaults,
              Permission.fromConfig({
                '*': 'deny'
              }),
              user
            ),
            options: {}
          },
          title: {
            name: 'title',
            mode: 'primary',
            options: {},
            native: true,
            hidden: true,
            temperature: 0.5,
            permission: Permission.merge(
              defaults,
              Permission.fromConfig({
                '*': 'deny'
              }),
              user
            ),
            prompt: PROMPT_TITLE
          },
          summary: {
            name: 'summary',
            mode: 'primary',
            options: {},
            native: true,
            hidden: true,
            permission: Permission.merge(
              defaults,
              Permission.fromConfig({
                '*': 'deny'
              }),
              user
            ),
            prompt: PROMPT_SUMMARY
          }
        };

        for (const [key, value] of Object.entries(cfg.agent ?? {})) {
          if (value.disable) {
            delete agents[key];
            continue;
          }
          let item = agents[key];
          if (!item) {
            item = agents[key] = {
              name: key,
              mode: 'all',
              permission: Permission.merge(defaults, user),
              options: {},
              native: false
            };
          }
          if (value.model) {
            item.model = Provider.parseModel(value.model);
          }
          item.variant = value.variant ?? item.variant;
          item.prompt = value.prompt ?? item.prompt;
          item.description = value.description ?? item.description;
          item.temperature = value.temperature ?? item.temperature;
          item.topP = value.top_p ?? item.topP;
          item.mode = value.mode ?? item.mode;
          item.hidden = value.hidden ?? item.hidden;
          item.name = (value.name as string) ?? item.name;
          item.steps = value.steps ?? item.steps;
          item.options = mergeDeep(item.options, value.options ?? {});
          item.permission = Permission.merge(
            item.permission,
            Permission.fromConfig(value.permission ?? {})
          );
        }

        // Ensure Truncate.GLOB is allowed unless explicitly configured
        for (const name in agents) {
          const agent = agents[name]!;
          const explicit = agent.permission.some(r => {
            if (r.permission !== 'external_directory') {
              return false;
            }
            if (r.action !== 'deny') {
              return false;
            }
            return r.pattern === Truncate.GLOB;
          });
          if (explicit) {
            continue;
          }

          agent.permission = Permission.merge(
            agent.permission,
            Permission.fromConfig({ external_directory: { [Truncate.GLOB]: 'allow' } })
          );
        }

        return {
          agents
        };
      }, Effect.provide(AppFileSystem.defaultLayer))
    );

    const get = Effect.fn('Agent.get')(function* (agent: string) {
      return yield* ModuleState.use(state, s => s.agents[agent]);
    });

    const list = Effect.fn('Agent.list')(function* () {
      const cfg = yield* config.get();
      const { agents } = yield* ModuleState.get(state);
      return pipe(
        agents,
        values(),
        sortBy(
          [x => (cfg.default_agent ? x.name === cfg.default_agent : x.name === 'build'), 'desc'],
          [x => x.name, 'asc']
        )
      );
    });

    const defaultInfo = Effect.fn('Agent.defaultInfo')(function* () {
      const c = yield* config.get();
      const { agents } = yield* ModuleState.get(state);
      if (c.default_agent) {
        const agent = agents[c.default_agent];
        if (!agent) {
          yield* Effect.die(new Error(`default agent "${c.default_agent}" not found`));
        }
        if (agent!.mode === 'subagent') {
          yield* Effect.die(new Error(`default agent "${c.default_agent}" is a subagent`));
        }
        if (agent!.hidden === true) {
          yield* Effect.die(new Error(`default agent "${c.default_agent}" is hidden`));
        }
        return agent!;
      }
      const visible = Object.values(agents).find(a => a.mode !== 'subagent' && a.hidden !== true);
      if (!visible) {
        yield* Effect.die(new Error('no primary visible agent found'));
      }
      return visible!;
    });

    const defaultAgent = Effect.fnUntraced(function* () {
      return (yield* defaultInfo()).name;
    });

    return Service.of({
      get,
      list,
      defaultInfo,
      defaultAgent
    });
  })
);

export const defaultLayer = layer.pipe(
  Layer.provide(Config.defaultLayer),
  Layer.provide(Skill.defaultLayer)
);
