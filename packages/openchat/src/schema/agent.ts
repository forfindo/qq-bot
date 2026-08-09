import { Schema, SchemaGetter } from 'effect';
import { type DeepMutable, PositiveInt } from './common';
import * as SchemaPermission from './permission';
import * as SchemaProvider from './provider';

const AgentSchema = Schema.StructWithRest(
  Schema.Struct({
    model: Schema.optional(Schema.String),
    variant: Schema.optional(Schema.String).annotate({
      description:
        "Default model variant for this agent (applies only when using the agent's configured model)."
    }),
    temperature: Schema.optional(Schema.Finite),
    top_p: Schema.optional(Schema.Finite),
    prompt: Schema.optional(Schema.String),
    tools: Schema.optional(Schema.Record(Schema.String, Schema.Boolean)).annotate({
      description: "@deprecated Use 'permission' field instead"
    }),
    disable: Schema.optional(Schema.Boolean),
    description: Schema.optional(Schema.String).annotate({
      description: 'Description of when to use the agent'
    }),
    mode: Schema.optional(Schema.Literals(['subagent', 'primary', 'all'])),
    hidden: Schema.optional(Schema.Boolean).annotate({
      description:
        'Hide this subagent from the @ autocomplete menu (default: false, only applies to mode: subagent)'
    }),
    options: Schema.optional(Schema.Record(Schema.String, Schema.Unknown)),
    steps: Schema.optional(PositiveInt).annotate({
      description: 'Maximum number of agentic iterations before forcing text-only response'
    }),
    permission: Schema.optional(SchemaPermission.Info)
  }),
  [Schema.Record(Schema.String, Schema.Unknown)]
);

const KNOWN_KEYS = new Set([
  'name',
  'model',
  'variant',
  'prompt',
  'description',
  'temperature',
  'top_p',
  'mode',
  'hidden',
  'color',
  'steps',
  'options',
  'permission',
  'disable',
  'tools'
]);

// Post-parse normalisation:
//  - Promote any unknown-but-present keys into `options` so they survive the
//    round-trip in a well-known field.
//  - Translate the deprecated `tools: { name: boolean }` map into the new
//    `permission` shape (write-adjacent tools collapse into `permission.edit`).
//  - Coalesce `steps ?? maxSteps` so downstream can ignore the deprecated alias.
const normalize = (
  agent: Schema.Schema.Type<typeof AgentSchema>
): Schema.Schema.Type<typeof AgentSchema> => {
  const options: Record<string, unknown> = { ...agent.options };
  for (const [key, value] of Object.entries(agent)) {
    if (!KNOWN_KEYS.has(key)) {
      options[key] = value;
    }
  }

  const permission: SchemaPermission.Info = {};
  for (const [tool, enabled] of Object.entries(agent.tools ?? {})) {
    const action = enabled ? 'allow' : 'deny';
    if (tool === 'write' || tool === 'edit' || tool === 'patch') {
      permission.edit = action;
      continue;
    }
    permission[tool] = action;
  }
  Object.assign(permission, agent.permission);

  const steps = agent.steps;
  return { ...agent, options, permission, ...(steps !== void 0 ? { steps } : {}) };
};

export const ConfigInfo = AgentSchema.pipe(
  Schema.decode({
    decode: SchemaGetter.transform(normalize),
    encode: SchemaGetter.passthrough({ strict: false })
  })
).annotate({ identifier: 'AgentConfig' });
export type ConfigInfo = Schema.Schema.Type<typeof ConfigInfo>;

export const Info = Schema.Struct({
  name: Schema.String,
  description: Schema.optional(Schema.String),
  mode: Schema.Literals(['subagent', 'primary', 'all']),
  native: Schema.optional(Schema.Boolean),
  hidden: Schema.optional(Schema.Boolean),
  topP: Schema.optional(Schema.Finite),
  temperature: Schema.optional(Schema.Finite),
  permission: SchemaPermission.Ruleset,
  model: Schema.optional(
    Schema.Struct({
      modelID: SchemaProvider.ModelID,
      providerID: SchemaProvider.ProviderID
    })
  ),
  variant: Schema.optional(Schema.String),
  prompt: Schema.optional(Schema.String),
  options: Schema.Record(Schema.String, Schema.Unknown),
  steps: Schema.optional(Schema.Finite)
}).annotate({ identifier: 'Agent' });
export type Info = DeepMutable<Schema.Schema.Type<typeof Info>>;
