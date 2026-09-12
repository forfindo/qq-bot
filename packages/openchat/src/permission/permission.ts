import { SchemaPermission } from '@/schema';
import { evaluate as evalRule } from './evaluate';
import os from 'os';
import { Context, Deferred, Effect, Layer } from 'effect';
import { Event } from '@/event';
import { ServiceState } from '@/instance';
import { Wildcard } from '@/utils';

const EDIT_TOOLS = ['edit', 'write', 'apply_patch'];

const expand = (pattern: string): string => {
  if (pattern.startsWith('~/')) {
    return os.homedir() + pattern.slice(1);
  }
  if (pattern === '~') {
    return os.homedir();
  }
  if (pattern.startsWith('$HOME/')) {
    return os.homedir() + pattern.slice(5);
  }
  if (pattern.startsWith('$HOME')) {
    return os.homedir() + pattern.slice(5);
  }
  return pattern;
};

export function evaluate(
  permission: string,
  pattern: string,
  ...rulesets: SchemaPermission.Ruleset[]
): SchemaPermission.Rule {
  return evalRule(permission, pattern, ...rulesets);
}

export function fromConfig(permission: SchemaPermission.Info) {
  const ruleset: SchemaPermission.Ruleset = [];
  for (const [key, value] of Object.entries(permission)) {
    if (typeof value === 'string') {
      ruleset.push({ permission: key, action: value, pattern: '*' });
      continue;
    }
    ruleset.push(
      ...Object.entries(value).map(([pattern, action]) => ({
        permission: key,
        pattern: expand(pattern),
        action
      }))
    );
  }
  return ruleset;
}

export function merge(...rulesets: SchemaPermission.Ruleset[]): SchemaPermission.Ruleset {
  return rulesets.flat();
}

export function disabled(tools: string[], ruleset: SchemaPermission.Ruleset): Set<string> {
  const result = new Set<string>();
  for (const tool of tools) {
    const permission = EDIT_TOOLS.includes(tool) ? 'edit' : tool;
    const rule = ruleset.findLast(rule => Wildcard.match(permission, rule.permission));
    if (!rule) {
      continue;
    }
    if (rule.pattern === '*' && rule.action === 'deny') {
      result.add(tool);
    }
  }
  return result;
}

export interface Interface {
  readonly ask: (input: SchemaPermission.AskInput) => Effect.Effect<void, SchemaPermission.Error>;
  readonly reply: (
    input: SchemaPermission.ReplyInput
  ) => Effect.Effect<void, SchemaPermission.NotFoundError>;
  readonly list: () => Effect.Effect<ReadonlyArray<SchemaPermission.Request>>;
}

interface PendingEntry {
  info: SchemaPermission.Request;
  deferred: Deferred.Deferred<
    void,
    SchemaPermission.RejectedError | SchemaPermission.CorrectedError
  >;
}

interface State {
  pending: Map<SchemaPermission.PermissionID, PendingEntry>;
  approved: SchemaPermission.Ruleset;
}

export class Service extends Context.Service<Service, Interface>()('@openchat/Permission') {}

export const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const events = yield* Event.Service;

    const state = yield* ServiceState.make<State>(
      Effect.fn('Permission.state')(function* () {
        const state = {
          pending: new Map<SchemaPermission.PermissionID, PendingEntry>(),
          approved: []
        };

        yield* Effect.addFinalizer(() =>
          Effect.gen(function* () {
            for (const item of state.pending.values()) {
              yield* Deferred.fail(item.deferred, new SchemaPermission.RejectedError());
            }
            state.pending.clear();
          })
        );

        return state;
      })
    );

    const ask = Effect.fn('Permission.ask')(function* (input: SchemaPermission.AskInput) {
      const { approved, pending } = yield* ServiceState.get(state);
      const { ruleset, ...request } = input;
      let needsAsk = false;

      for (const pattern of request.patterns) {
        const rule = evaluate(request.permission, pattern, ruleset, approved);
        yield* Effect.logInfo('evaluated', {
          permission: request.permission,
          pattern,
          action: rule
        });
        if (rule.action === 'deny') {
          return yield* new SchemaPermission.DeniedError({
            ruleset: ruleset.filter(rule => Wildcard.match(request.permission, rule.permission))
          });
        }
        if (rule.action === 'allow') {
          continue;
        }
        needsAsk = true;
      }

      if (!needsAsk) {
        return;
      }

      const id = request.id ?? SchemaPermission.PermissionID.ascending();
      const info: SchemaPermission.Request = {
        id,
        sessionID: request.sessionID,
        permission: request.permission,
        patterns: request.patterns,
        metadata: request.metadata,
        always: request.always,
        tool: request.tool
      };
      yield* Effect.logInfo('asking', { id, permission: info.permission, patterns: info.patterns });

      const deferred = yield* Deferred.make<
        void,
        SchemaPermission.RejectedError | SchemaPermission.CorrectedError
      >();
      pending.set(id, { info, deferred });
      yield* events.publish(SchemaPermission.Events.Asked, info);
      return yield* Effect.ensuring(
        Deferred.await(deferred),
        Effect.sync(() => {
          pending.delete(id);
        })
      );
    });

    const reply = Effect.fn('Permission.reply')(function* (input: SchemaPermission.ReplyInput) {
      const { approved, pending } = yield* ServiceState.get(state);
      const existing = pending.get(input.requestID);
      if (!existing) {
        return yield* new SchemaPermission.NotFoundError({ requestID: input.requestID });
      }

      pending.delete(input.requestID);
      yield* events.publish(SchemaPermission.Events.Replied, {
        sessionID: existing.info.sessionID,
        requestID: existing.info.id,
        reply: input.reply
      });

      if (input.reply === 'reject') {
        yield* Deferred.fail(
          existing.deferred,
          input.message
            ? new SchemaPermission.CorrectedError({ feedback: input.message })
            : new SchemaPermission.RejectedError()
        );

        for (const [id, item] of pending.entries()) {
          if (item.info.sessionID !== existing.info.sessionID) {
            continue;
          }
          pending.delete(id);
          yield* events.publish(SchemaPermission.Events.Replied, {
            sessionID: item.info.sessionID,
            requestID: item.info.id,
            reply: 'reject'
          });
          yield* Deferred.fail(item.deferred, new SchemaPermission.RejectedError());
        }
        return;
      }

      yield* Deferred.succeed(existing.deferred, void 0);
      if (input.reply === 'once') {
        return;
      }

      for (const pattern of existing.info.always) {
        approved.push({
          permission: existing.info.permission,
          pattern,
          action: 'allow'
        });
      }

      for (const [id, item] of pending.entries()) {
        if (item.info.sessionID !== existing.info.sessionID) {
          continue;
        }
        const ok = item.info.patterns.every(
          pattern => evaluate(item.info.permission, pattern, approved).action === 'allow'
        );
        if (!ok) {
          continue;
        }
        pending.delete(id);
        yield* events.publish(SchemaPermission.Events.Replied, {
          sessionID: item.info.sessionID,
          requestID: item.info.id,
          reply: 'always'
        });
        yield* Deferred.succeed(item.deferred, void 0);
      }
    });

    const list = Effect.fn('Permission.list')(function* () {
      const pending = (yield* ServiceState.get(state)).pending;
      return Array.from(pending.values(), item => item.info);
    });

    return Service.of({
      ask,
      list,
      reply
    });
  })
);

export const defaultLayer = layer.pipe(Layer.provide(Event.defaultLayer));
