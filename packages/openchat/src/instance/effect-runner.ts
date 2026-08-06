import { Effect, Exit, Fiber } from 'effect';
import { Instance, InstanceContext } from '@/instance/instance-context';
import { attachWith } from '@/instance/run-service';

export interface Shape {
  readonly promise: <A, E, R>(effect: Effect.Effect<A, E, R>) => Promise<A>;
  readonly fork: <A, E, R>(effect: Effect.Effect<A, E, R>) => Fiber.Fiber<A, E>;
  readonly run: <A, E, R>(effect: Effect.Effect<A, E, R>) => Effect.Effect<A, E>;
}

function restore<R>(instance: InstanceContext | undefined, fn: () => R): R {
  if (instance) {
    return Instance.restore(instance, fn);
  }
  return fn();
}

export function make(): Effect.Effect<Shape> {
  return Effect.gen(function* () {
    const ctx = yield* Effect.context();
    const instance = yield* InstanceContext;
    const attach = <A, E, R>(effect: Effect.Effect<A, E, R>) => attachWith(effect, { instance });
    const wrap = <A, E, R>(effect: Effect.Effect<A, E, R>) =>
      attach(effect).pipe(Effect.provide(ctx)) as Effect.Effect<A, E, never>;

    return {
      promise: <A, E, R>(effect: Effect.Effect<A, E, R>) =>
        restore(instance, () => Effect.runPromise(wrap(effect))),
      fork: <A, E, R>(effect: Effect.Effect<A, E, R>) =>
        restore(instance, () => Effect.runFork(wrap(effect))),
      run: <A, E, R>(effect: Effect.Effect<A, E, R>) =>
        Effect.callback<A, E>(resume => {
          void restore(instance, () =>
            Effect.runPromiseExit(wrap(effect)).then(exit =>
              resume(
                Exit.isSuccess(exit) ? Effect.succeed(exit.value) : Effect.failCause(exit.cause)
              )
            )
          );
        })
    } satisfies Shape;
  });
}
