import { describe, expect, it } from 'vitest';
import { Effect, Schema } from 'effect';
import { jsonc, schema } from '@/config/parse';

describe('config parser', () => {
  it('jsonc: normal', () => {
    const obj = Effect.gen(function* () {
      return yield* jsonc(
        JSON.stringify({
          name: 'test_name',
          abc: 12345,
          config: { test: 'name', ddd: 'query' }
        }),
        'test.jonsc'
      );
    }).pipe(Effect.runSync);
    expect(obj).toStrictEqual({ name: 'test_name', abc: 12345, config: { test: 'name', ddd: 'query' } });
  });

  it('jsonc: comment', () => {
    const obj = Effect.gen(function* () {
      return yield* jsonc(
        `{
      // 注释
      "name":"test_name",
      "abc":12345,
      // 配置项
      "config":{"test":"name","ddd":"query"}
      }`,
        'test.jonsc'
      );
    }).pipe(Effect.runSync);
    expect(obj).toStrictEqual({ name: 'test_name', abc: 12345, config: { test: 'name', ddd: 'query' } });
  });

  it('jsonc: invalidate', () => {
    expect(() =>
      Effect.gen(function* () {
        return yield* jsonc(
          `{
      // 注释
      "name":"test_name",
      "abc":12345,
      // 配置项
      "config":{test":"name","ddd":"query"}
      }`,
          'test.jonsc'
        );
      }).pipe(Effect.runSync)
    ).throw('ConfigJsonError');
  });

  it('schema: normal', () => {
    Effect.gen(function* () {
      const scm = Schema.Struct({
        name: Schema.String,
        age: Schema.Number.check(
          Schema.isBetween({
            minimum: 2,
            maximum: 100
          })
        ),
        phone: Schema.optional(Schema.String.check(Schema.isPattern(/^\+86/)))
      });

      return yield* schema(
        scm,
        {
          name: 'test_name',
          age: 46,
          phone: '+86 1343545346'
        },
        'test.json'
      );
    }).pipe(Effect.runSync);
  });

  it('schema: check error', () => {
    expect.assertions(2);
    Effect.gen(function* () {
      const scm = Schema.Struct({
        name: Schema.String,
        age: Schema.Number.check(
          Schema.isBetween({
            minimum: 2,
            maximum: 100
          })
        ),
        phone: Schema.optional(Schema.String.check(Schema.isPattern(/^\+86/)))
      });

      return yield* schema(
        scm,
        {
          age: 46,
          phone: '+86 1343545346',
          address: 'asgdgaghh'
        },
        'test.json'
      );
    }).pipe(
      Effect.catchTag('ConfigInvalidError', err => {
        const data = err.toObject();
        const issuesCount = data.data.issues?.length;
        expect(data.name).toBe('ConfigInvalidError');
        expect(issuesCount).toBe(2);
        return Effect.void;
      }),
      Effect.runSync
    );
  });
});
