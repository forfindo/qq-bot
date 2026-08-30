import { Schema, SchemaGetter } from 'effect';
import { NewType } from '@/schema/common';
import { Identifier } from '@/id';
import { MessageID } from '@/schema/message';
import { SessionID } from '@/schema/session';

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
