import { Schema, Types } from 'effect';
import * as SchemaAttachment from './attachment';
import * as SchemaMCP from './mcp';
import * as SchemaAgent from './agent';
import * as SchemaCommand from './command';
import * as SchemaPermission from './permission';
import { NonNegativeInt } from '@/schema/common';

export const Info = Schema.Struct({
  $schema: Schema.optional(Schema.String).annotate({
    description: 'JSON schema reference for configuration validation'
  }),
  command: Schema.optional(Schema.Record(Schema.String, SchemaCommand.Info)).annotate({
    description: 'Command configuration, see https://opencode.ai/docs/commands'
  }),
  compaction: Schema.optional(
    Schema.Struct({
      auto: Schema.optional(Schema.Boolean).annotate({
        description: 'Enable automatic compaction when context is full (default: true)'
      }),
      prune: Schema.optional(Schema.Boolean).annotate({
        description: 'Enable pruning of old tool outputs (default: true)'
      }),
      tail_turns: Schema.optional(NonNegativeInt).annotate({
        description: 'Number of recent user turns, including their following assistant/tool responses, to keep verbatim during compaction (default: 2)'
      }),
      preserve_recent_tokens: Schema.optional(NonNegativeInt).annotate({
        description: 'Maximum number of tokens from recent turns to preserve verbatim after compaction'
      }),
      reserved: Schema.optional(NonNegativeInt).annotate({
        description: 'Token buffer for compaction. Leaves enough window to avoid overflow during compaction.'
      })
    })
  ),
  model: Schema.optional(Schema.String).annotate({
    description: 'Model to use in the format of provider/model, eg anthropic/claude-2'
  }),
  agent: Schema.optional(
    Schema.StructWithRest(
      Schema.Struct({
        // primary
        plan: Schema.optional(SchemaAgent.Info),
        build: Schema.optional(SchemaAgent.Info),
        // subagent
        general: Schema.optional(SchemaAgent.Info),
        explore: Schema.optional(SchemaAgent.Info),
        scout: Schema.optional(SchemaAgent.Info),
        // specialized
        title: Schema.optional(SchemaAgent.Info),
        summary: Schema.optional(SchemaAgent.Info),
        compaction: Schema.optional(SchemaAgent.Info)
      }),
      [Schema.Record(Schema.String, SchemaAgent.Info)]
    )
  ).annotate({ description: 'Agent configuration, see https://opencode.ai/docs/agents' }),
  provider: Schema.optional(Schema.Record(Schema.String, Schema.Struct({}))).annotate({ description: 'Custom provider configurations and model overrides' }),
  mode: Schema.optional(
    Schema.StructWithRest(
      Schema.Struct({
        build: Schema.optional(SchemaAgent.Info),
        plan: Schema.optional(SchemaAgent.Info)
      }),
      [Schema.Record(Schema.String, SchemaAgent.Info)]
    )
  ).annotate({ description: '@deprecated Use `agent` field instead.' }),
  mcp: Schema.optional(Schema.Record(Schema.String, Schema.Union([SchemaMCP.Info, Schema.Struct({ enabled: Schema.Boolean })]))).annotate({
    description: 'MCP (Model Context Protocol) server configurations'
  }),
  permission: Schema.optional(SchemaPermission.Info),
  instructions: Schema.optional(Schema.mutable(Schema.Array(Schema.String))).annotate({ description: 'Additional instruction files or patterns to include' }),
  attachment: Schema.optional(SchemaAttachment.Info).annotate({
    description: 'Attachment processing configuration, including image size limits and resizing behavior'
  }),
  tools: Schema.optional(Schema.Record(Schema.String, Schema.Boolean)).annotate({ description: 'Tool activation selection' })
}).annotate({ identifier: 'Config' });
export type Info = Types.DeepMutable<Schema.Schema.Type<typeof Info>>;
