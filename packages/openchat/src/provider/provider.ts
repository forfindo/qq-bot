import { Context, Effect, Layer } from 'effect';
import { SchemaModels, SchemaProvider } from '@/schema';
import { type LanguageModelV3, NoSuchModelError } from '@ai-sdk/provider';
import { type BundledSDK, resolveSDK } from '@/provider/adapter';
import { AppFileSystem } from '@/file-system';
import { ModuleState } from '@/instance';
import { Config } from '@/config';
import { Auth } from '@/auth';
import { ModelsDev } from '@/models-dev';
import { mapValues, mergeDeep, omit, pickBy, sortBy } from 'remeda';
import { variants } from '@/provider/transform';
import { EffectPromise, Global, iife, Log, TypeGuard } from '@/utils';
import {
  custom,
  type CustomDep,
  type CustomDiscoverModels,
  type CustomModelLoader,
  type CustomVarsLoader
} from '@/provider/custom-loader';
import { Flag } from '@/flag';
import { ModelNotFoundError } from '@/schema/provider';
import fuzzysort from 'fuzzysort';
import path from 'path';

const log = Log.create({ service: 'provider' });
const priority = ['gpt-5', 'claude-sonnet-4', 'big-pickle', 'gemini-3-pro'];

export interface State {
  models: Map<string, LanguageModelV3>;
  providers: Record<SchemaProvider.ProviderID, SchemaProvider.Info>;
  catalog: Record<SchemaProvider.ProviderID, SchemaProvider.Info>;
  sdk: Map<string, BundledSDK>;
  modelLoaders: Record<string, CustomModelLoader>;
  varsLoaders: Record<string, CustomVarsLoader>;
}

function cost(c: SchemaModels.Model['cost']): SchemaProvider.Model['cost'] {
  const result: SchemaProvider.Model['cost'] = {
    input: c?.input ?? 0,
    output: c?.output ?? 0,
    cache: {
      read: c?.cache_read ?? 0,
      write: c?.cache_write ?? 0
    }
  };
  if (c?.tiers) {
    result.tiers = c.tiers.map(item => ({
      input: item.input,
      output: item.output,
      cache: {
        read: item.cache_read ?? 0,
        write: item.cache_write ?? 0
      },
      tier: item.tier
    }));
  }
  if (c?.context_over_200k) {
    result.experimentalOver200K = {
      cache: {
        read: c.context_over_200k.cache_read ?? 0,
        write: c.context_over_200k.cache_write ?? 0
      },
      input: c.context_over_200k.input,
      output: c.context_over_200k.output
    };
  }
  return result;
}

function fromModelsDevModel(
  provider: SchemaModels.Provider,
  model: SchemaModels.Model
): SchemaProvider.Model {
  const base: SchemaProvider.Model = {
    id: SchemaProvider.ModelID.make(model.id),
    providerID: SchemaProvider.ProviderID.make(provider.id),
    name: model.name,
    family: model.family,
    api: {
      id: model.id,
      url: model.provider?.api ?? provider.api ?? '',
      npm: model.provider?.npm ?? provider.npm ?? '@ai-sdk/openai-compatible'
    },
    status: model.status ?? 'active',
    headers: {},
    options: {},
    cost: cost(model.cost),
    limit: {
      context: model.limit.context,
      input: model.limit.input,
      output: model.limit.output
    },
    capabilities: {
      temperature: model.temperature ?? false,
      reasoning: model.reasoning ?? false,
      attachment: model.attachment ?? false,
      toolcall: model.tool_call ?? true,
      input: {
        text: model.modalities?.input?.includes('text') ?? false,
        audio: model.modalities?.input?.includes('audio') ?? false,
        image: model.modalities?.input?.includes('image') ?? false,
        video: model.modalities?.input?.includes('video') ?? false,
        pdf: model.modalities?.input?.includes('pdf') ?? false
      },
      output: {
        text: model.modalities?.output?.includes('text') ?? false,
        audio: model.modalities?.output?.includes('audio') ?? false,
        image: model.modalities?.output?.includes('image') ?? false,
        video: model.modalities?.output?.includes('video') ?? false,
        pdf: model.modalities?.output?.includes('pdf') ?? false
      },
      interleaved: model.interleaved ?? false
    },
    release_date: model.release_date ?? '',
    variants: {}
  };

  return {
    ...base,
    variants: variants(base)
  };
}

function suggestionModelIDs(
  provider: SchemaProvider.Info | undefined,
  enableExperimentalModels: boolean
) {
  if (!provider) {
    return [];
  }
  return Object.keys(provider.models).filter(id => {
    const model = provider.models[id];
    if (model?.status === 'deprecated') {
      return false;
    }
    return !(model?.status === 'alpha' && !enableExperimentalModels);
  });
}

function modelSuggestions(
  provider: SchemaProvider.Info | undefined,
  modelID: SchemaProvider.ModelID,
  enableExperimentalModels: boolean
) {
  const available = suggestionModelIDs(provider, enableExperimentalModels);
  const fuzzy = fuzzysort
    .go(modelID, available, { limit: 3, threshold: -10000 })
    .map(m => m.target);
  if (fuzzy.length) {
    return fuzzy;
  }
  const query = modelID
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter(part => part.length > 1);
  return sortBy(
    available
      .map(id => ({
        id,
        score: query.filter(part => id.toLowerCase().includes(part)).length
      }))
      .filter(item => item.score > 0),
    [item => item.score, 'desc'],
    [item => item.id, 'asc']
  )
    .slice(0, 3)
    .map(item => item.id);
}

export function toPublicInfo(provider: SchemaProvider.Info) {
  return JSON.parse(
    JSON.stringify(provider, (_, value: unknown) => {
      if (typeof value === 'function' || typeof value === 'symbol' || value === void 0) {
        return void 0;
      }
      if (typeof value === 'bigint') {
        return value.toString();
      }
      return value;
    })
  ) as SchemaProvider.Info;
}

export function fromModelsDevProvider(provider: SchemaModels.Provider): SchemaProvider.Info {
  const models: Record<string, SchemaProvider.Model> = {};
  for (const [key, model] of Object.entries(provider.models)) {
    models[key] = fromModelsDevModel(provider, model);
    for (const [mode, opts] of Object.entries(model.experimental?.modes ?? {})) {
      const id = `${model.id}-${mode}`;
      const base = fromModelsDevModel(provider, model);
      models[id] = {
        ...base,
        id: SchemaProvider.ModelID.make(id),
        name: `${model.name} ${mode[0]?.toUpperCase() ?? ''}${mode.slice(1)}`,
        cost: opts.cost ? mergeDeep(base.cost, cost(opts.cost)) : base.cost,
        options: opts.provider?.body
          ? Object.fromEntries(
              Object.entries(opts.provider.body).map(([k, v]) => [
                k.replace(/_([a-z])/g, (_, c: string) => c.toUpperCase()),
                v
              ])
            )
          : base.options,
        headers: opts.provider?.headers ?? base.headers
      };
    }
  }
  return {
    id: SchemaProvider.ProviderID.make(provider.id),
    source: 'custom',
    name: provider.name,
    env: [...(provider.env ?? [])],
    options: {},
    models
  };
}

export function sort<T extends { id: string }>(models: T[]) {
  return sortBy(
    models,
    [model => priority.findIndex(filter => model.id.includes(filter)), 'desc'],
    [model => (model.id.includes('latest') ? 0 : 1), 'asc'],
    [model => model.id, 'desc']
  );
}

export function parseModel(model: string) {
  const [providerID, ...rest] = model.split('/');
  return {
    providerID: SchemaProvider.ProviderID.make(providerID ?? 'unknown'),
    modelID: SchemaProvider.ModelID.make(rest.join('/'))
  };
}

export interface Interface {
  readonly list: () => Effect.Effect<Record<SchemaProvider.ProviderID, SchemaProvider.Info>>;
  readonly getProvider: (
    providerID: SchemaProvider.ProviderID
  ) => Effect.Effect<SchemaProvider.Info>;
  readonly getModel: (
    providerID: SchemaProvider.ProviderID,
    modelID: SchemaProvider.ModelID
  ) => Effect.Effect<SchemaProvider.Model, SchemaProvider.ModelNotFoundError>;
  readonly getLanguage: (
    model: SchemaProvider.Model
  ) => Effect.Effect<LanguageModelV3, SchemaProvider.ModelNotFoundError>;
  readonly closest: (
    providerID: SchemaProvider.ProviderID,
    query: string[]
  ) => Effect.Effect<{ providerID: SchemaProvider.ProviderID; modelID: string } | undefined>;
  readonly getSmallModel: (
    providerID: SchemaProvider.ProviderID
  ) => Effect.Effect<SchemaProvider.Model | undefined>;
  readonly defaultModel: () => Effect.Effect<{
    providerID: SchemaProvider.ProviderID;
    modelID: SchemaProvider.ModelID;
  }>;
}

export class Service extends Context.Service<Service, Interface>()('@openchat/Provider') {}

export const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const fs = yield* AppFileSystem.Service;
    const config = yield* Config.Service;
    const auth = yield* Auth.Service;
    const modelsDevSvc = yield* ModelsDev.Service;

    const state = yield* ModuleState.make<State>(() =>
      Effect.gen(function* () {
        const cfg = yield* config.get();
        const modelsDev = yield* modelsDevSvc.get();
        const catalog = mapValues(modelsDev, fromModelsDevProvider);
        const database = mapValues(catalog, toPublicInfo);

        const providers = {} as Record<SchemaProvider.ProviderID, SchemaProvider.Info>;
        const languages = new Map<string, LanguageModelV3>();
        const modelLoaders: {
          [providerID: string]: CustomModelLoader;
        } = {};
        const varsLoaders: {
          [providerID: string]: CustomVarsLoader;
        } = {};
        const sdk = new Map<string, BundledSDK>();
        const discoveryLoaders: {
          [providerID: string]: CustomDiscoverModels;
        } = {};
        const dep: CustomDep = {
          auth: (id: string) => auth.get(id).pipe(Effect.orDie),
          config: () => config.get(),
          env: () => process.env,
          get: (key: string) => process.env[key]
        };

        function mergeProvider(
          providerID: SchemaProvider.ProviderID,
          provider: Partial<SchemaProvider.Info>
        ) {
          const existing = providers[providerID];
          if (existing) {
            // @ts-expect-error
            providers[providerID] = mergeDeep(existing, provider);
            return;
          }
          const match = database[providerID];
          if (!match) {
            return;
          }
          // @ts-expect-error
          providers[providerID] = mergeDeep(match, provider);
        }

        const configProviders = Object.entries(cfg.provider ?? {});
        const disabled = new Set(cfg.disabled_providers ?? []);
        const enabled = cfg.enabled_providers ? new Set(cfg.enabled_providers) : null;

        function isProviderAllowed(providerID: SchemaProvider.ProviderID): boolean {
          if (enabled && !enabled.has(providerID)) {
            return false;
          }
          return !disabled.has(providerID);
        }

        // extend database from config
        for (const [providerID, provider] of configProviders) {
          const existing = database[providerID];
          const parsed: SchemaProvider.Info = {
            id: SchemaProvider.ProviderID.make(providerID),
            name: provider.name ?? existing?.name ?? providerID,
            env: provider.env ?? existing?.env ?? [],
            options: mergeDeep(existing?.options ?? {}, provider.options ?? {}),
            source: 'config',
            models: existing?.models ?? {}
          };

          for (const [modelID, model] of Object.entries(provider.models ?? {})) {
            const existingModel = parsed.models[model.id ?? modelID];
            const apiID = model.id ?? existingModel?.api.id ?? modelID;
            const apiNpm =
              model.provider?.npm ??
              provider.npm ??
              existingModel?.api.npm ??
              modelsDev[providerID]?.npm ??
              '@ai-sdk/openai-compatible';
            const name = iife(() => {
              if (model.name) {
                return model.name;
              }
              if (model.id && model.id !== modelID) {
                return modelID;
              }
              return existingModel?.name ?? modelID;
            });
            const parsedModel: SchemaProvider.Model = {
              id: SchemaProvider.ModelID.make(modelID),
              api: {
                id: apiID,
                npm: apiNpm,
                url:
                  model.provider?.api ??
                  provider?.api ??
                  existingModel?.api.url ??
                  modelsDev[providerID]?.api ??
                  ''
              },
              status: model.status ?? existingModel?.status ?? 'active',
              name,
              providerID: SchemaProvider.ProviderID.make(providerID),
              capabilities: {
                temperature: model.temperature ?? existingModel?.capabilities.temperature ?? false,
                reasoning: model.reasoning ?? existingModel?.capabilities.reasoning ?? false,
                attachment: model.attachment ?? existingModel?.capabilities.attachment ?? false,
                toolcall: model.tool_call ?? existingModel?.capabilities.toolcall ?? true,
                input: {
                  text:
                    model.modalities?.input?.includes('text') ??
                    existingModel?.capabilities.input.text ??
                    true,
                  audio:
                    model.modalities?.input?.includes('audio') ??
                    existingModel?.capabilities.input.audio ??
                    false,
                  image:
                    model.modalities?.input?.includes('image') ??
                    existingModel?.capabilities.input.image ??
                    false,
                  video:
                    model.modalities?.input?.includes('video') ??
                    existingModel?.capabilities.input.video ??
                    false,
                  pdf:
                    model.modalities?.input?.includes('pdf') ??
                    existingModel?.capabilities.input.pdf ??
                    false
                },
                output: {
                  text:
                    model.modalities?.output?.includes('text') ??
                    existingModel?.capabilities.output.text ??
                    true,
                  audio:
                    model.modalities?.output?.includes('audio') ??
                    existingModel?.capabilities.output.audio ??
                    false,
                  image:
                    model.modalities?.output?.includes('image') ??
                    existingModel?.capabilities.output.image ??
                    false,
                  video:
                    model.modalities?.output?.includes('video') ??
                    existingModel?.capabilities.output.video ??
                    false,
                  pdf:
                    model.modalities?.output?.includes('pdf') ??
                    existingModel?.capabilities.output.pdf ??
                    false
                },
                interleaved:
                  model.interleaved ??
                  existingModel?.capabilities.interleaved ??
                  (!existingModel &&
                  apiNpm === '@ai-sdk/openai-compatible' &&
                  apiID.includes('deepseek')
                    ? { field: 'reasoning_content' }
                    : false)
              },
              cost: {
                input: model?.cost?.input ?? existingModel?.cost?.input ?? 0,
                output: model?.cost?.output ?? existingModel?.cost?.output ?? 0,
                cache: {
                  read: model?.cost?.cache_read ?? existingModel?.cost?.cache.read ?? 0,
                  write: model?.cost?.cache_write ?? existingModel?.cost?.cache.write ?? 0
                }
              },
              options: mergeDeep(existingModel?.options ?? {}, model.options ?? {}),
              limit: {
                context: model.limit?.context ?? existingModel?.limit?.context ?? 0,
                input: model.limit?.input ?? existingModel?.limit?.input,
                output: model.limit?.output ?? existingModel?.limit?.output ?? 0
              },
              headers: mergeDeep(existingModel?.headers ?? {}, model.headers ?? {}),
              family: model.family ?? existingModel?.family ?? '',
              release_date: model.release_date ?? existingModel?.release_date ?? '',
              variants: {}
            };
            const merged = mergeDeep(variants(parsedModel), model.variants ?? {});
            parsedModel.variants = mapValues(
              pickBy(merged, v => !v.disabled),
              v => omit(v, ['disabled'])
            );
            parsed.models[modelID] = parsedModel;
          }
          database[providerID] = parsed;
        }

        // load env
        const envs = dep.env();
        for (const [id, provider] of Object.entries(database)) {
          const providerID = SchemaProvider.ProviderID.make(id);
          if (disabled.has(providerID)) {
            continue;
          }
          const apiKey = provider.env.map(item => envs[item]).find(Boolean);
          if (!apiKey) {
            continue;
          }
          mergeProvider(providerID, {
            source: 'env',
            key: provider.env.length === 1 ? apiKey : void 0
          });
        }

        // load apikeys
        const auths = yield* auth.all().pipe(Effect.orDie);
        for (const [id, provider] of Object.entries(auths)) {
          const providerID = SchemaProvider.ProviderID.make(id);
          if (disabled.has(providerID)) {
            continue;
          }
          if (provider.type === 'api') {
            mergeProvider(providerID, {
              source: 'api',
              key: provider.key
            });
          }
        }

        for (const [id, fn] of Object.entries(custom(dep))) {
          const providerID = SchemaProvider.ProviderID.make(id);
          if (disabled.has(providerID)) {
            continue;
          }
          const data = database[providerID];
          if (!data) {
            log.error('Provider does not exist in model list ' + providerID);
            continue;
          }
          const result = yield* fn(data);
          if (result && (result.autoload || providers[providerID])) {
            if (result.getModel) {
              modelLoaders[providerID] = result.getModel;
            }
            if (result.vars) {
              varsLoaders[providerID] = result.vars;
            }
            if (result.discoverModels) {
              discoveryLoaders[providerID] = result.discoverModels;
            }
            const opts = result.options ?? {};
            const patch: Partial<SchemaProvider.Info> = providers[providerID]
              ? { options: opts }
              : {
                  source: 'custom',
                  options: opts
                };
            mergeProvider(providerID, patch);
          }
        }

        // load config - re-apply with updated data
        for (const [id, provider] of configProviders) {
          const providerID = SchemaProvider.ProviderID.make(id);
          const partial: Partial<SchemaProvider.Info> = { source: 'config' };
          if (provider.env) {
            partial.env = provider.env;
          }
          if (provider.name) {
            partial.name = provider.name;
          }
          if (provider.options) {
            partial.options = provider.options;
          }
          mergeProvider(providerID, partial);
        }

        const gitlab = SchemaProvider.ProviderID.make('gitlab');
        if (discoveryLoaders[gitlab] && providers[gitlab] && isProviderAllowed(gitlab)) {
          yield* Effect.promise(async () => {
            try {
              const discovered = await discoveryLoaders[gitlab]!();
              for (const [modelID, model] of Object.entries(discovered)) {
                if (!providers[gitlab]!.models[modelID]) {
                  providers[gitlab]!.models[modelID] = model;
                }
              }
            } catch (e) {
              log.warn('state discovery error', { id: 'gitlab', error: e });
            }
          });
        }

        for (const [id, provider] of Object.entries(providers)) {
          const providerID = SchemaProvider.ProviderID.make(id);
          if (!isProviderAllowed(providerID)) {
            delete providers[providerID];
            continue;
          }

          const configProvider = cfg.provider?.[providerID];

          for (const [modelID, model] of Object.entries(provider.models)) {
            model.api.id = model.api.id ?? model.id ?? modelID;
            if (
              // These chat aliases are invalid for the special handling in the
              // built-in providers below, but custom providers may support them.
              (modelID === 'gpt-5-chat-latest' &&
                (providerID === SchemaProvider.ProviderID.openai ||
                  providerID === SchemaProvider.ProviderID.githubCopilot ||
                  providerID === SchemaProvider.ProviderID.openrouter)) ||
              (providerID === SchemaProvider.ProviderID.openrouter &&
                modelID === 'openai/gpt-5-chat')
            ) {
              delete provider.models[modelID];
            }
            if (model.status === 'alpha' && !Flag.ENABLE_EXPERIMENTAL_MODELS) {
              delete provider.models[modelID];
            }
            if (model.status === 'deprecated') {
              delete provider.models[modelID];
            }
            if (
              (configProvider?.blacklist && configProvider.blacklist.includes(modelID)) ||
              (configProvider?.whitelist && !configProvider.whitelist.includes(modelID))
            ) {
              delete provider.models[modelID];
            }

            if (!model.variants || Object.keys(model.variants).length === 0) {
              model.variants = variants(model);
            }

            const configVariants = configProvider?.models?.[modelID]?.variants;
            if (configVariants && model.variants) {
              const merged = mergeDeep(model.variants, configVariants);
              model.variants = mapValues(
                pickBy(merged, v => !v.disabled),
                v => omit(v, ['disabled'])
              );
            }
          }

          if (Object.keys(provider.models).length === 0) {
            delete providers[providerID];
            continue;
          }

          log.info('found', { providerID });
        }

        return {
          models: languages,
          providers,
          catalog,
          sdk,
          modelLoaders,
          varsLoaders
        };
      })
    );

    const list = Effect.fn('Provider.list')(() => ModuleState.use(state, s => s.providers));

    const getProvider = Effect.fn('Provider.getProvider')((providerID: SchemaProvider.ProviderID) =>
      ModuleState.use(state, s => s.providers[providerID]!)
    );

    const getModel = Effect.fn('Provider.getModel')(function* (
      providerID: SchemaProvider.ProviderID,
      modelID: SchemaProvider.ModelID
    ) {
      const s = yield* ModuleState.get(state);
      const provider = s.providers[providerID];
      if (!provider) {
        const catalogProvider = s.catalog[providerID];
        const suggestions = catalogProvider
          ? modelSuggestions(catalogProvider, modelID, Flag.ENABLE_EXPERIMENTAL_MODELS)
          : fuzzysort
              .go(providerID, Object.keys({ ...s.catalog, ...s.providers }), {
                limit: 3,
                threshold: -10000
              })
              .map(m => m.target);
        return yield* new ModelNotFoundError({ providerID, modelID, suggestions });
      }

      const info = provider.models[modelID];
      if (!info) {
        const current = modelSuggestions(provider, modelID, Flag.ENABLE_EXPERIMENTAL_MODELS);
        const suggestions = current.length
          ? current
          : modelSuggestions(s.catalog[providerID], modelID, Flag.ENABLE_EXPERIMENTAL_MODELS);
        return yield* new ModelNotFoundError({ providerID, modelID, suggestions });
      }
      return info;
    });

    const getLanguage = Effect.fn('Provider.getLanguage')(function* (model: SchemaProvider.Model) {
      const s = yield* ModuleState.get(state);
      const key = `${model.providerID}/${model.id}`;
      if (s.models.has(key)) {
        return s.models.get(key)!;
      }

      const provider = s.providers[model.providerID];
      if (!provider) {
        yield* Effect.fail(
          new ModelNotFoundError({ modelID: model.id, providerID: model.providerID })
        );
      }
      return yield* EffectPromise.refineRejection(
        async () => {
          const sdk = await resolveSDK(model, s);
          const language = s.modelLoaders[model.providerID]
            ? await s.modelLoaders[model.providerID]!(sdk, model.api.id, {
                ...provider!.options,
                ...model.options
              })
            : sdk.languageModel(model.api.id);
          if (!language) {
            throw new ModelNotFoundError({ modelID: model.id, providerID: model.providerID });
          }
          s.models.set(key, language);
          return language;
        },
        cause =>
          cause instanceof NoSuchModelError
            ? new ModelNotFoundError({ modelID: model.id, providerID: model.providerID, cause })
            : void 0
      );
    });

    const closest = Effect.fn('Provider.closest')(function* (
      providerID: SchemaProvider.ProviderID,
      query: string[]
    ) {
      const s = yield* ModuleState.get(state);
      const provider = s.providers[providerID];
      if (!provider) {
        return void 0;
      }
      for (const item of query) {
        for (const modelID of Object.keys(provider.models)) {
          if (modelID.includes(item)) {
            return { providerID, modelID };
          }
        }
      }
      return void 0;
    });

    const getSmallModel = Effect.fn('Provider.getSmallModel')(function* (
      providerID: SchemaProvider.ProviderID
    ) {
      const cfg = yield* config.get();

      if (cfg.small_model) {
        const parsed = parseModel(cfg.small_model);
        return yield* getModel(parsed.providerID, parsed.modelID).pipe(
          Effect.catchTag('ProviderModelNotFoundError', () => Effect.succeed(void 0))
        );
      }

      const s = yield* ModuleState.get(state);
      const provider = s.providers[providerID];
      if (!provider) {
        return void 0;
      }

      let priority = [
        'claude-haiku-4-5',
        'claude-haiku-4.5',
        '3-5-haiku',
        '3.5-haiku',
        'gemini-3-flash',
        'gemini-2.5-flash',
        'gpt-5-nano'
      ];
      if (providerID.startsWith('opencode')) {
        priority = ['gpt-5-nano'];
      }
      if (providerID.startsWith('github-copilot')) {
        priority = ['gpt-5-mini', 'claude-haiku-4.5', ...priority];
      }
      for (const item of priority) {
        if (providerID === SchemaProvider.ProviderID.amazonBedrock) {
          const crossRegionPrefixes = ['global.', 'us.', 'eu.'];
          const candidates = Object.keys(provider.models).filter(m => m.includes(item));

          const globalMatch = candidates.find(m => m.startsWith('global.'));
          if (globalMatch) {
            return provider.models[globalMatch];
          }

          const region = provider.options?.region as string;
          if (region) {
            const regionPrefix = region.split('-')[0];
            if (regionPrefix === 'us' || regionPrefix === 'eu') {
              const regionalMatch = candidates.find(m => m.startsWith(`${regionPrefix}.`));
              if (regionalMatch) {
                return provider.models[regionalMatch];
              }
            }
          }

          const unprefixed = candidates.find(m => !crossRegionPrefixes.some(p => m.startsWith(p)));
          if (unprefixed) {
            return provider.models[unprefixed];
          }
        } else {
          for (const model of Object.keys(provider.models)) {
            if (model.includes(item)) {
              return provider.models[model];
            }
          }
        }
      }
      return void 0;
    });

    const defaultModel = Effect.fn('Provider.defaultModel')(function* () {
      const cfg = yield* config.get();
      if (cfg.model) {
        return parseModel(cfg.model);
      }

      const s = yield* ModuleState.get(state);
      const recent = yield* fs.readJson(path.join(Global.Path.state, 'model.json')).pipe(
        Effect.map(
          (x): { providerID: SchemaProvider.ProviderID; modelID: SchemaProvider.ModelID }[] => {
            if (!TypeGuard.isRecord(x) || !Array.isArray(x.recent)) {
              return [];
            }
            return x.recent.flatMap(item => {
              if (!TypeGuard.isRecord(item)) {
                return [];
              }
              if (typeof item.providerID !== 'string') {
                return [];
              }
              if (typeof item.modelID !== 'string') {
                return [];
              }
              return [
                {
                  providerID: SchemaProvider.ProviderID.make(item.providerID),
                  modelID: SchemaProvider.ModelID.make(item.modelID)
                }
              ];
            });
          }
        ),
        Effect.catch(() =>
          Effect.succeed(
            [] as {
              providerID: SchemaProvider.ProviderID;
              modelID: SchemaProvider.ModelID;
            }[]
          )
        )
      );
      for (const entry of recent) {
        const provider = s.providers[entry.providerID];
        if (!provider) {
          continue;
        }
        if (!provider.models[entry.modelID]) {
          continue;
        }
        return { providerID: entry.providerID, modelID: entry.modelID };
      }

      const provider = Object.values(s.providers).find(
        p => !cfg.provider || Object.keys(cfg.provider).includes(p.id)
      );
      if (!provider) {
        throw new Error('no providers found');
      }
      const [model] = sort(Object.values(provider.models));
      if (!model) {
        throw new Error('no models found');
      }
      return {
        providerID: provider.id,
        modelID: model.id
      };
    });

    return Service.of({
      list,
      getProvider,
      getModel,
      getLanguage,
      closest,
      getSmallModel,
      defaultModel
    });
  })
);

export const defaultLayer = Layer.suspend(() =>
  layer.pipe(
    Layer.provide(AppFileSystem.defaultLayer),
    Layer.provide(Config.defaultLayer),
    Layer.provide(Auth.defaultLayer),
    Layer.provide(ModelsDev.defaultLayer)
  )
);
