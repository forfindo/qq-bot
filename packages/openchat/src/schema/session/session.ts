import { Effect, Schema } from 'effect';
import {
  type DeepMutable,
  NonNegativeInt,
  optionalOmitUndefined,
  withStatics
} from '@/schema/common';
import { Identifier } from '@/id';
import { Ruleset } from '@/schema/permission';
import {
  AgentPartInput,
  Assistant,
  FilePartInput,
  Info,
  MessageID,
  Part,
  PartID,
  SubtaskPartInput,
  TextPartInput
} from '@/schema/message';
import { ModelID, ModelRef, ProviderID } from '@/schema/provider';
import { FileDiff } from '@/schema/snapshot';
import { define, inventory } from '@/schema/event';

// Legacy HTTP accepted negative values here. Keep archive timestamps permissive
// while excluding non-finite values that cannot round-trip through JSON.
export const ArchivedTimestamp = Schema.Finite;

export const Metadata = Schema.Record(Schema.String, Schema.Unknown);

const Tokens = Schema.Struct({
  input: Schema.Finite,
  output: Schema.Finite,
  reasoning: Schema.Finite,
  cache: Schema.Struct({
    read: Schema.Finite,
    write: Schema.Finite
  })
});

const Time = Schema.Struct({
  created: NonNegativeInt,
  updated: NonNegativeInt,
  compacting: optionalOmitUndefined(NonNegativeInt),
  archived: optionalOmitUndefined(ArchivedTimestamp)
});

const Revert = Schema.Struct({
  messageID: MessageID,
  partID: optionalOmitUndefined(PartID),
  snapshot: optionalOmitUndefined(Schema.String),
  diff: optionalOmitUndefined(Schema.String)
});

export const Model = Schema.Struct({
  id: ModelID,
  providerID: ProviderID,
  variant: optionalOmitUndefined(Schema.String)
});

const Summary = Schema.Struct({
  additions: Schema.Finite,
  deletions: Schema.Finite,
  files: Schema.Finite,
  diffs: optionalOmitUndefined(Schema.Array(FileDiff))
});

const Share = Schema.Struct({
  url: Schema.String
});

export const SessionID = Schema.String.check(Schema.isStartsWith('ses')).pipe(
  Schema.brand('SessionID'),
  withStatics(s => ({
    descending: (id?: string) => s.make(Identifier.descending('session', id))
  }))
);
export type SessionID = Schema.Schema.Type<typeof SessionID>;

export const SetMetadataInput = Schema.Struct({
  sessionID: SessionID,
  metadata: Metadata
});

export const SessionInfo = Schema.Struct({
  id: SessionID,
  slug: Schema.String,
  ownerID: Schema.String,
  parentID: optionalOmitUndefined(SessionID),
  summary: optionalOmitUndefined(Summary),
  cost: optionalOmitUndefined(Schema.Finite),
  tokens: optionalOmitUndefined(Tokens),
  share: optionalOmitUndefined(Share),
  title: Schema.String,
  agent: optionalOmitUndefined(Schema.String),
  model: optionalOmitUndefined(Model),
  version: Schema.String,
  metadata: optionalOmitUndefined(Metadata),
  time: Time,
  permission: optionalOmitUndefined(Ruleset),
  revert: optionalOmitUndefined(Revert)
}).annotate({ identifier: 'Session' });
export type SessionInfo = DeepMutable<Schema.Schema.Type<typeof SessionInfo>>;

export const GlobalInfo = Schema.Struct({
  ...SessionInfo.fields
}).annotate({ identifier: 'GlobalSession' });
export type GlobalInfo = DeepMutable<Schema.Schema.Type<typeof GlobalInfo>>;

export class OutputFormatText extends Schema.Class<OutputFormatText>('OutputFormatText')({
  type: Schema.Literal('text')
}) {}

export class OutputFormatJsonSchema extends Schema.Class<OutputFormatJsonSchema>(
  'OutputFormatJsonSchema'
)({
  type: Schema.Literal('json_schema'),
  schema: Schema.Record(Schema.String, Schema.Any).annotate({ identifier: 'JSONSchema' }),
  retryCount: NonNegativeInt.pipe(Schema.optional, Schema.withDecodingDefault(Effect.succeed(2)))
}) {}

export const Format = Schema.Union([OutputFormatText, OutputFormatJsonSchema]).annotate({
  discriminator: 'type',
  identifier: 'OutputFormat'
});

export type OutputFormat = Schema.Schema.Type<typeof Format>;

export const PromptInput = Schema.Struct({
  sessionID: SessionID,
  messageID: Schema.optional(MessageID),
  model: Schema.optional(ModelRef),
  agent: Schema.optional(Schema.String),
  noReply: Schema.optional(Schema.Boolean),
  tools: Schema.optional(Schema.Record(Schema.String, Schema.Boolean)).annotate({
    description:
      '@deprecated tools and permissions have been merged, you can set permissions on the session itself now'
  }),
  format: Schema.optional(Format),
  system: Schema.optional(Schema.String),
  variant: Schema.optional(Schema.String),
  parts: Schema.Array(
    Schema.Union([TextPartInput, FilePartInput, AgentPartInput, SubtaskPartInput]).annotate({
      discriminator: 'type'
    })
  )
});
export type PromptInput = Schema.Schema.Type<typeof PromptInput>;

const options = {
  durable: {
    aggregate: 'sessionID',
    version: 1
  }
} as const;

const events = {
  Created: define({
    type: 'session.created',
    ...options,
    schema: Schema.Struct({
      sessionID: SessionID,
      info: SessionInfo
    })
  }),
  Updated: define({
    type: 'session.updated',
    ...options,
    schema: Schema.Struct({
      sessionID: SessionID,
      info: SessionInfo
    })
  }),
  Deleted: define({
    type: 'session.deleted',
    ...options,
    schema: Schema.Struct({
      sessionID: SessionID,
      info: SessionInfo
    })
  }),
  MessageUpdated: define({
    type: 'message.updated',
    ...options,
    schema: Schema.Struct({
      sessionID: SessionID,
      info: Info
    })
  }),
  MessageRemoved: define({
    type: 'message.removed',
    ...options,
    schema: Schema.Struct({
      sessionID: SessionID,
      messageID: MessageID
    })
  }),
  PartUpdated: define({
    type: 'message.part.updated',
    ...options,
    schema: Schema.Struct({
      sessionID: SessionID,
      part: Part,
      time: Schema.Finite
    })
  }),
  PartRemoved: define({
    type: 'message.part.removed',
    ...options,
    schema: Schema.Struct({
      sessionID: SessionID,
      messageID: MessageID,
      partID: PartID
    })
  })
};

export const PartDelta = define({
  type: 'message.part.delta',
  schema: Schema.Struct({
    sessionID: SessionID,
    messageID: MessageID,
    partID: PartID,
    field: Schema.String,
    delta: Schema.String
  })
});

export const Diff = define({
  type: 'session.diff',
  schema: Schema.Struct({
    sessionID: SessionID,
    diff: Schema.Array(FileDiff)
  })
});

export const Error = define({
  type: 'session.error',
  schema: Schema.Struct({
    sessionID: Schema.optional(SessionID),
    error: Assistant.fields.error
  })
});

export const Events = {
  ...events,
  PartDelta,
  Diff,
  Error,
  Definitions: inventory(
    events.Created,
    events.Updated,
    events.Deleted,
    events.MessageUpdated,
    events.MessageRemoved,
    events.PartUpdated,
    events.PartRemoved,
    PartDelta,
    Diff,
    Error
  )
};
