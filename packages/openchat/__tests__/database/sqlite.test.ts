import { integer, sqliteTable, text } from 'drizzle-orm/sqlite-core';
import { Effect } from 'effect';
import { DatabaseSync } from 'node:sqlite';
import type { SqlClient as SqlClientService } from 'effect/unstable/sql/SqlClient';
import { layer } from '@/database/effect-sqlite-node';
import { makeWithDefaults } from '@/database/effect-drizzle-sqlite/effect-sqlite';
import { describe } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { eq, sql } from 'drizzle-orm';
import { isSqlError } from 'effect/unstable/sql/SqlError';

const users = sqliteTable('users', {
  id: integer().primaryKey({ autoIncrement: true }),
  name: text().notNull()
});

const run = <A, E>(effect: Effect.Effect<A, E, SqlClientService>) =>
  Effect.runPromise(
    effect.pipe(Effect.provide(layer({ filename: ':memory:', disableWAL: true })), Effect.scoped)
  );

const makeDb = Effect.gen(function* () {
  const db = yield* makeWithDefaults();
  yield* db.run(sql`create table users
                    (
                      id   integer primary key autoincrement,
                      name text not null
                    )`);
  return db;
});

describe('sqlite node', () => {
  it('selects rows through Effect-yieldable query builders', async () => {
    await run(
      Effect.gen(function* () {
        const db = yield* makeDb;
        yield* db.insert(users).values({ name: 'Ada' });

        expect(yield* db.select().from(users)).toEqual([{ id: 1, name: 'Ada' }]);
        expect(
          yield* db.select({ id: users.id }).from(users).where(eq(users.name, 'Ada')).get()
        ).toEqual({ id: 1 });
      })
    );
  });

  it('commits successful transactions', async () => {
    await run(
      Effect.gen(function* () {
        const db = yield* makeDb;

        yield* db.transaction(tx => tx.insert(users).values({ name: 'Grace' }), {
          behavior: 'immediate'
        });

        expect(yield* db.select().from(users)).toEqual([{ id: 1, name: 'Grace' }]);
      })
    );
  });

  it('rolls back failed transactions', async () => {
    await run(
      Effect.gen(function* () {
        const db = yield* makeDb;

        yield* db
          .transaction(tx =>
            tx
              .insert(users)
              .values({ name: 'Linus' })
              .pipe(Effect.andThen(Effect.fail('boom')))
          )
          .pipe(Effect.ignore);

        expect(yield* db.select().from(users)).toEqual([]);
      })
    );
  });

  it('rolls back explicit transaction rollback', async () => {
    await run(
      Effect.gen(function* () {
        const db = yield* makeDb;

        yield* db
          .transaction(tx =>
            tx
              .insert(users)
              .values({ name: 'Barbara' })
              .pipe(Effect.andThen(Effect.fail(tx.rollback())))
          )
          .pipe(Effect.ignore);

        expect(yield* db.select().from(users)).toEqual([]);
      })
    );
  });

  it('preserves failed transaction begin errors', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'effect-drizzle-sqlite-'));
    const filename = join(dir, 'locked.db');
    const holder = new DatabaseSync(filename);

    try {
      holder.exec('create table users (id integer primary key autoincrement, name text not null)');
      holder.exec('pragma busy_timeout = 0');
      holder.exec('begin immediate');

      await Effect.runPromise(
        Effect.gen(function* () {
          const db = yield* makeWithDefaults();
          yield* db.run(sql`pragma
          busy_timeout = 0`);

          const error = yield* db
            .transaction(tx => tx.insert(users).values({ name: 'Blocked' }), {
              behavior: 'immediate'
            })
            .pipe(Effect.flip);

          if (!isSqlError(error)) {
            throw new Error('Expected SqlError');
          }
          expect(error.reason._tag).toBe('LockTimeoutError');
          expect(error.reason.cause instanceof Error ? error.reason.cause.message : '').toContain(
            'database is locked'
          );
        }).pipe(Effect.provide(layer({ filename, disableWAL: true })), Effect.scoped)
      );
    } finally {
      if (holder.isTransaction) {
        holder.exec('rollback');
      }
      holder.close();
      await rm(dir, { recursive: true, force: true });
    }
  });

  it('supports returning and rejects empty update sets', async () => {
    await run(
      Effect.gen(function* () {
        const db = yield* makeDb;

        const inserted = yield* db
          .insert(users)
          .values({ name: 'Ada' })
          .returning({ id: users.id, name: users.name });
        expect(inserted).toEqual([{ id: 1, name: 'Ada' }]);

        const updated = yield* db
          .update(users)
          .set({ name: 'Grace' })
          .where(eq(users.id, 1))
          .returning();
        expect(updated).toEqual([{ id: 1, name: 'Grace' }]);

        const deleted = yield* db.delete(users).where(eq(users.id, 1)).returning({ id: users.id });
        expect(deleted).toEqual([{ id: 1 }]);

        expect(() => db.update(users).set({ name: void 0 })).toThrow('No values to set');
      })
    );
  });
});
