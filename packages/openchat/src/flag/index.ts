import { Log } from '@/utils';
import * as process from 'node:process';

const log = Log.create();

const StaticFlag = {
  CONFIG_DIR: process.env['CONFIG_DIR'],
  AUTH_CONTENT: process.env['AUTH_CONTENT'],
  CONFIG_CONTENT: process.env['CONFIG_CONTENT'],
  TEST_HOME: process.env['TEST_HOME'],
  PERMISSION: process.env['PERMISSION'],
  DISABLE_AUTO_COMPACT: process.env['DISABLE_AUTOCOMPACT'],
  DISABLE_PRUNE: process.env['DISABLE_PRUNE']
};

type STAKey = keyof typeof StaticFlag;

export const Flag = new Proxy({
  // Static variable
  ...StaticFlag,
  // Dynamic variable
  get TEST() {
    return process.env['TEST'];
  }
}, {
  get(target, key, receiver): string | undefined {
    if (Object.hasOwn(target, key)) {
      return Reflect.get(target, key, receiver) as string | undefined;
    }
    return process.env[key.toString()];
  },
  set(target, key) {
    log.warn(`Flag key: ${key.toString()} not recommended to modify. If you need to modify environment variables, please use setFlag`);
    return false;
  }
});

export type FlagKey = keyof typeof Flag;

export const setFlag = <T extends string>(key: Exclude<T, STAKey>, value: string | number | boolean) => {
  process.env[key] = value.toString();
};
