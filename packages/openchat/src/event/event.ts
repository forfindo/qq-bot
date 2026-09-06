import { SchemaEvent, SchemaSession } from '@/schema';
import { Context, Effect, Layer, PubSub, Schema, Stream } from 'effect';
import { LocationRef } from '@/event/location';
import { isDeepStrictEqual } from 'node:util';
import { Database } from '@/database';
import { EventSequenceTable, EventTable } from '@/database/sql/event.sql';
import { and, asc, eq, gt } from 'drizzle-orm';

const versionedType = (type: string, version: number) => {
  return `${type}.${version}`;
};

const readonlyMap = <Key, Value>(map: Map<Key, Value>): ReadonlyMap<Key, Value> => {
  const result: ReadonlyMap<Key, Value> = Object.freeze({
    get size() {
      return map.size;
    },
    entries: () => map.entries(),
    forEach: (
      callback: (value: Value, key: Key, map: ReadonlyMap<Key, Value>) => void,
      thisArg?: unknown
    ) => map.forEach((value, key) => callback.call(thisArg, value, key, result)),
    get: (key: Key) => map.get(key),
    has: (key: Key) => map.has(key),
    keys: () => map.keys(),
    values: () => map.values(),
    [Symbol.iterator]: () => map[Symbol.iterator]()
  });
  return result;
};

const durable = <const Definitions extends ReadonlyArray<SchemaEvent.Definition>>(
  definitions: Definitions
) => {
  return readonlyMap(
    definitions.reduce((result, definition) => {
      if (!definition.durable) {
        return result;
      }
      const key = versionedType(definition.type, definition.durable.version);
      if (result.has(key)) {
        throw new Error(`Duplicate durable event definition for ${key}`);
      }
      result.set(key, definition);
      return result;
    }, new Map<string, Definitions[number]>())
  );
};

const Durable = durable([
  ...SchemaSession.Events.Definitions.filter(definition => definition.durable !== void 0),
  ...SchemaSession.DurableDefinitions
]);

const decodeSerializedEvent = (event: SerializedEvent): SchemaEvent.Payload => {
  const definition = Durable.get(event.type);
  if (!definition?.durable) {
    throw new SchemaEvent.InvalidDurableEventError({
      type: event.type,
      message: `Unknown durable event type ${event.type}`
    });
  }
  return {
    id: event.id,
    type: definition.type,
    durable: {
      aggregateID: event.aggregateID,
      seq: event.seq,
      version: definition.durable.version
    },
    data: Schema.decodeUnknownSync(definition.data)(event.data)
  };
};

export type Subscriber<D extends SchemaEvent.Definition = SchemaEvent.Definition> = (
  event: SchemaEvent.Payload<D>
) => Effect.Effect<void>;

export interface LayerOptions {
  readonly beforeAggregateRead?: (aggregateID: string) => Effect.Effect<void>;
}

export type SerializedEvent = {
  readonly id: SchemaEvent.ID;
  readonly type: string;
  readonly seq: number;
  readonly aggregateID: string;
  readonly data: Record<string, unknown>;
};

export interface PublishOptions {
  readonly id?: SchemaEvent.ID;
  readonly metadata?: Record<string, unknown>;
  readonly location?: SchemaEvent.LocationRef;
  /** Local operational projection committed atomically with a new durable event. Not replayed or serialized. */
  readonly commit?: (seq: number) => Effect.Effect<void>;
}

export interface Interface {
  readonly publish: <D extends SchemaEvent.Definition>(
    definition: D,
    data: SchemaEvent.Data<D>,
    options?: PublishOptions
  ) => Effect.Effect<SchemaEvent.Payload<D>>;
  readonly subscribe: <D extends SchemaEvent.Definition>(
    definition: D
  ) => Stream.Stream<SchemaEvent.Payload<D>>;
  readonly all: () => Stream.Stream<SchemaEvent.Payload>;
  readonly durable: (input: {
    readonly aggregateID: string;
    readonly after?: number;
  }) => Stream.Stream<SchemaEvent.Payload>;
  readonly project: <D extends SchemaEvent.Definition>(
    definition: D,
    projector: Subscriber<D>
  ) => Effect.Effect<void>;
  readonly replay: (
    event: SerializedEvent,
    options?: {
      readonly publish?: boolean;
      readonly ownerID?: string;
      readonly strictOwner?: boolean;
    }
  ) => Effect.Effect<void>;
  readonly replayAll: (
    events: SerializedEvent[],
    options?: {
      readonly publish?: boolean;
      readonly ownerID?: string;
      readonly strictOwner?: boolean;
    }
  ) => Effect.Effect<string | undefined>;
  readonly remove: (aggregateID: string) => Effect.Effect<void>;
  readonly claim: (aggregateID: string, ownerID: string) => Effect.Effect<void>;
}

export class Service extends Context.Service<Service, Interface>()('@openchat/Event') {}

const layerWith = (options?: LayerOptions) =>
  Layer.effect(
    Service,
    Effect.gen(function* () {
      const { db } = yield* Database.Service;

      const pubsub = {
        all: yield* PubSub.unbounded<SchemaEvent.Payload>(),
        durable: new Map<string, Set<PubSub.PubSub<void>>>(),
        typed: new Map<string, PubSub.PubSub<SchemaEvent.Payload>>()
      };
      // TODO: Bind durable projectors to exact type+version before supporting incompatible historical payloads.
      const projectors = new Map<string, Subscriber[]>();

      yield* Effect.addFinalizer(() =>
        Effect.gen(function* () {
          yield* PubSub.shutdown(pubsub.all);
          yield* Effect.forEach(
            pubsub.durable.values(),
            pubsubs => Effect.forEach(pubsubs, PubSub.shutdown, { discard: true }),
            { discard: true }
          );
          yield* Effect.forEach(pubsub.typed.values(), PubSub.shutdown, { discard: true });
        })
      );

      const getOrCreate = (definition: SchemaEvent.Definition) =>
        Effect.gen(function* () {
          const existing = pubsub.typed.get(definition.type);
          if (existing) {
            return existing;
          }
          const created = yield* PubSub.unbounded<SchemaEvent.Payload>();
          pubsub.typed.set(definition.type, created);
          return created;
        });

      const readAfter = (aggregateID: string, after: number) =>
        (options?.beforeAggregateRead?.(aggregateID) ?? Effect.void).pipe(
          Effect.andThen(
            db
              .select()
              .from(EventTable)
              .where(and(eq(EventTable.aggregate_id, aggregateID), gt(EventTable.seq, after)))
              .orderBy(asc(EventTable.seq))
              .all()
          ),
          Effect.orDie,
          Effect.map(rows =>
            rows.map(event =>
              decodeSerializedEvent({
                id: event.id,
                aggregateID: event.aggregate_id,
                seq: event.seq,
                type: event.type,
                data: event.data
              })
            )
          )
        );

      const subscribeDurable = (aggregateID: string) =>
        Effect.gen(function* () {
          const wake = yield* PubSub.sliding<void>(1);
          const subscription = yield* PubSub.subscribe(wake);
          yield* Effect.acquireRelease(
            Effect.sync(() => {
              const wakes = pubsub.durable.get(aggregateID) ?? new Set();
              wakes.add(wake);
              pubsub.durable.set(aggregateID, wakes);
            }),
            () =>
              Effect.sync(() => {
                const wakes = pubsub.durable.get(aggregateID);
                wakes?.delete(wake);
                if (wakes?.size === 0) {
                  pubsub.durable.delete(aggregateID);
                }
              }).pipe(Effect.andThen(PubSub.shutdown(wake)))
          );
          return subscription;
        });

      const notify = (event: SchemaEvent.Payload) => {
        return Effect.gen(function* () {
          const typed = pubsub.typed.get(event.type);
          if (typed) {
            yield* PubSub.publish(typed, event);
          }
          yield* PubSub.publish(pubsub.all, event);
        });
      };

      const commitDurableEvent = (
        definition: SchemaEvent.Definition,
        event: SchemaEvent.Payload,
        input?: {
          readonly seq: number;
          readonly aggregateID: string;
          readonly ownerID?: string;
          readonly strictOwner?: boolean;
        },
        commit?: (seq: number) => Effect.Effect<void>
      ) => {
        return Effect.gen(function* () {
          const durable = definition?.durable;
          if (durable) {
            const aggregateID = (event.data as Record<string, unknown>)[durable.aggregate];
            if (typeof aggregateID !== 'string') {
              yield* Effect.die(
                new SchemaEvent.InvalidDurableEventError({
                  type: event.type,
                  message: `Expected string aggregate field ${durable.aggregate}`
                })
              );
            } else {
              if (input && input.aggregateID !== aggregateID) {
                yield* Effect.die(
                  new SchemaEvent.InvalidDurableEventError({
                    type: event.type,
                    message: `Aggregate mismatch: expected ${input.aggregateID}, got ${aggregateID}`
                  })
                );
              }
              const list = projectors.get(event.type) ?? [];
              return yield* Effect.uninterruptible(
                Effect.gen(function* () {
                  const committed = yield* db
                    .transaction(
                      () =>
                        Effect.gen(function* () {
                          const row = yield* db
                            .select({
                              seq: EventSequenceTable.seq,
                              ownerID: EventSequenceTable.owner_id
                            })
                            .from(EventSequenceTable)
                            .where(eq(EventSequenceTable.aggregate_id, aggregateID))
                            .get()
                            .pipe(Effect.orDie);
                          const latest = row?.seq ?? -1;
                          const encoded = Schema.encodeUnknownSync(definition.data)(
                            event.data
                          ) as Record<string, unknown>;
                          if (input?.strictOwner && row?.ownerID && row.ownerID !== input.ownerID) {
                            yield* Effect.die(
                              new SchemaEvent.InvalidDurableEventError({
                                type: event.type,
                                message: `Replay owner mismatch for aggregate ${aggregateID}: expected ${row.ownerID}, got ${input.ownerID ?? 'none'}`
                              })
                            );
                          }
                          if (input && input.seq <= latest) {
                            const stored = yield* db
                              .select()
                              .from(EventTable)
                              .where(
                                and(
                                  eq(EventTable.aggregate_id, aggregateID),
                                  eq(EventTable.seq, input.seq)
                                )
                              )
                              .get()
                              .pipe(Effect.orDie);
                            if (
                              stored?.id === event.id &&
                              stored.type === versionedType(definition.type, durable.version) &&
                              isDeepStrictEqual(stored.data, encoded)
                            ) {
                              if (input.ownerID && row?.ownerID == null) {
                                yield* db
                                  .update(EventSequenceTable)
                                  .set({ owner_id: input.ownerID })
                                  .where(eq(EventSequenceTable.aggregate_id, aggregateID))
                                  .run()
                                  .pipe(Effect.orDie);
                              }
                              return;
                            }
                            yield* Effect.die(
                              new SchemaEvent.InvalidDurableEventError({
                                type: event.type,
                                message: `Replay diverged at aggregate ${aggregateID} sequence ${input.seq}`
                              })
                            );
                          }
                          if (input && row?.ownerID && row.ownerID !== input.ownerID) {
                            return;
                          }
                          const seq = input?.seq ?? latest + 1;
                          if (input && seq !== latest + 1) {
                            yield* Effect.die(
                              new SchemaEvent.InvalidDurableEventError({
                                type: event.type,
                                message: `Sequence mismatch for aggregate ${aggregateID}: expected ${latest + 1}, got ${seq}`
                              })
                            );
                          }
                          const stored = yield* db
                            .select({ aggregateID: EventTable.aggregate_id, seq: EventTable.seq })
                            .from(EventTable)
                            .where(eq(EventTable.id, event.id))
                            .get()
                            .pipe(Effect.orDie);
                          if (stored) {
                            yield* Effect.die(
                              new SchemaEvent.InvalidDurableEventError({
                                type: event.type,
                                message: `Event ${event.id} already exists at aggregate ${stored.aggregateID} sequence ${stored.seq}`
                              })
                            );
                          }
                          const committed = {
                            ...event,
                            durable: { aggregateID, seq, version: durable.version }
                          } as SchemaEvent.Payload;
                          for (const projector of list) {
                            yield* projector(committed);
                          }
                          if (commit) {
                            yield* commit(seq);
                          }
                          yield* db
                            .insert(EventSequenceTable)
                            .values([{ aggregate_id: aggregateID, seq, owner_id: input?.ownerID }])
                            .onConflictDoUpdate({
                              target: EventSequenceTable.aggregate_id,
                              set: {
                                seq,
                                ...(input?.ownerID && row?.ownerID == null
                                  ? { owner_id: input.ownerID }
                                  : {})
                              }
                            })
                            .run()
                            .pipe(Effect.orDie);
                          yield* db
                            .insert(EventTable)
                            .values([
                              {
                                id: event.id,
                                aggregate_id: aggregateID,
                                seq,
                                type: versionedType(definition.type, durable.version),
                                data: encoded
                              }
                            ])
                            .run()
                            .pipe(Effect.orDie);
                          return { aggregateID, seq };
                        }),
                      { behavior: 'immediate' }
                    )
                    .pipe(Effect.orDie);
                  if (committed) {
                    yield* Effect.forEach(
                      pubsub.durable.get(committed.aggregateID) ?? [],
                      wake => PubSub.publish(wake, void 0),
                      { discard: true }
                    );
                  }
                  return committed;
                })
              );
            }
          }
        });
      };

      const publishEvent = <D extends SchemaEvent.Definition>(
        definition: D,
        event: SchemaEvent.Payload<D>,
        commit?: PublishOptions['commit']
      ) => {
        return Effect.gen(function* () {
          if (!definition?.durable && commit) {
            return yield* Effect.die(
              new SchemaEvent.InvalidDurableEventError({
                type: event.type,
                message: 'Local commit hooks require a durable event'
              })
            );
          }
          if (definition?.durable) {
            const committed = yield* commitDurableEvent(definition, event, void 0, commit);
            if (committed) {
              event = {
                ...event,
                durable: {
                  aggregateID: committed.aggregateID,
                  seq: committed.seq,
                  version: definition.durable.version
                }
              };
              yield* notify(event);
              return event;
            }
          }
          yield* notify(event);
          return event;
        });
      };

      const publish = <D extends SchemaEvent.Definition>(
        definition: D,
        data: SchemaEvent.Data<D>,
        options?: PublishOptions
      ) => {
        return Effect.gen(function* () {
          const serviceLocation = yield* LocationRef;
          const location = options?.location ?? serviceLocation ?? void 0;
          return yield* publishEvent(
            definition,
            {
              id: options?.id ?? SchemaEvent.ID.create(),
              ...(options?.metadata ? { metadata: options.metadata } : {}),
              type: definition.type,
              ...(location ? { location } : {}),
              data
            },
            options?.commit
          );
        });
      };

      const subscribe = <D extends SchemaEvent.Definition>(
        definition: D
      ): Stream.Stream<SchemaEvent.Payload<D>> =>
        Stream.unwrap(
          getOrCreate(definition).pipe(Effect.map(pubsub => Stream.fromPubSub(pubsub)))
        ).pipe(Stream.map(event => event as SchemaEvent.Payload<D>));

      const streamAll = (): Stream.Stream<SchemaEvent.Payload> => Stream.fromPubSub(pubsub.all);

      const durable = (input: {
        readonly aggregateID: string;
        readonly after?: number;
      }): Stream.Stream<SchemaEvent.Payload> =>
        Stream.unwrap(
          Effect.gen(function* () {
            const wakes = yield* subscribeDurable(input.aggregateID);
            let sequence = input.after ?? -1;
            const read = Effect.suspend(() => readAfter(input.aggregateID, sequence)).pipe(
              Effect.tap(events =>
                Effect.sync(() => {
                  sequence = events.at(-1)?.durable?.seq ?? sequence;
                })
              )
            );
            const historical = yield* read;
            const live = Stream.fromSubscription(wakes).pipe(
              Stream.mapEffect(() => read),
              Stream.flattenIterable
            );
            return Stream.concat(Stream.fromIterable(historical), live);
          })
        );

      const project = <D extends SchemaEvent.Definition>(
        definition: D,
        projector: Subscriber<D>
      ): Effect.Effect<void> =>
        Effect.sync(() => {
          const list = projectors.get(definition.type) ?? [];
          list.push(event => projector(event as SchemaEvent.Payload<D>));
          projectors.set(definition.type, list);
        });

      const replay = (
        event: SerializedEvent,
        options?: {
          readonly publish?: boolean;
          readonly ownerID?: string;
          readonly strictOwner?: boolean;
        }
      ) => {
        return Effect.gen(function* () {
          const definition = Durable.get(event.type);
          if (!definition?.durable) {
            yield* Effect.die(
              new SchemaEvent.InvalidDurableEventError({
                type: event.type,
                message: `Unknown durable event type ${event.type}`
              })
            );
          } else {
            const payload = {
              id: event.id,
              type: definition.type,
              data: Schema.decodeUnknownSync(definition.data)(event.data)
            } as SchemaEvent.Payload;
            const committed = yield* commitDurableEvent(definition, payload, {
              seq: event.seq,
              aggregateID: event.aggregateID,
              ownerID: options?.ownerID,
              strictOwner: options?.strictOwner
            });
            if (committed && options?.publish) {
              yield* notify({
                ...payload,
                durable: {
                  aggregateID: committed.aggregateID,
                  seq: committed.seq,
                  version: definition.durable.version
                }
              });
            }
          }
        });
      };

      const replayAll = (
        events: SerializedEvent[],
        options?: {
          readonly publish?: boolean;
          readonly ownerID?: string;
          readonly strictOwner?: boolean;
        }
      ) => {
        return Effect.gen(function* () {
          const source = events[0]?.aggregateID;
          if (!source) {
            return void 0;
          }
          if (events.some(event => event.aggregateID !== source)) {
            yield* Effect.die(
              new SchemaEvent.InvalidDurableEventError({
                type: events[0]?.type ?? 'unknown',
                message: 'Replay events must belong to the same aggregate'
              })
            );
          }
          const start = events[0]?.seq ?? 0;
          for (const [index, event] of events.entries()) {
            const seq = start + index;
            if (event.seq !== seq) {
              yield* Effect.die(
                new SchemaEvent.InvalidDurableEventError({
                  type: event.type,
                  message: `Replay sequence mismatch at index ${index}: expected ${seq}, got ${event.seq}`
                })
              );
            }
          }
          for (const event of events) {
            yield* replay(event, options);
          }
          return source;
        });
      };

      const remove = (aggregateID: string) => {
        return db
          .transaction(() =>
            Effect.gen(function* () {
              yield* db
                .delete(EventSequenceTable)
                .where(eq(EventSequenceTable.aggregate_id, aggregateID))
                .run();
              yield* db.delete(EventTable).where(eq(EventTable.aggregate_id, aggregateID)).run();
            })
          )
          .pipe(Effect.orDie);
      };

      const claim = (aggregateID: string, ownerID: string) => {
        return db
          .update(EventSequenceTable)
          .set({ owner_id: ownerID })
          .where(eq(EventSequenceTable.aggregate_id, aggregateID))
          .run()
          .pipe(Effect.orDie);
      };

      return Service.of({
        publish,
        subscribe,
        all: streamAll,
        durable,
        project,
        replay,
        replayAll,
        remove,
        claim
      });
    })
  );

export const layer = layerWith();
export const defaultLayer = layer.pipe(Layer.provide(Database.defaultLayer));
