import { Schema } from 'effect';
import { optionalOmitUndefined } from '@/schema/common';

export const UnknownError = Schema.Struct({
  type: Schema.Literal('unknown'),
  message: Schema.String
}).annotate({ identifier: 'Session.Error.Unknown' });
export type UnknownError = Schema.Schema.Type<typeof UnknownError>;

export const RetryError = Schema.Struct({
  message: Schema.String,
  statusCode: Schema.Finite.pipe(optionalOmitUndefined),
  isRetryable: Schema.Boolean,
  responseHeaders: Schema.Record(Schema.String, Schema.String).pipe(optionalOmitUndefined),
  responseBody: Schema.String.pipe(optionalOmitUndefined),
  metadata: Schema.Record(Schema.String, Schema.String).pipe(optionalOmitUndefined)
}).annotate({
  identifier: 'session.next.retry_error'
});
export type RetryError = Schema.Schema.Type<typeof RetryError>;
