import path from 'path';
import npa from 'npm-package-arg';
import { Effect, Context, Layer, Option } from 'effect';
import { AppFileSystem } from '@/file';
import { Global, Flock, iife } from '@/utils';
import { makeRuntime } from '@/runtime/runtime';
import { SchemaNpm } from '@/schema';
import { load } from '@/npm/npm-config';
import { LayerNode } from '@/runtime';

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
  readonly install: (
    dir: string,
    input?: {
      add: {
        name: string;
        version?: string;
      }[];
    }
  ) => Effect.Effect<void, Flock.LockError | SchemaNpm.InstallFailedError>;
}

export class Service extends Context.Service<Service, Interface>()('@openchat/Npm') {}

const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const afs = yield* AppFileSystem.Service;
    const directory = (pkg: string) => path.join(Global.Path.cache, 'packages', sanitize(pkg));
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

    const install: Interface['install'] = Effect.fn('Npm.install')(function* (dir, input) {
      const canWrite = yield* afs.access(dir, { writable: true }).pipe(
        Effect.as(true),
        Effect.orElseSucceed(() => false)
      );
      if (!canWrite) {
        return;
      }

      const add = input?.add.map(pkg => [pkg.name, pkg.version].filter(Boolean).join('@')) ?? [];
      if (
        yield* Effect.gen(function* () {
          const nodeModulesExists = yield* afs.existsSafe(path.join(dir, 'node_modules'));
          if (!nodeModulesExists) {
            yield* reify({ add, dir });
            return true;
          }
          return false;
        }).pipe(Effect.withSpan('Npm.checkNodeModules'))
      ) {
        return;
      }

      yield* Effect.gen(function* () {
        const pkg = yield* afs
          .readJson(path.join(dir, 'package.json'))
          .pipe(Effect.orElseSucceed(() => ({})));
        const lock = yield* afs
          .readJson(path.join(dir, 'package-lock.json'))
          .pipe(Effect.orElseSucceed(() => ({})));

        const pkgAny = pkg as Record<string, unknown>;
        const lockAny = lock as Record<string, unknown>;
        const declared = new Set([
          ...Object.keys(pkgAny?.dependencies || {}),
          ...Object.keys(pkgAny?.devDependencies || {}),
          ...Object.keys(pkgAny?.peerDependencies || {}),
          ...Object.keys(pkgAny?.optionalDependencies || {}),
          ...(input?.add || []).map(pkg => pkg.name)
        ]);

        // @ts-ignore
        const root = (lockAny?.packages?.[''] || {}) as Record<string, unknown>;
        const locked = new Set([
          ...Object.keys(root?.dependencies || {}),
          ...Object.keys(root?.devDependencies || {}),
          ...Object.keys(root?.peerDependencies || {}),
          ...Object.keys(root?.optionalDependencies || {})
        ]);

        for (const name of declared) {
          if (!locked.has(name)) {
            yield* reify({ dir, add });
            return;
          }
        }
      }).pipe(Effect.withSpan('Npm.checkDirty'));

      return;
    }, Effect.scoped);

    return Service.of({
      add,
      install
    });
  })
);

export const node = LayerNode.make({
  service: Service,
  layer,
  deps: [AppFileSystem.node]
});

const { runPromise } = makeRuntime(Service, LayerNode.compile(node));

export async function add(...args: Parameters<Interface['add']>) {
  const entry = await runPromise(svc => svc.add(...args));
  return {
    directory: entry.directory,
    entrypoint: Option.getOrUndefined(entry.entrypoint)
  };
}
