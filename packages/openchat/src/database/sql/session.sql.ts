import { index, integer, primaryKey, real, sqliteTable, text } from 'drizzle-orm/sqlite-core';
import { Timestamps } from '@/database/schema.sql';
import {
  SchemaMessage,
  SchemaPermission,
  SchemaRevert,
  SchemaSession,
  SchemaSnapshot
} from '@/schema';

type V1MessageData = Omit<SchemaMessage.Info, 'id' | 'sessionID'>;
type V1PartData = Omit<SchemaMessage.Part, 'id' | 'sessionID' | 'messageID'>;

export const SessionTable = sqliteTable(
  'session',
  {
    id: text().$type<SchemaSession.SessionID>().primaryKey(),
    owner_id: text().notNull(),
    parent_id: text().$type<SchemaSession.SessionID>(),
    slug: text().notNull(),
    title: text().notNull(),
    version: text().notNull(),
    share_url: text(),
    summary_additions: integer(),
    summary_deletions: integer(),
    summary_files: integer(),
    summary_diffs: text({ mode: 'json' }).$type<SchemaSnapshot.FileDiff[]>(),
    metadata: text({ mode: 'json' }).$type<Record<string, unknown>>(),
    cost: real().notNull().default(0),
    tokens_input: integer().notNull().default(0),
    tokens_output: integer().notNull().default(0),
    tokens_reasoning: integer().notNull().default(0),
    tokens_cache_read: integer().notNull().default(0),
    tokens_cache_write: integer().notNull().default(0),
    revert: text({ mode: 'json' }).$type<SchemaRevert.State>(),
    permission: text({ mode: 'json' }).$type<SchemaPermission.Ruleset>(),
    agent: text(),
    model: text({ mode: 'json' }).$type<{
      id: string;
      providerID: string;
      variant?: string;
    }>(),
    ...Timestamps,
    time_compacting: integer(),
    time_archived: integer()
  },
  table => [
    index('session_owner_idx').on(table.owner_id),
    index('session_parent_idx').on(table.parent_id)
  ]
);

export const MessageTable = sqliteTable(
  'message',
  {
    id: text().$type<SchemaMessage.MessageID>().primaryKey(),
    session_id: text()
      .$type<SchemaSession.SessionID>()
      .notNull()
      .references(() => SessionTable.id, { onDelete: 'cascade' }),
    ...Timestamps,
    data: text({ mode: 'json' }).notNull().$type<V1MessageData>()
  },
  table => [
    index('message_session_time_created_id_idx').on(table.session_id, table.time_created, table.id)
  ]
);

export const PartTable = sqliteTable(
  'part',
  {
    id: text().$type<SchemaMessage.PartID>().primaryKey(),
    message_id: text()
      .$type<SchemaMessage.MessageID>()
      .notNull()
      .references(() => MessageTable.id, { onDelete: 'cascade' }),
    session_id: text().$type<SchemaSession.SessionID>().notNull(),
    ...Timestamps,
    data: text({ mode: 'json' }).notNull().$type<V1PartData>()
  },
  table => [
    index('part_message_id_id_idx').on(table.message_id, table.id),
    index('part_session_idx').on(table.session_id)
  ]
);

export const TodoTable = sqliteTable(
  'todo',
  {
    session_id: text()
      .$type<SchemaSession.SessionID>()
      .notNull()
      .references(() => SessionTable.id, { onDelete: 'cascade' }),
    content: text().notNull(),
    status: text().notNull(),
    priority: text().notNull(),
    position: integer().notNull(),
    ...Timestamps
  },
  table => [
    primaryKey({ columns: [table.session_id, table.position] }),
    index('todo_session_idx').on(table.session_id)
  ]
);
