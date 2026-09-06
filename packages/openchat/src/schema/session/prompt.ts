import { Schema } from 'effect';
import { optionalOmitUndefined, withStatics } from '@/schema/common';

export const Source = Schema.Struct({
  start: Schema.Finite,
  end: Schema.Finite,
  text: Schema.String
}).annotate({ identifier: 'Prompt.Source' });
export type Source = Schema.Schema.Type<typeof Source>;

export const FileAttachment = Schema.Struct({
  uri: Schema.String,
  mime: Schema.String,
  name: Schema.String.pipe(optionalOmitUndefined),
  description: Schema.String.pipe(optionalOmitUndefined),
  source: Source.pipe(optionalOmitUndefined)
})
  .annotate({ identifier: 'Prompt.FileAttachment' })
  .pipe(
    withStatics(schema => ({
      create: (input: FileAttachment) =>
        schema.make({
          uri: input.uri,
          mime: input.mime,
          name: input.name,
          description: input.description,
          source: input.source
        })
    }))
  );
export type FileAttachment = Schema.Schema.Type<typeof FileAttachment>;

export const AgentAttachment = Schema.Struct({
  name: Schema.String,
  source: Source.pipe(optionalOmitUndefined)
}).annotate({ identifier: 'Prompt.AgentAttachment' });
export type AgentAttachment = Schema.Schema.Type<typeof AgentAttachment>;

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
