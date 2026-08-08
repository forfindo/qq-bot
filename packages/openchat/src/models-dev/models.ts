import { Context, Duration, Effect, Layer, Option } from 'effect';
import { SchemaModels } from '@/schema';
import { AppFileSystem } from '@/file-system';
import { HttpClient, HttpClientRequest, FetchHttpClient } from 'effect/unstable/http';
import path from 'path';
import { Flag } from '@/flag';
import { Flock, Global, Hash, Log, withTransientReadRetry } from '@/utils';
import pkg from '../../package.json' with { type: 'json' };

const log = Log.create({ service: 'modelsDev' });

export interface Interface {
  readonly get: () => Effect.Effect<Record<string, SchemaModels.Provider>>;
  readonly refresh: (force?: boolean) => Effect.Effect<void>;
}

export class Service extends Context.Service<Service, Interface>()('@openchat/ModelsDev') {}

export const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const fs = yield* AppFileSystem.Service;
    const http = HttpClient.filterStatusOk(withTransientReadRetry(yield* HttpClient.HttpClient));
    const source = Flag.MODELS_URL || 'https://models.dev';
    const filepath = path.join(
      Global.Path.cache,
      source === 'https://models.dev' ? 'models.json' : `models-${Hash.fast(source)}.json`
    );
    const lockKey = `models-dev:${filepath}`;

    const fetchApi = Effect.fn('ModelsDev.fetchApi')(function* () {
      return yield* HttpClientRequest.get(`${source}/api.json`).pipe(
        HttpClientRequest.setHeader('User-Agent', `openchat@${pkg.version}`),
        http.execute,
        Effect.flatMap(res => res.text),
        Effect.timeout('10 seconds')
      );
    });

    const fetchAndWrite = Effect.fn('ModelsDev.fetchAndWrite')(function* () {
      const text = yield* fetchApi();
      yield* fs.writeWithDirs(filepath, text);
      return text;
    });

    const populate = Effect.gen(function* () {
      const fromDisk = yield* fs.readJson(Flag.MODELS_PATH ?? filepath).pipe(
        Effect.catch(() => Effect.succeed(void 0)),
        Effect.map(v => v as Record<string, SchemaModels.Provider> | undefined)
      );
      if (fromDisk) {
        return fromDisk;
      }
      if (Flag.DISABLE_MODELS_FETCH) {
        return {};
      }
      // Flock is cross-process: concurrent opencode CLIs can race on this cache file.
      const text = yield* Effect.scoped(
        Effect.gen(function* () {
          yield* Flock.effect(lockKey);
          return yield* fetchAndWrite();
        })
      );
      return JSON.parse(text) as Record<string, SchemaModels.Provider>;
    }).pipe(
      Effect.withSpan('ModelsDev.populate'),
      Effect.catchTag('TimeoutError', e => {
        log.warn('models.dev API timeout, skipping fetch: {error}', { error: e.message });
        return Effect.succeed({});
      }),
      Effect.orDie
    );

    const fresh = Effect.fnUntraced(function* () {
      const stat = yield* fs.stat(filepath).pipe(Effect.catch(() => Effect.succeed(void 0)));
      if (!stat) {
        return false;
      }
      const mtime = Option.getOrElse(stat.mtime, () => new Date(0)).getTime();
      return Date.now() - mtime < Duration.toMillis(Duration.minutes(5));
    });

    const [cachedGet, invalidate] = yield* Effect.cachedInvalidateWithTTL(
      populate,
      Duration.infinity
    );

    const get = (): Effect.Effect<Record<string, SchemaModels.Provider>> => cachedGet;

    const refresh = Effect.fn('ModelsDev.refresh')(function* (force = false) {
      if (!force && (yield* fresh())) {
        return;
      }
      yield* Effect.scoped(
        Effect.gen(function* () {
          yield* Flock.effect(lockKey);
          // Re-check under the lock: another process may have refreshed between
          // our outer check and lock acquisition.
          if (!force && (yield* fresh())) {
            return;
          }
          yield* fetchAndWrite();
          yield* invalidate;
        })
      ).pipe(
        Effect.tapCause(cause => {
          log.error('Failed to fetch models.dev, message: {cause}', { cause: cause.toJSON() });
          return Effect.void;
        }),
        Effect.ignore
      );
    });

    return Service.of({
      get,
      refresh
    });
  })
);

export const defaultLayer = layer.pipe(
  Layer.provide(FetchHttpClient.layer),
  Layer.provide(AppFileSystem.defaultLayer)
);
