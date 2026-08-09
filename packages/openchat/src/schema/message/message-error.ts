import { Schema } from 'effect';
import { NamedError } from '@/utils/error';
import { NonNegativeInt } from '@/schema/common';

export const OutputLengthError = NamedError.create('MessageOutputLengthError', {});

export const AuthError = NamedError.create('ProviderAuthError', {
  providerID: Schema.String,
  message: Schema.String
});

export const Shared = [
  AuthError.EffectSchema,
  NamedError.Unknown.EffectSchema,
  OutputLengthError.EffectSchema
] as const;
export const SharedSchema = Schema.Union(Shared);

export const StructuredOutputError = NamedError.create('StructuredOutputError', {
  message: Schema.String,
  retries: NonNegativeInt
});

export const AbortedError = NamedError.create('MessageAbortedError', { message: Schema.String });

export const APIError = NamedError.create('APIError', {
  message: Schema.String,
  statusCode: Schema.optional(NonNegativeInt),
  isRetryable: Schema.Boolean,
  responseHeaders: Schema.optional(Schema.Record(Schema.String, Schema.String)),
  responseBody: Schema.optional(Schema.String),
  metadata: Schema.optional(Schema.Record(Schema.String, Schema.String))
});
export type APIError = Schema.Schema.Type<typeof APIError.Schema>;

export const ContextOverflowError = NamedError.create('ContextOverflowError', {
  message: Schema.String,
  responseBody: Schema.optional(Schema.String)
});
