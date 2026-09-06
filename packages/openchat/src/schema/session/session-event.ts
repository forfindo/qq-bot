import { define, inventory, LocationRef } from '@/schema/event';
import { Schema } from 'effect';
import { DateTimeUtcFromMillis } from 'effect/Schema';
import { Prompt, RetryError, SessionID, UnknownError } from '@/schema/session';
import { MessageID } from '@/schema/message';
import { ModelRef } from '@/schema/provider';
import { optionalOmitUndefined, RelativePath } from '@/schema/common';
import { ProviderMetadata, ToolContent } from '@/schema/llm';
import { State } from '@/schema/revert';

export const Delivery = Schema.Literals(['steer', 'queue']);
export type Delivery = typeof Delivery.Type;

const Base = {
  timestamp: DateTimeUtcFromMillis,
  sessionID: SessionID
};

const PromptFields = Schema.Struct({
  ...Base,
  messageID: SessionID,
  prompt: Prompt,
  delivery: Delivery
});

const options = {
  durable: {
    aggregate: 'sessionID',
    version: 1
  }
} as const;

const stepSettlementOptions = {
  durable: {
    aggregate: 'sessionID',
    version: 2
  }
} as const;

export const AgentSwitched = define({
  type: 'session.next.agent.switched',
  ...options,
  schema: Schema.Struct({
    ...Base,
    messageID: MessageID,
    agent: Schema.String
  })
});
export type AgentSwitched = typeof AgentSwitched.Type;

export const ModelSwitched = define({
  type: 'session.next.model.switched',
  ...options,
  schema: Schema.Struct({
    ...Base,
    messageID: MessageID,
    model: ModelRef
  })
});
export type ModelSwitched = typeof ModelSwitched.Type;

export const Moved = define({
  type: 'session.next.moved',
  ...options,
  schema: Schema.Struct({
    ...Base,
    location: LocationRef,
    subdirectory: RelativePath.pipe(optionalOmitUndefined)
  })
});
export type Moved = typeof Moved.Type;

export const Prompted = define({
  type: 'session.next.prompted',
  ...options,
  schema: PromptFields
});
export type Prompted = typeof Prompted.Type;

export const PromptAdmitted = define({
  type: 'session.next.prompt.admitted',
  ...options,
  schema: PromptFields
});
export type PromptAdmitted = typeof PromptAdmitted.Type;

export const ContextUpdated = define({
  type: 'session.next.context.updated',
  ...options,
  schema: Schema.Struct({
    ...Base,
    messageID: MessageID,
    text: Schema.String
  })
});
export type ContextUpdated = typeof ContextUpdated.Type;

export const Synthetic = define({
  type: 'session.next.synthetic',
  ...options,
  schema: Schema.Struct({
    ...Base,
    messageID: MessageID,
    text: Schema.String
  })
});
export type Synthetic = typeof Synthetic.Type;

// eslint-disable-next-line @typescript-eslint/no-namespace
export namespace Shell {
  export const Started = define({
    type: 'session.next.shell.started',
    ...options,
    schema: Schema.Struct({
      ...Base,
      messageID: MessageID,
      callID: Schema.String,
      command: Schema.String
    })
  });
  export type Started = typeof Started.Type;

  export const Ended = define({
    type: 'session.next.shell.ended',
    ...options,
    schema: Schema.Struct({
      ...Base,
      callID: Schema.String,
      output: Schema.String
    })
  });
  export type Ended = typeof Ended.Type;
}

// eslint-disable-next-line @typescript-eslint/no-namespace
export namespace Step {
  export const Started = define({
    type: 'session.next.step.started',
    ...options,
    schema: Schema.Struct({
      ...Base,
      assistantMessageID: MessageID,
      agent: Schema.String,
      model: ModelRef,
      snapshot: Schema.String.pipe(optionalOmitUndefined)
    })
  });
  export type Started = typeof Started.Type;

  export const Ended = define({
    type: 'session.next.step.ended',
    ...stepSettlementOptions,
    schema: Schema.Struct({
      ...Base,
      assistantMessageID: MessageID,
      finish: Schema.String,
      cost: Schema.Finite,
      tokens: Schema.Struct({
        input: Schema.Finite,
        output: Schema.Finite,
        reasoning: Schema.Finite,
        cache: Schema.Struct({
          read: Schema.Finite,
          write: Schema.Finite
        })
      }),
      snapshot: Schema.String.pipe(optionalOmitUndefined),
      files: Schema.Array(RelativePath).pipe(optionalOmitUndefined)
    })
  });
  export type Ended = typeof Ended.Type;

  export const Failed = define({
    type: 'session.next.step.failed',
    ...stepSettlementOptions,
    schema: Schema.Struct({
      ...Base,
      assistantMessageID: MessageID,
      error: UnknownError
    })
  });
  export type Failed = typeof Failed.Type;
}

// eslint-disable-next-line @typescript-eslint/no-namespace
export namespace Text {
  export const Started = define({
    type: 'session.next.text.started',
    ...options,
    schema: Schema.Struct({
      ...Base,
      assistantMessageID: MessageID,
      textID: Schema.String
    })
  });
  export type Started = typeof Started.Type;

  // Stream fragments are live-only; Text.Ended is the replayable full-value boundary.
  export const Delta = define({
    type: 'session.next.text.delta',
    schema: Schema.Struct({
      ...Base,
      assistantMessageID: MessageID,
      textID: Schema.String,
      delta: Schema.String
    })
  });
  export type Delta = typeof Delta.Type;

  export const Ended = define({
    type: 'session.next.text.ended',
    ...options,
    schema: Schema.Struct({
      ...Base,
      assistantMessageID: MessageID,
      textID: Schema.String,
      text: Schema.String
    })
  });
  export type Ended = typeof Ended.Type;
}

// eslint-disable-next-line @typescript-eslint/no-namespace
export namespace Reasoning {
  export const Started = define({
    type: 'session.next.reasoning.started',
    ...options,
    schema: Schema.Struct({
      ...Base,
      assistantMessageID: MessageID,
      reasoningID: Schema.String,
      providerMetadata: ProviderMetadata.pipe(optionalOmitUndefined)
    })
  });
  export type Started = typeof Started.Type;

  // Stream fragments are live-only; Reasoning.Ended is the replayable full-value boundary.
  export const Delta = define({
    type: 'session.next.reasoning.delta',
    schema: Schema.Struct({
      ...Base,
      assistantMessageID: MessageID,
      reasoningID: Schema.String,
      delta: Schema.String
    })
  });
  export type Delta = typeof Delta.Type;

  export const Ended = define({
    type: 'session.next.reasoning.ended',
    ...options,
    schema: Schema.Struct({
      ...Base,
      assistantMessageID: MessageID,
      reasoningID: Schema.String,
      text: Schema.String,
      providerMetadata: ProviderMetadata.pipe(optionalOmitUndefined)
    })
  });
  export type Ended = typeof Ended.Type;
}

// eslint-disable-next-line @typescript-eslint/no-namespace
export namespace Tool {
  const ToolBase = {
    ...Base,
    assistantMessageID: MessageID,
    callID: Schema.String
  };

  // eslint-disable-next-line @typescript-eslint/no-namespace
  export namespace Input {
    export const Started = define({
      type: 'session.next.tool.input.started',
      ...options,
      schema: Schema.Struct({
        ...ToolBase,
        name: Schema.String
      })
    });
    export type Started = typeof Started.Type;

    // Stream fragments are live-only; Input.Ended is the replayable raw-input boundary.
    export const Delta = define({
      type: 'session.next.tool.input.delta',
      schema: Schema.Struct({
        ...ToolBase,
        delta: Schema.String
      })
    });
    export type Delta = typeof Delta.Type;

    export const Ended = define({
      type: 'session.next.tool.input.ended',
      ...options,
      schema: Schema.Struct({
        ...ToolBase,
        text: Schema.String
      })
    });
    export type Ended = typeof Ended.Type;
  }

  export const Called = define({
    type: 'session.next.tool.called',
    ...options,
    schema: Schema.Struct({
      ...ToolBase,
      tool: Schema.String,
      input: Schema.Record(Schema.String, Schema.Unknown),
      provider: Schema.Struct({
        executed: Schema.Boolean,
        metadata: ProviderMetadata.pipe(optionalOmitUndefined)
      })
    })
  });
  export type Called = typeof Called.Type;

  /**
   * Replayable bounded running-tool state. Tools should checkpoint semantic
   * transitions or at a bounded cadence, not persist every stdout/stderr chunk.
   */
  export const Progress = define({
    type: 'session.next.tool.progress',
    ...options,
    schema: Schema.Struct({
      ...ToolBase,
      structured: Schema.Record(Schema.String, Schema.Unknown),
      content: Schema.Array(ToolContent)
    })
  });
  export type Progress = typeof Progress.Type;

  export const Success = define({
    type: 'session.next.tool.success',
    ...options,
    schema: Schema.Struct({
      ...ToolBase,
      structured: Schema.Record(Schema.String, Schema.Unknown),
      content: Schema.Array(ToolContent),
      outputPaths: Schema.Array(Schema.String).pipe(optionalOmitUndefined),
      result: Schema.Unknown.pipe(optionalOmitUndefined),
      provider: Schema.Struct({
        executed: Schema.Boolean,
        metadata: ProviderMetadata.pipe(optionalOmitUndefined)
      })
    })
  });
  export type Success = typeof Success.Type;

  export const Failed = define({
    type: 'session.next.tool.failed',
    ...options,
    schema: Schema.Struct({
      ...ToolBase,
      error: UnknownError,
      result: Schema.Unknown.pipe(optionalOmitUndefined),
      provider: Schema.Struct({
        executed: Schema.Boolean,
        metadata: ProviderMetadata.pipe(optionalOmitUndefined)
      })
    })
  });
  export type Failed = typeof Failed.Type;
}

export const Retried = define({
  type: 'session.next.retried',
  ...options,
  schema: Schema.Struct({
    ...Base,
    attempt: Schema.Finite,
    error: RetryError
  })
});
export type Retried = typeof Retried.Type;

// eslint-disable-next-line @typescript-eslint/no-namespace
export namespace Compaction {
  export const Started = define({
    type: 'session.next.compaction.started',
    ...options,
    schema: Schema.Struct({
      ...Base,
      messageID: MessageID,
      reason: Schema.Union([Schema.Literal('auto'), Schema.Literal('manual')])
    })
  });
  export type Started = typeof Started.Type;

  export const Delta = define({
    type: 'session.next.compaction.delta',
    schema: Schema.Struct({
      ...Base,
      messageID: MessageID,
      text: Schema.String
    })
  });
  export type Delta = typeof Delta.Type;

  export const Ended = define({
    type: 'session.next.compaction.ended',
    ...options,
    schema: Schema.Struct({
      ...Base,
      messageID: MessageID,
      reason: Started.data.fields.reason,
      text: Schema.String,
      recent: Schema.String
    })
  });
  export type Ended = typeof Ended.Type;
}

// eslint-disable-next-line @typescript-eslint/no-namespace
export namespace RevertEvent {
  export const Staged = define({
    type: 'session.next.revert.staged',
    ...options,
    schema: Schema.Struct({ ...Base, revert: State })
  });
  export const Cleared = define({
    type: 'session.next.revert.cleared',
    ...options,
    schema: Schema.Struct(Base)
  });
  export const Committed = define({
    type: 'session.next.revert.committed',
    ...options,
    schema: Schema.Struct({ ...Base, messageID: MessageID })
  });
}

export const DurableDefinitions = inventory(
  AgentSwitched,
  ModelSwitched,
  Moved,
  Prompted,
  PromptAdmitted,
  ContextUpdated,
  Synthetic,
  Shell.Started,
  Shell.Ended,
  Step.Started,
  Step.Ended,
  Step.Failed,
  Text.Started,
  Text.Ended,
  Tool.Input.Started,
  Tool.Input.Ended,
  Tool.Called,
  Tool.Progress,
  Tool.Success,
  Tool.Failed,
  Reasoning.Started,
  Reasoning.Ended,
  Retried,
  Compaction.Started,
  Compaction.Ended,
  RevertEvent.Staged,
  RevertEvent.Cleared,
  RevertEvent.Committed
);
