import { Effect, Schema } from 'effect';
import { define } from '../tool';
import { AppFileSystem } from '@/file';
import { Event } from '@/event';
import DESCRIPTION from './write.md';
import { InstanceContext } from '@/instance';
import path from 'path';
import { SchemaTool } from '@/schema';
import { assertExternalDirectoryEffect } from '../external-directory';
import { Bom } from '@/utils';
import { trimDiff } from './edit';
import { structuredPatch } from 'diff';

export const Parameters = Schema.Struct({
  content: Schema.String.annotate({ description: 'The content to write to the file' }),
  filePath: Schema.String.annotate({
    description: 'The absolute path to the file to write (must be absolute, not relative)'
  })
});

export const WriteTool = define(
  'write',
  Effect.gen(function* () {
    const fs = yield* AppFileSystem.Service;
    const bus = yield* Event.Service;

    return {
      description: DESCRIPTION,
      parameters: Parameters,
      execute: (params: { content: string; filePath: string }, ctx: SchemaTool.Context) =>
        Effect.gen(function* () {
          const directory = yield* InstanceContext.directory;
          const filepath = path.isAbsolute(params.filePath)
            ? params.filePath
            : path.join(directory, params.filePath);
          yield* assertExternalDirectoryEffect(ctx, filepath);

          const exists = yield* fs.existsSafe(filepath);
          const source = exists ? yield* Bom.readFile(fs, filepath) : { bom: false, text: '' };
          const next = Bom.split(params.content);
          const desiredBom = source.bom || next.bom;
          const contentOld = source.text;
          const contentNew = next.text;

          const diff = trimDiff(structuredPatch(filepath, filepath, contentOld, contentNew));
          yield* ctx.ask({
            permission: 'edit',
            patterns: [path.relative(directory, filepath)],
            always: ['*'],
            metadata: {
              filepath,
              diff
            }
          });

          yield* fs.writeWithDirs(filepath, Bom.join(contentNew, desiredBom));
          void bus;
          // TODO
          // yield* bus.publish(File.Event.Edited, { file: filepath })
          // yield* bus.publish(FileWatcher.Event.Updated, {
          //   file: filepath,
          //   event: exists ? "change" : "add",
          // })

          return {
            title: path.relative(directory, filepath),
            metadata: {
              filepath,
              exists: exists
            },
            output: 'Wrote file successfully.'
          };
        }).pipe(Effect.provideService(AppFileSystem.Service, fs), Effect.orDie)
    };
  })
);
