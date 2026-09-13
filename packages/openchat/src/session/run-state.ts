import { Context, Effect, Latch, Layer, Scope } from 'effect';
import { SchemaMessage, SchemaSession } from '@/schema';
import * as SessionStatus from './status';
import { BackgroundJob } from '@/background';
import { Runner, ServiceState } from '@/instance';

const busyError = (sessionID: SchemaSession.SessionID) => {
  return new SchemaSession.BusyError({ sessionID });
};

const cancelBackgroundJobs = Effect.fn('SessionRunState.cancelBackgroundJobs')(function* (
  background: BackgroundJob.Interface,
  sessionID: SchemaSession.SessionID
) {
  const jobs = yield* background.list();
  const pending = new Set<string>([sessionID]);
  const cancelled = new Set<string>();
  const matches = (job: BackgroundJob.Info) => {
    if (job.status !== 'running') {
      return false;
    }
    if (cancelled.has(job.id)) {
      return false;
    }
    if (pending.has(job.id)) {
      return true;
    }
    if (typeof job.metadata?.sessionId === 'string' && pending.has(job.metadata.sessionId)) {
      return true;
    }
    return (
      typeof job.metadata?.parentSessionId === 'string' && pending.has(job.metadata.parentSessionId)
    );
  };
  let batch = jobs.filter(matches);
  while (batch.length > 0) {
    yield* Effect.forEach(
      batch,
      job =>
        background.cancel(job.id).pipe(
          Effect.tap(() =>
            Effect.sync(() => {
              cancelled.add(job.id);
              pending.add(job.id);
              if (typeof job.metadata?.sessionId === 'string') {
                pending.add(job.metadata.sessionId);
              }
            })
          )
        ),
      { concurrency: 'unbounded', discard: true }
    );
    batch = jobs.filter(matches);
  }
});

export interface Interface {
  readonly assertNotBusy: (
    sessionID: SchemaSession.SessionID
  ) => Effect.Effect<void, SchemaSession.BusyError>;
  readonly cancel: (sessionID: SchemaSession.SessionID) => Effect.Effect<void>;
  readonly ensureRunning: (
    sessionID: SchemaSession.SessionID,
    onInterrupt: Effect.Effect<SchemaMessage.WithParts>,
    work: Effect.Effect<SchemaMessage.WithParts>
  ) => Effect.Effect<SchemaMessage.WithParts>;
  readonly startShell: (
    sessionID: SchemaSession.SessionID,
    onInterrupt: Effect.Effect<SchemaMessage.WithParts>,
    work: Effect.Effect<SchemaMessage.WithParts>,
    ready?: Latch.Latch
  ) => Effect.Effect<SchemaMessage.WithParts, SchemaSession.BusyError>;
}

export class Service extends Context.Service<Service, Interface>()('@openchat/SessionRunState') {}

export const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const background = yield* BackgroundJob.Service;
    const status = yield* SessionStatus.Service;

    const state = yield* ServiceState.make(
      Effect.fn('SessionRunState.state')(function* () {
        const scope = yield* Scope.Scope;
        const runners = new Map<SchemaSession.SessionID, Runner.Runner<SchemaMessage.WithParts>>();
        yield* Effect.addFinalizer(
          Effect.fnUntraced(function* () {
            yield* Effect.forEach(runners.values(), runner => runner.cancel, {
              concurrency: 'unbounded',
              discard: true
            });
            runners.clear();
          })
        );
        return { runners, scope };
      })
    );

    const runner = Effect.fn('SessionRunState.runner')(function* (
      sessionID: SchemaSession.SessionID,
      onInterrupt: Effect.Effect<SchemaMessage.WithParts>
    ) {
      const data = yield* ServiceState.get(state);
      const existing = data.runners.get(sessionID);
      if (existing) {
        return existing;
      }
      const next = Runner.make<SchemaMessage.WithParts>(data.scope, {
        onIdle: Effect.gen(function* () {
          data.runners.delete(sessionID);
          yield* status.set(sessionID, { type: 'idle' });
        }),
        onBusy: status.set(sessionID, { type: 'busy' }),
        onInterrupt
      });
      data.runners.set(sessionID, next);
      return next;
    });

    const assertNotBusy = Effect.fn('SessionRunState.assertNotBusy')(function* (
      sessionID: SchemaSession.SessionID
    ) {
      const data = yield* ServiceState.get(state);
      const existing = data.runners.get(sessionID);
      if (existing?.busy) {
        yield* busyError(sessionID);
      }
    });

    const cancel = Effect.fn('SessionRunState.cancel')(function* (
      sessionID: SchemaSession.SessionID
    ) {
      yield* cancelBackgroundJobs(background, sessionID);
      const data = yield* ServiceState.get(state);
      const existing = data.runners.get(sessionID);
      if (!existing || !existing.busy) {
        yield* status.set(sessionID, { type: 'idle' });
        return;
      }
      yield* existing.cancel;
    });

    const ensureRunning = Effect.fn('SessionRunState.ensureRunning')(function* (
      sessionID: SchemaSession.SessionID,
      onInterrupt: Effect.Effect<SchemaMessage.WithParts>,
      work: Effect.Effect<SchemaMessage.WithParts>
    ) {
      return yield* (yield* runner(sessionID, onInterrupt)).ensureRunning(work);
    });

    const startShell = Effect.fn('SessionRunState.startShell')(function* (
      sessionID: SchemaSession.SessionID,
      onInterrupt: Effect.Effect<SchemaMessage.WithParts>,
      work: Effect.Effect<SchemaMessage.WithParts>,
      ready?: Latch.Latch
    ) {
      return yield* (yield* runner(sessionID, onInterrupt))
        .startShell(work, ready)
        .pipe(Effect.catchTag('RunnerBusy', () => Effect.fail(busyError(sessionID))));
    });

    return Service.of({ assertNotBusy, cancel, ensureRunning, startShell });
  })
);

export const defaultLayer = layer.pipe(
  Layer.provide(BackgroundJob.layer),
  Layer.provide(SessionStatus.defaultLayer)
);
