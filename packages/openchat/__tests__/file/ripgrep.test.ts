import { describe, expect } from 'vitest';
import { Context, Effect, Layer, Scope, Stream } from 'effect';
import { Ripgrep } from '@/file';
import path from 'path';

describe('ripgrep', () => {
  const effect = Layer.buildWithMemoMap(
    Ripgrep.defaultLayer,
    Layer.makeMemoMapUnsafe(),
    Scope.makeUnsafe()
  );

  const svc = Effect.gen(function* () {
    const context = yield* effect;
    return Context.get(context, Ripgrep.Service);
  });

  it('files', async () => {
    const result = await Effect.gen(function* () {
      const stream = yield* svc.pipe(
        Effect.map(e =>
          e.files({
            cwd: process.cwd()
          })
        )
      );
      return yield* stream.pipe(Stream.runCollect);
    }).pipe(Effect.runPromise);
    expect(result.includes('node_modules')).toBeFalsy();
    expect(result).toEqual(
      expect.arrayContaining([
        expect.stringContaining('__tests__'),
        expect.stringContaining('src'),
        '.gitignore',
        'global.d.ts',
        'LICENSE',
        'package.json',
        'README.md',
        'rollup.config.js',
        'tsconfig.json'
      ])
    );
  });

  it('search', async () => {
    const result = await Effect.gen(function* () {
      return yield* svc.pipe(
        Effect.flatMap(e =>
          e.search({
            pattern: 'import',
            cwd: process.cwd(),
            glob: ['**/mcp/**', '**/@types/**'],
            file: ['src/mcp/index.ts']
          })
        )
      );
    }).pipe(Effect.runPromise);
    expect(result.items.length === 1).toBeTruthy();
    expect(result.items[0]).toMatchObject({
      // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
      path: expect.objectContaining({
        // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
        text: expect.stringContaining(path.normalize('src/mcp/index.ts'))
      }),
      line_number: 1,
      absolute_offset: 0
    });
  });

  it('tree', async () => {
    const result = await Effect.gen(function* () {
      return yield* svc.pipe(
        Effect.flatMap(e =>
          e.tree({
            cwd: process.cwd()
          })
        )
      );
    }).pipe(Effect.runPromise);
    const lines = result.split('\n');
    expect(lines.length).toBeTruthy();
    expect(lines.every(line => !line.includes('.'))).toBeTruthy();
  });
});
