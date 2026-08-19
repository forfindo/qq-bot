import { Effect, Option, Schema, Stream } from 'effect';
import { define } from '@/tool/tool';
import { AppFileSystem, Ripgrep } from '@/file';
import DESCRIPTION from './glob.md';
import path from 'path';
import { assertExternalDirectoryEffect } from '@/tool/external-directory';
import { InstanceContext } from '@/instance';
import { SchemaTool } from '@/schema';

export const Parameters = Schema.Struct({
  pattern: Schema.String.annotate({ description: 'The glob pattern to match files against' }),
  path: Schema.optional(Schema.String).annotate({
    description: `The directory to search in. If not specified, the current working directory will be used. IMPORTANT: Omit this field to use the default directory. DO NOT enter "undefined" or "null" - simply omit it for the default behavior. Must be a valid directory path if provided.`
  })
});

export const GlobTool = define(
  'glob',
  Effect.gen(function* () {
    const rg = yield* Ripgrep.Service;
    const fs = yield* AppFileSystem.Service;

    return {
      description: DESCRIPTION,
      parameters: Parameters,
      execute: (params: { pattern: string; path?: string }, ctx: SchemaTool.Context) =>
        Effect.gen(function* () {
          const directory = yield* InstanceContext.directory;
          yield* ctx.ask({
            permission: 'glob',
            patterns: [params.pattern],
            always: ['*'],
            metadata: {
              pattern: params.pattern,
              path: params.path
            }
          });

          let search = params.path ?? directory;
          search = path.isAbsolute(search) ? search : path.resolve(directory, search);
          const info = yield* fs.stat(search).pipe(Effect.catch(() => Effect.succeed(void 0)));
          if (info?.type === 'File') {
            throw new Error(`glob path must be a directory: ${search}`);
          }
          yield* assertExternalDirectoryEffect(ctx, search, {
            bypass: false,
            kind: 'directory'
          });

          const limit = 100;
          let truncated = false;
          const files = yield* rg
            .files({ cwd: search, glob: [params.pattern], signal: ctx.abort })
            .pipe(
              Stream.mapEffect(file =>
                Effect.gen(function* () {
                  const full = path.resolve(search, file);
                  const info = yield* fs
                    .stat(full)
                    .pipe(Effect.catch(() => Effect.succeed(void 0)));
                  const mtime =
                    info?.mtime.pipe(
                      Option.map(date => date.getTime()),
                      Option.getOrElse(() => 0)
                    ) ?? 0;
                  return { path: full, mtime };
                })
              ),
              Stream.take(limit + 1),
              Stream.runCollect,
              Effect.map(chunk => [...chunk])
            );

          if (files.length > limit) {
            truncated = true;
            files.length = limit;
          }
          files.sort((a, b) => b.mtime - a.mtime);

          const output = [];
          if (files.length === 0) {
            output.push('No files found');
          }
          if (files.length > 0) {
            output.push(...files.map(file => file.path));
            if (truncated) {
              output.push('');
              output.push(
                `(Results are truncated: showing first ${limit} results. Consider using a more specific path or pattern.)`
              );
            }
          }

          return {
            title: path.relative(directory, search),
            metadata: {
              count: files.length,
              truncated
            },
            output: output.join('\n')
          };
        }).pipe(Effect.provideService(AppFileSystem.Service, fs), Effect.orDie)
    };
  })
);
