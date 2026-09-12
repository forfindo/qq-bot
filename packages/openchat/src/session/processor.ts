import { Cause, Context, DateTime, Deferred, Effect, Exit, Layer, Stream } from 'effect';
import {
  SchemaImage,
  SchemaMessage,
  SchemaPermission,
  SchemaProvider,
  SchemaQuestion,
  SchemaSession
} from '@/schema';
import * as LLM from '@/session/llm';
import * as Session from '@/session/session';
import * as SessionStatus from '@/session/status';
import { Config } from '@/config';
import { Permission } from '@/permission';
import { Image } from '@/image';
import { Event } from '@/event';
import { AppError, Log, TypeGuard } from '@/utils';
import type { StreamEvent } from '@/session/llm';
import { Flag } from '@/flag';
import { Agent } from '@/agent';
import { isOverflow } from '@/session/overflow';
import * as SessionRetry from './retry';
import * as Message from '@/session/message';
import { Database } from '@/database';

const log = Log.create({ service: 'session.processor' });
const DOOM_LOOP_THRESHOLD = 3;

export type Result = 'compact' | 'stop' | 'continue';

export interface Handle {
  readonly message: SchemaMessage.Assistant;
  readonly updateToolCall: (
    toolCallID: string,
    update: (part: SchemaMessage.ToolPart) => SchemaMessage.ToolPart
  ) => Effect.Effect<SchemaMessage.ToolPart | undefined>;
  readonly completeToolCall: (
    toolCallID: string,
    output: {
      title: string;
      metadata: Record<string, unknown>;
      output: string;
      attachments?: SchemaMessage.FilePart[];
    }
  ) => Effect.Effect<void>;
  readonly process: (streamInput: LLM.StreamInput) => Effect.Effect<Result>;
}

type Input = {
  assistantMessage: SchemaMessage.Assistant;
  sessionID: SchemaSession.SessionID;
  model: SchemaProvider.Model;
};

type ToolCall = {
  partID: SchemaMessage.ToolPart['id'];
  messageID: SchemaMessage.ToolPart['messageID'];
  sessionID: SchemaMessage.ToolPart['sessionID'];
  done: Deferred.Deferred<void>;
};

interface ProcessorContext extends Input {
  toolcalls: Record<string, ToolCall>;
  shouldBreak: boolean;
  blocked: boolean;
  needsCompaction: boolean;
  currentText: SchemaMessage.TextPart | undefined;
  reasoningMap: Record<string, SchemaMessage.ReasoningPart>;
}

export interface Interface {
  readonly create: (input: Input) => Effect.Effect<Handle>;
}

export class Service extends Context.Service<Service, Interface>()('@openchat/SessionProcessor') {}

export const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const session = yield* Session.Service;
    const config = yield* Config.Service;
    const llm = yield* LLM.Service;
    const permission = yield* Permission.Service;
    const image = yield* Image.Service;
    const event = yield* Event.Service;
    const agents = yield* Agent.Service;
    const status = yield* SessionStatus.Service;

    const create = (input: Input) => {
      // Pre-capture snapshot before the LLM stream starts. The AI SDK
      // may execute tools internally before emitting start-step events,
      // so capturing inside the event handler can be too late.
      const ctx: ProcessorContext = {
        assistantMessage: input.assistantMessage,
        sessionID: input.sessionID,
        model: input.model,
        toolcalls: {},
        shouldBreak: false,
        blocked: false,
        needsCompaction: false,
        currentText: void 0,
        reasoningMap: {}
      };
      let aborted = false;

      const parse = (e: unknown) =>
        SchemaMessage.fromError(e, {
          providerID: input.model.providerID,
          aborted
        });

      const settleToolCall = Effect.fn('SessionProcessor.settleToolCall')(function* (
        toolCallID: string
      ) {
        const done = ctx.toolcalls[toolCallID]?.done;
        delete ctx.toolcalls[toolCallID];
        if (done) {
          yield* Deferred.succeed(done, void 0).pipe(Effect.ignore);
        }
      });

      const readToolCall = Effect.fn('SessionProcessor.readToolCall')(function* (
        toolCallID: string
      ) {
        const call = ctx.toolcalls[toolCallID];
        if (!call) {
          return;
        }
        const part = yield* session.getPart({
          partID: call.partID,
          messageID: call.messageID,
          sessionID: call.sessionID
        });
        if (!part || part.type !== 'tool') {
          delete ctx.toolcalls[toolCallID];
          return;
        }
        return { call, part };
      });

      const updateToolCall = Effect.fn('SessionProcessor.updateToolCall')(function* (
        toolCallID: string,
        update: (part: SchemaMessage.ToolPart) => SchemaMessage.ToolPart
      ) {
        const match = yield* readToolCall(toolCallID);
        if (!match) {
          return;
        }
        const part = yield* session.updatePart(update(match.part));
        ctx.toolcalls[toolCallID] = {
          ...match.call,
          partID: part.id,
          messageID: part.messageID,
          sessionID: part.sessionID
        };
        return part;
      });

      const completeToolCall = Effect.fn('SessionProcessor.completeToolCall')(function* (
        toolCallID: string,
        output: {
          title: string;
          metadata: Record<string, unknown>;
          output: string;
          attachments?: SchemaMessage.FilePart[];
        }
      ) {
        const match = yield* readToolCall(toolCallID);
        if (!match || match.part.state.status !== 'running') {
          return;
        }
        yield* session.updatePart({
          ...match.part,
          state: {
            status: 'completed',
            input: match.part.state.input,
            output: output.output,
            metadata: output.metadata,
            title: output.title,
            time: { start: match.part.state.time.start, end: Date.now() },
            attachments: output.attachments
          }
        });
        yield* settleToolCall(toolCallID);
      });

      const failToolCall = Effect.fn('SessionProcessor.failToolCall')(function* (
        toolCallID: string,
        error: unknown
      ) {
        const match = yield* readToolCall(toolCallID);
        if (!match || match.part.state.status !== 'running') {
          return false;
        }
        yield* session.updatePart({
          ...match.part,
          state: {
            status: 'error',
            input: match.part.state.input,
            error: AppError.errorMessage(error),
            time: { start: match.part.state.time.start, end: Date.now() }
          }
        });
        if (
          error instanceof SchemaPermission.RejectedError ||
          error instanceof SchemaQuestion.RejectedError
        ) {
          ctx.blocked = ctx.shouldBreak;
        }
        yield* settleToolCall(toolCallID);
        return true;
      });

      const handleEvent = Effect.fnUntraced(function* (value: StreamEvent) {
        switch (value.type) {
          case 'start':
            yield* status.set(ctx.sessionID, { type: 'busy' });
            return;

          case 'reasoning-start':
            if (value.id in ctx.reasoningMap) {
              return;
            }
            // TODO(v2): Temporary dual-write while migrating session messages to v2 events.
            if (Flag.EXPERIMENTAL_EVENT_SYSTEM) {
              yield* event.publish(SchemaSession.DurableEvent.Reasoning.Started, {
                assistantMessageID: ctx.assistantMessage.id,
                sessionID: ctx.sessionID,
                reasoningID: value.id,
                timestamp: DateTime.makeUnsafe(Date.now())
              });
            }
            ctx.reasoningMap[value.id] = {
              id: SchemaMessage.PartID.ascending(),
              messageID: ctx.assistantMessage.id,
              sessionID: ctx.assistantMessage.sessionID,
              type: 'reasoning',
              text: '',
              time: { start: Date.now() },
              metadata: value.providerMetadata
            };
            yield* session.updatePart(ctx.reasoningMap[value.id]!);
            return;

          case 'reasoning-delta':
            if (!(value.id in ctx.reasoningMap)) {
              return;
            }
            ctx.reasoningMap[value.id]!.text += value.text;
            if (value.providerMetadata) {
              ctx.reasoningMap[value.id]!.metadata = value.providerMetadata;
            }
            yield* session.updatePartDelta({
              sessionID: ctx.reasoningMap[value.id]!.sessionID,
              messageID: ctx.reasoningMap[value.id]!.messageID,
              partID: ctx.reasoningMap[value.id]!.id,
              field: 'text',
              delta: value.text
            });
            return;

          case 'reasoning-end':
            if (!(value.id in ctx.reasoningMap)) {
              return;
            }
            // TODO(v2): Temporary dual-write while migrating session messages to v2 events.
            if (Flag.EXPERIMENTAL_EVENT_SYSTEM) {
              yield* event.publish(SchemaSession.DurableEvent.Reasoning.Ended, {
                assistantMessageID: ctx.assistantMessage.id,
                sessionID: ctx.sessionID,
                reasoningID: value.id,
                text: ctx.reasoningMap[value.id]!.text,
                timestamp: DateTime.makeUnsafe(Date.now())
              });
            }
            ctx.reasoningMap[value.id]!.time = {
              ...ctx.reasoningMap[value.id]!.time,
              end: Date.now()
            };
            if (value.providerMetadata) {
              ctx.reasoningMap[value.id]!.metadata = value.providerMetadata;
            }
            yield* session.updatePart(ctx.reasoningMap[value.id]!);
            delete ctx.reasoningMap[value.id];
            return;

          case 'tool-input-start': {
            if (ctx.assistantMessage.summary) {
              throw new Error(`Tool call not allowed while generating summary: ${value.toolName}`);
            }
            // TODO(v2): Temporary dual-write while migrating session messages to v2 events.
            if (Flag.EXPERIMENTAL_EVENT_SYSTEM) {
              yield* event.publish(SchemaSession.DurableEvent.Tool.Input.Started, {
                assistantMessageID: ctx.assistantMessage.id,
                sessionID: ctx.sessionID,
                callID: value.id,
                name: value.toolName,
                timestamp: DateTime.makeUnsafe(Date.now())
              });
            }
            const part = yield* session.updatePart({
              id: ctx.toolcalls[value.id]?.partID ?? SchemaMessage.PartID.ascending(),
              messageID: ctx.assistantMessage.id,
              sessionID: ctx.assistantMessage.sessionID,
              type: 'tool',
              tool: value.toolName,
              callID: value.id,
              state: { status: 'pending', input: {}, raw: '' },
              metadata: value.providerExecuted ? { providerExecuted: true } : void 0
            } satisfies SchemaMessage.ToolPart);
            ctx.toolcalls[value.id] = {
              done: yield* Deferred.make<void>(),
              partID: part.id,
              messageID: part.messageID,
              sessionID: part.sessionID
            };
            return;
          }

          case 'tool-input-delta':
            return;

          case 'tool-input-end': {
            // TODO(v2): Temporary dual-write while migrating session messages to v2 events.
            if (Flag.EXPERIMENTAL_EVENT_SYSTEM) {
              yield* event.publish(SchemaSession.DurableEvent.Tool.Input.Ended, {
                assistantMessageID: ctx.assistantMessage.id,
                sessionID: ctx.sessionID,
                callID: value.id,
                text: '',
                timestamp: DateTime.makeUnsafe(Date.now())
              });
            }
            return;
          }

          case 'tool-call': {
            if (ctx.assistantMessage.summary) {
              throw new Error(`Tool call not allowed while generating summary: ${value.toolName}`);
            }
            const toolCall = yield* readToolCall(value.toolCallId);
            // TODO(v2): Temporary dual-write while migrating session messages to v2 events.
            if (Flag.EXPERIMENTAL_EVENT_SYSTEM) {
              yield* event.publish(SchemaSession.DurableEvent.Tool.Called, {
                assistantMessageID: ctx.assistantMessage.id,
                sessionID: ctx.sessionID,
                callID: value.toolCallId,
                tool: value.toolName,
                input: value.input as Record<string, unknown>,
                provider: {
                  executed: toolCall?.part.metadata?.providerExecuted === true,
                  ...(value.providerMetadata ? { metadata: value.providerMetadata } : {})
                },
                timestamp: DateTime.makeUnsafe(Date.now())
              });
            }
            yield* updateToolCall(value.toolCallId, match => ({
              ...match,
              tool: value.toolName,
              state: {
                ...match.state,
                status: 'running',
                input: value.input as Record<string, unknown>,
                time: { start: Date.now() }
              },
              metadata: match.metadata?.providerExecuted
                ? { ...value.providerMetadata, providerExecuted: true }
                : value.providerMetadata
            }));

            const parts = yield* Message.parts(ctx.assistantMessage.id);
            const recentParts = parts.slice(-DOOM_LOOP_THRESHOLD);

            if (
              recentParts.length !== DOOM_LOOP_THRESHOLD ||
              !recentParts.every(
                part =>
                  part.type === 'tool' &&
                  part.tool === value.toolName &&
                  part.state.status !== 'pending' &&
                  JSON.stringify(part.state.input) === JSON.stringify(value.input)
              )
            ) {
              return;
            }

            const agent = yield* agents.get(ctx.assistantMessage.agent);
            yield* permission.ask({
              permission: 'doom_loop',
              patterns: [value.toolName],
              sessionID: ctx.assistantMessage.sessionID,
              metadata: { tool: value.toolName, input: value.input },
              always: [value.toolName],
              ruleset: agent!.permission
            });
            return;
          }

          case 'tool-result': {
            const toolCall = yield* readToolCall(value.toolCallId);
            const toolAttachments: SchemaMessage.FilePart[] = (
              TypeGuard.isRecord(value.output) && Array.isArray(value.output.attachments)
                ? value.output.attachments
                : []
            ).filter(
              (attachment: unknown): attachment is SchemaMessage.FilePart =>
                TypeGuard.isRecord(attachment) &&
                attachment.type === 'file' &&
                typeof attachment.mime === 'string' &&
                typeof attachment.url === 'string'
            );
            const normalized = yield* Effect.forEach(toolAttachments, attachment =>
              attachment.mime.startsWith('image/')
                ? image.normalize(attachment).pipe(
                    Effect.catchIf(
                      error => error instanceof SchemaImage.ResizerUnavailableError,
                      () => Effect.succeed(attachment)
                    ),
                    Effect.exit
                  )
                : Effect.succeed(Exit.succeed<SchemaMessage.FilePart>(attachment))
            );
            const omitted = normalized.filter(Exit.isFailure).length;
            const attachments = normalized.filter(Exit.isSuccess).map(item => item.value);
            const output = {
              ...value.output,
              output:
                omitted === 0
                  ? (value.output as { output: string }).output
                  : `${(value.output as { output: string }).output}\n\n[${omitted} image${omitted === 1 ? '' : 's'} omitted: could not be resized below the image size limit.]`,
              attachments: attachments?.length ? attachments : void 0
            } as {
              title: string;
              metadata: Record<string, unknown>;
              output: string;
              attachments?: SchemaMessage.FilePart[];
            };
            // TODO(v2): Temporary dual-write while migrating session messages to v2 events.
            if (Flag.EXPERIMENTAL_EVENT_SYSTEM) {
              yield* event.publish(SchemaSession.DurableEvent.Tool.Success, {
                assistantMessageID: ctx.assistantMessage.id,
                sessionID: ctx.sessionID,
                callID: value.toolCallId,
                structured: output.metadata,
                content: [
                  {
                    type: 'text',
                    text: output.output
                  },
                  ...(output.attachments?.map((item: SchemaMessage.FilePart) => ({
                    type: 'file' as const,
                    uri: item.url,
                    mime: item.mime,
                    name: item.filename
                  })) ?? [])
                ],
                provider: {
                  executed: toolCall?.part.metadata?.providerExecuted === true
                },
                timestamp: DateTime.makeUnsafe(Date.now())
              });
            }
            yield* completeToolCall(value.toolCallId, output);
            return;
          }

          case 'tool-error': {
            const toolCall = yield* readToolCall(value.toolCallId);
            // TODO(v2): Temporary dual-write while migrating session messages to v2 events.
            if (Flag.EXPERIMENTAL_EVENT_SYSTEM) {
              yield* event.publish(SchemaSession.DurableEvent.Tool.Failed, {
                assistantMessageID: ctx.assistantMessage.id,
                sessionID: ctx.sessionID,
                callID: value.toolCallId,
                error: {
                  type: 'unknown',
                  message: AppError.errorMessage(value.error)
                },
                provider: {
                  executed: toolCall?.part.metadata?.providerExecuted === true
                },
                timestamp: DateTime.makeUnsafe(Date.now())
              });
            }
            yield* failToolCall(value.toolCallId, value.error);
            return;
          }

          case 'error':
            throw value.error;

          case 'start-step':
            if (!ctx.assistantMessage.summary) {
              // TODO(v2): Temporary dual-write while migrating session messages to v2 events.
              if (Flag.EXPERIMENTAL_EVENT_SYSTEM) {
                yield* event.publish(SchemaSession.DurableEvent.Step.Started, {
                  assistantMessageID: ctx.assistantMessage.id,
                  sessionID: ctx.sessionID,
                  agent: input.assistantMessage.agent,
                  model: {
                    modelID: SchemaProvider.ModelID.make(ctx.model.id),
                    providerID: SchemaProvider.ProviderID.make(ctx.model.providerID),
                    variant: SchemaProvider.VariantID.make(
                      input.assistantMessage.variant ?? 'default'
                    )
                  },
                  timestamp: DateTime.makeUnsafe(Date.now())
                });
              }
            }
            yield* session.updatePart({
              id: SchemaMessage.PartID.ascending(),
              messageID: ctx.assistantMessage.id,
              sessionID: ctx.sessionID,
              type: 'step-start'
            });
            return;

          case 'finish-step': {
            const usage = Session.getUsage({
              model: ctx.model,
              usage: value.usage,
              metadata: value.providerMetadata
            });
            if (!ctx.assistantMessage.summary) {
              // TODO(v2): Temporary dual-write while migrating session messages to v2 events.
              if (Flag.EXPERIMENTAL_EVENT_SYSTEM) {
                yield* event.publish(SchemaSession.DurableEvent.Step.Ended, {
                  assistantMessageID: ctx.assistantMessage.id,
                  sessionID: ctx.sessionID,
                  finish: value.finishReason,
                  cost: usage.cost,
                  tokens: usage.tokens,
                  timestamp: DateTime.makeUnsafe(Date.now())
                });
              }
            }
            ctx.assistantMessage.finish = value.finishReason;
            ctx.assistantMessage.cost += usage.cost;
            ctx.assistantMessage.tokens = usage.tokens;
            yield* session.updatePart({
              id: SchemaMessage.PartID.ascending(),
              reason: value.finishReason,
              messageID: ctx.assistantMessage.id,
              sessionID: ctx.assistantMessage.sessionID,
              type: 'step-finish',
              tokens: usage.tokens,
              cost: usage.cost
            });
            yield* session.updateMessage(ctx.assistantMessage);
            if (
              !ctx.assistantMessage.summary &&
              isOverflow({ cfg: yield* config.get(), tokens: usage.tokens, model: ctx.model })
            ) {
              ctx.needsCompaction = true;
            }
            return;
          }

          case 'text-start':
            if (!ctx.assistantMessage.summary) {
              // TODO(v2): Temporary dual-write while migrating session messages to v2 events.
              if (Flag.EXPERIMENTAL_EVENT_SYSTEM) {
                yield* event.publish(SchemaSession.DurableEvent.Text.Started, {
                  assistantMessageID: ctx.assistantMessage.id,
                  sessionID: ctx.sessionID,
                  timestamp: DateTime.makeUnsafe(Date.now()),
                  textID: value.id
                });
              }
            }
            ctx.currentText = {
              id: SchemaMessage.PartID.ascending(),
              messageID: ctx.assistantMessage.id,
              sessionID: ctx.assistantMessage.sessionID,
              type: 'text',
              text: '',
              time: { start: Date.now() },
              metadata: value.providerMetadata
            };
            yield* session.updatePart(ctx.currentText);
            return;

          case 'text-delta':
            if (!ctx.currentText) {
              return;
            }
            ctx.currentText.text += value.text;
            if (value.providerMetadata) {
              ctx.currentText.metadata = value.providerMetadata;
            }
            yield* session.updatePartDelta({
              sessionID: ctx.currentText.sessionID,
              messageID: ctx.currentText.messageID,
              partID: ctx.currentText.id,
              field: 'text',
              delta: value.text
            });
            return;

          case 'text-end':
            if (!ctx.currentText) {
              return;
            }
            if (!ctx.assistantMessage.summary) {
              // TODO(v2): Temporary dual-write while migrating session messages to v2 events.
              if (Flag.EXPERIMENTAL_EVENT_SYSTEM) {
                yield* event.publish(SchemaSession.DurableEvent.Text.Ended, {
                  assistantMessageID: ctx.assistantMessage.id,
                  textID: value.id,
                  sessionID: ctx.sessionID,
                  text: ctx.currentText.text,
                  timestamp: DateTime.makeUnsafe(Date.now())
                });
              }
            }
            {
              const end = Date.now();
              ctx.currentText.time = { start: ctx.currentText.time?.start ?? end, end };
            }
            if (value.providerMetadata) {
              ctx.currentText.metadata = value.providerMetadata;
            }
            yield* session.updatePart(ctx.currentText);
            ctx.currentText = void 0;
            return;

          case 'finish':
            return;

          default:
            log.info('unhandled', { event: value.type, value });
            return;
        }
      }, Effect.provide(Database.defaultLayer));

      const cleanup = Effect.fn('SessionProcessor.cleanup')(function* () {
        if (ctx.currentText) {
          const end = Date.now();
          ctx.currentText.time = { start: ctx.currentText.time?.start ?? end, end };
          yield* session.updatePart(ctx.currentText);
          ctx.currentText = void 0;
        }

        for (const part of Object.values(ctx.reasoningMap)) {
          const end = Date.now();
          yield* session.updatePart({
            ...part,
            time: { start: part.time.start ?? end, end }
          });
        }
        ctx.reasoningMap = {};

        yield* Effect.forEach(
          Object.values(ctx.toolcalls),
          call => Deferred.await(call.done).pipe(Effect.timeout('250 millis'), Effect.ignore),
          { concurrency: 'unbounded' }
        );

        for (const toolCallID of Object.keys(ctx.toolcalls)) {
          const match = yield* readToolCall(toolCallID);
          if (!match) {
            continue;
          }
          const part = match.part;
          const end = Date.now();
          const metadata =
            'metadata' in part.state && TypeGuard.isRecord(part.state.metadata)
              ? part.state.metadata
              : {};
          yield* session.updatePart({
            ...part,
            state: {
              ...part.state,
              status: 'error',
              error: 'Tool execution aborted',
              metadata: { ...metadata, interrupted: true },
              time: { start: 'time' in part.state ? part.state.time.start : end, end }
            }
          });
        }
        ctx.toolcalls = {};
        ctx.assistantMessage.time.completed = Date.now();
        yield* session.updateMessage(ctx.assistantMessage);
      });

      const halt = Effect.fn('SessionProcessor.halt')(function* (e: unknown) {
        log.error('process', {
          error: AppError.errorMessage(e),
          stack: e instanceof Error ? e.stack : void 0
        });
        const error = parse(e);
        if (SchemaMessage.ContextOverflowError.isInstance(error)) {
          ctx.needsCompaction = true;
          yield* event.publish(SchemaSession.Events.Error, { sessionID: ctx.sessionID, error });
          return;
        }
        if (!ctx.assistantMessage.summary) {
          // TODO(v2): Temporary dual-write while migrating session messages to v2 events.
          if (Flag.EXPERIMENTAL_EVENT_SYSTEM) {
            yield* event.publish(SchemaSession.DurableEvent.Step.Failed, {
              assistantMessageID: ctx.assistantMessage.id,
              sessionID: ctx.sessionID,
              error: {
                type: 'unknown',
                message: AppError.errorMessage(e)
              },
              timestamp: DateTime.makeUnsafe(Date.now())
            });
          }
        }
        ctx.assistantMessage.error = error;
        yield* event.publish(SchemaSession.Events.Error, {
          sessionID: ctx.assistantMessage.sessionID,
          error: ctx.assistantMessage.error
        });
        yield* status.set(ctx.sessionID, { type: 'idle' });
      });

      const process = Effect.fn('SessionProcessor.process')(function* (
        streamInput: LLM.StreamInput
      ) {
        log.info('process');
        ctx.needsCompaction = false;
        ctx.shouldBreak = (yield* config.get()).experimental?.continue_loop_on_deny !== true;

        return yield* Effect.gen(function* () {
          yield* Effect.gen(function* () {
            ctx.currentText = void 0;
            ctx.reasoningMap = {};
            const stream = llm.stream(streamInput);

            yield* stream.pipe(
              Stream.tap(event => handleEvent(event)),
              Stream.takeUntil(() => ctx.needsCompaction),
              Stream.runDrain
            );
          }).pipe(
            Effect.onInterrupt(() =>
              Effect.gen(function* () {
                aborted = true;
                if (!ctx.assistantMessage.error) {
                  yield* halt(new DOMException('Aborted', 'AbortError'));
                }
              })
            ),
            Effect.catchCauseIf(
              cause => !Cause.hasInterruptsOnly(cause),
              cause => Effect.fail(Cause.squash(cause))
            ),
            Effect.retry(
              SessionRetry.policy({
                provider: input.model.providerID,
                parse,
                set: info => {
                  // TODO(v2): Temporary dual-write while migrating session messages to v2 events.
                  const effect = Flag.EXPERIMENTAL_EVENT_SYSTEM
                    ? event.publish(SchemaSession.DurableEvent.Retried, {
                        sessionID: ctx.sessionID,
                        attempt: info.attempt,
                        error: {
                          message: info.message,
                          isRetryable: true
                        },
                        timestamp: DateTime.makeUnsafe(Date.now())
                      })
                    : Effect.void;
                  return effect.pipe(
                    Effect.andThen(
                      status.set(ctx.sessionID, {
                        type: 'retry',
                        attempt: info.attempt,
                        message: info.message,
                        action: info.action,
                        next: info.next
                      })
                    )
                  );
                }
              })
            ),
            Effect.catch(halt),
            Effect.ensuring(cleanup())
          );

          if (ctx.needsCompaction) {
            return 'compact';
          }
          if (ctx.blocked || ctx.assistantMessage.error) {
            return 'stop';
          }
          return 'continue';
        });
      });

      return Effect.succeed({
        get message() {
          return ctx.assistantMessage;
        },
        updateToolCall,
        completeToolCall,
        process
      } satisfies Handle);
    };

    return Service.of({
      create
    });
  })
);
