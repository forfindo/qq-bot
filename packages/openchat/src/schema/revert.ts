import { Schema } from 'effect';
import { MessageID } from '@/schema/message';
import { optionalOmitUndefined } from '@/schema/common';
import { FileDiff } from '@/schema/snapshot';

export const State = Schema.Struct({
  messageID: MessageID,
  partID: Schema.String.pipe(optionalOmitUndefined),
  snapshot: Schema.String.pipe(optionalOmitUndefined),
  diff: Schema.String.pipe(optionalOmitUndefined),
  files: Schema.Array(FileDiff).pipe(optionalOmitUndefined)
}).annotate({ identifier: 'Revert.State' });
export type State = Schema.Schema.Type<typeof State>;
