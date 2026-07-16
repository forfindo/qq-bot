import { Context, Effect, Layer } from 'effect';
import { SchemaConfig } from '../schema';

export interface Interface {
  readonly get: () => Effect.Effect<SchemaConfig.Info>;
}

export class Service extends Context.Service<Service, Interface>()('@openchat/Config') {}

export const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const state = yield* InstanceState.make()

    return Service.of({
      get() {
        return Effect.succeed({} as SchemaConfig.Info);
      }
    });
  })
);
