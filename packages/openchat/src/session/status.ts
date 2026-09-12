import { SchemaSession } from '@/schema';
import { Context, Effect, Layer } from 'effect';
import { Event } from '@/event';
import { ServiceState } from '@/instance';

export interface Interface {
  readonly get: (sessionID: SchemaSession.SessionID) => Effect.Effect<SchemaSession.StatusInfo>;
  readonly list: () => Effect.Effect<Map<SchemaSession.SessionID, SchemaSession.StatusInfo>>;
  readonly set: (
    sessionID: SchemaSession.SessionID,
    status: SchemaSession.StatusInfo
  ) => Effect.Effect<void>;
}

export class Service extends Context.Service<Service, Interface>()('@openchat/SessionStatus') {}

export const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const bus = yield* Event.Service;

    const state = yield* ServiceState.make(
      Effect.fn('SessionStatus.state')(() =>
        Effect.succeed(new Map<SchemaSession.SessionID, SchemaSession.StatusInfo>())
      )
    );

    const get = Effect.fn('SessionStatus.get')(function* (sessionID: SchemaSession.SessionID) {
      const data = yield* ServiceState.get(state);
      return data.get(sessionID) ?? { type: 'idle' as const };
    });

    const list = Effect.fn('SessionStatus.list')(function* () {
      return new Map(yield* ServiceState.get(state));
    });

    const set = Effect.fn('SessionStatus.set')(function* (
      sessionID: SchemaSession.SessionID,
      status: SchemaSession.StatusInfo
    ) {
      const data = yield* ServiceState.get(state);
      yield* bus.publish(SchemaSession.Events.Status, { sessionID, status });
      if (status.type === 'idle') {
        yield* bus.publish(SchemaSession.Events.Idle, { sessionID });
        data.delete(sessionID);
        return;
      }
      data.set(sessionID, status);
    });

    return Service.of({ get, list, set });
  })
);

export const defaultLayer = layer.pipe(Layer.provide(Event.layer));
