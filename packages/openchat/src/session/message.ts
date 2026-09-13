import { SchemaMessage, SchemaProvider, type SchemaSession } from '@/schema';
import { Effect } from 'effect';
import { Database } from '@/database';
import { and, desc, eq, inArray, lt, or } from 'drizzle-orm';
import { MessageTable, PartTable, SessionTable } from '@/database/sql/session.sql';
import { NotFoundError } from '@/storage/storage';
import { convertToModelMessages, type UIMessage } from 'ai';
import { iife, MediaUtil } from '@/utils';
import type { JSONObject } from '@ai-sdk/provider';

export const SYNTHETIC_ATTACHMENT_PROMPT = 'Attached media from tool result:';

const truncateToolOutput = (text: string, maxChars?: number) => {
  if (!maxChars || text.length <= maxChars) {
    return text;
  }
  const omitted = text.length - maxChars;
  return `${text.slice(0, maxChars)}\n[Tool output truncated for compaction: omitted ${omitted} chars]`;
};

const providerMeta = (metadata: Record<string, JSONObject> | undefined) => {
  if (!metadata) {
    return void 0;
  }
  const { providerExecuted: _, ...rest } = metadata;
  return Object.keys(rest).length > 0 ? rest : void 0;
};

const older = (row: SchemaMessage.Cursor) =>
  or(
    lt(MessageTable.time_created, row.time),
    and(eq(MessageTable.time_created, row.time), lt(MessageTable.id, row.id))
  );

const part = (row: typeof PartTable.$inferSelect) =>
  ({
    ...row.data,
    id: row.id,
    sessionID: row.session_id,
    messageID: row.message_id
  }) as SchemaMessage.Part;

const info = (row: typeof MessageTable.$inferSelect) =>
  ({
    ...row.data,
    id: row.id,
    sessionID: row.session_id
  }) as SchemaMessage.Info;

const hydrate = (db: Database.Interface['db'], rows: (typeof MessageTable.$inferSelect)[]) => {
  const ids = rows.map(row => row.id);
  const partByMessage = new Map<string, SchemaMessage.Part[]>();
  return Effect.gen(function* () {
    if (ids.length > 0) {
      const partRows = yield* db
        .select()
        .from(PartTable)
        .where(inArray(PartTable.message_id, ids))
        .orderBy(PartTable.message_id, PartTable.id)
        .all()
        .pipe(Effect.orDie);
      for (const row of partRows) {
        const next = part(row);
        const list = partByMessage.get(row.message_id);
        if (list) {
          list.push(next);
        } else {
          partByMessage.set(row.message_id, [next]);
        }
      }
    }

    return rows.map(row => ({
      info: info(row),
      parts: partByMessage.get(row.id) ?? []
    }));
  });
};

export const page = Effect.fn('Message.page')(function* (input: {
  sessionID: SchemaSession.SessionID;
  limit: number;
  before?: string;
}) {
  const { db } = yield* Database.Service;
  const before = input.before ? SchemaMessage.decodeCursor(input.before) : void 0;
  const where = before
    ? and(eq(MessageTable.session_id, input.sessionID), older(before))
    : eq(MessageTable.session_id, input.sessionID);
  const rows = yield* db
    .select()
    .from(MessageTable)
    .where(where)
    .orderBy(desc(MessageTable.time_created), desc(MessageTable.id))
    .limit(input.limit + 1)
    .all()
    .pipe(Effect.orDie);
  if (rows.length === 0) {
    const row = yield* db
      .select({ id: SessionTable.id })
      .from(SessionTable)
      .where(eq(SessionTable.id, input.sessionID))
      .get()
      .pipe(Effect.orDie);
    if (!row) {
      return yield* new NotFoundError({ message: `Session not found: ${input.sessionID}` });
    }
    return {
      items: [] as SchemaMessage.WithParts[],
      more: false
    };
  }

  const more = rows.length > input.limit;
  const slice = more ? rows.slice(0, input.limit) : rows;
  const items = yield* hydrate(db, slice);
  items.reverse();
  const tail = slice.at(-1);
  return {
    items,
    more,
    cursor:
      more && tail ? SchemaMessage.encodeCursor({ id: tail.id, time: tail.time_created }) : void 0
  };
});

export function parts(messageID: SchemaMessage.MessageID) {
  return Effect.gen(function* () {
    const { db } = yield* Database.Service;
    const rows = yield* db
      .select()
      .from(PartTable)
      .where(eq(PartTable.message_id, messageID))
      .orderBy(PartTable.id)
      .all()
      .pipe(Effect.orDie);
    return rows.map(part);
  });
}

export const get = Effect.fn('MessageV2.get')(function* (input: {
  sessionID: SchemaSession.SessionID;
  messageID: SchemaMessage.MessageID;
}) {
  const { db } = yield* Database.Service;
  const row = yield* db
    .select()
    .from(MessageTable)
    .where(and(eq(MessageTable.id, input.messageID), eq(MessageTable.session_id, input.sessionID)))
    .get()
    .pipe(Effect.orDie);
  if (!row) {
    return yield* new NotFoundError({ message: `Message not found: ${input.messageID}` });
  }
  return {
    info: info(row),
    parts: yield* parts(input.messageID)
  };
});

export const toModelMessagesEffect = Effect.fnUntraced(function* (
  input: SchemaMessage.WithParts[],
  model: SchemaProvider.Model,
  options?: { stripMedia?: boolean; toolOutputMaxChars?: number }
) {
  const result: UIMessage[] = [];
  const toolNames = new Set<string>();
  // Track media from tool results that need to be injected as user messages
  // for providers that don't support that media type in tool results.
  //
  // OpenAI-compatible APIs only support string content in tool results, so we need
  // to extract media and inject as user messages. Some SDKs only support a subset
  // of media in tool results; e.g. Bedrock supports images but not PDFs there.
  //
  // Only apply this workaround if the model actually supports that media input -
  // otherwise unsupportedParts() will turn it into a user-visible error.
  const supportsMediaInToolResult = (attachment: { mime: string }) => {
    if (model.api.npm === '@ai-sdk/anthropic') {
      return true;
    }
    if (model.api.npm === '@ai-sdk/openai') {
      return true;
    }
    if (model.api.npm === '@ai-sdk/amazon-bedrock') {
      return attachment.mime.startsWith('image/');
    }
    if (model.api.npm === '@ai-sdk/google-vertex/anthropic') {
      return true;
    }
    if (model.api.npm === '@ai-sdk/google') {
      const id = model.api.id.toLowerCase();
      return id.includes('gemini-3') && !id.includes('gemini-2');
    }
    return false;
  };

  const toModelOutput = (options: { toolCallId: string; input: unknown; output: unknown }) => {
    const output = options.output;
    if (typeof output === 'string') {
      return { type: 'text', value: output };
    }

    if (typeof output === 'object') {
      const outputObject = output as {
        text: string;
        attachments?: Array<{ mime: string; url: string }>;
      };
      const attachments = (outputObject.attachments ?? []).filter(attachment => {
        return attachment.url.startsWith('data:') && attachment.url.includes(',');
      });

      return {
        type: 'content',
        value: [
          ...(outputObject.text ? [{ type: 'text', text: outputObject.text }] : []),
          ...attachments.map(attachment => ({
            type: 'media',
            mediaType: attachment.mime,
            data: iife(() => {
              const commaIndex = attachment.url.indexOf(',');
              return commaIndex === -1 ? attachment.url : attachment.url.slice(commaIndex + 1);
            })
          }))
        ]
      };
    }

    return { type: 'json', value: output as never };
  };

  for (const msg of input) {
    if (msg.parts.length === 0) {
      continue;
    }

    if (msg.info.role === 'user') {
      const userMessage: UIMessage = {
        id: msg.info.id,
        role: 'user',
        parts: []
      };
      for (const part of msg.parts) {
        // User message parts should never be empty
        if (part.type === 'text' && !part.ignored && part.text !== '') {
          userMessage.parts.push({
            type: 'text',
            text: part.text
          });
        }
        // text/plain and directory files are converted into text parts, ignore them
        if (
          part.type === 'file' &&
          part.mime !== 'text/plain' &&
          part.mime !== 'application/x-directory'
        ) {
          if (options?.stripMedia && MediaUtil.isMedia(part.mime)) {
            userMessage.parts.push({
              type: 'text',
              text: `[Attached ${part.mime}: ${part.filename ?? 'file'}]`
            });
          } else {
            userMessage.parts.push({
              type: 'file',
              url: part.url,
              mediaType: part.mime,
              filename: part.filename
            });
          }
        }

        if (part.type === 'compaction') {
          userMessage.parts.push({
            type: 'text',
            text: 'What did we do so far?'
          });
        }
        if (part.type === 'subtask') {
          userMessage.parts.push({
            type: 'text',
            text: 'The following tool was executed by the user'
          });
        }
      }
      if (userMessage.parts.length > 0) {
        result.push(userMessage);
      }
    }

    if (msg.info.role === 'assistant') {
      const differentModel =
        `${model.providerID}/${model.id}` !== `${msg.info.providerID}/${msg.info.modelID}`;
      const media: Array<{ mime: string; url: string; filename?: string }> = [];

      if (
        msg.info.error &&
        !(
          SchemaMessage.AbortedError.isInstance(msg.info.error) &&
          msg.parts.some(part => part.type !== 'step-start' && part.type !== 'reasoning')
        )
      ) {
        continue;
      }
      const assistantMessage: UIMessage = {
        id: msg.info.id,
        role: 'assistant',
        parts: []
      };
      // Anthropic adaptive thinking can persist assistant turns like:
      // step-start, reasoning(signature), text(""), step-start,
      // reasoning(signature). The empty text part is a structural separator,
      // but it does not carry the signature metadata itself. Dropping it shifts
      // signed thinking positions after step-start splitting/provider regrouping;
      // keeping it as "" is filtered by the AI SDK and rejected by Anthropic.
      // It is unclear whether this shape originates in our stream processing,
      // a proxy, or a lower-level library, but preserving a non-empty separator
      // here is the only safe replay point we have.
      // Use a single space so the separator survives replay without changing
      // the neighboring signed reasoning blocks.
      const hasSignedReasoning = msg.parts.some(part => {
        if (part.type !== 'reasoning') {
          return false;
        }
        // @ts-ignore
        return part.metadata?.anthropic?.signature != null;
      });
      for (const part of msg.parts) {
        if (part.type === 'text') {
          const text = part.text === '' && hasSignedReasoning ? ' ' : part.text;
          assistantMessage.parts.push({
            type: 'text',
            text,
            ...(differentModel
              ? {}
              : { providerMetadata: part.metadata as Record<string, JSONObject> })
          });
        }
        if (part.type === 'step-start') {
          assistantMessage.parts.push({
            type: 'step-start'
          });
        }
        if (part.type === 'tool') {
          toolNames.add(part.tool);
          if (part.state.status === 'completed') {
            const outputText = part.state.time.compacted
              ? '[Old tool result content cleared]'
              : truncateToolOutput(part.state.output, options?.toolOutputMaxChars);
            const attachments =
              part.state.time.compacted || options?.stripMedia
                ? []
                : (part.state.attachments ?? []);

            // For providers that don't support media in tool results, extract media files
            // (images, PDFs) to be sent as a separate user message
            const mediaAttachments = attachments.filter(a => MediaUtil.isMedia(a.mime));
            const extractedMedia = mediaAttachments.filter(a => !supportsMediaInToolResult(a));
            if (extractedMedia.length > 0) {
              media.push(...extractedMedia);
            }
            const finalAttachments = attachments.filter(
              a => !MediaUtil.isMedia(a.mime) || supportsMediaInToolResult(a)
            );

            const output =
              finalAttachments.length > 0
                ? {
                    text: outputText,
                    attachments: finalAttachments
                  }
                : outputText;

            assistantMessage.parts.push({
              type: ('tool-' + part.tool) as `tool-${string}`,
              state: 'output-available',
              toolCallId: part.callID,
              input: part.state.input,
              output,
              ...(part.metadata?.providerExecuted ? { providerExecuted: true } : {}),
              ...(differentModel
                ? {}
                : {
                    callProviderMetadata: providerMeta(part.metadata as Record<string, JSONObject>)
                  })
            });
          }
          if (part.state.status === 'error') {
            const output =
              part.state.metadata?.interrupted === true ? part.state.metadata.output : void 0;
            if (typeof output === 'string') {
              assistantMessage.parts.push({
                type: ('tool-' + part.tool) as `tool-${string}`,
                state: 'output-available',
                toolCallId: part.callID,
                input: part.state.input,
                output,
                ...(part.metadata?.providerExecuted ? { providerExecuted: true } : {}),
                ...(differentModel
                  ? {}
                  : {
                      callProviderMetadata: providerMeta(
                        part.metadata as Record<string, JSONObject>
                      )
                    })
              });
            } else {
              assistantMessage.parts.push({
                type: ('tool-' + part.tool) as `tool-${string}`,
                state: 'output-error',
                toolCallId: part.callID,
                input: part.state.input,
                errorText: part.state.error,
                ...(part.metadata?.providerExecuted ? { providerExecuted: true } : {}),
                ...(differentModel
                  ? {}
                  : {
                      callProviderMetadata: providerMeta(
                        part.metadata as Record<string, JSONObject>
                      )
                    })
              });
            }
          }
          // Handle pending/running tool calls to prevent dangling tool_use blocks
          // Anthropic/Claude APIs require every tool_use to have a corresponding tool_result
          if (part.state.status === 'pending' || part.state.status === 'running') {
            assistantMessage.parts.push({
              type: ('tool-' + part.tool) as `tool-${string}`,
              state: 'output-error',
              toolCallId: part.callID,
              input: part.state.input,
              errorText: '[Tool execution was interrupted]',
              ...(part.metadata?.providerExecuted ? { providerExecuted: true } : {}),
              ...(differentModel
                ? {}
                : {
                    callProviderMetadata: providerMeta(part.metadata as Record<string, JSONObject>)
                  })
            });
          }
        }
        if (part.type === 'reasoning') {
          if (differentModel) {
            if (part.text.trim().length > 0) {
              assistantMessage.parts.push({
                type: 'text',
                text: part.text
              });
            }
            continue;
          }
          assistantMessage.parts.push({
            type: 'reasoning',
            text: part.text,
            providerMetadata: part.metadata as Record<string, JSONObject>
          });
        }
      }
      if (assistantMessage.parts.length > 0) {
        result.push(assistantMessage);
        // Inject pending media as a user message for providers that don't support
        // media (images, PDFs) in tool results
        if (media.length > 0) {
          result.push({
            id: SchemaMessage.MessageID.ascending(),
            role: 'user',
            parts: [
              {
                type: 'text' as const,
                text: SYNTHETIC_ATTACHMENT_PROMPT
              },
              ...media.map(attachment => ({
                type: 'file' as const,
                url: attachment.url,
                mediaType: attachment.mime,
                filename: attachment.filename
              }))
            ]
          });
        }
      }
    }
  }

  const tools = Object.fromEntries(
    Array.from(toolNames).map(toolName => [toolName, { toModelOutput }])
  );

  return yield* Effect.promise(() =>
    convertToModelMessages(
      result.filter(msg => msg.parts.some(part => part.type !== 'step-start')),
      {
        //@ts-expect-error (convertToModelMessages expects a ToolSet but only actually needs tools[name]?.toModelOutput)
        tools
      }
    )
  );
});
