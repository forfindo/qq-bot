import { type SchemaCommand } from '@/schema';
import { Context, Effect, Layer } from 'effect';
import { MCP } from '@/mcp';
import { Skill } from '@/skill';
import { EffectRunner, ServiceState } from '@/instance';
import { Config } from '@/config';

export const hints = (template: string) => {
  const result: string[] = [];
  const numbered = template.match(/\$\d+/g);
  if (numbered) {
    for (const match of [...new Set(numbered)].sort()) {
      result.push(match);
    }
  }
  if (template.includes('$ARGUMENTS')) {
    result.push('$ARGUMENTS');
  }
  return result;
};

type State = {
  commands: Record<string, SchemaCommand.Info>;
};

export interface Interface {
  readonly get: (name: string) => Effect.Effect<SchemaCommand.Info | undefined>;
  readonly list: () => Effect.Effect<SchemaCommand.Info[]>;
}

export class Service extends Context.Service<Service, Interface>()('@openchat/Command') {}

export const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const config = yield* Config.Service;
    const mcp = yield* MCP.Service;
    const skill = yield* Skill.Service;

    const init = Effect.fn('Command.state')(function* () {
      const cfg = yield* config.get();
      const bridge = yield* EffectRunner.make();
      const commands: Record<string, SchemaCommand.Info> = {};

      for (const [name, command] of Object.entries(cfg.command ?? {})) {
        commands[name] = {
          name,
          agent: command.agent,
          model: command.model,
          description: command.description,
          source: 'command',
          get template() {
            return command.template;
          },
          subtask: command.subtask,
          hints: hints(command.template)
        };
      }

      for (const [name, prompt] of Object.entries(yield* mcp.prompts())) {
        commands[name] = {
          name,
          source: 'mcp',
          description: prompt.description,
          get template() {
            return bridge.promise(
              mcp
                .getPrompt(
                  prompt.client,
                  prompt.name,
                  prompt.arguments
                    ? Object.fromEntries(
                        prompt.arguments.map((argument, i) => [argument.name, `$${i + 1}`])
                      )
                    : {}
                )
                .pipe(
                  Effect.map(
                    template =>
                      template?.messages
                        .map(message =>
                          message.content.type === 'text' ? message.content.text : ''
                        )
                        .join('\n') || ''
                  )
                )
            );
          },
          hints: prompt.arguments?.map((_, i) => `$${i + 1}`) ?? []
        };
      }

      for (const item of yield* skill.all()) {
        if (commands[item.name]) {
          continue;
        }
        commands[item.name] = {
          name: item.name,
          description: item.description,
          source: 'skill',
          get template() {
            return item.content;
          },
          hints: []
        };
      }

      return {
        commands
      };
    });

    const state = yield* ServiceState.make<State>(init);

    const get = Effect.fn('Command.get')(function* (name: string) {
      return yield* ServiceState.use(state, s => s.commands[name]);
    });

    const list = Effect.fn('Command.list')(function* () {
      return yield* ServiceState.use(state, s => Object.values(s.commands));
    });

    return Service.of({ get, list });
  })
);

export const defaultLayer = layer.pipe(
  Layer.provide(Config.defaultLayer),
  Layer.provide(MCP.defaultLayer),
  Layer.provide(Skill.defaultLayer)
);
