import { Schema } from 'effect';

export class AppProcessError extends Schema.TaggedErrorClass<AppProcessError>()('AppProcessError', {
  command: Schema.String,
  exitCode: Schema.optional(Schema.Number),
  stderr: Schema.optional(Schema.String),
  cause: Schema.optional(Schema.Defect())
}) {}
