import { SchemaMessage, SchemaPermission, SchemaProvider, SchemaSession } from '@/schema';
import { Context, Effect, Layer, Option, Schema } from 'effect';
import { NotFoundError } from '@/storage/storage';
import { Database } from '@/database';
import { Event } from '@/event';
import { BackgroundJob } from '@/background';
import { SessionTable, PartTable } from '@/database/sql/session.sql';
import { and, desc, eq, gte, isNull, like } from 'drizzle-orm';
import { InstallationVersion } from '@/installation/version';
import { Slug } from '@/utils';
import * as MessageSender from './message-sender';
import * as Message from './message';
import { InstanceContext } from '@/instance';

export type NotFound = NotFoundError;

export type ListInput = {
  ownerID?: string;
  roots?: boolean;
  start?: number;
  search?: string;
  limit?: number;
};

export type Patch = Omit<
  Partial<SchemaSession.SessionInfo>,
  'time' | 'share' | 'summary' | 'revert' | 'permission'
> & {
  time?: Partial<SchemaSession.SessionInfo['time']>;
  share?: Partial<NonNullable<SchemaSession.SessionInfo['share']>> | null;
  summary?: SchemaSession.SessionInfo['summary'] | null;
  revert?: SchemaSession.SessionInfo['revert'] | null;
  permission?: SchemaSession.SessionInfo['permission'] | null;
};

type SessionRow = typeof SessionTable.$inferSelect;

const parentTitlePrefix = 'New session - ';
const childTitlePrefix = 'Child session - ';
const EmptyTokens = { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } };

export const fromRow = (row: SessionRow): SchemaSession.SessionInfo => {
  const summary =
    row.summary_additions !== null || row.summary_deletions !== null || row.summary_files !== null
      ? {
          additions: row.summary_additions ?? 0,
          deletions: row.summary_deletions ?? 0,
          files: row.summary_files ?? 0,
          diffs: row.summary_diffs ?? void 0
        }
      : void 0;
  const share = row.share_url ? { url: row.share_url } : void 0;
  const revert = row.revert
    ? {
        messageID: SchemaMessage.MessageID.make(row.revert.messageID),
        partID: row.revert.partID ? SchemaMessage.PartID.make(row.revert.partID) : void 0,
        snapshot: row.revert.snapshot,
        diff: row.revert.diff
      }
    : void 0;
  return {
    id: row.id,
    slug: row.slug,
    ownerID: row.owner_id,
    parentID: row.parent_id ?? void 0,
    title: row.title,
    agent: row.agent ?? void 0,
    model: row.model
      ? {
          id: SchemaProvider.ModelID.make(row.model.id),
          providerID: SchemaProvider.ProviderID.make(row.model.providerID),
          variant: row.model.variant
        }
      : void 0,
    version: row.version,
    summary,
    cost: row.cost,
    tokens: {
      input: row.tokens_input,
      output: row.tokens_output,
      reasoning: row.tokens_reasoning,
      cache: {
        read: row.tokens_cache_read,
        write: row.tokens_cache_write
      }
    },
    share,
    metadata: row.metadata ?? void 0,
    revert,
    permission: row.permission ? [...row.permission] : void 0,
    time: {
      created: row.time_created,
      updated: row.time_updated,
      compacting: row.time_compacting ?? void 0,
      archived: row.time_archived ?? void 0
    }
  };
};

const getForkedTitle = (title: string): string => {
  const match = title.match(/^(.+) \(fork #(\d+)\)$/);
  if (match) {
    const base = match[1];
    const num = parseInt(match[2]!, 10);
    return `${base} (fork #${num + 1})`;
  }
  return `${title} (fork #1)`;
};

const cancelBackgroundJobs = Effect.fn('Session.cancelBackgroundJobs')(function* (
  background: BackgroundJob.Interface,
  sessionID: SchemaSession.SessionID
) {
  const jobs = yield* background.list();
  yield* Effect.forEach(
    jobs.filter(job => {
      if (job.status !== 'running') {
        return false;
      }
      if (job.id === sessionID) {
        return true;
      }
      if (job.metadata?.sessionId === sessionID) {
        return true;
      }
      return job.metadata?.parentSessionId === sessionID;
    }),
    job => background.cancel(job.id),
    { concurrency: 'unbounded', discard: true }
  );
});

export interface Interface {
  readonly list: (input?: ListInput) => Effect.Effect<SchemaSession.SessionInfo[]>;
  readonly create: (input?: {
    parentID?: SchemaSession.SessionID;
    title?: string;
    agent?: string;
    model?: Schema.Schema.Type<typeof SchemaSession.Model>;
    metadata?: typeof SchemaSession.Metadata.Type;
    permission?: SchemaPermission.Ruleset;
  }) => Effect.Effect<SchemaSession.SessionInfo>;
  readonly fork: (input: {
    sessionID: SchemaSession.SessionID;
    messageID?: SchemaMessage.MessageID;
  }) => Effect.Effect<SchemaSession.SessionInfo, NotFound>;
  readonly touch: (sessionID: SchemaSession.SessionID) => Effect.Effect<void>;
  readonly get: (id: SchemaSession.SessionID) => Effect.Effect<SchemaSession.SessionInfo, NotFound>;
  readonly setTitle: (input: {
    sessionID: SchemaSession.SessionID;
    title: string;
  }) => Effect.Effect<void>;
  readonly setArchived: (input: {
    sessionID: SchemaSession.SessionID;
    time?: number;
  }) => Effect.Effect<void>;
  readonly setMetadata: (input: typeof SchemaSession.SetMetadataInput.Type) => Effect.Effect<void>;
  readonly setAgentModel: (input: {
    sessionID: SchemaSession.SessionID;
    agent: string;
    model: NonNullable<SchemaSession.SessionInfo['model']>;
    time: number;
  }) => Effect.Effect<void>;
  readonly setPermission: (input: {
    sessionID: SchemaSession.SessionID;
    permission: SchemaPermission.Ruleset;
  }) => Effect.Effect<void>;
  readonly setRevert: (input: {
    sessionID: SchemaSession.SessionID;
    revert: SchemaSession.SessionInfo['revert'];
    summary: SchemaSession.SessionInfo['summary'];
  }) => Effect.Effect<void>;
  readonly clearRevert: (sessionID: SchemaSession.SessionID) => Effect.Effect<void>;
  readonly setSummary: (input: {
    sessionID: SchemaSession.SessionID;
    summary: SchemaSession.SessionInfo['summary'];
  }) => Effect.Effect<void>;
  readonly setShare: (input: {
    sessionID: SchemaSession.SessionID;
    share: SchemaSession.SessionInfo['share'];
  }) => Effect.Effect<void>;
  readonly messages: (input: {
    sessionID: SchemaSession.SessionID;
    limit?: number;
  }) => Effect.Effect<SchemaMessage.WithParts[], NotFound>;
  readonly children: (
    parentID: SchemaSession.SessionID
  ) => Effect.Effect<SchemaSession.SessionInfo[]>;
  readonly remove: (sessionID: SchemaSession.SessionID) => Effect.Effect<void, NotFound>;
  readonly updateMessage: <T extends SchemaMessage.Info>(msg: T) => Effect.Effect<T>;
  readonly removeMessage: (input: {
    sessionID: SchemaSession.SessionID;
    messageID: SchemaMessage.MessageID;
  }) => Effect.Effect<SchemaMessage.MessageID>;
  readonly removePart: (input: {
    sessionID: SchemaSession.SessionID;
    messageID: SchemaMessage.MessageID;
    partID: SchemaMessage.PartID;
  }) => Effect.Effect<SchemaMessage.PartID>;
  readonly getPart: (input: {
    sessionID: SchemaSession.SessionID;
    messageID: SchemaMessage.MessageID;
    partID: SchemaMessage.PartID;
  }) => Effect.Effect<SchemaMessage.Part | undefined>;
  readonly updatePart: <T extends SchemaMessage.Part>(part: T) => Effect.Effect<T>;
  readonly updatePartDelta: (input: {
    sessionID: SchemaSession.SessionID;
    messageID: SchemaMessage.MessageID;
    partID: SchemaMessage.PartID;
    field: string;
    delta: string;
  }) => Effect.Effect<void>;
  /** Finds the first message matching the predicate, searching newest-first. */
  readonly findMessage: (
    sessionID: SchemaSession.SessionID,
    predicate: (msg: SchemaMessage.WithParts) => boolean
  ) => Effect.Effect<Option.Option<SchemaMessage.WithParts>, NotFound>;
}

export class Service extends Context.Service<Service, Interface>()('@openchat/Session') {}

export const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const database = yield* Database.Service;
    const bus = yield* Event.Service;
    const background = yield* BackgroundJob.Service;
    const sender = yield* MessageSender.Service;
    const db = database.db;

    const patch = (sessionID: SchemaSession.SessionID, info: Patch) =>
      Effect.gen(function* () {
        const current = yield* get(sessionID);
        const next = {
          ...current,
          ...info,
          time: info.time ? { ...current.time, ...info.time } : current.time,
          share:
            info.share === null
              ? void 0
              : info.share
                ? { ...current.share, ...info.share }
                : current.share,
          summary: info.summary === null ? void 0 : (info.summary ?? current.summary),
          revert: info.revert === null ? void 0 : (info.revert ?? current.revert),
          permission: info.permission === null ? void 0 : (info.permission ?? current.permission)
        } as SchemaSession.SessionInfo;
        yield* bus.publish(SchemaSession.Events.Updated, { sessionID, info: next });
      });

    const updateMessage = <T extends SchemaMessage.Info>(msg: T): Effect.Effect<T> =>
      Effect.gen(function* () {
        yield* bus.publish(SchemaSession.Events.MessageUpdated, {
          sessionID: msg.sessionID,
          info: msg
        });
        return msg;
      }).pipe(Effect.withSpan('Session.updateMessage'));

    const updatePart = <T extends SchemaMessage.Part>(part: T): Effect.Effect<T> =>
      Effect.gen(function* () {
        yield* bus.publish(SchemaSession.Events.PartUpdated, {
          sessionID: part.sessionID,
          part: structuredClone(part),
          time: Date.now()
        });
        return part;
      }).pipe(Effect.withSpan('Session.updatePart'));

    const get = Effect.fn('Session.get')(function* (id: SchemaSession.SessionID) {
      const row = yield* db
        .select()
        .from(SessionTable)
        .where(eq(SessionTable.id, id))
        .get()
        .pipe(Effect.orDie);
      if (!row) {
        return yield* Effect.fail(new NotFoundError({ message: `Session not found: ${id}` }));
      }
      return fromRow(row);
    });

    const createNext = Effect.fn('Session.createNext')(function* (input: {
      id?: SchemaSession.SessionID;
      title?: string;
      agent?: string;
      model?: Schema.Schema.Type<typeof SchemaSession.Model>;
      parentID?: SchemaSession.SessionID;
      ownerID: string;
      path?: string;
      metadata?: typeof SchemaSession.Metadata.Type;
      permission?: SchemaPermission.Ruleset;
    }) {
      const result: SchemaSession.SessionInfo = {
        id: SchemaSession.SessionID.descending(input.id),
        ownerID: input.ownerID,
        slug: Slug.create(),
        version: InstallationVersion,
        parentID: input.parentID,
        title:
          input.title ??
          (input.parentID ? childTitlePrefix : parentTitlePrefix) + new Date().toISOString(),
        agent: input.agent,
        model: input.model,
        metadata: input.metadata,
        permission: input.permission ? [...input.permission] : void 0,
        cost: 0,
        tokens: EmptyTokens,
        time: {
          created: Date.now(),
          updated: Date.now()
        }
      };
      yield* Effect.logInfo('created', result);
      yield* bus.publish(SchemaSession.Events.Created, { sessionID: result.id, info: result });
      return result;
    });

    const list = Effect.fn('Session.list')(function* (input?: ListInput) {
      const conditions = [];
      if (input?.ownerID) {
        conditions.push(eq(SessionTable.owner_id, input.ownerID));
      }
      if (input?.roots) {
        conditions.push(isNull(SessionTable.parent_id));
      }
      if (input?.start) {
        conditions.push(gte(SessionTable.time_updated, input.start));
      }
      if (input?.search) {
        conditions.push(like(SessionTable.title, `%${input.search}%`));
      }

      const limit = input?.limit ?? 100;

      return yield* db
        .select()
        .from(SessionTable)
        .where(and(...conditions))
        .orderBy(desc(SessionTable.time_updated))
        .limit(limit)
        .all()
        .pipe(
          Effect.orDie,
          Effect.map(rows => rows.map(fromRow))
        );
    });

    const create = Effect.fn('Session.create')(function* (input?: {
      parentID?: SchemaSession.SessionID;
      title?: string;
      agent?: string;
      model?: Schema.Schema.Type<typeof SchemaSession.Model>;
      metadata?: typeof SchemaSession.Metadata.Type;
      permission?: SchemaPermission.Ruleset;
    }) {
      return yield* createNext({
        ownerID: sender.groupID ?? sender.uid,
        parentID: input?.parentID,
        title: input?.title,
        agent: input?.agent,
        model: input?.model,
        metadata: input?.metadata,
        permission: input?.permission
      });
    });

    const messages: Interface['messages'] = Effect.fn('Session.messages')(function* (input) {
      if (input.limit) {
        return (yield* Message.page({ sessionID: input.sessionID, limit: input.limit }).pipe(
          Effect.provideService(Database.Service, database)
        )).items;
      }

      const size = 50;
      const result = [] as SchemaMessage.WithParts[];
      let before: string | undefined;
      while (true) {
        const page = yield* Message.page({
          sessionID: input.sessionID,
          limit: size,
          before
        }).pipe(Effect.provideService(Database.Service, database));
        if (page.items.length === 0) {
          break;
        }
        for (let i = page.items.length - 1; i >= 0; i--) {
          const item = page.items[i];
          if (item) {
            result.push(item);
          }
        }
        if (!page.more || !page.cursor) {
          break;
        }
        before = page.cursor;
      }
      return result.reverse();
    });

    const fork = Effect.fn('Session.fork')(function* (input: {
      sessionID: SchemaSession.SessionID;
      messageID?: SchemaMessage.MessageID;
    }) {
      const original = yield* get(input.sessionID);
      const title = getForkedTitle(original.title);
      const session = yield* createNext({
        ownerID: sender.groupID ?? sender.uid,
        title,
        metadata: structuredClone(original.metadata)
      });
      const msgs = yield* messages({ sessionID: input.sessionID });
      const idMap = new Map<string, SchemaMessage.MessageID>();
      const target = input.messageID
        ? msgs.findIndex(msg => msg.info.id === input.messageID)
        : msgs.length;

      for (const msg of msgs.slice(0, target < 0 ? msgs.length : target)) {
        const newID = SchemaMessage.MessageID.ascending();
        idMap.set(msg.info.id, newID);

        const parentID =
          msg.info.role === 'assistant' && msg.info.parentID
            ? idMap.get(msg.info.parentID)
            : void 0;
        const cloned = yield* updateMessage({
          ...msg.info,
          sessionID: session.id,
          id: newID,
          ...(parentID && { parentID })
        });

        for (const part of msg.parts) {
          const p: SchemaMessage.Part = {
            ...part,
            id: SchemaMessage.PartID.ascending(),
            messageID: cloned.id,
            sessionID: session.id
          };
          if (p.type === 'compaction' && p.tail_start_id) {
            p.tail_start_id = idMap.get(p.tail_start_id);
          }
          yield* updatePart(p);
        }
      }
      return session;
    });

    const touch = Effect.fn('Session.touch')(function* (sessionID: SchemaSession.SessionID) {
      yield* patch(sessionID, { time: { updated: Date.now() } }).pipe(Effect.orDie);
    });

    const setTitle = Effect.fn('Session.setTitle')(function* (input: {
      sessionID: SchemaSession.SessionID;
      title: string;
    }) {
      yield* patch(input.sessionID, { title: input.title }).pipe(Effect.orDie);
    });

    const setArchived = Effect.fn('Session.setArchived')(function* (input: {
      sessionID: SchemaSession.SessionID;
      time?: number;
    }) {
      yield* patch(input.sessionID, { time: { archived: input.time } }).pipe(Effect.orDie);
    });

    const setMetadata = Effect.fn('Session.setMetadata')(function* (
      input: typeof SchemaSession.SetMetadataInput.Type
    ) {
      yield* patch(input.sessionID, {
        metadata: input.metadata,
        time: { updated: Date.now() }
      }).pipe(Effect.orDie);
    });

    const setAgentModel = Effect.fn('Session.setAgentModel')(function* (input: {
      sessionID: SchemaSession.SessionID;
      agent: string;
      model: NonNullable<SchemaSession.SessionInfo['model']>;
      time: number;
    }) {
      yield* patch(input.sessionID, {
        agent: input.agent,
        model: input.model,
        time: { updated: input.time }
      }).pipe(Effect.orDie);
    });

    const setPermission = Effect.fn('Session.setPermission')(function* (input: {
      sessionID: SchemaSession.SessionID;
      permission: SchemaPermission.Ruleset;
    }) {
      yield* patch(input.sessionID, {
        permission: [...input.permission],
        time: { updated: Date.now() }
      }).pipe(Effect.orDie);
    });

    const setRevert = Effect.fn('Session.setRevert')(function* (input: {
      sessionID: SchemaSession.SessionID;
      revert: SchemaSession.SessionInfo['revert'];
      summary: SchemaSession.SessionInfo['summary'];
    }) {
      yield* patch(input.sessionID, {
        summary: input.summary,
        time: { updated: Date.now() },
        revert: input.revert
      }).pipe(Effect.orDie);
    });

    const clearRevert = Effect.fn('Session.clearRevert')(function* (
      sessionID: SchemaSession.SessionID
    ) {
      yield* patch(sessionID, { time: { updated: Date.now() }, revert: null }).pipe(Effect.orDie);
    });

    const setSummary = Effect.fn('Session.setSummary')(function* (input: {
      sessionID: SchemaSession.SessionID;
      summary: SchemaSession.SessionInfo['summary'];
    }) {
      yield* patch(input.sessionID, { time: { updated: Date.now() }, summary: input.summary }).pipe(
        Effect.orDie
      );
    });

    const setShare = Effect.fn('Session.setShare')(function* (input: {
      sessionID: SchemaSession.SessionID;
      share: SchemaSession.SessionInfo['share'];
    }) {
      yield* patch(input.sessionID, {
        share: input.share ?? null,
        time: { updated: Date.now() }
      }).pipe(Effect.orDie);
    });

    const removeMessage = Effect.fn('Session.removeMessage')(function* (input: {
      sessionID: SchemaSession.SessionID;
      messageID: SchemaMessage.MessageID;
    }) {
      yield* bus.publish(SchemaSession.Events.MessageRemoved, {
        sessionID: input.sessionID,
        messageID: input.messageID
      });
      return input.messageID;
    });

    const removePart = Effect.fn('Session.removePart')(function* (input: {
      sessionID: SchemaSession.SessionID;
      messageID: SchemaMessage.MessageID;
      partID: SchemaMessage.PartID;
    }) {
      yield* bus.publish(SchemaSession.Events.PartRemoved, {
        sessionID: input.sessionID,
        messageID: input.messageID,
        partID: input.partID
      });
      return input.partID;
    });

    const children = Effect.fn('Session.children')(function* (parentID: SchemaSession.SessionID) {
      const rows = yield* db
        .select()
        .from(SessionTable)
        .where(and(eq(SessionTable.parent_id, parentID)))
        .all()
        .pipe(Effect.orDie);
      return rows.map(fromRow);
    });

    const remove: Interface['remove'] = Effect.fnUntraced(function* (
      sessionID: SchemaSession.SessionID
    ) {
      const session = yield* get(sessionID);
      try {
        // `remove` needs to work in all cases, such as broken sessions that
        // run cleanup without instance state.
        const hasInstance = yield* InstanceContext.uid.pipe(
          Effect.as(true),
          Effect.catchCause(() => Effect.succeed(false))
        );

        if (hasInstance) {
          yield* cancelBackgroundJobs(background, sessionID);
        }
        const kids = yield* children(sessionID);
        for (const child of kids) {
          yield* remove(child.id);
        }

        yield* bus.publish(SchemaSession.Events.Deleted, { sessionID, info: session });
        // TODO
        // yield* bus.remove(sessionID)
      } catch (error) {
        yield* Effect.logError('failed to remove session', { sessionID, error });
      }
    });

    const getPart: Interface['getPart'] = Effect.fn('Session.getPart')(function* (input) {
      const row = yield* db
        .select()
        .from(PartTable)
        .where(
          and(
            eq(PartTable.session_id, input.sessionID),
            eq(PartTable.message_id, input.messageID),
            eq(PartTable.id, input.partID)
          )
        )
        .get()
        .pipe(Effect.orDie);
      if (!row) {
        return;
      }
      return {
        ...row.data,
        id: row.id,
        sessionID: row.session_id,
        messageID: row.message_id
      } as SchemaMessage.Part;
    });

    const updatePartDelta = Effect.fnUntraced(function* (input: {
      sessionID: SchemaSession.SessionID;
      messageID: SchemaMessage.MessageID;
      partID: SchemaMessage.PartID;
      field: string;
      delta: string;
    }) {
      yield* bus.publish(SchemaSession.Events.PartDelta, input);
    });

    /** Finds the first message matching the predicate, searching newest-first. */
    const findMessage: Interface['findMessage'] = Effect.fn('Session.findMessage')(
      function* (sessionID, predicate) {
        const size = 50;
        let before: string | undefined;
        while (true) {
          const page = yield* Message.page({ sessionID, limit: size, before }).pipe(
            Effect.provideService(Database.Service, database)
          );
          if (page.items.length === 0) {
            break;
          }
          for (let i = page.items.length - 1; i >= 0; i--) {
            const item = page.items[i];
            if (item && predicate(item)) {
              return Option.some(item);
            }
          }
          if (!page.more || !page.cursor) {
            break;
          }
          before = page.cursor;
        }
        return Option.none<SchemaMessage.WithParts>();
      }
    );

    return Service.of({
      get,
      list,
      fork,
      touch,
      create,
      getPart,
      setShare,
      messages,
      setTitle,
      setRevert,
      clearRevert,
      setArchived,
      setMetadata,
      setSummary,
      updateMessage,
      setPermission,
      setAgentModel,
      removeMessage,
      removePart,
      updatePart,
      findMessage,
      updatePartDelta,
      children,
      remove
    });
  })
);

export const defaultLayer = layer.pipe(
  Layer.provide(BackgroundJob.layer),
  Layer.provide(Event.defaultLayer),
  Layer.provide(Database.defaultLayer)
);
