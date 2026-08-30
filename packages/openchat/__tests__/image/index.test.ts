import { Effect } from 'effect';
import { Config } from '@/config';
import { Image } from '@/image';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { MessageID, PartID } from '@/schema/message';
import { SessionID } from '@/schema/session';

describe('image service', () => {
  // 图片bytes 528136
  const base64Image = fs.readFileSync(path.join(import.meta.dirname, './img.dataurl'), 'utf-8');

  function genEffect(url: string) {
    return Effect.gen(function* () {
      const imgSvc = yield* Image.Service;
      return yield* imgSvc.normalize({
        filename: 'image.png',
        id: PartID.make('prt_f5bb63f59002nXj4ZCl3kWsmKo'),
        mime: 'image/png',
        type: 'file',
        url: url,
        sessionID: SessionID.make('ses_test'),
        messageID: MessageID.make('msg_test')
      });
    });
  }

  function genConfigService(bytes: number): Config.Interface {
    return {
      directories() {
        return Effect.succeed([]);
      },
      getGlobal() {
        return Effect.succeed({});
      },
      invalidate() {
        return Effect.void;
      },
      update() {
        return Effect.void;
      },
      updateGlobal() {
        throw new Error('unimplement');
      },
      get() {
        return Effect.succeed({
          attachment: {
            image: {
              auto_resize: true,
              max_base64_bytes: bytes
            }
          }
        });
      }
    };
  }

  // 正常图片
  const imageEffect = genEffect(base64Image);

  it('压缩', async () => {
    const result = await Effect.provide(imageEffect, Image.layer).pipe(
      Effect.provideService(Config.Service, genConfigService(528135)),
      Effect.runPromise
    );
    expect(result.url === base64Image).toBeFalsy();
  });

  it('不压缩', async () => {
    const result = await Effect.provide(imageEffect, Image.layer).pipe(
      Effect.provideService(Config.Service, genConfigService(628136)),
      Effect.runPromise
    );
    expect(result.url).toBe(base64Image);
  });

  it('无合适尺寸', async () => {
    await expect(
      Effect.provide(imageEffect, Image.layer).pipe(
        Effect.provideService(Config.Service, genConfigService(0)),
        Effect.runPromise
      )
    ).rejects.toThrow();
  });

  it('url格式不正确', async () => {
    await expect(
      Effect.provide(genEffect('file:pjg;base64,'), Image.layer).pipe(
        Effect.provideService(Config.Service, genConfigService(0)),
        Effect.runPromise
      )
    ).rejects.toThrow('Image URL must be a base64 data URL');
  });

  it('图片解析失败', async () => {
    await expect(
      Effect.provide(genEffect('data:pjg;base64,hjkahdskuioqr2432542'), Image.layer).pipe(
        Effect.provideService(Config.Service, genConfigService(0)),
        Effect.runPromise
      )
    ).rejects.toThrow('Image could not be decoded');
  });
});
