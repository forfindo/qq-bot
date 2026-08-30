import { Context, Effect, Layer } from 'effect';
import EffectDrizzleSqlite from './effect-drizzle-sqlite';
import { isAbsolute, join } from 'path';
import { Flag } from '@/flag';
import { Global } from '@/utils';
import { InstallationChannel } from '@/installation/version';
import { layer as sqliteLayer } from './sqlite.node';

const makeDatabase = EffectDrizzleSqlite.makeWithDefaults();
type DatabaseShape = Effect.Success<typeof makeDatabase>;

export interface Interface {
  db: DatabaseShape;
}

export class Service extends Context.Service<Service, Interface>()('@openchat/Database') {}

const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const db = yield* makeDatabase;

    yield* db.run('PRAGMA journal_mode = WAL');
    yield* db.run('PRAGMA synchronous = NORMAL');
    yield* db.run('PRAGMA busy_timeout = 5000');
    yield* db.run('PRAGMA cache_size = -64000');
    yield* db.run('PRAGMA foreign_keys = ON');
    yield* db.run('PRAGMA wal_checkpoint(PASSIVE)');

    return { db };
  }).pipe(Effect.orDie)
);

export function path() {
  if (Flag.OPENCHAT_DB) {
    if (Flag.OPENCHAT_DB === ':memory:' || isAbsolute(Flag.OPENCHAT_DB)) {
      return Flag.OPENCHAT_DB;
    }
    return join(Global.Path.data, Flag.OPENCHAT_DB);
  }
  if (
    ['latest', 'beta', 'prod'].includes(InstallationChannel) ||
    process.env.DISABLE_CHANNEL_DB === '1' ||
    process.env.DISABLE_CHANNEL_DB === 'true'
  ) {
    return join(Global.Path.data, 'opencode.db');
  }
  return join(
    Global.Path.data,
    `opencode-${InstallationChannel.replace(/[^a-zA-Z0-9._-]/g, '-')}.db`
  );
}

export const defaultLayer = layer.pipe(Layer.provide(sqliteLayer({ filename: path() })));
