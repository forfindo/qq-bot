import { Schema } from 'effect';
import { type DeepMutable, NonNegativeInt, Range, withStatics } from '@/schema/common';
import { Identifier } from '@/id';
import { ModelID, ProviderID } from '@/schema/provider';
import { APIError } from './message-error';
import { Info, MessageID } from './message';
import { SessionID } from '@/schema/session';

export const PartID = Schema.String.check(Schema.isStartsWith('prt')).pipe(
  Schema.brand('PartID'),
  withStatics(s => ({
    ascending: (id?: string) => s.make(Identifier.ascending('part', id))
  }))
);
export type PartID = Schema.Schema.Type<typeof PartID>;

const partBase = {
  id: PartID,
  sessionID: SessionID,
  messageID: MessageID
};

const filePartSourceBase = {
  text: Schema.Struct({
    value: Schema.String,
    start: Schema.Finite,
    end: Schema.Finite
  }).annotate({ identifier: 'FilePartSourceText' })
};

export const FileSource = Schema.Struct({
  ...filePartSourceBase,
  type: Schema.Literal('file'),
  path: Schema.String
}).annotate({ identifier: 'FileSource' });

/**
 * @remarks unstable
 */
export const SymbolSource = Schema.Struct({
  ...filePartSourceBase,
  type: Schema.Literal('symbol'),
  path: Schema.String,
  range: Range,
  name: Schema.String,
  kind: NonNegativeInt
}).annotate({ identifier: 'SymbolSource' });

export const ResourceSource = Schema.Struct({
  ...filePartSourceBase,
  type: Schema.Literal('resource'),
  clientName: Schema.String,
  uri: Schema.String
}).annotate({ identifier: 'ResourceSource' });

export const FilePartSource = Schema.Union([FileSource, SymbolSource, ResourceSource]).annotate({
  discriminator: 'type',
  identifier: 'FilePartSource'
});

export const FilePart = Schema.Struct({
  ...partBase,
  type: Schema.Literal('file'),
  mime: Schema.String,
  filename: Schema.optional(Schema.String),
  url: Schema.String,
  source: Schema.optional(FilePartSource)
}).annotate({ identifier: 'FilePart' });
export type FilePart = DeepMutable<Schema.Schema.Type<typeof FilePart>>;

export const TextPart = Schema.Struct({
  ...partBase,
  type: Schema.Literal('text'),
  text: Schema.String,
  synthetic: Schema.optional(Schema.Boolean),
  ignored: Schema.optional(Schema.Boolean),
  time: Schema.optional(
    Schema.Struct({
      start: NonNegativeInt,
      end: Schema.optional(NonNegativeInt)
    })
  ),
  metadata: Schema.optional(Schema.Record(Schema.String, Schema.Unknown))
}).annotate({ identifier: 'TextPart' });
export type TextPart = DeepMutable<Schema.Schema.Type<typeof TextPart>>;

export const SubtaskPart = Schema.Struct({
  ...partBase,
  type: Schema.Literal('subtask'),
  prompt: Schema.String,
  description: Schema.String,
  agent: Schema.String,
  model: Schema.optional(
    Schema.Struct({
      providerID: ProviderID,
      modelID: ModelID
    })
  ),
  command: Schema.optional(Schema.String)
}).annotate({ identifier: 'SubtaskPart' });
export type SubtaskPart = DeepMutable<Schema.Schema.Type<typeof SubtaskPart>>;

export const ReasoningPart = Schema.Struct({
  ...partBase,
  type: Schema.Literal('reasoning'),
  text: Schema.String,
  metadata: Schema.optional(Schema.Record(Schema.String, Schema.Unknown)),
  time: Schema.Struct({
    start: NonNegativeInt,
    end: Schema.optional(NonNegativeInt)
  })
}).annotate({ identifier: 'ReasoningPart' });
export type ReasoningPart = DeepMutable<Schema.Schema.Type<typeof ReasoningPart>>;

export const ToolStatePending = Schema.Struct({
  status: Schema.Literal('pending'),
  input: Schema.Record(Schema.String, Schema.Unknown),
  raw: Schema.String
}).annotate({ identifier: 'ToolStatePending' });
export type ToolStatePending = DeepMutable<Schema.Schema.Type<typeof ToolStatePending>>;

export const ToolStateRunning = Schema.Struct({
  status: Schema.Literal('running'),
  input: Schema.Record(Schema.String, Schema.Unknown),
  title: Schema.optional(Schema.String),
  metadata: Schema.optional(Schema.Record(Schema.String, Schema.Unknown)),
  time: Schema.Struct({
    start: NonNegativeInt
  })
}).annotate({ identifier: 'ToolStateRunning' });
export type ToolStateRunning = DeepMutable<Schema.Schema.Type<typeof ToolStateRunning>>;

export const ToolStateCompleted = Schema.Struct({
  status: Schema.Literal('completed'),
  input: Schema.Record(Schema.String, Schema.Unknown),
  output: Schema.String,
  title: Schema.String,
  metadata: Schema.Record(Schema.String, Schema.Unknown),
  time: Schema.Struct({
    start: NonNegativeInt,
    end: NonNegativeInt,
    compacted: Schema.optional(NonNegativeInt)
  }),
  attachments: Schema.optional(Schema.Array(FilePart))
}).annotate({ identifier: 'ToolStateCompleted' });
export type ToolStateCompleted = DeepMutable<Schema.Schema.Type<typeof ToolStateCompleted>>;

export const ToolStateError = Schema.Struct({
  status: Schema.Literal('error'),
  input: Schema.Record(Schema.String, Schema.Unknown),
  error: Schema.String,
  metadata: Schema.optional(Schema.Record(Schema.String, Schema.Unknown)),
  time: Schema.Struct({
    start: NonNegativeInt,
    end: NonNegativeInt
  })
}).annotate({ identifier: 'ToolStateError' });
export type ToolStateError = DeepMutable<Schema.Schema.Type<typeof ToolStateError>>;

export const ToolState = Schema.Union([
  ToolStatePending,
  ToolStateRunning,
  ToolStateCompleted,
  ToolStateError
]).annotate({
  discriminator: 'status',
  identifier: 'ToolState'
});
export type ToolState = ToolStatePending | ToolStateRunning | ToolStateCompleted | ToolStateError;

export const ToolPart = Schema.Struct({
  ...partBase,
  type: Schema.Literal('tool'),
  callID: Schema.String,
  tool: Schema.String,
  state: ToolState,
  metadata: Schema.optional(Schema.Record(Schema.String, Schema.Unknown))
}).annotate({ identifier: 'ToolPart' });
export type ToolPart = Omit<DeepMutable<Schema.Schema.Type<typeof ToolPart>>, 'state'> & {
  state: ToolState;
};

export const StepStartPart = Schema.Struct({
  ...partBase,
  type: Schema.Literal('step-start'),
  snapshot: Schema.optional(Schema.String)
}).annotate({ identifier: 'StepStartPart' });
export type StepStartPart = DeepMutable<Schema.Schema.Type<typeof StepStartPart>>;

export const StepFinishPart = Schema.Struct({
  ...partBase,
  type: Schema.Literal('step-finish'),
  reason: Schema.String,
  snapshot: Schema.optional(Schema.String),
  cost: Schema.Finite,
  tokens: Schema.Struct({
    total: Schema.optional(Schema.Finite),
    input: Schema.Finite,
    output: Schema.Finite,
    reasoning: Schema.Finite,
    cache: Schema.Struct({
      read: Schema.Finite,
      write: Schema.Finite
    })
  })
}).annotate({ identifier: 'StepFinishPart' });
export type StepFinishPart = DeepMutable<Schema.Schema.Type<typeof StepFinishPart>>;

export const SnapshotPart = Schema.Struct({
  ...partBase,
  type: Schema.Literal('snapshot'),
  snapshot: Schema.String
}).annotate({ identifier: 'SnapshotPart' });
export type SnapshotPart = DeepMutable<Schema.Schema.Type<typeof SnapshotPart>>;

export const PatchPart = Schema.Struct({
  ...partBase,
  type: Schema.Literal('patch'),
  hash: Schema.String,
  files: Schema.Array(Schema.String)
}).annotate({ identifier: 'PatchPart' });
export type PatchPart = DeepMutable<Schema.Schema.Type<typeof PatchPart>>;

export const AgentPart = Schema.Struct({
  ...partBase,
  type: Schema.Literal('agent'),
  name: Schema.String,
  source: Schema.optional(
    Schema.Struct({
      value: Schema.String,
      start: NonNegativeInt,
      end: NonNegativeInt
    })
  )
}).annotate({ identifier: 'AgentPart' });
export type AgentPart = DeepMutable<Schema.Schema.Type<typeof AgentPart>>;

export const RetryPart = Schema.Struct({
  ...partBase,
  type: Schema.Literal('retry'),
  attempt: NonNegativeInt,
  error: APIError.EffectSchema,
  time: Schema.Struct({
    created: NonNegativeInt
  })
}).annotate({ identifier: 'RetryPart' });
export type RetryPart = Omit<DeepMutable<Schema.Schema.Type<typeof RetryPart>>, 'error'> & {
  error: APIError;
};

export const CompactionPart = Schema.Struct({
  ...partBase,
  type: Schema.Literal('compaction'),
  auto: Schema.Boolean,
  overflow: Schema.optional(Schema.Boolean),
  tail_start_id: Schema.optional(MessageID)
}).annotate({ identifier: 'CompactionPart' });
export type CompactionPart = DeepMutable<Schema.Schema.Type<typeof CompactionPart>>;

export const TextPartInput = Schema.Struct({
  id: Schema.optional(PartID),
  type: Schema.Literal('text'),
  text: Schema.String,
  synthetic: Schema.optional(Schema.Boolean),
  ignored: Schema.optional(Schema.Boolean),
  time: Schema.optional(
    Schema.Struct({
      start: NonNegativeInt,
      end: Schema.optional(NonNegativeInt)
    })
  ),
  metadata: Schema.optional(Schema.Record(Schema.String, Schema.Unknown))
}).annotate({ identifier: 'TextPartInput' });
export type TextPartInput = DeepMutable<Schema.Schema.Type<typeof TextPartInput>>;

export const FilePartInput = Schema.Struct({
  id: Schema.optional(PartID),
  type: Schema.Literal('file'),
  mime: Schema.String,
  filename: Schema.optional(Schema.String),
  url: Schema.String,
  source: Schema.optional(FilePartSource)
}).annotate({ identifier: 'FilePartInput' });
export type FilePartInput = DeepMutable<Schema.Schema.Type<typeof FilePartInput>>;

export const AgentPartInput = Schema.Struct({
  id: Schema.optional(PartID),
  type: Schema.Literal('agent'),
  name: Schema.String,
  source: Schema.optional(
    Schema.Struct({
      value: Schema.String,
      start: NonNegativeInt,
      end: NonNegativeInt
    })
  )
}).annotate({ identifier: 'AgentPartInput' });
export type AgentPartInput = DeepMutable<Schema.Schema.Type<typeof AgentPartInput>>;

export const SubtaskPartInput = Schema.Struct({
  id: Schema.optional(PartID),
  type: Schema.Literal('subtask'),
  prompt: Schema.String,
  description: Schema.String,
  agent: Schema.String,
  model: Schema.optional(
    Schema.Struct({
      providerID: ProviderID,
      modelID: ModelID
    })
  ),
  command: Schema.optional(Schema.String)
}).annotate({ identifier: 'SubtaskPartInput' });
export type SubtaskPartInput = DeepMutable<Schema.Schema.Type<typeof SubtaskPartInput>>;

export const Part = Schema.Union([
  TextPart,
  SubtaskPart,
  ReasoningPart,
  FilePart,
  ToolPart,
  StepStartPart,
  StepFinishPart,
  SnapshotPart,
  PatchPart,
  AgentPart,
  RetryPart,
  CompactionPart
]).annotate({ discriminator: 'type', identifier: 'Part' });
export type Part =
  | TextPart
  | SubtaskPart
  | ReasoningPart
  | FilePart
  | ToolPart
  | StepStartPart
  | StepFinishPart
  | SnapshotPart
  | PatchPart
  | AgentPart
  | RetryPart
  | CompactionPart;

export const WithParts = Schema.Struct({
  info: Info,
  parts: Schema.Array(Part)
});
export type WithParts = {
  info: Info;
  parts: Part[];
};
