import { Effect, Schema, SchemaGetter, Types } from 'effect';
import { NonNegativeInt, withStatics } from '@/schema/common';
import { Identifier } from '@/id';
import { ModelID, ProviderID } from '@/schema/provider';
import {
  AbortedError,
  APIError,
  ContextOverflowError,
  Shared,
  StructuredOutputError
} from './message-error';
import { FileDiff } from '@/schema/snapshot';
import { SessionID } from '@/schema/session';

export const MessageID = Schema.String.check(Schema.isStartsWith('msg')).pipe(
  Schema.brand('MessageID'),
  withStatics(s => ({
    ascending: (id?: string) => s.make(Identifier.ascending('message', id))
  }))
);
export type MessageID = Schema.Schema.Type<typeof MessageID>;

const AssistantErrorSchema = Schema.Union([
  ...Shared,
  AbortedError.EffectSchema,
  StructuredOutputError.EffectSchema,
  ContextOverflowError.EffectSchema,
  APIError.EffectSchema
]).annotate({ discriminator: 'name' });
type AssistantError = Schema.Schema.Type<typeof AssistantErrorSchema>;

const messageBase = {
  id: MessageID,
  sessionID: SessionID
};

export const Assistant = Schema.Struct({
  ...messageBase,
  role: Schema.Literal('assistant'),
  time: Schema.Struct({
    created: NonNegativeInt,
    completed: Schema.optional(NonNegativeInt)
  }),
  error: Schema.optional(AssistantErrorSchema),
  parentID: MessageID,
  modelID: ModelID,
  providerID: ProviderID,
  /**
   * @deprecated
   */
  mode: Schema.String,
  agent: Schema.String,
  path: Schema.Struct({
    cwd: Schema.String,
    root: Schema.String
  }),
  summary: Schema.optional(Schema.Boolean),
  cost: Schema.Finite,
  tokens: Schema.Struct({
    total: Schema.optional(Schema.Finite),
    input: Schema.Finite,
    output: Schema.Finite,
    reasoning: Schema.Finite,
    cache: Schema.Struct({
      read: Schema.Finite,
      write: Schema.Finite
    })
  }),
  structured: Schema.optional(Schema.Any),
  variant: Schema.optional(Schema.String),
  finish: Schema.optional(Schema.String)
}).annotate({ identifier: 'AssistantMessage' });
export type Assistant = Omit<Types.DeepMutable<Schema.Schema.Type<typeof Assistant>>, 'error'> & {
  error?: AssistantError;
};

export class OutputFormatText extends Schema.Class<OutputFormatText>('OutputFormatText')({
  type: Schema.Literal('text')
}) {}

export class OutputFormatJsonSchema extends Schema.Class<OutputFormatJsonSchema>(
  'OutputFormatJsonSchema'
)({
  type: Schema.Literal('json_schema'),
  schema: Schema.Record(Schema.String, Schema.Any).annotate({ identifier: 'JSONSchema' }),
  retryCount: NonNegativeInt.pipe(Schema.optional, Schema.withDecodingDefault(Effect.succeed(2)))
}) {}

export const Format = Schema.Union([OutputFormatText, OutputFormatJsonSchema]).annotate({
  discriminator: 'type',
  identifier: 'OutputFormat'
});
export type OutputFormat = Schema.Schema.Type<typeof Format>;

export const User = Schema.Struct({
  ...messageBase,
  role: Schema.Literal('user'),
  time: Schema.Struct({
    created: NonNegativeInt
  }),
  format: Schema.optional(Format),
  summary: Schema.optional(
    Schema.Struct({
      title: Schema.optional(Schema.String),
      body: Schema.optional(Schema.String),
      diffs: Schema.Array(FileDiff)
    })
  ),
  agent: Schema.String,
  model: Schema.Struct({
    providerID: ProviderID,
    modelID: ModelID,
    variant: Schema.optional(Schema.String)
  }),
  system: Schema.optional(Schema.String),
  tools: Schema.optional(Schema.Record(Schema.String, Schema.Boolean))
}).annotate({ identifier: 'UserMessage' });
export type User = Types.DeepMutable<Schema.Schema.Type<typeof User>>;

export const Info = Schema.Union([User, Assistant]).annotate({
  discriminator: 'role',
  identifier: 'Message'
});
export type Info = User | Assistant;

const _Cursor = Schema.Struct({
  id: MessageID,
  time: Schema.Finite.check(Schema.isGreaterThanOrEqualTo(0))
});

export const Cursor = _Cursor.pipe(
  Schema.encodeTo(Schema.String, {
    decode: SchemaGetter.transform((input: string) =>
      Schema.decodeUnknownSync(_Cursor)(
        JSON.parse(Buffer.from(input, 'base64url').toString('utf8'))
      )
    ),
    encode: SchemaGetter.transform(input =>
      Buffer.from(JSON.stringify(input)).toString('base64url')
    )
  })
);
export type Cursor = typeof Cursor.Type;

export const decodeCursor = Schema.decodeUnknownSync(Cursor);

export const encodeCursor = Schema.encodeSync(Cursor);
