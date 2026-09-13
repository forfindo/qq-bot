import { Effect, Schema } from 'effect';
import { SchemaTool } from '@/schema';
import * as Truncate from './truncate';
import { Agent } from '@/agent';
import z from 'zod';

type AskInput = {
  permission: string;
  patterns: string[];
  always: string[];
  metadata: { [key: string]: unknown };
};

export type ToolAttachment = {
  type: 'file';
  mime: string;
  url: string;
  filename?: string;
};

export type ToolResult =
  | string
  | {
      title?: string;
      output: string;
      metadata?: { [key: string]: unknown };
      attachments?: ToolAttachment[];
    };

export type ToolContext = {
  sessionID: string;
  messageID: string;
  agent: string;
  /**
   * Current project directory for this session.
   * Prefer this over process.cwd() when resolving relative paths.
   */
  directory: string;
  abort: AbortSignal;
  metadata(input: { title?: string; metadata?: { [key: string]: unknown } }): void;
  ask(input: AskInput): Promise<void>;
};

type Init<Parameters extends Schema.Decoder<unknown>, M extends SchemaTool.Metadata> =
  | SchemaTool.DefWithoutID<Parameters, M>
  | (() => Effect.Effect<SchemaTool.DefWithoutID<Parameters, M>>);

const wrap = <Parameters extends Schema.Decoder<unknown>, Result extends SchemaTool.Metadata>(
  id: string,
  init: Init<Parameters, Result>,
  truncate: Truncate.Interface,
  agents: Agent.Interface
) => {
  return () =>
    Effect.gen(function* () {
      const toolInfo = typeof init === 'function' ? { ...(yield* init()) } : { ...init };
      // Compile the parser closure once per tool init; `decodeUnknownEffect`
      // allocates a new closure per call, so hoisting avoids re-closing it for
      // every LLM tool invocation.
      const decode = Schema.decodeUnknownEffect(toolInfo.parameters);
      const execute = toolInfo.execute;
      toolInfo.execute = (args, ctx) => {
        const attrs = {
          'tool.name': id,
          'session.id': ctx.sessionID,
          'message.id': ctx.messageID,
          ...(ctx.callID ? { 'tool.call_id': ctx.callID } : {})
        };
        return Effect.gen(function* () {
          const decoded = yield* decode(args).pipe(
            Effect.mapError(error =>
              toolInfo.formatValidationError
                ? new Error(toolInfo.formatValidationError(error), { cause: error })
                : new Error(
                    `The ${id} tool was called with invalid arguments: ${error.toString()}.\nPlease rewrite the input so it satisfies the expected schema.`,
                    { cause: error }
                  )
            )
          );
          const result = yield* execute(decoded as Schema.Schema.Type<Parameters>, ctx);
          if (result.metadata.truncated !== void 0) {
            return result;
          }
          const agent = yield* agents.get(ctx.agent);
          const truncated = yield* truncate.output(result.output, {}, agent);
          return {
            ...result,
            output: truncated.content,
            metadata: {
              ...result.metadata,
              truncated: truncated.truncated,
              ...(truncated.truncated && { outputPath: truncated.outputPath })
            }
          };
        }).pipe(Effect.orDie, Effect.withSpan('Tool.execute', { attributes: attrs }));
      };
      return toolInfo;
    });
};

export function define<
  Parameters extends Schema.Decoder<unknown>,
  Result extends SchemaTool.Metadata,
  R,
  ID extends string = string
>(
  id: ID,
  init: Effect.Effect<Init<Parameters, Result>, never, R>
): Effect.Effect<
  SchemaTool.Info<Parameters, Result>,
  never,
  R | Truncate.Service | Agent.Service
> & { id: ID } {
  return Object.assign(
    Effect.gen(function* () {
      const resolved = yield* init;
      const truncate = yield* Truncate.Service;
      const agents = yield* Agent.Service;
      return { id, init: wrap(id, resolved, truncate, agents) };
    }),
    { id }
  );
}

export function init<P extends Schema.Decoder<unknown>, M extends SchemaTool.Metadata>(
  info: SchemaTool.Info<P, M>
): Effect.Effect<SchemaTool.Def<P, M>> {
  return Effect.gen(function* () {
    const init = yield* info.init();
    return {
      ...init,
      id: info.id
    };
  });
}

export function tool<Args extends z.ZodRawShape>(input: {
  description: string;
  args: Args;
  execute(args: z.infer<z.ZodObject<Args>>, context: ToolContext): Promise<ToolResult>;
}) {
  return input;
}
tool.schema = z;

export type ToolDefinition = ReturnType<typeof tool>;
