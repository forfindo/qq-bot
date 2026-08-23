import { Log } from '@/utils';
import * as process from 'node:process';

const log = Log.create();

const truthy = (key: string) => {
  const value = process.env[key]?.toLowerCase();
  return value === 'true' || value === '1';
};

const some = (...keys: string[]) => {
  for (const key of keys) {
    if (truthy(key)) {
      return true;
    }
  }
  return false;
};

const positiveInteger = (key: string) => {
  const value = Number(process.env[key]);
  return Number.isInteger(value) && value > 0 ? value : void 0;
};

const getStaticFlag = () => {
  return {
    CONFIG_DIR: process.env['CONFIG_DIR'],
    AUTH_CONTENT: process.env['AUTH_CONTENT'],
    CONFIG_CONTENT: process.env['CONFIG_CONTENT'],
    TEST_HOME: process.env['TEST_HOME'],
    PERMISSION: process.env['PERMISSION'],
    DISABLE_AUTO_COMPACT: process.env['DISABLE_AUTOCOMPACT'],
    DISABLE_PRUNE: process.env['DISABLE_PRUNE'],
    MODELS_URL: process.env['MODELS_URL'],
    MODELS_PATH: process.env['MODELS_PATH'],
    DISABLE_MODELS_FETCH: truthy('DISABLE_MODELS_FETCH'),
    DISABLE_EXTERNAL_SKILLS: truthy('DISABLE_EXTERNAL_SKILLS'),
    DISABLE_CLAUDE_CODE_SKILLS: some('DISABLE_CLAUDE_CODE_SKILLS', 'DISABLE_CLAUDE_CODE'),
    DISABLE_CLAUDE_CODE_PROMPT: some('DISABLE_CLAUDE_CODE_PROMPT', 'DISABLE_CLAUDE_CODE'),
    GIT_BASH_PATH: process.env['GIT_BASH_PATH']
  };
};

let StaticFlag = getStaticFlag();

type STAKey = keyof typeof StaticFlag;

export const Flag = new Proxy(
  {
    // Static variable,
    ...StaticFlag,
    // Dynamic variable
    DISABLE_PROJECT_CONFIG: truthy('DISABLE_PROJECT_CONFIG'),
    ENABLE_EXPERIMENTAL_MODELS: truthy('ENABLE_EXPERIMENTAL_MODELS'),
    BASH_DEFAULT_TIMEOUT_MS: positiveInteger('EXPERIMENTAL_BASH_DEFAULT_TIMEOUT_MS'),
    ENABLE_EXA: some('EXPERIMENTAL', 'ENABLE_EXA', 'EXPERIMENTAL_EXA'),
    ENABLE_PARALLEL: some('ENABLE_PARALLEL', 'EXPERIMENTAL_PARALLEL')
  },
  {
    get(target, key): string | undefined {
      if (Object.hasOwn(StaticFlag, key)) {
        return Reflect.get(StaticFlag, key) as string | undefined;
      }
      return process.env[key.toString()];
    },
    set() {
      log.warn(
        `Method not allowed. If you need to modify environment variables, please use setEnv`
      );
      return false;
    }
  }
);

type Flag = typeof Flag;
export type FlagKey = keyof Flag;

export const setFlag = <T extends string>(
  key: Exclude<T, STAKey>,
  value: string | number | boolean
) => {
  if (Object.hasOwn(StaticFlag, key)) {
    log.warn(`property: ${key} not allowed to be modified`);
    return false;
  }
  process.env[key] = value.toString();
  return true;
};

export const setEnv = (flag: Partial<Flag> & NodeJS.ProcessEnv) => {
  Object.assign(process.env, flag);
  StaticFlag = getStaticFlag();
};
