import { SchemaQuestion, SchemaSession } from '@/schema';
import { Context, Deferred, Effect, Layer } from 'effect';
import { Bus } from '@/bus';
import { ModuleState } from '@/instance';
import { Log } from '@/utils';

const log = Log.create({ service: 'question' });

interface PendingEntry {
  info: SchemaQuestion.Request;
  deferred: Deferred.Deferred<ReadonlyArray<SchemaQuestion.Answer>, SchemaQuestion.RejectedError>;
}

interface State {
  pending: Map<SchemaQuestion.QuestionID, PendingEntry>;
}

export interface Interface {
  readonly ask: (input: {
    sessionID: SchemaSession.SessionID;
    questions: ReadonlyArray<SchemaQuestion.Info>;
    tool?: SchemaQuestion.Tool;
  }) => Effect.Effect<ReadonlyArray<SchemaQuestion.Answer>, SchemaQuestion.RejectedError>;
  readonly reply: (input: {
    requestID: SchemaQuestion.QuestionID;
    answers: ReadonlyArray<SchemaQuestion.Answer>;
  }) => Effect.Effect<void>;
  readonly reject: (requestID: SchemaQuestion.QuestionID) => Effect.Effect<void>;
  readonly list: () => Effect.Effect<ReadonlyArray<SchemaQuestion.Request>>;
}

export class Service extends Context.Service<Service, Interface>()('@openchat/Question') {}

export const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const bus = yield* Bus.Service;
    const state = yield* ModuleState.make<State>(
      Effect.fn('Question.state')(function* () {
        const state = {
          pending: new Map<SchemaQuestion.QuestionID, PendingEntry>()
        };

        yield* Effect.addFinalizer(() =>
          Effect.gen(function* () {
            for (const item of state.pending.values()) {
              yield* Deferred.fail(item.deferred, new SchemaQuestion.RejectedError());
            }
            state.pending.clear();
          })
        );

        return state;
      })
    );

    const ask = Effect.fn('Question.ask')(function* (input: {
      sessionID: SchemaSession.SessionID;
      questions: ReadonlyArray<SchemaQuestion.Info>;
      tool?: SchemaQuestion.Tool;
    }) {
      const pending = (yield* ModuleState.get(state)).pending;
      const id = SchemaQuestion.QuestionID.ascending();
      log.info('asking', { id, questions: input.questions.length });

      const deferred = yield* Deferred.make<
        ReadonlyArray<SchemaQuestion.Answer>,
        SchemaQuestion.RejectedError
      >();
      const info = SchemaQuestion.decodeRequest({
        id,
        sessionID: input.sessionID,
        questions: input.questions,
        tool: input.tool
      });
      pending.set(id, { info, deferred });
      void bus;
      // TODO
      // yield* bus.publish(Event.Asked, info)

      return yield* Effect.ensuring(
        Deferred.await(deferred),
        Effect.sync(() => {
          pending.delete(id);
        })
      );
    });

    const reply = Effect.fn('Question.reply')(function* (input: {
      requestID: SchemaQuestion.QuestionID;
      answers: ReadonlyArray<SchemaQuestion.Answer>;
    }) {
      const pending = (yield* ModuleState.get(state)).pending;
      const existing = pending.get(input.requestID);
      if (!existing) {
        log.warn('reply for unknown request', { requestID: input.requestID });
        return;
      }
      pending.delete(input.requestID);
      log.info('replied', { requestID: input.requestID, answers: input.answers });
      // TODO
      // yield* bus.publish(Event.Replied, {
      //   sessionID: existing.info.sessionID,
      //   requestID: existing.info.id,
      //   answers: input.answers.map((a) => [...a]),
      // })
      yield* Deferred.succeed(existing.deferred, input.answers);
    });

    const reject = Effect.fn('Question.reject')(function* (requestID: SchemaQuestion.QuestionID) {
      const pending = (yield* ModuleState.get(state)).pending;
      const existing = pending.get(requestID);
      if (!existing) {
        log.warn('reject for unknown request', { requestID });
        return;
      }
      pending.delete(requestID);
      log.info('rejected', { requestID });
      // TODO
      // yield* bus.publish(Event.Rejected, {
      //   sessionID: existing.info.sessionID,
      //   requestID: existing.info.id,
      // })
      yield* Deferred.fail(existing.deferred, new SchemaQuestion.RejectedError());
    });

    const list = Effect.fn('Question.list')(function* () {
      const pending = (yield* ModuleState.get(state)).pending;
      return Array.from(pending.values(), x => x.info);
    });

    return Service.of({
      ask,
      list,
      reply,
      reject
    });
  })
);
