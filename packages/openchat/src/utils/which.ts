import whichPkg from 'which';
import path from 'path';
import { Path } from '@/utils/global';

export const which = (cmd: string, env?: NodeJS.ProcessEnv) => {
  const base = env?.PATH ?? env?.Path ?? process.env.PATH ?? process.env.Path ?? '';
  const full = base ? base + path.delimiter + Path.bin : Path.bin;
  const result = whichPkg.sync(cmd, {
    nothrow: true,
    path: full,
    pathExt: env?.PATHEXT ?? env?.PathExt ?? process.env.PATHEXT ?? process.env.PathExt
  });
  return typeof result === 'string' ? result : null;
};
