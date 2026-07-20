import path from 'path';
import fs from 'fs/promises';
import os from 'os';
import { Context, Layer } from 'effect';
import { Flag } from '@/flag';
import { isRecord } from '@/utils/type-guard';

const app = 'openchat';
const basePath = path.resolve('.', app);
const data = path.resolve(basePath, 'data');
const cache = path.resolve(basePath, 'cache');
const config = path.resolve(basePath, 'config');
const state = path.resolve(basePath, 'state');
const tmp = path.resolve(os.tmpdir(), app);

const paths = {
  get home() {
    return Flag.TEST_HOME ?? os.homedir();
  },
  data,
  bin: path.join(cache, 'bin'),
  log: path.join(data, 'log'),
  repos: path.join(data, 'repos'),
  cache,
  config,
  state,
  tmp
};

const ensureGitignore = () => {
  const gitignore = path.resolve('.', '.gitignore');
  return fs
    .readFile(gitignore, 'utf-8')
    .then(
      text => {
        const lines = text.split('\n').map(item => item.trim());
        if (!lines.includes('.openchat')) {
          lines.push('.openchat');
        }
        if (!lines.includes('openchat')) {
          lines.push('openchat');
        }
        return lines.join('\n');
      },
      (err: unknown) => {
        if (isRecord(err) && err.code === 'ENOENT') {
          return ['.openchat', 'openchat', '\n'].join('\n');
        } else {
          throw new Error('ensureGitignore readFile error', {
            cause: err
          });
        }
      }
    )
    .then(text => {
      return fs.writeFile(gitignore, text, 'utf-8');
    });
};

export const Path = paths;

await Promise.all([
  fs.mkdir(Path.data, { recursive: true }),
  fs.mkdir(Path.config, { recursive: true }),
  fs.mkdir(Path.state, { recursive: true }),
  fs.mkdir(Path.tmp, { recursive: true }),
  fs.mkdir(Path.log, { recursive: true }),
  fs.mkdir(Path.bin, { recursive: true }),
  fs.mkdir(Path.repos, { recursive: true }),
  ensureGitignore()
]);

export class Service extends Context.Service<Service, Interface>()('@openchat/Global') {
}

export interface Interface {
  readonly home: string;
  readonly data: string;
  readonly cache: string;
  readonly config: string;
  readonly state: string;
  readonly tmp: string;
  readonly bin: string;
  readonly log: string;
  readonly repos: string;
}

export function make(input: Partial<Interface> = {}): Interface {
  return {
    home: Path.home,
    data: Path.data,
    cache: Path.cache,
    config: Flag.CONFIG_DIR ?? Path.config,
    state: Path.state,
    tmp: Path.tmp,
    bin: Path.bin,
    log: Path.log,
    repos: Path.repos,
    ...input
  };
}

export const layer = Layer.succeed(Service, Service.of(make()));

export const defaultLayer = layer;

export const layerWith = (input: Partial<Interface>) => Layer.succeed(Service, Service.of(make(input)));
