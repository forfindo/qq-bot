import { Schema } from 'effect';

export class ResizerUnavailableError extends Schema.TaggedErrorClass<ResizerUnavailableError>()(
  'ImageResizerUnavailableError',
  {}
) {
  override get message() {
    return 'Image resizer is unavailable';
  }
}

export class InvalidDataUrlError extends Schema.TaggedErrorClass<InvalidDataUrlError>()(
  'ImageInvalidDataUrlError',
  {
    url: Schema.String
  }
) {
  override get message() {
    return 'Image URL must be a base64 data URL';
  }
}

export class DecodeError extends Schema.TaggedErrorClass<DecodeError>()('ImageDecodeError', {}) {
  override get message() {
    return 'Image could not be decoded';
  }
}

export class SizeError extends Schema.TaggedErrorClass<SizeError>()('ImageSizeError', {
  bytes: Schema.Number,
  max: Schema.Number,
  width: Schema.Number,
  height: Schema.Number,
  max_width: Schema.Number,
  max_height: Schema.Number
}) {
  override get message() {
    return `Image ${this.width}x${this.height} with base64 size ${this.bytes} exceeds configured limits and could not be resized below ${this.max_width}x${this.max_height}/${this.max} bytes`;
  }
}

export type Error = ResizerUnavailableError | InvalidDataUrlError | DecodeError | SizeError;
