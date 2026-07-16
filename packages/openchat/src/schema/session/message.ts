import { Schema, Types } from 'effect';
import { NonNegativeInt, Range, withStatics } from '@/schema/common';
import { Identifier } from '@/id';

export const SessionID = Schema.String.check(Schema.isStartsWith('ses')).pipe(
  Schema.brand('SessionID'),
  withStatics(s => ({
    descending: (id?: string) => s.make(Identifier.descending('session', id))
  }))
);
export type SessionID = Schema.Schema.Type<typeof SessionID>;

export const MessageID = Schema.String.check(Schema.isStartsWith('msg')).pipe(
  Schema.brand('MessageID'),
  withStatics(s => ({
    ascending: (id?: string) => s.make(Identifier.ascending('message', id))
  }))
);
export type MessageID = Schema.Schema.Type<typeof MessageID>;

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
export type FilePart = Types.DeepMutable<Schema.Schema.Type<typeof FilePart>>;
