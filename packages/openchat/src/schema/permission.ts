import { Schema, SchemaGetter } from 'effect';
import { NewType } from '@/schema/common';
import { Identifier } from '@/id';
import { MessageID } from '@/schema/message';
import { SessionID } from '@/schema/session';
import { define } from '@/schema/event';

export class PermissionID extends NewType<PermissionID>()(
  'PermissionID',
  Schema.String.check(Schema.isStartsWith('per'))
) {
  static ascending(id?: string): PermissionID {
    return this.make(Identifier.ascending('permission', id));
  }
}

export const Action = Schema.Literals(['ask', 'allow', 'deny']).annotate({
  identifier: 'PermissionAction'
});
export type Action = Schema.Schema.Type<typeof Action>;

export const Object = Schema.Record(Schema.String, Action).annotate({
  identifier: 'PermissionObjectConfig'
});
export type Object = Schema.Schema.Type<typeof Object>;

export const ConfigRule = Schema.Union([Action, Object]).annotate({
  identifier: 'PermissionRuleConfig'
});
export type ConfigRule = Schema.Schema.Type<typeof ConfigRule>;

export const Rule = Schema.Struct({
  permission: Schema.String,
  pattern: Schema.String,
  action: Action
}).annotate({ identifier: 'PermissionRule' });
export type Rule = Schema.Schema.Type<typeof Rule>;

export const Ruleset = Schema.mutable(Schema.Array(Rule)).annotate({
  identifier: 'PermissionRuleset'
});
export type Ruleset = Schema.Schema.Type<typeof Ruleset>;

export class Request extends Schema.Class<Request>('PermissionRequest')({
  id: PermissionID,
  sessionID: SessionID,
  permission: Schema.String,
  patterns: Schema.Array(Schema.String),
  metadata: Schema.Record(Schema.String, Schema.Unknown),
  always: Schema.Array(Schema.String),
  tool: Schema.optional(
    Schema.Struct({
      messageID: MessageID,
      callID: Schema.String
    })
  )
}) {}

// Known permission keys get explicit types in the Effect schema for generated
// docs/types. Runtime config parsing uses Effect's `propertyOrder: "original"`
// parse option so user key order is preserved for permission precedence.
const InputObject = Schema.StructWithRest(
  Schema.Struct({
    read: Schema.optional(ConfigRule),
    edit: Schema.optional(ConfigRule),
    glob: Schema.optional(ConfigRule),
    grep: Schema.optional(ConfigRule),
    list: Schema.optional(ConfigRule),
    bash: Schema.optional(ConfigRule),
    task: Schema.optional(ConfigRule),
    external_directory: Schema.optional(ConfigRule),
    todowrite: Schema.optional(Action),
    question: Schema.optional(Action),
    webfetch: Schema.optional(Action),
    websearch: Schema.optional(Action),
    doom_loop: Schema.optional(Action),
    skill: Schema.optional(ConfigRule)
  }),
  [Schema.Record(Schema.String, ConfigRule)]
);

// Input the user writes in config: either a single Action (shorthand for "*")
// or an object of per-target rules.
const InputSchema = Schema.Union([Action, InputObject]);

// Normalise the Action shorthand into `{ "*": action }`. Object inputs pass
// through untouched.
const normalizeInput = (
  input: Schema.Schema.Type<typeof InputSchema>
): Schema.Schema.Type<typeof InputObject> => (typeof input === 'string' ? { '*': input } : input);

export const Info = InputSchema.pipe(
  Schema.decodeTo(InputObject, {
    decode: SchemaGetter.transform(normalizeInput),
    // Not perfectly invertible (we lose whether the user originally typed an
    // Action shorthand), but the object form is always a valid representation
    // of the same rules.
    encode: SchemaGetter.passthrough({ strict: false })
  })
).annotate({ identifier: 'PermissionConfig' });
type _Info = Schema.Schema.Type<typeof InputObject>;
export type Info = { -readonly [K in keyof _Info]: _Info[K] };

export const Reply = Schema.Literals(['once', 'always', 'reject']);
export type Reply = Schema.Schema.Type<typeof Reply>;

const reply = {
  reply: Reply,
  message: Schema.optional(Schema.String)
};

export const ReplyBody = Schema.Struct(reply).annotate({ identifier: 'PermissionReplyBody' });
export type ReplyBody = Schema.Schema.Type<typeof ReplyBody>;

export const AskInput = Schema.Struct({
  ...Request.fields,
  id: Schema.optional(PermissionID),
  ruleset: Ruleset
}).annotate({ identifier: 'PermissionAskInput' });
export type AskInput = Schema.Schema.Type<typeof AskInput>;

export const ReplyInput = Schema.Struct({
  requestID: PermissionID,
  ...reply
}).annotate({ identifier: 'PermissionReplyInput' });
export type ReplyInput = Schema.Schema.Type<typeof ReplyInput>;

// Error
export class RejectedError extends Schema.TaggedErrorClass<RejectedError>()(
  'PermissionRejectedError',
  {}
) {
  override get message() {
    return 'The user rejected permission to use this specific tool call.';
  }
}

export class CorrectedError extends Schema.TaggedErrorClass<CorrectedError>()(
  'PermissionCorrectedError',
  {
    feedback: Schema.String
  }
) {
  override get message() {
    return `The user rejected permission to use this specific tool call with the following feedback: ${this.feedback}`;
  }
}

export class DeniedError extends Schema.TaggedErrorClass<DeniedError>()('PermissionDeniedError', {
  ruleset: Schema.Any
}) {
  override get message() {
    return `The user has specified a rule which prevents you from using this specific tool call. Here are some of the relevant rules ${JSON.stringify(this.ruleset)}`;
  }
}

export class NotFoundError extends Schema.TaggedErrorClass<NotFoundError>()(
  'Permission.NotFoundError',
  {
    requestID: PermissionID
  }
) {}

export type Error = DeniedError | RejectedError | CorrectedError;

export const Events = {
  Asked: define({ type: 'permission.asked', schema: Request }),
  Replied: define({
    type: 'permission.replied',
    schema: Schema.Struct({
      sessionID: SessionID,
      requestID: PermissionID,
      reply: Reply
    })
  })
};
