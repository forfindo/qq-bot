import { Effect, Schema } from 'effect';
import { NonNegativeInt } from '@/schema/common';

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
