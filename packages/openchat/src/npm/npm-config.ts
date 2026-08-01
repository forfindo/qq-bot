import Config from '@npmcli/config';
import { definitions, flatten, nerfDarts, shorthands } from '@npmcli/config/lib/definitions';
import { Effect } from 'effect';

export const load = (dir: string): Effect.Effect<Record<string, unknown>> =>
  Effect.tryPromise({
    try: async () => {
      const config = new Config({
        npmPath: '',
        cwd: dir,
        env: { ...process.env },
        argv: [process.execPath, process.execPath],
        execPath: process.execPath,
        platform: process.platform,
        definitions,
        flatten,
        nerfDarts,
        shorthands,
        warn: false
      });
      await config.load();
      return config.flat as Record<string, unknown>;
    },
    catch: cause => cause
  }).pipe(Effect.orElseSucceed(() => ({})));

export const registry = (dir: string) =>
  load(dir).pipe(
    Effect.map(config => {
      const registry =
        typeof config.registry === 'string' ? config.registry : 'https://registry.npmjs.org';
      return registry.endsWith('/') ? registry.slice(0, -1) : registry;
    })
  );
