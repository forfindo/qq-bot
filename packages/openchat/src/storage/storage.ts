import { Schema } from 'effect';

export class NotFoundError extends Schema.TaggedErrorClass<NotFoundError>()('NotFoundError', {
  message: Schema.String
}) {
  static isInstance(input: unknown): input is NotFoundError {
    return input instanceof NotFoundError;
  }
}
