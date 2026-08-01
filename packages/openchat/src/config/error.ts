import { AppError } from '@/utils';
import { Schema } from 'effect';

const Issue = Schema.StructWithRest(
  Schema.Struct({
    message: Schema.String,
    path: Schema.Array(Schema.String)
  }),
  [Schema.Record(Schema.String, Schema.Unknown)]
);

export const JsonError = AppError.NamedError.create('ConfigJsonError', {
  path: Schema.String,
  message: Schema.optional(Schema.String)
});

export const InvalidError = AppError.NamedError.create('ConfigInvalidError', {
  path: Schema.String,
  issues: Schema.optional(Schema.Array(Issue)),
  message: Schema.optional(Schema.String)
});

export const FrontmatterError = AppError.NamedError.create('ConfigFrontmatterError', {
  path: Schema.String,
  message: Schema.String
});
