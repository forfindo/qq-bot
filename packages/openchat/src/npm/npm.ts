import path from 'path';
import npa from 'npm-package-arg';
import { Effect, Context, Layer, Option } from 'effect';
import { NodeFileSystem } from '@effect/platform-node';
import { AppFileSystem } from '@/file-system';
import { Global, Flock, iife } from '@/utils';
import { makeRuntime } from '@/runtime/runtime';
import { SchemaNpm } from '@/schema';
import { load } from '@/npm/npm-config';

const illegal =
  process.platform === 'win32' ? new Set(['<', '>', ':', '"', '|', '?', '*']) : void 0;

export function sanitize(pkg: string) {
  if (!illegal) {
    return pkg;
  }
  return Array.from(pkg, char => (illegal.has(char) || char.charCodeAt(0) < 32 ? '_' : char)).join(
    ''
  );
}

const resolveEntryPoint = (name: string, dir: string): SchemaNpm.EntryPoint => {
  let entrypoint: Option.Option<string>;
  try {
    const resolved = import.meta.resolve(dir);
    entrypoint = Option.some(resolved);
  } catch {
    entrypoint = Option.none();
  }
  return {
    directory: dir,
    entrypoint
  };
};

export interface Interface {
  readonly add: (
    pkg: string
  ) => Effect.Effect<SchemaNpm.EntryPoint, SchemaNpm.InstallFailedError | Flock.LockError>;
}

export class Service extends Context.Service<Service, Interface>()('@openchat/Npm') {}

export const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const afs = yield* AppFileSystem.Service;
    const global = yield* Global.Service;
    const directory = (pkg: string) => path.join(global.cache, 'packages', sanitize(pkg));
    const reify = (input: { dir: string; add?: string[] }) =>
      Effect.gen(function* () {
        yield* Flock.effect(`npm-install:${input.dir}`);
        const { Arborist } = yield* Effect.promise(() => import('@npmcli/arborist'));
        const add = input.add ?? [];
        const npmOptions = yield* load(input.dir);
        const arborist = new Arborist({
          ...npmOptions,
          path: input.dir,
          binLinks: true,
          progress: false,
          savePrefix: '',
          ignoreScripts: true
        });
        return yield* Effect.tryPromise({
          try: () =>
            arborist.reify({
              ...npmOptions,
              add,
              save: true,
              saveType: 'prod'
            }),
          catch: cause =>
            new SchemaNpm.InstallFailedError({
              cause,
              add,
              dir: input.dir
            })
        });
      }).pipe(
        Effect.withSpan('Npm.reify', {
          attributes: input
        })
      );

    const add = Effect.fn('Npm.add')(function* (pkg: string) {
      const dir = directory(pkg);
      const name = iife(() => {
        try {
          return npa(pkg).name ?? pkg;
        } catch {
          return pkg;
        }
      });

      if (yield* afs.existsSafe(path.join(dir, 'node_modules', name))) {
        return resolveEntryPoint(name, path.join(dir, 'node_modules', name));
      }

      const tree = yield* reify({ dir, add: [pkg] });
      const first = tree.edgesOut.values().next().value?.to;
      if (!first) {
        const result = resolveEntryPoint(name, path.join(dir, 'node_modules', name));
        if (Option.isSome(result.entrypoint)) {
          return result;
        }
        return yield* new SchemaNpm.InstallFailedError({ add: [pkg], dir });
      }
      return resolveEntryPoint(first.name, first.path);
    }, Effect.scoped);

    return Service.of({
      add
    });
  })
);

export const defaultLayer = layer.pipe(
  Layer.provide(AppFileSystem.layer),
  Layer.provide(Global.layer),
  Layer.provide(NodeFileSystem.layer)
);

const { runPromise } = makeRuntime(Service, defaultLayer);

export async function add(...args: Parameters<Interface['add']>) {
  const entry = await runPromise(svc => svc.add(...args));
  return {
    directory: entry.directory,
    entrypoint: Option.getOrUndefined(entry.entrypoint)
  };
}
