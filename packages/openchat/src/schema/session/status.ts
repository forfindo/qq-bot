import { Schema } from 'effect';
import { NonNegativeInt } from '@/schema/common';

export const StatusInfo = Schema.Union([
  Schema.Struct({
    type: Schema.Literal('idle')
  }),
  Schema.Struct({
    type: Schema.Literal('retry'),
    attempt: NonNegativeInt,
    message: Schema.String,
    action: Schema.optional(
      Schema.Struct({
        reason: Schema.String,
        provider: Schema.String,
        title: Schema.String,
        message: Schema.String,
        label: Schema.String,
        link: Schema.optional(Schema.String)
      })
    ),
    next: NonNegativeInt
  }),
  Schema.Struct({
    type: Schema.Literal('busy')
  })
]).annotate({ identifier: 'SessionStatus' });
export type StatusInfo = Schema.Schema.Type<typeof StatusInfo>;
