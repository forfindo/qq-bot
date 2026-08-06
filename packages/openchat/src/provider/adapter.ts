import type { LanguageModelV3 } from '@ai-sdk/provider';
import { pathToFileURL } from 'url';
import { SchemaProvider } from '@/schema';
import type { State } from '@/provider/provider';
import { Hash, iife, Log, TypeGuard } from '@/utils';
import { Flag, type FlagKey } from '@/flag';
import { InitError } from '@/schema/provider';
import { Npm } from '@/npm';

const log = Log.create({ service: 'provider-sdk' });

export type BundledSDK = {
  languageModel(modelId: string): LanguageModelV3;
};

type ProviderOptionsMap = {
  [K in keyof typeof BUNDLED_PROVIDERS]: Parameters<
    Awaited<ReturnType<(typeof BUNDLED_PROVIDERS)[K]>>
  >[0];
};

function wrapSSE(res: Response, ms: number, ctl: AbortController) {
  if (typeof ms !== 'number' || ms <= 0) {
    return res;
  }
  if (!res.body) {
    return res;
  }
  if (!res.headers.get('content-type')?.includes('text/event-stream')) {
    return res;
  }

  const reader = res.body.getReader();
  const body = new ReadableStream<Uint8Array>({
    async pull(ctrl) {
      const part = await new Promise<Awaited<ReturnType<typeof reader.read>>>((resolve, reject) => {
        const id = setTimeout(() => {
          const err = new Error('SSE read timed out');
          ctl.abort(err);
          void reader.cancel(err);
          reject(err);
        }, ms);

        reader.read().then(
          part => {
            clearTimeout(id);
            resolve(part);
          },
          err => {
            clearTimeout(id);
            reject(err as Error);
          }
        );
      });

      if (part.done) {
        ctrl.close();
        return;
      }

      ctrl.enqueue(part.value as Uint8Array);
    },
    async cancel(reason) {
      ctl.abort(reason);
      await reader.cancel(reason);
    }
  });

  return new Response(body, {
    headers: new Headers(res.headers),
    status: res.status,
    statusText: res.statusText
  });
}

/* no @ai-sdk/github-copilot */
const BUNDLED_PROVIDERS = {
  '@ai-sdk/amazon-bedrock': () => import('@ai-sdk/amazon-bedrock').then(m => m.createAmazonBedrock),
  '@ai-sdk/anthropic': () => import('@ai-sdk/anthropic').then(m => m.createAnthropic),
  '@ai-sdk/azure': () => import('@ai-sdk/azure').then(m => m.createAzure),
  '@ai-sdk/google': () => import('@ai-sdk/google').then(m => m.createGoogleGenerativeAI),
  '@ai-sdk/google-vertex': () => import('@ai-sdk/google-vertex').then(m => m.createVertex),
  '@ai-sdk/google-vertex/anthropic': () =>
    import('@ai-sdk/google-vertex/anthropic').then(m => m.createVertexAnthropic),
  '@ai-sdk/openai': () => import('@ai-sdk/openai').then(m => m.createOpenAI),
  '@ai-sdk/openai-compatible': () =>
    import('@ai-sdk/openai-compatible').then(m => m.createOpenAICompatible),
  '@openrouter/ai-sdk-provider': () =>
    import('@openrouter/ai-sdk-provider').then(m => m.createOpenRouter),
  '@ai-sdk/xai': () => import('@ai-sdk/xai').then(m => m.createXai),
  '@ai-sdk/mistral': () => import('@ai-sdk/mistral').then(m => m.createMistral),
  '@ai-sdk/groq': () => import('@ai-sdk/groq').then(m => m.createGroq),
  '@ai-sdk/deepinfra': () => import('@ai-sdk/deepinfra').then(m => m.createDeepInfra),
  '@ai-sdk/cerebras': () => import('@ai-sdk/cerebras').then(m => m.createCerebras),
  '@ai-sdk/cohere': () => import('@ai-sdk/cohere').then(m => m.createCohere),
  '@ai-sdk/gateway': () => import('@ai-sdk/gateway').then(m => m.createGateway),
  '@ai-sdk/togetherai': () => import('@ai-sdk/togetherai').then(m => m.createTogetherAI),
  '@ai-sdk/perplexity': () => import('@ai-sdk/perplexity').then(m => m.createPerplexity),
  '@ai-sdk/vercel': () => import('@ai-sdk/vercel').then(m => m.createVercel),
  '@ai-sdk/alibaba': () => import('@ai-sdk/alibaba').then(m => m.createAlibaba),
  'gitlab-ai-provider': () => import('gitlab-ai-provider').then(m => m.createGitLab),
  'venice-ai-sdk-provider': () => import('venice-ai-sdk-provider').then(m => m.createVenice)
};

type SdkNpm = keyof typeof BUNDLED_PROVIDERS;

function isTName(npm: string): npm is SdkNpm {
  return npm in BUNDLED_PROVIDERS;
}

async function _resolveSdk<TName extends SdkNpm>(
  name: TName,
  options: ProviderOptionsMap[TName]
): Promise<BundledSDK> {
  const creator = await BUNDLED_PROVIDERS[name]();
  return (creator as (options: ProviderOptionsMap[TName]) => BundledSDK)(options);
}

export async function resolveSDK(model: SchemaProvider.Model, s: State) {
  try {
    const provider = s.providers[model.providerID]!;
    const options = { ...provider.options };

    if (
      model.providerID === 'google-vertex' &&
      !model.api.npm.includes('@ai-sdk/openai-compatible')
    ) {
      delete options.fetch;
    }

    if (model.api.npm.includes('@ai-sdk/openai-compatible') && options['includeUsage'] !== false) {
      options['includeUsage'] = true;
    }

    const baseURL = iife(() => {
      let url =
        typeof options['baseURL'] === 'string' && options['baseURL'] !== ''
          ? options['baseURL']
          : model.api.url;
      if (!url) {
        return;
      }

      const loader = s.varsLoaders[model.providerID];
      if (loader) {
        const vars = loader(options);
        for (const [key, value] of Object.entries(vars)) {
          const field = '${' + key + '}';
          url = url.replaceAll(field, value);
        }
      }

      url = url.replace(/\$\{([^}]+)\}/g, (item: string, key: string) => {
        const val = Flag[String(key) as FlagKey] ?? '';
        return val.toString() ?? item;
      });
      return url;
    });

    if (baseURL !== void 0) {
      options['baseURL'] = baseURL;
    }
    if (options['apiKey'] === void 0 && provider.key) {
      options['apiKey'] = provider.key;
    }
    if (model.headers) {
      options['headers'] = {
        ...(TypeGuard.isRecord(options['headers']) ? options['headers'] : {}),
        ...model.headers
      };
    }

    const key = Hash.fast(
      JSON.stringify({
        providerID: model.providerID,
        npm: model.api.npm,
        options
      })
    );
    const existing = s.sdk.get(key);
    if (existing) {
      return existing;
    }

    const customFetch = options['fetch'] as typeof fetch;
    const chunkTimeout = options['chunkTimeout'] as number;
    delete options['chunkTimeout'];

    options['fetch'] = async (input: string | URL | Request, init?: RequestInit) => {
      const fetchFn = customFetch ?? fetch;
      const opts = init ?? {};
      const chunkAbortCtl =
        typeof chunkTimeout === 'number' && chunkTimeout > 0 ? new AbortController() : void 0;
      const signals: AbortSignal[] = [];

      if (opts.signal) {
        signals.push(opts.signal);
      }
      if (chunkAbortCtl) {
        signals.push(chunkAbortCtl.signal);
      }
      if (
        options['timeout'] !== void 0 &&
        options['timeout'] !== null &&
        options['timeout'] !== false
      ) {
        signals.push(AbortSignal.timeout(options['timeout'] as number));
      }

      const combined =
        signals.length === 0 ? null : signals.length === 1 ? signals[0] : AbortSignal.any(signals);
      if (combined) {
        opts.signal = combined;
      }

      // Strip openai itemId metadata following what codex does
      if (
        (model.api.npm === '@ai-sdk/openai' || model.api.npm === '@ai-sdk/azure') &&
        opts.body &&
        opts.method === 'POST'
      ) {
        const body = TypeGuard.typeSafeParse(opts.body as string)!;
        const keepIds = body.store === true;
        if (!keepIds && Array.isArray(body.input)) {
          for (const item of body.input) {
            if (TypeGuard.isRecord(item) && 'id' in item) {
              delete item.id;
            }
          }
          opts.body = JSON.stringify(body);
        }
      }

      const res = await fetchFn(input, {
        ...opts,
        // @ts-ignore see here: https://github.com/oven-sh/bun/issues/16682
        timeout: false
      });

      if (!chunkAbortCtl) {
        return res;
      }
      return wrapSSE(res, chunkTimeout, chunkAbortCtl);
    };

    if (isTName(model.api.npm)) {
      const sdk = await _resolveSdk(model.api.npm, {
        name: model.providerID,
        ...options
      });
      s.sdk.set(key, sdk);
      return sdk;
    }

    let installedPath: string;
    if (!model.api.npm.startsWith('file://')) {
      const item = await Npm.add(model.api.npm);
      if (!item.entrypoint) {
        throw new Error(`Package ${model.api.npm} has no import entrypoint`);
      }
      installedPath = item.entrypoint;
    } else {
      log.info('loading local provider', { pkg: model.api.npm });
      installedPath = model.api.npm;
    }

    // `installedPath` is a local entry path or an existing `file://` URL. Normalize
    // only path inputs so Node on Windows accepts the dynamic import.
    const importSpec = installedPath.startsWith('file://')
      ? installedPath
      : pathToFileURL(installedPath).href;
    const mod = (await import(importSpec)) as Record<string, unknown>;
    const fn = mod[Object.keys(mod).find(key => key.startsWith('create'))!] as (
      options: Record<string, unknown>
    ) => BundledSDK;
    const loaded = fn({
      name: model.providerID,
      ...options
    });
    s.sdk.set(key, loaded);
    return loaded;
  } catch (e) {
    throw new InitError({ providerID: model.providerID, cause: e });
  }
}
