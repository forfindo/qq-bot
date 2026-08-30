import { Option, Schema } from 'effect';

export class InstallFailedError extends Schema.TaggedErrorClass<InstallFailedError>()(
  'NpmInstallFailedError',
  {
    add: Schema.Array(Schema.String).pipe(Schema.optional),
    dir: Schema.String,
    cause: Schema.optional(Schema.Defect())
  }
) {}

export interface EntryPoint {
  readonly directory: string;
  readonly entrypoint: Option.Option<string>;
}
