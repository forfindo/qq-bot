import path from 'path';
import { Effect } from 'effect';
import { SchemaTool } from '@/schema';
import { InstanceContext } from '@/instance';
import { AppFileSystem } from '@/file';

type Kind = 'file' | 'directory';

type Options = {
  bypass?: boolean;
  kind?: Kind;
};

export const assertExternalDirectoryEffect = Effect.fn('Tool.assertExternalDirectory')(function* (
  ctx: SchemaTool.Context,
  target?: string,
  options?: Options
) {
  if (!target) {
    return;
  }

  if (options?.bypass) {
    return;
  }

  const directory = yield* InstanceContext.directory;
  const full = process.platform === 'win32' ? AppFileSystem.normalizePath(target) : target;
  if (AppFileSystem.contains(full, directory)) {
    return;
  }

  const kind = options?.kind ?? 'file';
  const dir = kind === 'directory' ? full : path.dirname(full);
  const glob =
    process.platform === 'win32'
      ? AppFileSystem.normalizePathPattern(path.join(dir, '*'))
      : path.join(dir, '*').replaceAll('\\', '/');

  yield* ctx.ask({
    permission: 'external_directory',
    patterns: [glob],
    always: [glob],
    metadata: {
      filepath: full,
      parentDir: dir
    }
  });
});
