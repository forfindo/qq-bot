import { Context, Effect, Layer, Record, Schema } from 'effect';
import { SchemaAuth } from '@/schema';
import { AppFileSystem } from '@/file';
import path from 'path';
import { Global } from '@/utils';
import { Flag } from '@/flag';

const file = path.join(Global.Path.data, 'auth.json');
const fail = (message: string) => (cause: unknown) => new SchemaAuth.AuthError({ message, cause });

export interface Interface {
  readonly get: (
    providerID: string
  ) => Effect.Effect<SchemaAuth.Info | undefined, SchemaAuth.AuthError>;
  readonly all: () => Effect.Effect<Record<string, SchemaAuth.Info>>;
  readonly set: (key: string, info: SchemaAuth.Info) => Effect.Effect<void, SchemaAuth.AuthError>;
  readonly remove: (key: string) => Effect.Effect<void, SchemaAuth.AuthError>;
}

export class Service extends Context.Service<Service, Interface>()('@openchat/Auth') {}

export const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const fs = yield* AppFileSystem.Service;

    const all = Effect.fn('Auth.all')(function* () {
      const foundFile = Flag.AUTH_CONTENT
        ? Effect.sync(() => JSON.parse(Flag.AUTH_CONTENT || '') as unknown)
        : fs.readJson(file);

      const data = (yield* foundFile.pipe(Effect.orElseSucceed(() => ({})))) as Record<
        string,
        unknown
      >;
      return Record.filterMap(data, value => Schema.decodeUnknownResult(SchemaAuth.Info)(value));
    });

    const get = Effect.fn('Auth.get')(function* (providerID: string) {
      return (yield* all())[providerID];
    });

    const set = Effect.fn('Auth.set')(function* (key: string, info: SchemaAuth.Info) {
      const norm = key.replace(/\/+$/, '');
      const data = yield* all();
      if (norm !== key) {
        delete data[key];
      }
      delete data[norm + '/'];
      yield* fs
        .writeJson(file, { ...data, [norm]: info }, 0o600)
        .pipe(Effect.mapError(fail('Failed to write auth data')));
    });

    const remove = Effect.fn('Auth.remove')(function* (key: string) {
      const norm = key.replace(/\/+$/, '');
      const data = yield* all();
      delete data[key];
      delete data[norm];
      yield* fs
        .writeJson(file, data, 0o600)
        .pipe(Effect.mapError(fail('Failed to write auth data')));
    });

    return Service.of({
      all,
      get,
      set,
      remove
    });
  })
);

export const defaultLayer = layer.pipe(Layer.provide(AppFileSystem.defaultLayer));
