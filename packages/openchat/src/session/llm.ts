import { Context, Effect, Layer, Record, Stream } from 'effect';
import {
  SchemaAgent,
  SchemaMessage,
  SchemaPermission,
  SchemaProvider,
  SchemaSession
} from '@/schema';
import { jsonSchema, type ModelMessage, streamText, tool, type Tool, wrapLanguageModel } from 'ai';
import { Auth } from '@/auth';
import { Config } from '@/config';
import { Provider, ProviderTransform } from '@/provider';
import { Permission } from '@/permission';
import { Log, Wildcard } from '@/utils';
import { InstanceRef } from '@/instance/refrences';
import CommonPrompt from './prompt/common.md';
import * as MessageSender from './message-sender';
import { channelPrompt, globalPrompt, providerPrompt } from '@/session/system-prompt';
import { mergeDeep } from 'remeda';
import { GitLabWorkflowLanguageModel } from 'gitlab-ai-provider';
import type { JSONObject } from '@ai-sdk/provider';
import { EffectRunner, InstanceContext } from '@/instance';
import { Event } from '@/event';
import { InstallationVersion } from '@/installation/version';

const log = Log.create({ service: 'llm' });

type Result = Awaited<ReturnType<typeof streamText>>;

export type StreamInput = {
  user: SchemaMessage.User;
  sessionID: string;
  parentSessionID?: string;
  model: SchemaProvider.Model;
  agent: SchemaAgent.Info;
  permission?: SchemaPermission.Ruleset;
  system: string[];
  messages: ModelMessage[];
  small?: boolean;
  tools: Record<string, Tool>;
  retries?: number;
  toolChoice?: 'auto' | 'required' | 'none';
};

export type StreamRequest = StreamInput & {
  abort: AbortSignal;
};

// Avoid re-instantiating remeda's deep merge types in this hot LLM path; the runtime behavior is still mergeDeep.
const mergeOptions = (
  target: Record<string, unknown>,
  source: Record<string, unknown> | undefined
): Record<string, unknown> => mergeDeep(target, source ?? {});

const resolveTools = (input: Pick<StreamInput, 'tools' | 'agent' | 'permission' | 'user'>) => {
  const disabled = Permission.disabled(
    Object.keys(input.tools),
    Permission.merge(input.agent.permission, input.permission ?? [])
  );
  return Record.filter(input.tools, (_, k) => input.user.tools?.[k] !== false && !disabled.has(k));
};

// Check if messages contain any tool-call content
// Used to determine if a dummy tool should be added (GitHub Copilot only; see stream()).
export const hasToolCalls = (messages: ModelMessage[]): boolean => {
  for (const msg of messages) {
    if (!Array.isArray(msg.content)) {
      continue;
    }
    for (const part of msg.content) {
      if (part.type === 'tool-call' || part.type === 'tool-result') {
        return true;
      }
    }
  }
  return false;
};

export type Output = Result['fullStream'] extends AsyncIterable<infer T> ? T : never;

export interface Interface {
  readonly stream: (input: StreamInput) => Stream.Stream<Output, unknown>;
}

export class Service extends Context.Service<Service, Interface>()('@openchat/LLM') {}

const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const auth = yield* Auth.Service;
    const config = yield* Config.Service;
    const provider = yield* Provider.Service;
    const perm = yield* Permission.Service;
    const messageSender = yield* MessageSender.Service;
    const event = yield* Event.Service;

    const run = Effect.fn('LLM.run')(function* (input: StreamRequest) {
      log.info('stream', {
        modelID: input.model.id,
        providerID: input.model.providerID
      });

      const [language, cfg, item, info] = yield* Effect.all(
        [
          provider.getLanguage(input.model),
          config.get(),
          provider.getProvider(input.model.providerID),
          auth.get(input.model.providerID)
        ],
        { concurrency: 'unbounded' }
      );

      // TODO: move this to a proper hook
      const isOpenaiOauth = item.id === 'openai' && info?.type === 'oauth';

      const ctx = yield* InstanceRef;
      if (!ctx) {
        return yield* Effect.die(new Error('InstanceContext should not be null'));
      }
      const system: string[] = [];
      system.push(
        [
          // use agent prompt otherwise provider prompt
          [
            CommonPrompt.replace(
              /\{(.*?)}/g,
              (_, name: 'name' | 'owner') => ctx[name] || `{${name}}`
            ),
            yield* globalPrompt(),
            (yield* channelPrompt(
              messageSender.channelType,
              messageSender.channelInfo?.channelID ?? messageSender.source!.uid
            )) ||
              input.agent.prompt ||
              providerPrompt(input.model)
          ].join('\n'),
          // any custom prompt passed into this call
          ...input.system,
          // any custom prompt from last user message
          input.user.system ?? ''
        ]
          .filter(x => x)
          .join('\n')
      );
      // rejoin to maintain 2-part structure for caching if header unchanged
      if (system.length > 2) {
        const header = system[0]!;
        const rest = system.slice(1);
        system.length = 0;
        system.push(header, rest.join('\n'));
      }

      const variant =
        !input.small && input.model.variants && input.user.model.variant
          ? input.model.variants[input.user.model.variant]
          : {};
      const base = input.small
        ? ProviderTransform.smallOptions(input.model)
        : ProviderTransform.options({
            model: input.model,
            sessionID: input.sessionID,
            providerOptions: item.options
          });
      const options = mergeOptions(
        mergeOptions(mergeOptions(base, input.model.options), input.agent.options),
        variant
      );
      if (isOpenaiOauth) {
        options.instructions = system.join('\n');
      }

      const isWorkflow = language instanceof GitLabWorkflowLanguageModel;
      const messages = isOpenaiOauth
        ? input.messages
        : isWorkflow
          ? input.messages
          : [
              ...system.map(
                (x): ModelMessage => ({
                  role: 'system',
                  content: x
                })
              ),
              ...input.messages
            ];

      const params = {
        temperature: input.model.capabilities.temperature
          ? (input.agent.temperature ?? ProviderTransform.temperature(input.model))
          : void 0,
        topP: input.agent.topP ?? ProviderTransform.topP(input.model),
        topK: ProviderTransform.topK(input.model),
        maxOutputTokens: ProviderTransform.maxOutputTokens(input.model),
        options
      };
      const tools = resolveTools(input);
      // GitHub Copilot may require the tools parameter when message history contains
      // tool calls but no tools are active (e.g. compaction). Inject a stub tool that
      // is never meant to be invoked. LiteLLM-backed providers are excluded.
      if (
        input.model.providerID.includes('github-copilot') &&
        Object.keys(tools).length === 0 &&
        hasToolCalls(input.messages)
      ) {
        tools['_noop'] = tool({
          description:
            'Do not call this tool. It exists only for API compatibility and must never be invoked.',
          inputSchema: jsonSchema({
            type: 'object',
            properties: {
              reason: { type: 'string', description: 'Unused' }
            }
          }),
          execute: () => Promise.resolve({ output: '', title: '', metadata: {} })
        });
      }
      const sortedTools = Object.fromEntries(
        Object.entries(tools).toSorted(([a], [b]) => a.localeCompare(b))
      );

      // Wire up toolExecutor for DWS workflow models so that tool calls
      // from the workflow service are executed via opencode's tool system
      // and results sent back over the WebSocket.
      if (language instanceof GitLabWorkflowLanguageModel) {
        const workflowModel = language as GitLabWorkflowLanguageModel & {
          sessionID?: string;
          sessionPreapprovedTools?: string[];
          approvalHandler?: (
            approvalTools: { name: string; args: string }[]
          ) => Promise<{ approved: boolean }>;
        };
        workflowModel.sessionID = input.sessionID;
        workflowModel.systemPrompt = system.join('\n');
        workflowModel.toolExecutor = async (toolName, argsJson, _requestID) => {
          const t = sortedTools[toolName];
          if (!t || !t.execute) {
            return { result: '', error: `Unknown tool: ${toolName}` };
          }
          try {
            const result = (await t.execute(JSON.parse(argsJson), {
              toolCallId: _requestID,
              messages: input.messages,
              abortSignal: input.abort
            })) as string | Record<string, unknown>;
            const output =
              typeof result === 'string'
                ? result
                : ((result?.output as string) ?? JSON.stringify(result));
            return {
              result: output,
              metadata:
                typeof result === 'object' ? (result?.metadata as Record<string, unknown>) : void 0,
              title: typeof result === 'object' ? (result?.title as string) : void 0
            };
          } catch (e: unknown) {
            return { result: '', error: e instanceof Error ? e.message : String(e) };
          }
        };

        const ruleset = Permission.merge(input.agent.permission ?? [], input.permission ?? []);
        workflowModel.sessionPreapprovedTools = Object.keys(sortedTools).filter(name => {
          const match = ruleset.findLast(rule => Wildcard.match(name, rule.permission));
          return !match || match.action !== 'ask';
        });

        const bridge = yield* EffectRunner.make();
        const approvedToolsForSession = new Set<string>();
        workflowModel.approvalHandler = InstanceContext.bind(
          async (approvalTools: { name: string; args: string }[]) => {
            const uniqueNames = [
              ...new Set(approvalTools.map((t: { name: string }) => t.name))
            ] as string[];
            // Auto-approve tools that were already approved in this session
            // (prevents infinite approval loops for server-side MCP tools)
            if (uniqueNames.every(name => approvedToolsForSession.has(name))) {
              return { approved: true };
            }

            const id = SchemaPermission.PermissionID.ascending();
            try {
              // TODO
              // event.subscribe(SchemaPermission.Events.Replied).pipe(evt => {
              //   if (evt.properties.requestID === id) {
              //     void evt.properties.reply;
              //   }
              // });
              void event;
              const toolPatterns = approvalTools.map((t: { name: string; args: string }) => {
                try {
                  const parsed = JSON.parse(t.args) as Record<string, unknown>;
                  const title = (parsed?.title ?? parsed?.name ?? '') as string;
                  return title ? `${t.name}: ${title}` : t.name;
                } catch {
                  return t.name;
                }
              });
              const uniquePatterns = [...new Set(toolPatterns)] as string[];
              await bridge.promise(
                perm.ask({
                  id,
                  sessionID: SchemaSession.SessionID.make(input.sessionID),
                  permission: 'workflow_tool_approval',
                  patterns: uniquePatterns,
                  metadata: { tools: approvalTools },
                  always: uniquePatterns,
                  ruleset: []
                })
              );
              for (const name of uniqueNames) {
                approvedToolsForSession.add(name);
              }
              workflowModel.sessionPreapprovedTools = [
                ...(workflowModel.sessionPreapprovedTools ?? []),
                ...uniqueNames
              ];
              return { approved: true };
            } catch {
              return { approved: false };
            }
          }
        );
      }

      void cfg;
      // TODO
      // const tracer = cfg.experimental?.openTelemetry
      //   ? Option.getOrUndefined(yield* Effect.serviceOption(OtelTracer.OtelTracer))
      //   : void 0;
      // const telemetryTracer = tracer
      //   ? new Proxy(tracer, {
      //       get(target, prop, receiver) {
      //         if (prop !== 'startSpan') {
      //           return Reflect.get(target, prop, receiver);
      //         }
      //         return (...args: Parameters<typeof target.startSpan>) => {
      //           const span = target.startSpan(...args);
      //           span.setAttribute('session.id', input.sessionID);
      //           return span;
      //         };
      //       }
      //     })
      //   : void 0;

      const opencodeProjectID = input.model.providerID.startsWith('opencode') ? 'openchat' : void 0;

      return streamText({
        onError(error) {
          log.error('stream error', {
            error
          });
        },
        experimental_repairToolCall(failed) {
          const lower = failed.toolCall.toolName.toLowerCase();
          if (lower !== failed.toolCall.toolName && sortedTools[lower]) {
            log.info('repairing tool call', {
              tool: failed.toolCall.toolName,
              repaired: lower
            });
            return Promise.resolve({
              ...failed.toolCall,
              toolName: lower
            });
          }
          return Promise.resolve({
            ...failed.toolCall,
            input: JSON.stringify({
              tool: failed.toolCall.toolName,
              error: failed.error.message
            }),
            toolName: 'invalid'
          });
        },
        temperature: params.temperature,
        topP: params.topP,
        topK: params.topK,
        providerOptions: ProviderTransform.providerOptions(
          input.model,
          params.options as JSONObject
        ),
        activeTools: Object.keys(sortedTools).filter(x => x !== 'invalid'),
        tools: sortedTools,
        toolChoice: input.toolChoice,
        maxOutputTokens: params.maxOutputTokens,
        abortSignal: input.abort,
        headers: {
          ...(input.model.providerID.startsWith('opencode')
            ? {
                'x-opencode-project': opencodeProjectID,
                'x-opencode-session': input.sessionID,
                'x-opencode-request': input.user.id,
                'x-opencode-client': 'plugin',
                'User-Agent': `openchat/${InstallationVersion}`
              }
            : {
                'x-session-affinity': input.sessionID,
                ...(input.parentSessionID ? { 'x-parent-session-id': input.parentSessionID } : {}),
                'User-Agent': `openchat/${InstallationVersion}`
              }),
          ...input.model.headers
        },
        maxRetries: input.retries ?? 0,
        messages,
        model: wrapLanguageModel({
          model: language,
          middleware: [
            {
              specificationVersion: 'v3' as const,
              transformParams(args) {
                // @ts-expect-error
                args.params.prompt = ProviderTransform.message(
                  args.params.prompt,
                  input.model,
                  options
                );
                return Promise.resolve(args.params);
              }
            }
          ]
        })
        // TODO
        // experimental_telemetry: {
        //   isEnabled: cfg.experimental?.openTelemetry,
        //   functionId: 'session.llm',
        //   tracer: telemetryTracer,
        //   metadata: {
        //     userId: cfg.username ?? 'unknown',
        //     sessionId: input.sessionID
        //   }
        // }
      });
    });

    const stream: Interface['stream'] = input =>
      Stream.scoped(
        Stream.unwrap(
          Effect.gen(function* () {
            const ctrl = yield* Effect.acquireRelease(
              Effect.sync(() => new AbortController()),
              ctrl => Effect.sync(() => ctrl.abort())
            );

            const result = yield* run({ ...input, abort: ctrl.signal });

            return Stream.fromAsyncIterable(result.fullStream, e =>
              e instanceof Error ? e : new Error(String(e))
            );
          })
        )
      );

    return Service.of({
      stream
    });
  })
);

export const defaultLayer = layer.pipe(
  Layer.provide(Auth.defaultLayer),
  Layer.provide(Config.defaultLayer),
  Layer.provide(Provider.defaultLayer),
  Layer.provide(Permission.defaultLayer),
  Layer.provide(Event.defaultLayer)
);
