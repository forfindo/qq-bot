import { Schema, Types } from 'effect';
import * as SchemaAttachment from './attachment';
import * as SchemaMCP from './mcp';

export const Info = Schema.Struct({
  model: Schema.optional(Schema.String).annotate({
    description: 'Model to use in the format of provider/model, eg anthropic/claude-2'
  }),
  agent: Schema.optional(Schema.Struct({})).annotate({ description: 'Agent configuration, see https://opencode.ai/docs/agents' }),
  provider: Schema.Record(Schema.String, Schema.Struct({})).annotate({ description: 'Custom provider configurations and model overrides' }),
  mcp: Schema.optional(Schema.Record(Schema.String, Schema.Union([SchemaMCP.Info, Schema.Struct({ enabled: Schema.Boolean })]))).annotate({
    description: 'MCP (Model Context Protocol) server configurations'
  }),
  attachment: Schema.optional(SchemaAttachment.Info).annotate({
    description: 'Attachment processing configuration, including image size limits and resizing behavior'
  }),
  tools: Schema.optional(Schema.Record(Schema.String, Schema.Boolean)).annotate({ description: 'Tool activation selection' })
}).annotate({ identifier: 'Config' });
export type Info = Types.DeepMutable<Schema.Schema.Type<typeof Info>>;
