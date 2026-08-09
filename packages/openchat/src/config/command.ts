import { Cause, Effect, Exit, Schema } from 'effect';
import { SchemaCommand } from '@/schema';
import { Glob, Log } from '@/utils';
import { InvalidError } from '@/config/error';
import { parse } from '@/config/markdowm';
import { configEntryNameFromPath } from '@/config/entry-name';

const log = Log.create({ service: 'config' });

const decodeInfo = Schema.decodeUnknownExit(SchemaCommand.Info);

export const load = Effect.fn('ConfigCommand.load')(function* (dir: string) {
  const result: Record<string, SchemaCommand.Info> = {};
  const globResult = yield* Effect.promise(() =>
    Glob.scan('{command,commands}/**/*.md', {
      cwd: dir,
      absolute: true,
      dot: true,
      symlink: true
    })
  );
  for (const item of globResult) {
    const md = yield* parse(item).pipe(
      Effect.catchCause(cause => {
        // TODO
        // const message = FrontmatterError.isInstance(err)
        //   ? err.data.message
        //   : `Failed to parse command ${item}`;
        // const { Session } = await import('@/session/session');
        // void Bus.publish(Session.Event.Error, { error: new NamedError.Unknown({ message }).toObject() });
        log.error('failed to load command', { command: item, err: Cause.squash(cause) });
        return Effect.void;
      })
    );
    if (!md) {
      continue;
    }

    const patterns = ['/command/', '/commands/'];
    const name = configEntryNameFromPath(item, patterns);

    const config = {
      name,
      ...md.data,
      template: md.content.trim()
    };
    const parsed = decodeInfo(config, { errors: 'all', propertyOrder: 'original' });
    if (Exit.isSuccess(parsed)) {
      result[config.name] = parsed.value;
      continue;
    }
    throw new InvalidError(
      { path: item, message: Cause.pretty(parsed.cause) },
      { cause: Cause.squash(parsed.cause) }
    );
  }
  return result;
});
