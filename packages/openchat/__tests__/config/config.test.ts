import { Effect } from 'effect';
import { Config } from '@/config';
import { InstanceContext } from '@/instance';
import { expect } from 'vitest';

describe('config service', () => {
  it('CONFIG_CONTENT', async () => {
    const cfg = await InstanceContext.Instance.restore({
      uid: '3530766280'
    }, async () => {
      return await Effect.gen(function* () {
        const svc = yield* Config.Service;
        return yield* svc.get();
      }).pipe(
        Effect.provide(Config.defaultLayer),
        Effect.runPromise
      );
    });
    expect(cfg).toMatchObject({
      // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
      instructions: expect.arrayContaining(['你是凑企鹅！你是凑企鹅！你是凑企鹅！！！'])
    });
  });

  it('variable substitution', async () => {
    const cfg = await InstanceContext.Instance.restore({
      uid: '3530766280'
    }, async () => {
      return await Effect.gen(function* () {
        const svc = yield* Config.Service;
        return yield* svc.get();
      }).pipe(
        Effect.provide(Config.defaultLayer),
        Effect.runPromise
      );
    });
    expect(cfg.provider?.deepseek).toMatchObject({
      options: {
        apiKey: 'sk-1234'
      }
    });
  });
});