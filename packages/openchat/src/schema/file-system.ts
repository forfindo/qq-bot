import { Schema } from 'effect';
import type { PlatformError } from 'effect/PlatformError';

export class FileSystemError extends Schema.TaggedErrorClass<FileSystemError>()('FileSystemError', {
  method: Schema.String,
  cause: Schema.optional(Schema.Defect())
}) {}

export type Error = PlatformError | FileSystemError;
