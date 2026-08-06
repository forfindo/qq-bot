import { Context, Duration, Effect, Layer, pipe, Record, Result } from 'effect';
import { SchemaConfig, SchemaPermission } from '@/schema';
import { ModuleState, InstanceContext } from '@/instance';
import { mergeDeep, unique } from 'remeda';
import path from 'path';
import { existsSync } from 'fs';
import { Global, Log, TypeGuard } from '@/utils';
import { Auth } from '@/auth';
import { substitute } from '@/config/variable';
import { Flag, setFlag } from '@/flag';
import { AppFileSystem } from '@/file-system';
import { jsonc, schema } from '@/config/parse';
import * as ConfigCommand from './command';
import * as ConfigAgent from './agent';
import { applyEdits, modify } from 'jsonc-parser';

const log = Log.create();

function mergeConfigConcatArrays(
  target: SchemaConfig.Info,
  source: SchemaConfig.Info
): SchemaConfig.Info {
  const merged = mergeDeep(target, source);
  if (target.instructions && source.instructions) {
    merged.instructions = Array.from(new Set([...target.instructions, ...source.instructions]));
  }
  return merged;
}

export interface Interface {
  readonly get: () => Effect.Effect<SchemaConfig.Info>;
  readonly getGlobal: () => Effect.Effect<SchemaConfig.Info>;
  readonly update: (config: SchemaConfig.Info) => Effect.Effect<void>;
  readonly updateGlobal: (
    config: SchemaConfig.Info
  ) => Effect.Effect<{ info: SchemaConfig.Info; changed: boolean }>;
  readonly invalidate: () => Effect.Effect<void>;
  readonly directories: () => Effect.Effect<string[]>;
}

type State = {
  config: SchemaConfig.Info;
  directories: string[];
};

function writableGlobal(next: SchemaConfig.Info) {
  // When a user changes config from a value back to default in the Desktop app, we don't want to leave a blank `"shell": "",` key
  if ('shell' in next && next.shell === '') {
    return { ...next, shell: void 0 };
  }
  return next;
}

function patchJsonc(input: string, patch: unknown, path: string[] = []): string {
  if (!TypeGuard.isRecord(patch)) {
    const edits = modify(input, path, patch, {
      formattingOptions: {
        insertSpaces: true,
        tabSize: 2
      }
    });
    return applyEdits(input, edits);
  }

  return Object.entries(patch).reduce(
    (result, [key, value]) => patchJsonc(result, value, [...path, key]),
    input
  );
}

function globalConfigFile() {
  const candidates = ['openchat.jsonc', 'openchat.json', 'config.json'].map(file =>
    path.join(Global.Path.config, file)
  );
  for (const file of candidates) {
    if (existsSync(file)) {
      return file;
    }
  }
  return candidates[0]!;
}

export class Service extends Context.Service<Service, Interface>()('@openchat/Config') {}

export const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const authSvc = yield* Auth.Service;
    const fs = yield* AppFileSystem.Service;

    const readConfigFile = (filepath: string) => fs.readFileStringSafe(filepath).pipe(Effect.orDie);

    const substituteWellKnownRemoteConfig = Effect.fnUntraced(function* (input: {
      value: unknown;
      dir: string;
      source: string;
    }) {
      if (!TypeGuard.isRecord(input.value) || typeof input.value.url !== 'string') {
        return;
      }

      const url = yield* substitute({
        text: input.value.url,
        type: 'virtual',
        dir: input.dir,
        source: input.source
      });

      const headers = TypeGuard.isRecord(input.value.headers)
        ? yield* pipe(
            input.value.headers,
            Record.filterMap(value =>
              typeof value === 'string'
                ? Result.succeed(
                    substitute({
                      text: value,
                      type: 'virtual',
                      dir: input.dir,
                      source: input.source
                    })
                  )
                : Result.fail(void 0)
            ),
            Effect.all
          )
        : void 0;

      return { url, headers };
    });

    const loadConfig = Effect.fnUntraced(function* (
      text: string,
      options: { path: string } | { dir: string; source: string }
    ) {
      const source = 'path' in options ? options.path : options.source;
      const expanded = yield* substitute(
        'path' in options
          ? { text, type: 'path', path: options.path }
          : { text, type: 'virtual', ...options }
      );
      const parsed = yield* jsonc(expanded, source);
      const data = yield* schema(SchemaConfig.Info, parsed, source);
      if (!('path' in options)) {
        return data;
      }

      if (!data.$schema) {
        data.$schema = 'https://opencode.ai/config.json';
        const updated = text.replace(
          /^\s*\{/,
          '{\n  "$schema": "https://opencode.ai/config.json",'
        );
        yield* fs.writeFileString(options.path, updated).pipe(Effect.catch(() => Effect.void));
      }
      return data;
    });

    const loadFile = Effect.fnUntraced(function* (filepath: string) {
      log.info('loading', { path: filepath });
      const text = yield* readConfigFile(filepath);
      if (!text) {
        return {};
      }
      return yield* loadConfig(text, { path: filepath });
    });

    const loadGlobal = Effect.fnUntraced(function* () {
      let result: SchemaConfig.Info = {};
      // Seed the default global config with the schema for editor completion, but avoid writing when the user
      // explicitly routes config through env-provided paths or content.
      if (!Flag.CONFIG_DIR && !Flag.CONFIG_CONTENT) {
        const file = globalConfigFile();
        if (!existsSync(file)) {
          yield* fs
            .writeWithDirs(
              file,
              JSON.stringify({ $schema: 'https://opencode.ai/config.json' }, null, 2)
            )
            .pipe(Effect.catch(() => Effect.void));
        }
      }
      result = mergeDeep(result, yield* loadFile(path.join(Global.Path.config, 'config.json')));
      result = mergeDeep(result, yield* loadFile(path.join(Global.Path.config, 'openchat.json')));
      result = mergeDeep(result, yield* loadFile(path.join(Global.Path.config, 'openchat.jsonc')));

      return result;
    });

    const [cachedGlobal, invalidateGlobal] = yield* Effect.cachedInvalidateWithTTL(
      loadGlobal().pipe(
        Effect.tapError(error =>
          Effect.sync(() =>
            log.error('failed to load global config, using defaults', { error: error.message })
          )
        ),
        Effect.provideService(AppFileSystem.Service, fs),
        Effect.orElseSucceed((): SchemaConfig.Info => ({}))
      ),
      Duration.infinity
    );

    const loadInstanceState = Effect.fn('Config.loadInstanceState')(
      function* (ctx: InstanceContext.InstanceContext) {
        let result: SchemaConfig.Info = {};
        const auth = yield* authSvc.all();

        const merge = (next: SchemaConfig.Info) => {
          result = mergeConfigConcatArrays(result, next);
        };

        for (const [key, value] of Object.entries(auth)) {
          if (value.type === 'wellknown') {
            const url = key.replace(/\/+$/, '');
            setFlag(value.key, value.token);
            log.debug('fetching remote config', { url: `${url}/.well-known/openchat` });
            const response = yield* Effect.promise(() => fetch(`${url}/.well-known/openchat`));
            if (!response.ok) {
              throw new Error(`failed to fetch remote config from ${url}: ${response.status}`);
            }
            const wellknown = (yield* Effect.promise(() => response.json())) as {
              config?: Record<string, unknown>;
              remote_config?: unknown;
            };
            const remote = yield* substituteWellKnownRemoteConfig({
              value: wellknown.remote_config,
              dir: url,
              source: `${url}/.well-known/openchat`
            });
            const fetchedConfig = remote
              ? ((yield* Effect.promise(async () => {
                  log.debug('fetching remote config', { url: remote.url });
                  const response = await fetch(remote.url, { headers: remote.headers });
                  if (!response.ok) {
                    throw new Error(
                      `failed to fetch remote config from ${remote.url}: ${response.status}`
                    );
                  }
                  const data = await response.json();
                  return TypeGuard.isRecord(data) && TypeGuard.isRecord(data.config)
                    ? data.config
                    : data;
                })) as Record<string, unknown>)
              : {};
            const remoteConfig = mergeDeep(
              wellknown.config ?? {},
              fetchedConfig as SchemaConfig.Info
            );
            if (!remoteConfig.$schema) {
              remoteConfig.$schema = 'https://opencode.ai/config.json';
            }
            const source = `${url}/.well-known/openchat`;
            const next = yield* loadConfig(JSON.stringify(remoteConfig), {
              dir: path.dirname(source),
              source
            });
            merge(next);
            log.debug('loaded remote config from well-known', { url });
          }
        }

        const global = yield* getGlobal();
        merge(global);

        result.agent = result.agent || {};
        result.mode = result.mode || {};

        const dirs = unique([
          Global.Path.config,
          yield* InstanceContext.directory,
          ...(Flag.CONFIG_DIR ? [Flag.CONFIG_DIR] : [])
        ]);

        if (Flag.CONFIG_DIR) {
          log.debug('loading config from CONFIG_DIR', { path: Flag.CONFIG_DIR });
        }

        for (const dir of dirs) {
          if (dir !== Global.Path.config) {
            for (const file of ['openchat.json', 'openchat.jsonc']) {
              const source = path.join(dir, file);
              log.debug(`loading config from ${source}`);
              merge(yield* loadFile(source));
              result.agent ??= {};
              result.mode ??= {};
            }
          }

          result.command = mergeDeep(result.command ?? {}, yield* ConfigCommand.load(dir));
          result.agent = mergeDeep(result.agent ?? {}, yield* ConfigAgent.load(dir));
          result.agent = mergeDeep(result.agent ?? {}, yield* ConfigAgent.loadMode(dir));
        }

        if (Flag.CONFIG_CONTENT) {
          const source = 'CONFIG_CONTENT';
          const next = yield* loadConfig(Flag.CONFIG_CONTENT, {
            dir: ctx.uid,
            source
          });
          merge(next);
          log.debug('loaded custom config from CONFIG_CONTENT');
        }

        for (const [name, mode] of Object.entries(result.mode ?? {})) {
          result.agent = mergeDeep(result.agent ?? {}, {
            [name]: {
              ...mode,
              mode: 'primary' as const
            }
          });
        }

        if (Flag.PERMISSION) {
          result.permission = mergeDeep(result.permission ?? {}, JSON.parse(Flag.PERMISSION));
        }

        if (result.tools) {
          const perms: Record<string, SchemaPermission.Action> = {};
          for (const [tool, enabled] of Object.entries(result.tools)) {
            const action: SchemaPermission.Action = enabled ? 'allow' : 'deny';
            if (tool === 'write' || tool === 'edit' || tool === 'patch') {
              perms.edit = action;
              continue;
            }
            perms[tool] = action;
          }
          result.permission = mergeDeep(perms, result.permission ?? {});
        }

        if (Flag.DISABLE_AUTO_COMPACT) {
          result.compaction = { ...result.compaction, auto: false };
        }
        if (Flag.DISABLE_PRUNE) {
          result.compaction = { ...result.compaction, prune: false };
        }

        return {
          config: result,
          directories: dirs
        };
      },
      Effect.provideService(AppFileSystem.Service, fs),
      Effect.orDie
    );

    const state = yield* ModuleState.make<State>(
      Effect.fn('Config.state')(function* (ctx) {
        return yield* loadInstanceState(ctx);
      })
    );

    const get = Effect.fn('Config.get')(function* () {
      return yield* ModuleState.use(state, s => s.config);
    });

    const update = Effect.fn('Config.update')(
      function* (config: SchemaConfig.Info) {
        const dir = yield* InstanceContext.directory;
        const file = path.join(dir, 'config.json');
        const existing = yield* loadFile(file);
        yield* fs
          .writeFileString(file, JSON.stringify(mergeDeep(existing, config), null, 2))
          .pipe(Effect.orDie);
      },
      Effect.provideService(AppFileSystem.Service, fs),
      Effect.orDie
    );

    const getGlobal = Effect.fn('Config.getGlobal')(function* () {
      return yield* cachedGlobal;
    });

    const directories = Effect.fn('Config.directories')(function* () {
      return yield* ModuleState.use(state, s => s.directories);
    });

    const invalidate = Effect.fn('Config.invalidate')(function* () {
      yield* invalidateGlobal;
    });

    const updateGlobal = Effect.fn('Config.updateGlobal')(
      function* (config: SchemaConfig.Info) {
        const file = globalConfigFile();
        const before = (yield* readConfigFile(file)) ?? '{}';
        const patch = writableGlobal(config);

        let next: SchemaConfig.Info;
        let changed: boolean;
        if (!file.endsWith('.jsonc')) {
          const existing = yield* schema(SchemaConfig.Info, yield* jsonc(before, file), file);
          const merged = mergeDeep(existing, patch);
          const serialized = JSON.stringify(merged, null, 2);
          changed = serialized !== before;
          if (changed) {
            yield* fs.writeFileString(file, serialized).pipe(Effect.orDie);
          }
          next = merged;
        } else {
          const updated = patchJsonc(before, patch);
          next = yield* schema(SchemaConfig.Info, yield* jsonc(updated, file), file);
          changed = updated !== before;
          if (changed) {
            yield* fs.writeFileString(file, updated).pipe(Effect.orDie);
          }
        }

        if (changed) {
          yield* invalidate();
        }
        return { info: next, changed };
      },
      Effect.provideService(AppFileSystem.Service, fs),
      Effect.orDie
    );

    return Service.of({
      get,
      update,
      getGlobal,
      invalidate,
      directories,
      updateGlobal
    });
  })
);

export const defaultLayer = layer.pipe(
  Layer.provide(Auth.defaultLayer),
  Layer.provide(AppFileSystem.defaultLayer)
);
