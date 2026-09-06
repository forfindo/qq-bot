import { Schema } from 'effect';
import { type DeepMutable, optionalOmitUndefined, withStatics } from '@/schema/common';

const ProviderApiInfo = Schema.Struct({
  id: Schema.String,
  url: Schema.String,
  npm: Schema.String
});

const ProviderModalities = Schema.Struct({
  text: Schema.Boolean,
  audio: Schema.Boolean,
  image: Schema.Boolean,
  video: Schema.Boolean,
  pdf: Schema.Boolean
});

const ProviderInterleaved = Schema.Union([
  Schema.Boolean,
  Schema.Struct({
    field: Schema.Literals(['reasoning_content', 'reasoning_details'])
  })
]);

const ProviderCapabilities = Schema.Struct({
  temperature: Schema.Boolean,
  reasoning: Schema.Boolean,
  attachment: Schema.Boolean,
  toolcall: Schema.Boolean,
  input: ProviderModalities,
  output: ProviderModalities,
  interleaved: ProviderInterleaved
});

const ProviderCacheCost = Schema.Struct({
  read: Schema.Finite,
  write: Schema.Finite
});

const ProviderCostTier = Schema.Struct({
  input: Schema.Finite,
  output: Schema.Finite,
  cache: ProviderCacheCost,
  tier: Schema.Struct({
    type: Schema.Literal('context'),
    size: Schema.Finite
  })
});

const ProviderCost = Schema.Struct({
  input: Schema.Finite,
  output: Schema.Finite,
  cache: ProviderCacheCost,
  tiers: optionalOmitUndefined(Schema.Array(ProviderCostTier)),
  experimentalOver200K: optionalOmitUndefined(
    Schema.Struct({
      input: Schema.Finite,
      output: Schema.Finite,
      cache: ProviderCacheCost
    })
  )
});

const ProviderLimit = Schema.Struct({
  context: Schema.Finite,
  input: optionalOmitUndefined(Schema.Finite),
  output: Schema.Finite
});

export const ProviderID = Schema.String.pipe(
  Schema.brand('ProviderID'),
  withStatics(schema => ({
    opencode: schema.make('opencode'),
    anthropic: schema.make('anthropic'),
    openai: schema.make('openai'),
    google: schema.make('google'),
    googleVertex: schema.make('google-vertex'),
    githubCopilot: schema.make('github-copilot'),
    amazonBedrock: schema.make('amazon-bedrock'),
    azure: schema.make('azure'),
    openrouter: schema.make('openrouter'),
    mistral: schema.make('mistral'),
    gitlab: schema.make('gitlab')
  }))
);
export type ProviderID = typeof ProviderID.Type;

export const ModelID = Schema.String.pipe(Schema.brand('ModelID'));
export type ModelID = typeof ModelID.Type;

export const VariantID = Schema.String.pipe(Schema.brand('VariantID'));
export type VariantID = typeof VariantID.Type;

export const ModelRef = Schema.Struct({
  providerID: ProviderID,
  modelID: ModelID,
  variant: VariantID.pipe(optionalOmitUndefined)
}).annotate({ identifier: 'Model.Ref' });
export type ModelRef = typeof ModelRef.Type;

export const ModelStatus = Schema.Literals(['alpha', 'beta', 'deprecated', 'active']);
export type ModelStatus = typeof ModelStatus.Type;

export const Model = Schema.Struct({
  id: ModelID,
  providerID: ProviderID,
  api: ProviderApiInfo,
  name: Schema.String,
  family: optionalOmitUndefined(Schema.String),
  capabilities: ProviderCapabilities,
  cost: ProviderCost,
  limit: ProviderLimit,
  status: ModelStatus,
  options: Schema.Record(Schema.String, Schema.Any),
  headers: Schema.Record(Schema.String, Schema.String),
  release_date: Schema.String,
  variants: optionalOmitUndefined(
    Schema.Record(Schema.String, Schema.Record(Schema.String, Schema.Any))
  )
}).annotate({ identifier: 'Model' });
export type Model = DeepMutable<Schema.Schema.Type<typeof Model>>;

export const Info = Schema.Struct({
  id: ProviderID,
  name: Schema.String,
  source: Schema.Literals(['env', 'config', 'custom', 'api']),
  env: Schema.Array(Schema.String),
  key: optionalOmitUndefined(Schema.String),
  options: Schema.Record(Schema.String, Schema.Unknown),
  models: Schema.Record(Schema.String, Model)
}).annotate({ identifier: 'Provider' });
export type Info = DeepMutable<Schema.Schema.Type<typeof Info>>;

// Error
export class ModelNotFoundError extends Schema.TaggedErrorClass<ModelNotFoundError>()(
  'ProviderModelNotFoundError',
  {
    providerID: ProviderID,
    modelID: ModelID,
    suggestions: Schema.optional(Schema.Array(Schema.String)),
    cause: Schema.optional(Schema.Defect())
  }
) {
  static isInstance(input: unknown): input is ModelNotFoundError {
    return input instanceof ModelNotFoundError;
  }
}

export class InitError extends Schema.TaggedErrorClass<InitError>()('ProviderInitError', {
  providerID: ProviderID,
  cause: Schema.optional(Schema.Defect())
}) {
  static isInstance(input: unknown): input is InitError {
    return input instanceof InitError;
  }
}

export type Error = ModelNotFoundError | InitError;
