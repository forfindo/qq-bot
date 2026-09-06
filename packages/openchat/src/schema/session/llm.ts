import { Schema } from 'effect';
import { optionalOmitUndefined } from '@/schema/common';

export const ProviderMetadata = Schema.Record(
  Schema.String,
  Schema.Record(Schema.String, Schema.Unknown)
).annotate({
  identifier: 'LLM.ProviderMetadata'
});
export type ProviderMetadata = Schema.Schema.Type<typeof ProviderMetadata>;

export const ToolTextContent = Schema.Struct({
  type: Schema.Literal('text'),
  text: Schema.String
}).annotate({ identifier: 'Tool.TextContent' });
export type ToolTextContent = Schema.Schema.Type<typeof ToolTextContent>;

export const ToolFileContent = Schema.Struct({
  type: Schema.Literal('file'),
  uri: Schema.String,
  mime: Schema.String,
  name: optionalOmitUndefined(Schema.String)
}).annotate({ identifier: 'Tool.FileContent' });
export type ToolFileContent = Schema.Schema.Type<typeof ToolFileContent>;

export const ToolContent = Schema.Union([ToolTextContent, ToolFileContent])
  .pipe(Schema.toTaggedUnion('type'))
  .annotate({ identifier: 'LLM.ToolContent' });
export type ToolContent = Schema.Schema.Type<typeof ToolContent>;
