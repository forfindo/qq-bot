import { SchemaAgent } from '@/schema';
import { Cause, Effect, Exit, Schema } from 'effect';
import { Glob, Log } from '@/utils';
import { parse } from '@/config/markdowm';
import { configEntryNameFromPath } from '@/config/entry-name';
import { schema } from '@/config/parse';

const log = Log.create({ service: 'config' });

export const load = Effect.fn('ConfigAgent.load')(function* (dir: string) {
  const result: Record<string, SchemaAgent.ConfigInfo> = {};
  const globResult = yield* Effect.promise(() =>
    Glob.scan('{agent,agents}/**/*.md', {
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
        //   : `Failed to parse agent ${item}`;
        // const { Session } = await import('@/session/session');
        // void Bus.publish(Session.Event.Error, { error: new NamedError.Unknown({ message }).toObject() });
        log.error('failed to load agent', { agent: item, err: Cause.squash(cause) });
        return Effect.void;
      })
    );
    if (!md) {
      continue;
    }

    const patterns = ['/.openchat/agent/', '/.openchat/agents/', '/agent/', '/agents/'];
    const name = configEntryNameFromPath(item, patterns);

    const config = {
      name,
      ...md.data,
      prompt: md.content.trim()
    };
    result[config.name] = schema(SchemaAgent.ConfigInfo, config, item);
  }
  return result;
});

export const loadMode = Effect.fn('ConfigAgent.loadMore')(function* (dir: string) {
  const result: Record<string, SchemaAgent.ConfigInfo> = {};
  const globResult = yield* Effect.promise(() =>
    Glob.scan('{mode,modes}/*.md', {
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
        // const message = ConfigMarkdown.FrontmatterError.isInstance(err)
        //   ? err.data.message
        //   : `Failed to parse mode ${item}`;
        // const { Session } = await import('@/session/session');
        // void Bus.publish(Session.Event.Error, { error: new NamedError.Unknown({ message }).toObject() });
        log.error('failed to load mode', { mode: item, err: Cause.squash(cause) });
        return Effect.void;
      })
    );
    if (!md) {
      continue;
    }

    const config = {
      name: configEntryNameFromPath(item, []),
      ...md.data,
      prompt: md.content.trim()
    };
    const parsed = Schema.decodeUnknownExit(SchemaAgent.ConfigInfo)(config, {
      errors: 'all',
      propertyOrder: 'original'
    });
    if (Exit.isSuccess(parsed)) {
      result[config.name] = {
        ...parsed.value,
        mode: 'primary' as const
      };
    }
  }
  return result;
});
