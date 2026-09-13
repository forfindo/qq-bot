import { Schema } from 'effect';
import { SessionID } from '@/schema/session/id';
import { MessageID } from '@/schema/message/message';
import { define } from '@/schema/event';

export const ConfigInfo = Schema.Struct({
  template: Schema.String,
  description: Schema.optional(Schema.String),
  agent: Schema.optional(Schema.String),
  model: Schema.optional(Schema.String),
  subtask: Schema.optional(Schema.Boolean)
});

export type ConfigInfo = Schema.Schema.Type<typeof ConfigInfo>;

export const Info = Schema.Struct({
  name: Schema.String,
  description: Schema.optional(Schema.String),
  agent: Schema.optional(Schema.String),
  model: Schema.optional(Schema.String),
  source: Schema.optional(Schema.Literals(['command', 'mcp', 'skill'])),
  // Some command templates are lazy promises from MCP prompt resolution.
  template: Schema.Unknown,
  subtask: Schema.optional(Schema.Boolean),
  hints: Schema.Array(Schema.String)
}).annotate({ identifier: 'Command' });

export type Info = Omit<Schema.Schema.Type<typeof Info>, 'template'> & {
  template: Promise<string> | string;
};

export const Events = {
  Executed: define({
    type: 'command.executed',
    schema: Schema.Struct({
      name: Schema.String,
      sessionID: SessionID,
      arguments: Schema.String,
      messageID: MessageID
    })
  })
};
