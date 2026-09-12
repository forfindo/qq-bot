import { Schema } from 'effect';
import { type DeepMutable, optionalOmitUndefined, withStatics } from '@/schema/common';
import type { APICallError } from 'ai';
import { iife } from '@/utils';
import { STATUS_CODES } from 'http';

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

export type ParsedStreamError =
  | {
      type: 'context_overflow';
      message: string;
      responseBody: string;
    }
  | {
      type: 'api_error';
      message: string;
      isRetryable: boolean;
      responseBody: string;
    };

// Adapted from overflow detection patterns in:
// https://github.com/badlogic/pi-mono/blob/main/packages/ai/src/utils/overflow.ts
const OVERFLOW_PATTERNS = [
  /prompt is too long/i, // Anthropic
  /input is too long for requested model/i, // Amazon Bedrock
  /exceeds the context window/i, // OpenAI (Completions + Responses API message text)
  /input token count.*exceeds the maximum/i, // Google (Gemini)
  /maximum prompt length is \d+/i, // xAI (Grok)
  /reduce the length of the messages/i, // Groq
  /maximum context length is \d+ tokens/i, // OpenRouter, DeepSeek, vLLM
  /exceeds the limit of \d+/i, // GitHub Copilot
  /exceeds the available context size/i, // llama.cpp server
  /greater than the context length/i, // LM Studio
  /context window exceeds limit/i, // MiniMax
  /exceeded model token limit/i, // Kimi For Coding, Moonshot
  /context[_ ]length[_ ]exceeded/i, // Generic fallback
  /request entity too large/i, // HTTP 413
  /context length is only \d+ tokens/i, // vLLM
  /input length.*exceeds.*context length/i, // vLLM
  /prompt too long; exceeded (?:max )?context length/i, // Ollama explicit overflow error
  /too large for model with \d+ maximum context length/i, // Mistral
  /model_context_window_exceeded/i // z.ai non-standard finish_reason surfaced as error text
];

const isOpenAiErrorRetryable = (e: APICallError) => {
  const status = e.statusCode;
  if (!status) {
    return e.isRetryable;
  }
  // openai sometimes returns 404 for models that are actually available
  return status === 404 || e.isRetryable;
};

// Providers not reliably handled in this function:
// - z.ai: can accept overflow silently (needs token-count/context-window checks)
const isOverflow = (message: string) => {
  if (OVERFLOW_PATTERNS.some(p => p.test(message))) {
    return true;
  }

  // Providers/status patterns handled outside of regex list:
  // - Cerebras: often returns "400 (no body)" / "413 (no body)"
  // - Mistral: often returns "400 (no body)" / "413 (no body)"
  return /^4(00|13)\s*(status code)?\s*\(no body\)/i.test(message);
};

const message = (providerID: ProviderID, e: APICallError) => {
  return iife(() => {
    const msg = e.message;
    if (msg === '') {
      if (e.responseBody) {
        return e.responseBody;
      }
      if (e.statusCode) {
        const err = STATUS_CODES[e.statusCode];
        if (err) {
          return err;
        }
      }
      return 'Unknown error';
    }

    if (!e.responseBody || (e.statusCode && msg !== STATUS_CODES[e.statusCode])) {
      return msg;
    }

    try {
      const body: unknown = JSON.parse(e.responseBody);
      // try to extract common error message fields
      // @ts-ignore
      // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
      const errMsg: unknown = body.message || body.error || body.error?.message;
      if (errMsg && typeof errMsg === 'string') {
        return `${msg}: ${errMsg}`;
      }
    } catch {
      /* empty */
    }

    // If responseBody is HTML (e.g. from a gateway or proxy error page),
    // provide a human-readable message instead of dumping raw markup
    if (/^\s*<!doctype|^\s*<html/i.test(e.responseBody)) {
      if (e.statusCode === 401) {
        return 'Unauthorized: request was blocked by a gateway or proxy. Your authentication token may be missing or expired — try running `opencode auth login <your provider URL>` to re-authenticate.';
      }
      if (e.statusCode === 403) {
        return 'Forbidden: request was blocked by a gateway or proxy. You may not have permission to access this resource — check your account and provider settings.';
      }
      return msg;
    }

    return `${msg}: ${e.responseBody}`;
  }).trim();
};

const json = (input: unknown) => {
  if (typeof input === 'string') {
    try {
      const result: unknown = JSON.parse(input);
      if (result && typeof result === 'object') {
        return result as {
          type: string;
          message?: string;
          error?: { code: string; message: string };
        };
      }
      return void 0;
    } catch {
      return void 0;
    }
  }
  if (typeof input === 'object' && input !== null) {
    return input as { type: string; message?: string; error?: { code: string; message: string } };
  }
  return void 0;
};

export const parseStreamError = (input: unknown): ParsedStreamError | undefined => {
  const raw = json(input);
  const body = typeof raw?.message === 'string' ? (json(raw.message) ?? raw) : raw;
  if (!body) {
    return;
  }

  const responseBody = JSON.stringify(body);
  if (body.type !== 'error') {
    return;
  }

  switch (body?.error?.code) {
    case 'context_length_exceeded':
      return {
        type: 'context_overflow',
        message: 'Input exceeds context window of this model',
        responseBody
      };
    case 'insufficient_quota':
      return {
        type: 'api_error',
        message: 'Quota exceeded. Check your plan and billing details.',
        isRetryable: false,
        responseBody
      };
    case 'usage_not_included':
      return {
        type: 'api_error',
        message:
          'To use Codex with your ChatGPT plan, upgrade to Plus: https://chatgpt.com/explore/plus.',
        isRetryable: false,
        responseBody
      };
    case 'invalid_prompt':
      return {
        type: 'api_error',
        message:
          typeof body?.error?.message === 'string' ? body?.error?.message : 'Invalid prompt.',
        isRetryable: false,
        responseBody
      };
    case 'server_is_overloaded':
    case 'server_error':
      return {
        type: 'api_error',
        message: typeof body?.error?.message === 'string' ? body?.error?.message : 'Server error.',
        isRetryable: true,
        responseBody
      };
  }
};

export type ParsedAPICallError =
  | {
      type: 'context_overflow';
      message: string;
      responseBody?: string;
    }
  | {
      type: 'api_error';
      message: string;
      statusCode?: number;
      isRetryable: boolean;
      responseHeaders?: Record<string, string>;
      responseBody?: string;
      metadata?: Record<string, string>;
    };

export const parseAPICallError = (input: {
  providerID: ProviderID;
  error: APICallError;
}): ParsedAPICallError => {
  const m = message(input.providerID, input.error);
  const body = json(input.error.responseBody);
  if (
    isOverflow(m) ||
    input.error.statusCode === 413 ||
    body?.error?.code === 'context_length_exceeded'
  ) {
    return {
      type: 'context_overflow',
      message: m,
      responseBody: input.error.responseBody
    };
  }

  const metadata = input.error.url ? { url: input.error.url } : void 0;
  return {
    type: 'api_error',
    message: m,
    statusCode: input.error.statusCode,
    isRetryable: input.providerID.startsWith('openai')
      ? isOpenAiErrorRetryable(input.error)
      : input.error.isRetryable,
    responseHeaders: input.error.responseHeaders,
    responseBody: input.error.responseBody,
    metadata
  };
};
