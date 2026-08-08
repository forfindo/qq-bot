import { Schema } from 'effect';

export const ConfigInfo = Schema.Struct({
  paths: Schema.optional(Schema.Array(Schema.String)).annotate({
    description: 'Additional paths to skill folders'
  }),
  urls: Schema.optional(Schema.Array(Schema.String)).annotate({
    description: 'URLs to fetch skills from (e.g., https://example.com/.well-known/skills/)'
  })
});

export type ConfigInfo = Schema.Schema.Type<typeof ConfigInfo>;

export const Info = Schema.Struct({
  name: Schema.String,
  description: Schema.optional(Schema.String),
  location: Schema.String,
  content: Schema.String
});
export type Info = Schema.Schema.Type<typeof Info>;

class IndexSkill extends Schema.Class<IndexSkill>('IndexSkill')({
  name: Schema.String,
  files: Schema.Array(Schema.String)
}) {}

export class Index extends Schema.Class<Index>('Index')({
  skills: Schema.Array(IndexSkill)
}) {}
