import { Effect, Scope, ScopedCache } from 'effect';
import { InstanceContext, uid } from '@/instance/instance-context';
import { registerDisposer } from '@/instance/state-registry';
import { Log } from '@/utils';

const TypeId = '~openchat/ModuleState';

export interface ModuleState<A, E = never, R = never> {
  readonly [TypeId]: typeof TypeId;
  readonly cache: ScopedCache.ScopedCache<string, A, E, R>;
}

export const make = <A, E = never, R = never>(
  init: (ctx: InstanceContext) => Effect.Effect<A, E, R | Scope.Scope>
): Effect.Effect<ModuleState<A, E, Exclude<R, Scope.Scope>>, never, R | Scope.Scope> => {
  return Effect.gen(function* () {
    const cache = yield* ScopedCache.make<string, A, E, R>({
      capacity: Number.POSITIVE_INFINITY,
      lookup: () =>
        Effect.gen(function* () {
          return yield* init(yield* InstanceContext);
        })
    });

    const off = registerDisposer(uid => Effect.runPromise(ScopedCache.invalidate(cache, uid).pipe(Effect.provide(Log.layer))));
    yield* Effect.addFinalizer(() => Effect.sync(off));

    return {
      [TypeId]: TypeId,
      cache
    };
  });
};

export const get = <A, E, R>(self: ModuleState<A, E, R>) =>
  Effect.gen(function* () {
    return yield* ScopedCache.get(self.cache, yield* uid);
  });

export const use = <A, E, R, B>(self: ModuleState<A, E, R>, select: (value: A) => B) => Effect.map(get(self), select);

export const invalidate = <A, E, R>(self: ModuleState<A, E, R>) =>
  Effect.gen(function* () {
    yield* ScopedCache.invalidate(self.cache, yield* uid);
  });
