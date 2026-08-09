import { Effect } from 'effect';
import { Provider } from '@/provider';
import { InstanceContext } from '@/instance';
import { SchemaProvider } from '@/schema';
import { expect } from 'vitest';

describe('provider service', () => {
  it('list', async () => {
    const list = await InstanceContext.Instance.restore(
      {
        uid: '3530766280',
        owner: '3530766280'
      },
      async () => {
        return await Effect.gen(function* () {
          const provider = yield* Provider.Service;
          return yield* provider.list();
        }).pipe(Effect.provide(Provider.defaultLayer), Effect.runPromise);
      }
    );
    expect(Object.keys(list)).toStrictEqual(['opencode', 'deepseek']);
  });

  it('getProvider', async () => {
    const deepseek = await InstanceContext.Instance.restore(
      {
        uid: '3530766280',
        owner: '3530766280'
      },
      async () => {
        return await Effect.gen(function* () {
          const provider = yield* Provider.Service;
          const id = SchemaProvider.ProviderID.make('deepseek');
          return yield* provider.getProvider(id);
        }).pipe(Effect.provide(Provider.defaultLayer), Effect.runPromise);
      }
    );
    expect(Object.keys(deepseek.models).length).toBeTruthy();
  });
});
