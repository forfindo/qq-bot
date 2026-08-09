import { describe, expect } from 'vitest';
import { Effect } from 'effect';
import { Agent } from '@/agent';
import { InstanceRef } from '@/instance/refrences';

describe('agent service', () => {
  it('list', async () => {
    const result = await Effect.gen(function* () {
      const agent = yield* Agent.Service;
      return yield* agent.list();
    }).pipe(
      Effect.provide(Agent.defaultLayer),
      Effect.provideService(InstanceRef, { uid: '3530766280', owner: '3530766280' }),
      Effect.runPromise
    );
    expect(result.length).toBe(8);
    expect(result).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          name: 'build'
        }),
        expect.objectContaining({
          name: 'plan'
        }),
        expect.objectContaining({
          name: 'explore'
        }),
        expect.objectContaining({
          name: 'general'
        }),
        expect.objectContaining({
          name: 'title'
        }),
        expect.objectContaining({
          name: 'compaction'
        }),
        expect.objectContaining({
          name: 'summary'
        }),
        expect.objectContaining({
          name: 'custom',
          mode: 'primary',
          temperature: 0.5,
          prompt: '这是我自定义的agent，没什么其他用处'
        })
      ])
    );
  });
});
