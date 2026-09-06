import { SchemaSession } from '@/schema';
import { Context, Effect, Layer } from 'effect';
import { Event } from '@/event';
import { Database } from '@/database';
import { asc, eq } from 'drizzle-orm';
import { TodoTable } from '@/database/sql/session.sql';

export interface Interface {
  readonly update: (input: {
    sessionID: SchemaSession.SessionID;
    todos: ReadonlyArray<SchemaSession.TodoInfo>;
  }) => Effect.Effect<void>;
  readonly get: (sessionID: SchemaSession.SessionID) => Effect.Effect<SchemaSession.TodoInfo[]>;
}

export class Service extends Context.Service<Service, Interface>()('@openchat/SessionTodo') {}

export const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const bus = yield* Event.Service;
    const { db } = yield* Database.Service;

    const update = Effect.fn('Todo.update')(function* (input: {
      sessionID: SchemaSession.SessionID;
      todos: ReadonlyArray<SchemaSession.TodoInfo>;
    }) {
      yield* db
        .transaction(tx =>
          Effect.gen(function* () {
            yield* tx.delete(TodoTable).where(eq(TodoTable.session_id, input.sessionID)).run();
            if (input.todos.length === 0) {
              return;
            }
            yield* tx
              .insert(TodoTable)
              .values(
                input.todos.map((todo, position) => ({
                  session_id: input.sessionID,
                  content: todo.content,
                  status: todo.status,
                  priority: todo.priority,
                  position
                }))
              )
              .run();
          })
        )
        .pipe(Effect.orDie);
      // TODO
      // yield* bus.publish(SchemaSession.TodoUpdated, input);
      void bus;
    });

    const get = Effect.fn('Todo.get')(function* (sessionID: SchemaSession.SessionID) {
      const rows = yield* db
        .select()
        .from(TodoTable)
        .where(eq(TodoTable.session_id, sessionID))
        .orderBy(asc(TodoTable.position))
        .all()
        .pipe(Effect.orDie);
      return rows.map(row => ({
        content: row.content,
        status: row.status,
        priority: row.priority
      }));
    });

    return Service.of({ update, get });
  })
);

export const defaultLayer = layer.pipe(
  Layer.provide(Event.defaultLayer),
  Layer.provide(Database.defaultLayer)
);
