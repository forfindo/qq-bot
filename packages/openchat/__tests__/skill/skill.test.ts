import { describe, expect } from 'vitest';
import { Effect } from 'effect';
import { Skill } from '@/skill';
import { InstanceRef } from '@/instance/refrences';

describe('skill service', () => {
  it('all', async () => {
    const list = await Effect.gen(function* () {
      const skill = yield* Skill.Service;
      return yield* skill.all();
    }).pipe(
      Effect.provideService(InstanceRef, {
        uid: '3530766280',
        owner: '3530766280'
      }),
      Effect.provide(Skill.defaultLayer),
      Effect.runPromise
    );

    expect(list.length).toBe(2);
    expect(list).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          name: 'ui-ux-pro-max',
          // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
          content: expect.stringMatching(/.+/)
        }),
        expect.objectContaining({
          name: 'frontend-slides',
          // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
          content: expect.stringMatching(/.+/)
        })
      ])
    );
  });
});
