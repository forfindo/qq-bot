import { SchemaFs, SchemaMessage } from '@/schema';
import { Context, Effect, Layer } from 'effect';
import { Config } from '@/config';
import { AppFileSystem } from '@/file';
import { FetchHttpClient, HttpClient, HttpClientRequest } from 'effect/unstable/http';
import { Global, withTransientReadRetry } from '@/utils';
import path from 'path';
import { Flag } from '@/flag';
import { InstanceContext, ModuleState } from '@/instance';

const FILES = [
  'AGENTS.md',
  ...(Flag.DISABLE_CLAUDE_CODE_PROMPT ? [] : ['CLAUDE.md']),
  'CONTEXT.md' // deprecated
];

const extract = (messages: SchemaMessage.WithParts[]) => {
  const paths = new Set<string>();
  for (const msg of messages) {
    for (const part of msg.parts) {
      if (part.type === 'tool' && part.tool === 'read' && part.state.status === 'completed') {
        if (part.state.time.compacted) {
          continue;
        }
        const loaded: unknown = part.state.metadata?.loaded;
        if (!loaded || !Array.isArray(loaded)) {
          continue;
        }
        for (const p of loaded) {
          if (typeof p === 'string') {
            paths.add(p);
          }
        }
      }
    }
  }
  return paths;
};

interface State {
  claims: Map<SchemaMessage.MessageID, Set<string>>;
  remote: Map<string, string>;
}

export interface Interface {
  readonly clear: (messageID: SchemaMessage.MessageID) => Effect.Effect<void>;
  readonly systemPaths: () => Effect.Effect<Set<string>, SchemaFs.Error>;
  readonly system: () => Effect.Effect<string[], SchemaFs.Error>;
  readonly find: (dir: string) => Effect.Effect<string | undefined, SchemaFs.Error>;
  readonly resolve: (
    messages: SchemaMessage.WithParts[],
    filepath: string,
    messageID: SchemaMessage.MessageID
  ) => Effect.Effect<{ filepath: string; content: string }[], SchemaFs.Error>;
}

export class Service extends Context.Service<Service, Interface>()('@openchat/Instruction') {}

export const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const cfg = yield* Config.Service;
    const fs = yield* AppFileSystem.Service;
    const http = HttpClient.filterStatusOk(withTransientReadRetry(yield* HttpClient.HttpClient));
    const globalFiles = [
      path.join(Flag.CONFIG_DIR ?? Global.Path.config, 'AGENTS.md'),
      ...(!Flag.DISABLE_CLAUDE_CODE_PROMPT
        ? [path.join(Global.Path.home, '.claude', 'CLAUDE.md')]
        : [])
    ];

    const state = yield* ModuleState.make<State>(
      Effect.fn('Instruction.state')(() =>
        Effect.succeed({
          // Track which instruction files have already been attached for a given assistant message.
          claims: new Map<SchemaMessage.MessageID, Set<string>>(),
          // In-memory cache of remote instruction contents, keyed by URL.
          remote: new Map<string, string>()
        })
      )
    );

    const relative = Effect.fnUntraced(
      function* (instruction: string) {
        const directory = yield* InstanceContext.directory;
        if (!Flag.DISABLE_PROJECT_CONFIG) {
          return yield* fs
            .globUp(instruction, directory, directory)
            .pipe(Effect.catch(() => Effect.succeed([] as string[])));
        }
        const configPath = Flag.CONFIG_DIR ?? Global.Path.config;
        return yield* fs
          .globUp(instruction, configPath, configPath)
          .pipe(Effect.catch(() => Effect.succeed([] as string[])));
      },
      Effect.provideService(AppFileSystem.Service, fs)
    );

    const read = Effect.fnUntraced(function* (filepath: string) {
      return yield* fs.readFileString(filepath).pipe(Effect.catch(() => Effect.succeed('')));
    });

    const fetch = Effect.fnUntraced(function* (url: string) {
      const s = yield* ModuleState.get(state);
      const cached = s.remote.get(url);
      if (cached !== void 0) {
        return cached;
      }
      const res = yield* http.execute(HttpClientRequest.get(url)).pipe(
        Effect.timeout(5000),
        Effect.catch(() => Effect.succeed(null))
      );
      if (!res) {
        return '';
      }
      const body = yield* res.arrayBuffer.pipe(
        Effect.catch(() => Effect.succeed(new ArrayBuffer(0)))
      );
      const text = new TextDecoder().decode(body);
      if (text) {
        s.remote.set(url, text);
      }
      return text;
    });

    const clear = Effect.fn('Instruction.clear')(function* (messageID: SchemaMessage.MessageID) {
      const s = yield* ModuleState.get(state);
      s.claims.delete(messageID);
    });

    const systemPaths = Effect.fn('Instruction.systemPaths')(
      function* () {
        const config = yield* cfg.get();
        const directory = yield* InstanceContext.directory;
        const paths = new Set<string>();

        for (const file of globalFiles) {
          if (yield* fs.existsSafe(file)) {
            paths.add(path.resolve(file));
            break;
          }
        }

        // The first project-level match wins so we don't stack AGENTS.md/CLAUDE.md from every ancestor.
        if (!Flag.DISABLE_PROJECT_CONFIG) {
          for (const file of FILES) {
            const matches = yield* fs.findUp(file, directory, directory);
            if (matches.length > 0) {
              matches.forEach(item => paths.add(path.resolve(item)));
              break;
            }
          }
        }

        if (config.instructions) {
          for (const raw of config.instructions) {
            if (raw.startsWith('https://') || raw.startsWith('http://')) {
              continue;
            }
            const instruction = raw.startsWith('~/')
              ? path.join(Global.Path.home, raw.slice(2))
              : raw;
            const matches = yield* (
              path.isAbsolute(instruction)
                ? fs.glob(path.basename(instruction), {
                    cwd: path.dirname(instruction),
                    absolute: true,
                    include: 'file'
                  })
                : relative(instruction)
            ).pipe(Effect.catch(() => Effect.succeed([] as string[])));
            matches.forEach(item => paths.add(path.resolve(item)));
          }
        }
        return paths;
      },
      Effect.provideService(AppFileSystem.Service, fs)
    );

    const system = Effect.fn('Instruction.system')(function* () {
      const config = yield* cfg.get();
      const paths = yield* systemPaths();
      const urls = [
        ...new Set(
          (config.instructions ?? []).filter(
            item => item.startsWith('https://') || item.startsWith('http://')
          )
        )
      ];

      const files = yield* Effect.forEach(Array.from(paths), read, { concurrency: 8 });
      const remote = yield* Effect.forEach(urls, fetch, { concurrency: 4 });

      return [
        ...Array.from(paths).flatMap((item, i) =>
          files[i] ? [`Instructions from: ${item}\n${files[i]}`] : []
        ),
        ...urls.flatMap((item, i) =>
          remote[i] ? [`Instructions from: ${item}\n${remote[i]}`] : []
        )
      ];
    });

    const find = Effect.fn('Instruction.find')(function* (dir: string) {
      for (const file of FILES) {
        const filepath = path.resolve(path.join(dir, file));
        if (yield* fs.existsSafe(filepath)) {
          return filepath;
        }
      }
      return void 0;
    });

    const resolve = Effect.fn('Instruction.resolve')(
      function* (
        messages: SchemaMessage.WithParts[],
        filepath: string,
        messageID: SchemaMessage.MessageID
      ) {
        const sys = yield* systemPaths();
        const already = extract(messages);
        const results: { filepath: string; content: string }[] = [];
        const s = yield* ModuleState.get(state);
        const root = path.resolve(yield* InstanceContext.directory);

        const target = path.resolve(filepath);
        let current = path.dirname(target);

        // Walk upward from the file being read and attach nearby instruction files once per message.
        while (current.startsWith(root) && current !== root) {
          const found = yield* find(current);
          if (!found || found === target || sys.has(found) || already.has(found)) {
            current = path.dirname(current);
            continue;
          }

          let set = s.claims.get(messageID);
          if (!set) {
            set = new Set();
            s.claims.set(messageID, set);
          }
          if (set.has(found)) {
            current = path.dirname(current);
            continue;
          }

          set.add(found);
          const content = yield* read(found);
          if (content) {
            results.push({ filepath: found, content: `Instructions from: ${found}\n${content}` });
          }

          current = path.dirname(current);
        }

        return results;
      },
      Effect.provideService(AppFileSystem.Service, fs)
    );

    return Service.of({
      clear,
      systemPaths,
      system,
      find,
      resolve
    });
  })
);

export const defaultLayer = layer.pipe(
  Layer.provide(Config.defaultLayer),
  Layer.provide(AppFileSystem.defaultLayer),
  Layer.provide(FetchHttpClient.layer)
);
