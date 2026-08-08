import { Context, Effect, Layer } from 'effect';
import { SchemaAgent, SchemaSkill } from '@/schema';
import { Bus } from '@/bus';
import { AppFileSystem } from '@/file-system';
import { Config, ConfigMarkdown } from '@/config';
import { ModuleState } from '@/instance';
import { Glob, Global, Log, TypeGuard } from '@/utils';
import path from 'path';
import * as Discovery from './discovery';
import { Flag } from '@/flag';
import { getDirectory } from '@/instance/instance-context';
import { Permission } from '@/permission';

const log = Log.create({ service: 'skill' });
const CLAUDE_EXTERNAL_DIR = '.claude';
const AGENTS_EXTERNAL_DIR = '.agents';
const EXTERNAL_SKILL_PATTERN = 'skills/**/SKILL.md';
const OPENCHAT_SKILL_PATTERN = '{skill,skills}/**/SKILL.md';
const SKILL_PATTERN = '**/SKILL.md';

const isSkillFrontmatter = (data: unknown): data is { name: string; description?: string } => {
  return (
    TypeGuard.isRecord(data) &&
    typeof data.name === 'string' &&
    (data.description === void 0 || typeof data.description === 'string')
  );
};

const scan = Effect.fnUntraced(function* (
  state: ScanState,
  root: string,
  pattern: string,
  opts?: { dot?: boolean; scope?: string }
) {
  const matches = yield* Effect.tryPromise({
    try: () =>
      Glob.scan(pattern, {
        cwd: root,
        absolute: true,
        include: 'file',
        symlink: true,
        dot: opts?.dot
      }),
    catch: error => error
  }).pipe(
    Effect.catch(error => {
      if (!opts?.scope) {
        return Effect.die(error);
      }
      log.error(`failed to scan ${opts.scope} skills`, { dir: root, error });
      return Effect.succeed([] as string[]);
    })
  );

  for (const match of matches) {
    state.matches.add(match);
    state.dirs.add(path.dirname(match));
  }
});

const add = Effect.fnUntraced(function* (state: State, match: string) {
  const md = yield* ConfigMarkdown.parse(match).pipe(
    Effect.catch(err => {
      // TODO
      // const message = ConfigMarkdown.FrontmatterError.isInstance(err)
      //   ? err.data.message
      //   : `Failed to parse skill ${match}`
      // const { Session } = yield* Effect.promise(() => import("@/session/session"))
      // yield* bus.publish(Session.Event.Error, { error: new NamedError.Unknown({ message }).toObject() })
      log.error('failed to load skill', { skill: match, err });
      return Effect.succeed(void 0);
    })
  );

  if (!md) {
    return;
  }

  if (!isSkillFrontmatter(md.data)) {
    return;
  }

  if (state.skills[md.data.name]) {
    log.warn('duplicate skill name', {
      name: md.data.name,
      existing: state.skills[md.data.name]!.location,
      duplicate: match
    });
  }

  state.dirs.add(path.dirname(match));
  state.skills[md.data.name] = {
    name: md.data.name,
    description: md.data.description,
    location: match,
    content: md.content
  };
});

const loadSkills = Effect.fnUntraced(function* (
  state: State,
  discovered: DiscoveryState,
  bus: Bus.Interface
) {
  void bus;
  yield* Effect.forEach(discovered.matches, match => add(state, match), {
    concurrency: 'unbounded',
    discard: true
  });

  log.info('init', { count: Object.keys(state.skills).length });
});

interface State {
  skills: Record<string, SchemaSkill.Info>;
  dirs: Set<string>;
}

interface ScanState {
  matches: Set<string>;
  dirs: Set<string>;
}

interface DiscoveryState {
  matches: string[];
  dirs: string[];
}

export interface Interface {
  readonly get: (name: string) => Effect.Effect<SchemaSkill.Info | undefined>;
  readonly all: () => Effect.Effect<SchemaSkill.Info[]>;
  readonly dirs: () => Effect.Effect<string[]>;
  readonly available: (agent?: SchemaAgent.Info) => Effect.Effect<SchemaSkill.Info[]>;
}

export class Service extends Context.Service<Service, Interface>()('@openchat/Skill') {}

export const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const discovery = yield* Discovery.Service;
    const config = yield* Config.Service;
    const bus = yield* Bus.Service;
    const fs = yield* AppFileSystem.Service;
    const global = yield* Global.Service;

    const discovered = yield* ModuleState.make<DiscoveryState>(
      Effect.fn('Skill.discovery')(
        function* (ctx) {
          const state: ScanState = { matches: new Set(), dirs: new Set() };
          const directory = yield* getDirectory(ctx.uid);

          const externalDirs: string[] = [];
          if (!Flag.DISABLE_EXTERNAL_SKILLS) {
            if (!Flag.DISABLE_CLAUDE_CODE_SKILLS) {
              externalDirs.push(CLAUDE_EXTERNAL_DIR);
            }
            externalDirs.push(AGENTS_EXTERNAL_DIR);

            for (const dir of externalDirs) {
              const root = path.join(global.home, dir);
              if (!(yield* fs.isDir(root))) {
                continue;
              }
              yield* scan(state, root, EXTERNAL_SKILL_PATTERN, { dot: true, scope: 'global' });
            }

            const upDirs = yield* fs
              .up({ targets: externalDirs, start: directory, stop: directory })
              .pipe(Effect.catch(() => Effect.succeed([] as string[])));

            for (const root of upDirs) {
              yield* scan(state, root, EXTERNAL_SKILL_PATTERN, { dot: true, scope: 'project' });
            }
          }

          const configDirs = yield* config.directories();
          for (const dir of configDirs) {
            yield* scan(state, dir, OPENCHAT_SKILL_PATTERN);
          }

          const cfg = yield* config.get();
          for (const item of cfg.skills?.paths ?? []) {
            const expanded = item.startsWith('~/') ? path.join(global.home, item.slice(2)) : item;
            const dir = path.isAbsolute(expanded) ? expanded : path.join(directory, expanded);
            if (!(yield* fs.isDir(dir))) {
              log.warn('skill path not found', { path: dir });
              continue;
            }

            yield* scan(state, dir, SKILL_PATTERN);
          }

          for (const url of cfg.skills?.urls ?? []) {
            const pulledDirs = yield* discovery.pull(url);
            for (const dir of pulledDirs) {
              yield* scan(state, dir, SKILL_PATTERN);
            }
          }

          return {
            matches: Array.from(state.matches),
            dirs: Array.from(state.dirs)
          };
        },
        Effect.provideService(AppFileSystem.Service, fs)
      )
    );

    const state = yield* ModuleState.make<State>(
      Effect.fn('Skill.state')(
        function* () {
          const s: State = { skills: {}, dirs: new Set() };
          yield* loadSkills(s, yield* ModuleState.get(discovered), bus);
          return s;
        },
        Effect.provideService(AppFileSystem.Service, fs)
      )
    );

    const get = Effect.fn('Skill.get')(function* (name: string) {
      return yield* ModuleState.use(state, s => s.skills[name]);
    });

    const all = Effect.fn('Skill.all')(function* () {
      return yield* ModuleState.use(state, s => Object.values(s.skills));
    });

    const dirs = Effect.fn('Skill.dirs')(function* () {
      return yield* ModuleState.use(discovered, s => s.dirs);
    });

    const available = Effect.fn('Skill.available')(function* (agent?: SchemaAgent.Info) {
      const s = yield* ModuleState.get(state);
      const list = Object.values(s.skills).toSorted((a, b) => a.name.localeCompare(b.name));
      if (!agent) {
        return list;
      }
      return list.filter(
        skill => Permission.evaluate('skill', skill.name, agent.permission).action !== 'deny'
      );
    });

    return Service.of({
      get,
      all,
      dirs,
      available
    });
  })
);

export const defaultLayer = layer.pipe(
  Layer.provide(AppFileSystem.defaultLayer),
  Layer.provide(Bus.defaultLayer),
  Layer.provide(Config.defaultLayer),
  Layer.provide(Discovery.defaultLayer),
  Layer.provide(Global.defaultLayer)
);
