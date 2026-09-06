import { Effect, Schema } from 'effect';
import { define } from '@/tool/tool';
import { AppFileSystem } from '@/file';
import { Event } from '@/event';
import { SchemaTool } from '@/schema';
import { InstanceContext } from '@/instance';
import { deriveNewContentsFromChunks, type Hunk, parsePatch } from '@/tool/patch';
import path from 'path';
import { assertExternalDirectoryEffect } from '@/tool/external-directory';
import { Bom } from '@/utils';
import { diffLines, structuredPatch } from 'diff';
import { trimDiff } from '@/tool/tools/edit';
import DESCRIPTION from './apply-patch.md';

export const Parameters = Schema.Struct({
  patchText: Schema.String.annotate({
    description: 'The full patch text that describes all changes to be made'
  })
});

export const ApplyPatchTool = define(
  'apply_patch',
  Effect.gen(function* () {
    const fs = yield* AppFileSystem.Service;
    const bus = yield* Event.Service;

    const run = Effect.fn('ApplyPatchTool.execute')(
      function* (params: Schema.Schema.Type<typeof Parameters>, ctx: SchemaTool.Context) {
        if (!params.patchText) {
          return yield* Effect.fail(new Error('patchText is required'));
        }

        // Parse the patch to get hunks
        let hunks: Hunk[];
        try {
          const parseResult = parsePatch(params.patchText);
          hunks = parseResult.hunks;
        } catch (error) {
          return yield* Effect.fail(new Error(`apply_patch verification failed: ${String(error)}`));
        }

        if (hunks.length === 0) {
          const normalized = params.patchText.replace(/\r\n/g, '\n').replace(/\r/g, '\n').trim();
          if (normalized === '*** Begin Patch\n*** End Patch') {
            return yield* Effect.fail(new Error('patch rejected: empty patch'));
          }
          return yield* Effect.fail(new Error('apply_patch verification failed: no hunks found'));
        }

        const directory = yield* InstanceContext.directory;
        // Validate file paths and check permissions
        const fileChanges: Array<{
          filePath: string;
          oldContent: string;
          newContent: string;
          type: 'add' | 'update' | 'delete' | 'move';
          movePath?: string;
          diff: string;
          additions: number;
          deletions: number;
          bom: boolean;
        }> = [];

        let totalDiff = '';

        for (const hunk of hunks) {
          const filePath = path.resolve(directory, hunk.path);
          yield* assertExternalDirectoryEffect(ctx, filePath);

          switch (hunk.type) {
            case 'add': {
              const oldContent = '';
              const newContent =
                hunk.contents.length === 0 || hunk.contents.endsWith('\n')
                  ? hunk.contents
                  : `${hunk.contents}\n`;
              const next = Bom.split(newContent);
              const diff = trimDiff(structuredPatch(filePath, filePath, oldContent, next.text));

              let additions = 0;
              let deletions = 0;
              for (const change of diffLines(oldContent, next.text)) {
                if (change.added) {
                  additions += change.count || 0;
                }
                if (change.removed) {
                  deletions += change.count || 0;
                }
              }

              fileChanges.push({
                filePath,
                oldContent,
                newContent: next.text,
                type: 'add',
                diff,
                additions,
                deletions,
                bom: next.bom
              });

              totalDiff += diff + '\n';
              break;
            }

            case 'update': {
              // Check if file exists for update
              const stats = yield* fs
                .stat(filePath)
                .pipe(Effect.catch(() => Effect.succeed(void 0)));
              if (!stats || stats.type === 'Directory') {
                return yield* Effect.fail(
                  new Error(
                    `apply_patch verification failed: Failed to read file to update: ${filePath}`
                  )
                );
              }

              const source = yield* Bom.readFile(fs, filePath);
              const oldContent = source.text;
              let newContent: string;
              let bom: boolean;

              // Apply the update chunks to get new content
              try {
                const fileUpdate = deriveNewContentsFromChunks(
                  filePath,
                  hunk.chunks,
                  Bom.join(source.text, source.bom)
                );
                newContent = fileUpdate.content;
                bom = fileUpdate.bom;
              } catch (error) {
                return yield* Effect.fail(
                  new Error(`apply_patch verification failed: ${String(error)}`)
                );
              }

              const diff = trimDiff(structuredPatch(filePath, filePath, oldContent, newContent));

              let additions = 0;
              let deletions = 0;
              for (const change of diffLines(oldContent, newContent)) {
                if (change.added) {
                  additions += change.count || 0;
                }
                if (change.removed) {
                  deletions += change.count || 0;
                }
              }

              const movePath = hunk.move_path ? path.resolve(directory, hunk.move_path) : void 0;
              yield* assertExternalDirectoryEffect(ctx, movePath);

              fileChanges.push({
                filePath,
                oldContent,
                newContent,
                type: hunk.move_path ? 'move' : 'update',
                movePath,
                diff,
                additions,
                deletions,
                bom
              });

              totalDiff += diff + '\n';
              break;
            }

            case 'delete': {
              const source = yield* Bom.readFile(fs, filePath).pipe(
                Effect.catch(error =>
                  Effect.fail(
                    new Error(
                      `apply_patch verification failed: ${error instanceof Error ? error.message : String(error)}`
                    )
                  )
                )
              );
              const contentToDelete = source.text;
              const deleteDiff = trimDiff(structuredPatch(filePath, filePath, contentToDelete, ''));

              const deletions = contentToDelete.split('\n').length;

              fileChanges.push({
                filePath,
                oldContent: contentToDelete,
                newContent: '',
                type: 'delete',
                diff: deleteDiff,
                additions: 0,
                deletions,
                bom: source.bom
              });

              totalDiff += deleteDiff + '\n';
              break;
            }
          }
        }

        // Build per-file metadata for UI rendering (used for both permission and result)
        const files = fileChanges.map(change => ({
          filePath: change.filePath,
          relativePath: path
            .relative(directory, change.movePath ?? change.filePath)
            .replaceAll('\\', '/'),
          type: change.type,
          patch: change.diff,
          additions: change.additions,
          deletions: change.deletions,
          movePath: change.movePath
        }));

        // Check permissions if needed
        const relativePaths = fileChanges.map(c =>
          path.relative(directory, c.filePath).replaceAll('\\', '/')
        );
        yield* ctx.ask({
          permission: 'edit',
          patterns: relativePaths,
          always: ['*'],
          metadata: {
            filepath: relativePaths.join(', '),
            diff: totalDiff,
            files
          }
        });

        // Apply the changes
        const updates: Array<{ file: string; event: 'add' | 'change' | 'unlink' }> = [];

        for (const change of fileChanges) {
          const edited = change.type === 'delete' ? void 0 : (change.movePath ?? change.filePath);
          switch (change.type) {
            case 'add':
              // Create parent directories (recursive: true is safe on existing/root dirs)
              yield* fs.writeWithDirs(change.filePath, Bom.join(change.newContent, change.bom));
              updates.push({ file: change.filePath, event: 'add' });
              break;

            case 'update':
              yield* fs.writeWithDirs(change.filePath, Bom.join(change.newContent, change.bom));
              updates.push({ file: change.filePath, event: 'change' });
              break;

            case 'move':
              if (change.movePath) {
                // Create parent directories (recursive: true is safe on existing/root dirs)
                yield* fs.writeWithDirs(change.movePath, Bom.join(change.newContent, change.bom));
                yield* fs.remove(change.filePath);
                updates.push({ file: change.filePath, event: 'unlink' });
                updates.push({ file: change.movePath, event: 'add' });
              }
              break;

            case 'delete':
              yield* fs.remove(change.filePath);
              updates.push({ file: change.filePath, event: 'unlink' });
              break;
          }

          if (edited) {
            void bus;
            // TODO
            // yield* bus.publish(File.Event.Edited, { file: edited });
          }
        }

        // Publish file change events
        for (const update of updates) {
          void update;
          // TODO
          // yield* bus.publish(FileWatcher.Event.Updated, update);
        }

        // Generate output summary
        const summaryLines = fileChanges.map(change => {
          if (change.type === 'add') {
            return `A ${path.relative(directory, change.filePath).replaceAll('\\', '/')}`;
          }
          if (change.type === 'delete') {
            return `D ${path.relative(directory, change.filePath).replaceAll('\\', '/')}`;
          }
          const target = change.movePath ?? change.filePath;
          return `M ${path.relative(directory, target).replaceAll('\\', '/')}`;
        });
        const output = `Success. Updated the following files:\n${summaryLines.join('\n')}`;

        return {
          title: output,
          metadata: {
            diff: totalDiff,
            files
          },
          output
        };
      },
      Effect.provideService(AppFileSystem.Service, fs)
    );

    return {
      description: DESCRIPTION,
      parameters: Parameters,
      execute: (params: Schema.Schema.Type<typeof Parameters>, ctx: SchemaTool.Context) =>
        run(params, ctx).pipe(Effect.orDie)
    };
  })
);
