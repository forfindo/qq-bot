import { index, integer, primaryKey, real, sqliteTable, text } from 'drizzle-orm/sqlite-core';
import { Timestamps } from '@/database/schema.sql';
import { SchemaPermission, SchemaRevert, SchemaSession, SchemaSnapshot } from '@/schema';

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
