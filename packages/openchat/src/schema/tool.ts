import { Effect, Schema } from 'effect';
import type { JSONSchema7 } from '@ai-sdk/provider';
import * as SchemaPermission from '@/schema/permission';
import * as SchemaMessage from '@/schema/message';
import { withStatics } from '@/schema/common';
import { Identifier } from '@/id';

const toolIdSchema = Schema.String.check(Schema.isStartsWith('tool')).pipe(Schema.brand('ToolID'));

export type ToolID = typeof toolIdSchema.Type;

export const ToolID = toolIdSchema.pipe(
  withStatics((schema: typeof toolIdSchema) => ({
    ascending: (id?: string) => schema.make(Identifier.ascending('tool', id))
  }))
);

export interface Metadata {
  [key: string]: unknown;
}

export type Context<M extends Metadata = Metadata> = {
  sessionID: SchemaMessage.SessionID;
  messageID: SchemaMessage.MessageID;
  agent: string;
  abort: AbortSignal;
  callID?: string;
  extra?: { [key: string]: unknown };
  messages: SchemaMessage.WithParts[];
  metadata(input: { title?: string; metadata?: M }): Effect.Effect<void>;
  ask(input: Omit<SchemaPermission.Request, 'id' | 'sessionID' | 'tool'>): Effect.Effect<void>;
};

export interface ExecuteResult<M extends Metadata = Metadata> {
  title: string;
  metadata: M;
  output: string;
  attachments?: Omit<SchemaMessage.FilePart, 'id' | 'sessionID' | 'messageID'>[];
}

export interface Def<
  Parameters extends Schema.Decoder<unknown> = Schema.Decoder<unknown>,
  M extends Metadata = Metadata
> {
  id: string;
  description: string;
  parameters: Parameters;
  jsonSchema?: JSONSchema7;
  execute(args: Schema.Schema.Type<Parameters>, ctx: Context): Effect.Effect<ExecuteResult<M>>;
  formatValidationError?(error: unknown): string;
}

export type DefWithoutID<
  Parameters extends Schema.Decoder<unknown> = Schema.Decoder<unknown>,
  M extends Metadata = Metadata
> = Omit<Def<Parameters, M>, 'id'>;

export interface Info<
  Parameters extends Schema.Decoder<unknown> = Schema.Decoder<unknown>,
  M extends Metadata = Metadata
> {
  id: string;
  init: () => Effect.Effect<DefWithoutID<Parameters, M>>;
}
