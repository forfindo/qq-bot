import { Schema } from 'effect';

export const FileDiff = Schema.Struct({
  // Optional because legacy/imported `summary_diffs` on disk may omit
  // file details and patch text. Required Schema rejected the whole
  // session response and broke session loading on Desktop.
  file: Schema.optional(Schema.String),
  patch: Schema.optional(Schema.String),
  additions: Schema.Finite,
  deletions: Schema.Finite,
  status: Schema.optional(Schema.Literals(['added', 'deleted', 'modified']))
}).annotate({ identifier: 'SnapshotFileDiff' });
export type FileDiff = typeof FileDiff.Type;
