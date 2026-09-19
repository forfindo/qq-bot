import { Schema } from 'effect';
import { optionalOmitUndefined, withStatics } from '@/schema/common';

export class Source extends Schema.Class<Source>('Prompt.Source')({
  start: Schema.Finite,
  end: Schema.Finite,
  text: Schema.String
}) {}

export class FileAttachment extends Schema.Class<FileAttachment>('Prompt.FileAttachment')({
  uri: Schema.String,
  mime: Schema.String,
  name: Schema.String.pipe(Schema.optional),
  description: Schema.String.pipe(Schema.optional),
  source: Source.pipe(Schema.optional)
}) {
  static create(input: FileAttachment) {
    return new FileAttachment({
      uri: input.uri,
      mime: input.mime,
      name: input.name,
      description: input.description,
      source: input.source
    });
  }
}

export class AgentAttachment extends Schema.Class<AgentAttachment>('Prompt.AgentAttachment')({
  name: Schema.String,
  source: Source.pipe(Schema.optional)
}) {}

export const Prompt = Schema.Struct({
  text: Schema.String,
  files: Schema.Array(FileAttachment).pipe(optionalOmitUndefined),
  agents: Schema.Array(AgentAttachment).pipe(optionalOmitUndefined)
})
  .annotate({ identifier: 'Prompt' })
  .pipe(
    withStatics(schema => ({
      equivalence: Schema.toEquivalence(schema),
      fromUserMessage: (input: Pick<Prompt, 'text' | 'files' | 'agents'>) =>
        schema.make({
          text: input.text,
          ...(input.files === void 0 ? {} : { files: input.files }),
          ...(input.agents === void 0 ? {} : { agents: input.agents })
        })
    }))
  );
export type Prompt = Schema.Schema.Type<typeof Prompt>;
