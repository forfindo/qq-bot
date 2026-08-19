import { describe, expect } from 'vitest';
import { parse } from '@/config/markdowm';
import { Effect } from 'effect';
import { AppFileSystem } from '@/file';
import path from 'path';

describe('markdown parse', () => {
  it("metadata contain '#'", async () => {
    const filePath = path.resolve(import.meta.dirname, './test.md');
    const md = await parse(filePath).pipe(
      Effect.provide(AppFileSystem.defaultLayer),
      Effect.runPromise
    );
    expect(Object.prototype.hasOwnProperty.call(md.data, 'name')).toBeFalsy();
    expect(md).toMatchObject({
      content: '这是内容',
      // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
      data: expect.objectContaining({
        description: '这是第一行\n这是第二行\n',
        keywords: '测试\n注释'
      })
    });
  });
});
