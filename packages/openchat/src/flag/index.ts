import * as process from 'node:process';

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

export const Flag = {
  // Static variable
  ...StaticFlag,
  // Dynamic variable
  get TEST() {
    return process.env['TEST'];
  }
};

export type FlagKey = keyof typeof Flag;

export const setFlag = <T extends string>(key: Exclude<T, STAKey>, value: string | number | boolean) => {
  process.env[key] = value.toString();
};
