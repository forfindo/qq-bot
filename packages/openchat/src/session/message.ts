import { SchemaMessage, type SchemaSession } from '@/schema';
import { Effect } from 'effect';
import { Database } from '@/database';
import { and, desc, eq, inArray, lt, or } from 'drizzle-orm';
import { MessageTable, PartTable, SessionTable } from '@/database/sql/session.sql';
import { NotFoundError } from '@/storage/storage';

const older = (row: SchemaMessage.Cursor) =>
  or(
    lt(MessageTable.time_created, row.time),
    and(eq(MessageTable.time_created, row.time), lt(MessageTable.id, row.id))
  );

const part = (row: typeof PartTable.$inferSelect) =>
  ({
    ...row.data,
    id: row.id,
    sessionID: row.session_id,
    messageID: row.message_id
  }) as SchemaMessage.Part;

const info = (row: typeof MessageTable.$inferSelect) =>
  ({
    ...row.data,
    id: row.id,
    sessionID: row.session_id
  }) as SchemaMessage.Info;

const hydrate = (db: Database.Interface['db'], rows: (typeof MessageTable.$inferSelect)[]) => {
  const ids = rows.map(row => row.id);
  const partByMessage = new Map<string, SchemaMessage.Part[]>();
  return Effect.gen(function* () {
    if (ids.length > 0) {
      const partRows = yield* db
        .select()
        .from(PartTable)
        .where(inArray(PartTable.message_id, ids))
        .orderBy(PartTable.message_id, PartTable.id)
        .all()
        .pipe(Effect.orDie);
      for (const row of partRows) {
        const next = part(row);
        const list = partByMessage.get(row.message_id);
        if (list) {
          list.push(next);
        } else {
          partByMessage.set(row.message_id, [next]);
        }
      }
    }

    return rows.map(row => ({
      info: info(row),
      parts: partByMessage.get(row.id) ?? []
    }));
  });
};

export const page = Effect.fn('MessageV2.page')(function* (input: {
  sessionID: SchemaSession.SessionID;
  limit: number;
  before?: string;
}) {
  const { db } = yield* Database.Service;
  const before = input.before ? SchemaMessage.decodeCursor(input.before) : void 0;
  const where = before
    ? and(eq(MessageTable.session_id, input.sessionID), older(before))
    : eq(MessageTable.session_id, input.sessionID);
  const rows = yield* db
    .select()
    .from(MessageTable)
    .where(where)
    .orderBy(desc(MessageTable.time_created), desc(MessageTable.id))
    .limit(input.limit + 1)
    .all()
    .pipe(Effect.orDie);
  if (rows.length === 0) {
    const row = yield* db
      .select({ id: SessionTable.id })
      .from(SessionTable)
      .where(eq(SessionTable.id, input.sessionID))
      .get()
      .pipe(Effect.orDie);
    if (!row) {
      return yield* new NotFoundError({ message: `Session not found: ${input.sessionID}` });
    }
    return {
      items: [] as SchemaMessage.WithParts[],
      more: false
    };
  }

  const more = rows.length > input.limit;
  const slice = more ? rows.slice(0, input.limit) : rows;
  const items = yield* hydrate(db, slice);
  items.reverse();
  const tail = slice.at(-1);
  return {
    items,
    more,
    cursor:
      more && tail ? SchemaMessage.encodeCursor({ id: tail.id, time: tail.time_created }) : void 0
  };
});
