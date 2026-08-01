import { Schema } from 'effect';
import { NonNegativeInt } from '@/schema/common';

export const Oauth = Schema.Struct({
  type: Schema.Literal('oauth'),
  refresh: Schema.String,
  access: Schema.String,
  expires: NonNegativeInt,
  accountId: Schema.optional(Schema.String),
  enterpriseUrl: Schema.optional(Schema.String)
});
export type Oauth = Schema.Schema.Type<typeof Oauth>;

export const Api = Schema.Struct({
  type: Schema.Literal('api'),
  key: Schema.String,
  metadata: Schema.optional(Schema.Record(Schema.String, Schema.String))
});
export type Api = Schema.Schema.Type<typeof Api>;

export const WellKnown = Schema.Struct({
  type: Schema.Literal('wellknown'),
  key: Schema.String,
  token: Schema.String
});
export type WellKnown = Schema.Schema.Type<typeof WellKnown>;

export const Info = Schema.Union([Oauth, Api, WellKnown]).annotate({
  discriminator: 'type',
  identifier: 'Auth'
});
export type Info = Schema.Schema.Type<typeof Info>;

// Error
export class AuthError extends Schema.TaggedErrorClass<AuthError>()('AuthError', {
  message: Schema.String,
  cause: Schema.optional(Schema.Defect)
}) {}
