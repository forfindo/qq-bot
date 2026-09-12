import { Schema } from 'effect';
import { NamedError } from '@/utils/error';
import { NonNegativeInt } from '@/schema/common';
import type { ProviderID } from '@/schema/provider';
import type { Assistant } from '@/schema/message/message';
import { APICallError, LoadAPIKeyError } from 'ai';
import { ProviderError } from '@/provider';
import { AppError } from '@/utils';

/** Error shape thrown by Bun's fetch() when gzip/br decompression fails mid-stream */
interface FetchDecompressionError extends Error {
  code: 'ZlibError';
  errno: number;
  path: string;
}

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

export const fromError = (
  e: unknown,
  ctx: { providerID: ProviderID; aborted?: boolean }
): NonNullable<Assistant['error']> => {
  switch (true) {
    case e instanceof DOMException && e.name === 'AbortError':
      return new AbortedError(
        { message: e.message },
        {
          cause: e
        }
      ).toObject();
    case OutputLengthError.isInstance(e):
      return e;
    case LoadAPIKeyError.isInstance(e):
      return new AuthError(
        {
          providerID: ctx.providerID,
          message: e.message
        },
        { cause: e }
      ).toObject();
    case (e as { code: string })?.code === 'ECONNRESET':
      return new APIError(
        {
          message: 'Connection reset by server',
          isRetryable: true,
          metadata: {
            code: (e as { code: string }).code ?? '',
            syscall: (e as { syscall?: string }).syscall ?? '',
            message: (e as { message?: string }).message ?? ''
          }
        },
        { cause: e }
      ).toObject();
    case e instanceof Error && (e as FetchDecompressionError).code === 'ZlibError':
      if (ctx.aborted) {
        return new AbortedError({ message: e.message }, { cause: e }).toObject();
      }
      return new APIError(
        {
          message: 'Response decompression failed',
          isRetryable: true,
          metadata: {
            code: (e as FetchDecompressionError).code,
            message: e.message
          }
        },
        { cause: e }
      ).toObject();
    case APICallError.isInstance(e): {
      const parsed = ProviderError.parseAPICallError({
        providerID: ctx.providerID,
        error: e
      });
      if (parsed.type === 'context_overflow') {
        return new ContextOverflowError(
          {
            message: parsed.message,
            responseBody: parsed.responseBody
          },
          { cause: e }
        ).toObject();
      }

      return new APIError(
        {
          message: parsed.message,
          statusCode: parsed.statusCode,
          isRetryable: parsed.isRetryable,
          responseHeaders: parsed.responseHeaders,
          responseBody: parsed.responseBody,
          metadata: parsed.metadata
        },
        { cause: e }
      ).toObject();
    }
    case e instanceof Error:
      return new NamedError.Unknown({ message: AppError.errorMessage(e) }, { cause: e }).toObject();
    default:
      try {
        const parsed = ProviderError.parseStreamError(e);
        if (parsed) {
          if (parsed.type === 'context_overflow') {
            return new ContextOverflowError(
              {
                message: parsed.message,
                responseBody: parsed.responseBody
              },
              { cause: e }
            ).toObject();
          }
          return new APIError(
            {
              message: parsed.message,
              isRetryable: parsed.isRetryable,
              responseBody: parsed.responseBody
            },
            {
              cause: e
            }
          ).toObject();
        }
      } catch {
        /* empty */
      }
      return new NamedError.Unknown({ message: JSON.stringify(e) }, { cause: e }).toObject();
  }
};
