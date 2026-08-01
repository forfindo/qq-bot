import { describe } from 'vitest';
import { Effect } from 'effect';
import { ModelsDev } from '@/models-dev';

describe('models-dev service', () => {
  it('get', async () => {
    const result = await Effect.gen(function* () {
      const models = yield* ModelsDev.Service;
      return yield* models.get();
    }).pipe(Effect.provide(ModelsDev.defaultLayer), Effect.runPromise);
    console.log(result);
  });
});
