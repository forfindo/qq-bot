import { Context, Effect, Layer, Record, Schema } from 'effect';
import { SchemaAuth } from '@/schema';
import { AppFileSystem } from '@/file-system';
import path from 'path';
import { Global } from '@/utils';
import { Flag } from '@/flag';

const file = path.join(Global.Path.data, 'auth.json');

export class AuthError extends Schema.TaggedErrorClass<AuthError>()('AuthError', {
  message: Schema.String,
  cause: Schema.optional(Schema.Defect)
}) {}

export interface Interface {
  readonly all: () => Effect.Effect<Record<string, SchemaAuth.Info>>;
}

export class Service extends Context.Service<Service, Interface>()('@openchat/Auth') {}

export const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const fs = yield* AppFileSystem.Service;

    const all = Effect.fn('Auth.all')(function* () {
      const foundFile = Flag.AUTH_CONTENT ? Effect.sync(() => JSON.parse(Flag.AUTH_CONTENT || '') as unknown) : fs.readJson(file);

      const data = (yield* foundFile.pipe(Effect.orElseSucceed(() => ({})))) as Record<string, unknown>;
      return Record.filterMap(data, value => Schema.decodeUnknownResult(SchemaAuth.Info)(value));
    });

    return Service.of({
      all
    });
  })
);

export const defaultLayer = layer.pipe(Layer.provide(AppFileSystem.defaultLayer));
