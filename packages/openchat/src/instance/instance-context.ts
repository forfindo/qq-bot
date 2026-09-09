import { AppFileSystem } from '@/file';
import { LocalContext } from '@/utils';
import { Context, Effect, Fiber } from 'effect';
import path from 'path';
import { InstanceRef } from '@/instance/refrences';

export interface InstanceContext {
  readonly uid: string;
  readonly owner: string;
  readonly name: string;
}

const context = LocalContext.create<InstanceContext>('instance');

export const Instance = {
  get current() {
    return context.use();
  },
  get uid() {
    return context.use().uid;
  },
  get name() {
    return context.use().name;
  },
  /**
   * Captures the current instance ALS context and returns a wrapper that
   * restores it when called. Use this for callbacks that fire outside the
   * instance async context (native addons, event emitters, timers, etc.).
   */
  bind<F extends (...args: unknown[]) => unknown>(fn: F): F {
    const ctx = context.use();
    return ((...args: unknown[]) => context.provide(ctx, () => fn(...args))) as F;
  },
  /**
   * Run a synchronous function within the given instance context ALS.
   * Use this to bridge from Effect (where InstanceRef carries context)
   * back to sync code that reads Instance.directory from ALS.
   */
  restore<R>(ctx: InstanceContext, fn: () => R): R {
    return context.provide(ctx, fn);
  }
};

export const InstanceContext = Effect.gen(function* () {
  return (yield* InstanceRef) ?? Instance.current;
});

export const uid = Effect.map(InstanceContext, ctx => ctx.uid);

export const directory = Effect.gen(function* () {
  return yield* getDirectory();
});

export const getDirectory = Effect.fnUntraced(function* (uid?: string) {
  const fs = yield* AppFileSystem.Service;
  const suid = uid ?? (yield* InstanceContext).uid;
  const dir = path.resolve('./data', suid);
  yield* fs.ensureDir(dir).pipe(Effect.orDie);
  return dir;
});

// eslint-disable-next-line
export const bind = <F extends (...args: any[]) => any>(fn: F): F => {
  try {
    return Instance.bind(fn);
  } catch (err) {
    if (!(err instanceof LocalContext.NotFound)) {
      throw err;
    }
  }
  const fiber = Fiber.getCurrent();
  const ctx = fiber ? Context.getReferenceUnsafe(fiber.context, InstanceRef) : void 0;
  if (!ctx) {
    return fn;
  }
  // eslint-disable-next-line
  return ((...args: any[]) => Instance.restore(ctx, () => fn(...args))) as F;
};
