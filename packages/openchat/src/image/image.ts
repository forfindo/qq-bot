import { Config } from '@/config';
import type { SchemaMessage } from '@/schema/session';
import { Context, Effect, Layer, Result, Schema } from 'effect';
import { create } from '@/utils/log';

const MAX_BASE64_BYTES = 5 * 1024 * 1024;
const MAX_WIDTH = 2000;
const MAX_HEIGHT = 2000;
const AUTO_RESIZE = true;
const JPEG_QUALITIES = [80, 85, 70, 55, 40];
const log = create();

export class ResizerUnavailableError extends Schema.TaggedErrorClass<ResizerUnavailableError>()('ImageResizerUnavailableError', {}) {
  override get message() {
    return 'Image resizer is unavailable';
  }
}

export class InvalidDataUrlError extends Schema.TaggedErrorClass<InvalidDataUrlError>()('ImageInvalidDataUrlError', {
  url: Schema.String
}) {
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

export interface Interface {
  readonly normalize: (input: SchemaMessage.FilePart) => Effect.Effect<SchemaMessage.FilePart, Error>;
}

export class Service extends Context.Service<Service, Interface>()('@openchat/Image') {}

export const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const config = yield* Config.Service;
    const loadSharp = yield* Effect.cached(
      Effect.tryPromise(() => import('sharp')).pipe(
        Effect.map(e => {
          const sharp = e.default;
          sharp.cache(false);
          return sharp;
        }),
        Effect.tapError(error => Effect.sync(() => log.warn('failed to load sharp', { error }))),
        Effect.mapError(() => new ResizerUnavailableError())
      )
    );

    const normalize = Effect.fn('Image.normalize')(function* (input: SchemaMessage.FilePart) {
      const image = (yield* config.get()).attachment?.image;
      const info = {
        autoResize: image?.auto_resize ?? AUTO_RESIZE,
        maxWidth: image?.max_width ?? MAX_WIDTH,
        maxHeight: image?.max_height ?? MAX_HEIGHT,
        maxBase64Bytes: image?.max_base64_bytes ?? MAX_BASE64_BYTES
      };
      if (!input.url.startsWith('data:') || !input.url.includes(';base64,')) {
        return yield* new InvalidDataUrlError({ url: input.url });
      }

      const base64 = input.url.slice(input.url.indexOf(';base64,') + ';base64,'.length);
      const bytes = Buffer.byteLength(base64, 'utf8');

      const sharp = yield* loadSharp;

      const originImage = sharp(Buffer.from(base64, 'base64'));
      const originMetadata = yield* Effect.tryPromise({
        try: () => originImage.metadata(),
        catch: error => {
          log.warn('failed to decode image', { error });
          return new DecodeError();
        }
      });

      const { width: originalWidth, height: originalHeight } = originMetadata;
      if (originalWidth <= info.maxWidth && originalHeight <= info.maxHeight && bytes <= info.maxBase64Bytes) {
        return input;
      }
      if (!info.autoResize) {
        return yield* new SizeError({
          bytes,
          max: info.maxBase64Bytes,
          width: originalWidth,
          height: originalHeight,
          max_width: info.maxWidth,
          max_height: info.maxHeight
        });
      }

      const scale = Math.min(1, info.maxWidth / originalWidth, info.maxHeight / originalHeight);
      for (const size of Array.from({ length: 32 }).reduce<Array<{ width: number; height: number }>>(acc => {
        const previous = acc.at(-1) ?? {
          width: Math.max(1, Math.round(originalWidth * scale)),
          height: Math.max(1, Math.round(originalHeight * scale))
        };
        const next =
          acc.length === 0
            ? previous
            : {
                width: previous.width === 1 ? 1 : Math.max(1, Math.floor(previous.width * 0.75)),
                height: previous.height === 1 ? 1 : Math.max(1, Math.floor(previous.height * 0.75))
              };
        return acc.some(item => item.width === next.width && item.height === next.height) ? acc : [...acc, next];
      }, [])) {
        const resized = originImage.clone().resize(size.width, size.height, {
          fit: 'inside',
          withoutEnlargement: true,
          kernel: sharp.kernel.lanczos3, // 最高画质缩小算法
          fastShrinkOnLoad: false // 关闭快速预缩小，避免摩尔纹失真（画质优先）
        });

        const imageTypes = [
          {
            data: resized.clone().png({ compressionLevel: 9 }).toBuffer(),
            mime: 'image/png'
          },
          ...JPEG_QUALITIES.map(quality => ({
            data: resized
              .clone()
              .jpeg({
                quality,
                mozjpeg: true
              })
              .toBuffer(),
            mime: 'image/jpeg'
          }))
        ];
        const candidate = (yield* Effect.all(
          imageTypes.map(it => Effect.promise(() => it.data)),
          {
            mode: 'result',
            concurrency: 'unbounded'
          }
        ))
          .map((result, index) => {
            if (Result.isSuccess(result)) {
              return {
                data: result.success.toString('base64'),
                mime: imageTypes[index]!.mime,
                bytes: Buffer.byteLength(result.success, 'binary')
              };
            } else {
              return {
                error: result.failure,
                mime: imageTypes[index]!.mime,
                bytes: 0
              };
            }
          })
          .find(item => item.bytes && item.bytes <= info.maxBase64Bytes);

        if (candidate) {
          log.info('using resized image', {
            from_mime: input.mime,
            to_mime: candidate.mime,
            from: `${originalWidth}x${originalHeight}`,
            to: `${size.width}x${size.height}`
          });
          return {
            ...input,
            mime: candidate.mime,
            url: `data:${candidate.mime};base64,${candidate.data}`
          };
        }
      }

      return yield* new SizeError({
        bytes,
        max: info.maxBase64Bytes,
        width: originalWidth,
        height: originalHeight,
        max_width: info.maxWidth,
        max_height: info.maxHeight
      });
    });

    return Service.of({ normalize });
  })
);
