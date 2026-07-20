import { AppFileSystem } from '@/file-system';
import { LocalContext } from '@/utils';
import { Effect } from 'effect';
import path from 'path';

export interface InstanceContext {
  readonly uid: string;
}

const context = LocalContext.create<InstanceContext>('instance');

export const Instance = {
  get current() {
    return context.use();
  },
  get uid() {
    return context.use().uid;
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

export const InstanceContext = Effect.sync(() => Instance.current);

export const uid = Effect.map(InstanceContext, ctx => ctx.uid);

export const directory = Effect.gen(function* () {
  const fs = yield* AppFileSystem.Service;
  const dir = path.resolve('./.openchat', Instance.uid);
  yield* fs.ensureDir(dir);
  return dir;
});
