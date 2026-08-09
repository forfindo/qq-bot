import { Schema } from 'effect';
import * as SchemaAttachment from './attachment';
import * as SchemaMCP from './mcp';
import * as SchemaAgent from './agent';
import * as SchemaCommand from './command';
import * as SchemaPermission from './permission';
import * as SchemaSkill from './skill';
import { type DeepMutable, NonNegativeInt, PositiveInt } from '@/schema/common';
import { ModelStatus } from '@/schema/provider';

export const ConfigModel = Schema.Struct({
  id: Schema.optional(Schema.String),
  name: Schema.optional(Schema.String),
  family: Schema.optional(Schema.String),
  release_date: Schema.optional(Schema.String),
  attachment: Schema.optional(Schema.Boolean),
  reasoning: Schema.optional(Schema.Boolean),
  temperature: Schema.optional(Schema.Boolean),
  tool_call: Schema.optional(Schema.Boolean),
  interleaved: Schema.optional(
    Schema.Union([
      Schema.Literal(true),
      Schema.Struct({
        field: Schema.Literals(['reasoning_content', 'reasoning_details'])
      })
    ])
  ),
  cost: Schema.optional(
    Schema.Struct({
      input: Schema.Finite,
      output: Schema.Finite,
      cache_read: Schema.optional(Schema.Finite),
      cache_write: Schema.optional(Schema.Finite),
      context_over_200k: Schema.optional(
        Schema.Struct({
          input: Schema.Finite,
          output: Schema.Finite,
          cache_read: Schema.optional(Schema.Finite),
          cache_write: Schema.optional(Schema.Finite)
        })
      )
    })
  ),
  limit: Schema.optional(
    Schema.Struct({
      context: Schema.Finite,
      input: Schema.optional(Schema.Finite),
      output: Schema.Finite
    })
  ),
  modalities: Schema.optional(
    Schema.Struct({
      input: Schema.mutable(
        Schema.Array(Schema.Literals(['text', 'audio', 'image', 'video', 'pdf']))
      ),
      output: Schema.mutable(
        Schema.Array(Schema.Literals(['text', 'audio', 'image', 'video', 'pdf']))
      )
    })
  ),
  experimental: Schema.optional(Schema.Boolean),
  status: Schema.optional(ModelStatus),
  provider: Schema.optional(
    Schema.Struct({ npm: Schema.optional(Schema.String), api: Schema.optional(Schema.String) })
  ),
  options: Schema.optional(Schema.Record(Schema.String, Schema.Any)),
  headers: Schema.optional(Schema.Record(Schema.String, Schema.String)),
  variants: Schema.optional(
    Schema.Record(
      Schema.String,
      Schema.StructWithRest(
        Schema.Struct({
          disabled: Schema.optional(Schema.Boolean).annotate({
            description: 'Disable this variant for the model'
          })
        }),
        [Schema.Record(Schema.String, Schema.Any)]
      )
    ).annotate({ description: 'Variant-specific configuration' })
  )
});

export const ConfigProvider = Schema.Struct({
  api: Schema.optional(Schema.String),
  name: Schema.optional(Schema.String),
  env: Schema.optional(Schema.mutable(Schema.Array(Schema.String))),
  id: Schema.optional(Schema.String),
  npm: Schema.optional(Schema.String),
  whitelist: Schema.optional(Schema.mutable(Schema.Array(Schema.String))),
  blacklist: Schema.optional(Schema.mutable(Schema.Array(Schema.String))),
  options: Schema.optional(
    Schema.StructWithRest(
      Schema.Struct({
        apiKey: Schema.optional(Schema.String),
        baseURL: Schema.optional(Schema.String),
        enterpriseUrl: Schema.optional(Schema.String).annotate({
          description: 'GitHub Enterprise URL for copilot authentication'
        }),
        setCacheKey: Schema.optional(Schema.Boolean).annotate({
          description: 'Enable promptCacheKey for this provider (default false)'
        }),
        timeout: Schema.optional(
          Schema.Union([PositiveInt, Schema.Literal(false)]).annotate({
            description:
              'Timeout in milliseconds for requests to this provider. Default is 300000 (5 minutes). Set to false to disable timeout.'
          })
        ).annotate({
          description:
            'Timeout in milliseconds for requests to this provider. Default is 300000 (5 minutes). Set to false to disable timeout.'
        }),
        chunkTimeout: Schema.optional(PositiveInt).annotate({
          description:
            'Timeout in milliseconds between streamed SSE chunks for this provider. If no chunk arrives within this window, the request is aborted.'
        })
      }),
      [Schema.Record(Schema.String, Schema.Unknown)]
    )
  ),
  models: Schema.optional(Schema.Record(Schema.String, ConfigModel))
}).annotate({ identifier: 'ProviderConfig' });
export type ConfigProvider = Schema.Schema.Type<typeof ConfigProvider>;

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
        description:
          'Number of recent user turns, including their following assistant/tool responses, to keep verbatim during compaction (default: 2)'
      }),
      preserve_recent_tokens: Schema.optional(NonNegativeInt).annotate({
        description:
          'Maximum number of tokens from recent turns to preserve verbatim after compaction'
      }),
      reserved: Schema.optional(NonNegativeInt).annotate({
        description:
          'Token buffer for compaction. Leaves enough window to avoid overflow during compaction.'
      })
    })
  ),
  disabled_providers: Schema.optional(Schema.mutable(Schema.Array(Schema.String))).annotate({
    description: 'Disable providers that are loaded automatically'
  }),
  skills: Schema.optional(SchemaSkill.ConfigInfo).annotate({
    description: 'Additional skill folder paths'
  }),
  enabled_providers: Schema.optional(Schema.mutable(Schema.Array(Schema.String))).annotate({
    description:
      'When set, ONLY these providers will be enabled. All other providers will be ignored'
  }),
  model: Schema.optional(Schema.String).annotate({
    description: 'Model to use in the format of provider/model, eg anthropic/claude-2'
  }),
  small_model: Schema.optional(Schema.String).annotate({
    description:
      'Small model to use for tasks like title generation in the format of provider/model'
  }),
  default_agent: Schema.optional(Schema.String).annotate({
    description:
      "Default agent to use when none is specified. Must be a primary agent. Falls back to 'build' if not set or if the specified agent is invalid."
  }),
  agent: Schema.optional(
    Schema.StructWithRest(
      Schema.Struct({
        // primary
        plan: Schema.optional(SchemaAgent.ConfigInfo),
        build: Schema.optional(SchemaAgent.ConfigInfo),
        // subagent
        general: Schema.optional(SchemaAgent.ConfigInfo),
        explore: Schema.optional(SchemaAgent.ConfigInfo),
        // specialized
        title: Schema.optional(SchemaAgent.ConfigInfo),
        summary: Schema.optional(SchemaAgent.ConfigInfo),
        compaction: Schema.optional(SchemaAgent.ConfigInfo)
      }),
      [Schema.Record(Schema.String, SchemaAgent.ConfigInfo)]
    )
  ).annotate({ description: 'Agent configuration, see https://opencode.ai/docs/agents' }),
  provider: Schema.optional(Schema.Record(Schema.String, ConfigProvider)).annotate({
    description: 'Custom provider configurations and model overrides'
  }),
  tool_output: Schema.optional(
    Schema.Struct({
      max_lines: Schema.optional(PositiveInt).annotate({
        description:
          'Maximum lines of tool output before it is truncated and saved to disk (default: 2000)'
      }),
      max_bytes: Schema.optional(PositiveInt).annotate({
        description:
          'Maximum bytes of tool output before it is truncated and saved to disk (default: 51200)'
      })
    })
  ).annotate({
    description:
      'Thresholds for truncating tool output. When output exceeds either limit, the full text is written to the truncation directory and a preview is returned.'
  }),
  mode: Schema.optional(
    Schema.StructWithRest(
      Schema.Struct({
        build: Schema.optional(SchemaAgent.ConfigInfo),
        plan: Schema.optional(SchemaAgent.ConfigInfo)
      }),
      [Schema.Record(Schema.String, SchemaAgent.ConfigInfo)]
    )
  ).annotate({ description: '@deprecated Use `agent` field instead.' }),
  mcp: Schema.optional(
    Schema.Record(
      Schema.String,
      Schema.Union([SchemaMCP.Info, Schema.Struct({ enabled: Schema.Boolean })])
    )
  ).annotate({
    description: 'MCP (Model Context Protocol) server configurations'
  }),
  permission: Schema.optional(SchemaPermission.Info),
  instructions: Schema.optional(Schema.mutable(Schema.Array(Schema.String))).annotate({
    description: 'Additional instruction files or patterns to include'
  }),
  attachment: Schema.optional(SchemaAttachment.Info).annotate({
    description:
      'Attachment processing configuration, including image size limits and resizing behavior'
  }),
  tools: Schema.optional(Schema.Record(Schema.String, Schema.Boolean)).annotate({
    description: 'Tool activation selection'
  }),
  experimental: Schema.optional(
    Schema.Struct({
      mcp_timeout: Schema.optional(PositiveInt).annotate({
        description: 'Timeout in milliseconds for model context protocol (MCP) requests'
      })
    })
  )
}).annotate({ identifier: 'Config' });
export type Info = DeepMutable<Schema.Schema.Type<typeof Info>>;
