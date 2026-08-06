import { SchemaAuth, SchemaConfig, SchemaProvider } from '@/schema';
import type { LanguageModelV3 } from '@ai-sdk/provider';
import { Effect } from 'effect';
import { AppFileSystem } from '@/file-system';
import { iife, Log, TypeGuard } from '@/utils';
import { InstanceContext } from '@/instance';
import pkg from '../../package.json' with { type: 'json' };
import os from 'os';

const log = Log.create({ service: 'provider' });

export interface WorkFlowModel extends LanguageModelV3 {
  selectedModelRef?: string;

  [k: string]: unknown;
}

export type CustomModelLoader = (
  sdk: unknown,
  modelID: string,
  options?: Record<string, unknown>
) => Promise<LanguageModelV3 | undefined>;
export type CustomVarsLoader = (options: Record<string, unknown>) => Record<string, string>;
export type CustomDiscoverModels = () => Promise<Record<string, SchemaProvider.Model>>;
export type CustomLoader = (provider: SchemaProvider.Info) => Effect.Effect<{
  autoload: boolean;
  getModel?: CustomModelLoader;
  vars?: CustomVarsLoader;
  options?: Record<string, unknown>;
  discoverModels?: CustomDiscoverModels;
}>;
export type CustomDep = {
  auth: (id: string) => Effect.Effect<SchemaAuth.Info | undefined>;
  config: () => Effect.Effect<SchemaConfig.Info>;
  env: () => NodeJS.ProcessEnv;
  get: (key: string) => string | undefined;
};
type GetModel = (modelId: string) => Promise<LanguageModelV3>;
type GetWorkFlowModel = (
  modelId: string,
  option: {
    featureFlags: {
      duo_agent_platform_agentic_chat: boolean;
      duo_agent_platform: boolean;
    };
    workflowDefinition?: string;
  }
) => Promise<WorkFlowModel>;
type GetAgentModel = (
  modelId: string,
  option: {
    aiGatewayHeaders: {
      'User-Agent': string;
      'anthropic-beta': string;
      [k: string]: unknown;
    };
    featureFlags: {
      duo_agent_platform_agentic_chat: boolean;
      duo_agent_platform: boolean;
    };
  }
) => Promise<LanguageModelV3>;

interface SDK {
  chat: GetModel;
  messages: GetModel;
  responses: GetModel;
  languageModel: GetModel;
  workflowChat: GetWorkFlowModel;
  agenticChat: GetAgentModel;
}

type SDKKeys = keyof SDK;
type SDKType<K extends SDKKeys | '' = ''> = K extends SDKKeys
  ? Required<Pick<SDK, K>> & Partial<Omit<SDK, K>>
  : Partial<SDK>;

function isSDK<K extends SDKKeys>(sdk: unknown, required?: K): sdk is SDKType<K> {
  if (sdk && typeof sdk === 'object' && Object.getOwnPropertyNames(sdk).length) {
    if (required) {
      return required in sdk;
    }
    return true;
  }
  return false;
}

function isGetModel(fn: unknown): fn is GetModel {
  return typeof fn === 'function';
}

function shouldUseCopilotResponsesApi(modelID: string): boolean {
  const match = /^gpt-(\d+)/.exec(modelID);
  if (!match) {
    return false;
  }
  return Number(match[1]) >= 5 && !modelID.startsWith('gpt-5-mini');
}

function selectAzureLanguageModel(sdk: SDKType, modelID: string, useChat: boolean) {
  if (useChat && sdk.chat) {
    return sdk.chat(modelID);
  }
  if (sdk.responses) {
    return sdk.responses(modelID);
  }
  if (sdk.messages) {
    return sdk.messages(modelID);
  }
  if (sdk.chat) {
    return sdk.chat(modelID);
  }
  return sdk.languageModel!(modelID);
}

function useLanguageModel(sdk: unknown): sdk is SDKType<'languageModel'> {
  return TypeGuard.isRecord(sdk) && sdk.responses === void 0 && sdk.chat === void 0;
}

export function custom(dep: CustomDep): Record<string, CustomLoader> {
  return {
    anthropic: () =>
      Effect.succeed({
        autoload: false,
        options: {
          headers: {
            'anthropic-beta':
              'interleaved-thinking-2025-05-14,fine-grained-tool-streaming-2025-05-14'
          }
        }
      }),
    opencode: Effect.fnUntraced(function* (input: SchemaProvider.Info) {
      const env = dep.env();
      const hasKey = iife(() => {
        return input.env.some(item => env[item]);
      });
      const ok =
        hasKey ||
        Boolean(yield* dep.auth(input.id)) ||
        Boolean((yield* dep.config()).provider?.['opencode']?.options?.apiKey);

      if (!ok) {
        for (const [key, value] of Object.entries(input.models)) {
          if (value.cost.input === 0) {
            continue;
          }
          delete input.models[key];
        }
      }

      return {
        autoload: Object.keys(input.models).length > 0,
        options: ok ? {} : { apiKey: 'public' }
      };
    }),
    openai: () =>
      Effect.succeed({
        autoload: false,
        getModel(sdk: unknown, modelID: string) {
          if (isSDK(sdk, 'responses')) {
            return sdk.responses(modelID);
          }
          return Promise.resolve(void 0);
        },
        options: {}
      }),
    xai: () =>
      Effect.succeed({
        autoload: false,
        getModel(sdk: unknown, modelID: string) {
          if (isSDK(sdk, 'responses')) {
            return sdk.responses(modelID);
          }
          return Promise.resolve(void 0);
        },
        options: {}
      }),
    'github-copilot': () =>
      Effect.succeed({
        autoload: false,
        getModel(sdk: unknown, modelID: string) {
          if (useLanguageModel(sdk)) {
            return sdk.languageModel(modelID);
          } else if (isSDK(sdk)) {
            return shouldUseCopilotResponsesApi(modelID)
              ? sdk.responses!(modelID)
              : sdk.chat!(modelID);
          }
          return Promise.resolve(void 0);
        },
        options: {}
      }),
    azure: Effect.fnUntraced(function* (provider: SchemaProvider.Info) {
      const env = dep.env();
      const auth = yield* dep.auth(provider.id);
      const resource = iife(() => {
        return [
          provider.options?.resourceName as string,
          auth?.type === 'api' ? auth.metadata?.resourceName : void 0,
          env['AZURE_RESOURCE_NAME']
        ].find(name => typeof name === 'string' && name.trim() !== '');
      });

      if (!resource && !provider.options?.baseURL) {
        return {
          autoload: false,
          getModel() {
            throw new Error(
              'AZURE_RESOURCE_NAME is missing, set it using env var or reconnecting the azure provider and setting it'
            );
          }
        };
      }

      return {
        autoload: false,
        getModel(sdk: unknown, modelID: string, options?: Record<string, unknown>) {
          if (isSDK(sdk)) {
            return selectAzureLanguageModel(sdk, modelID, Boolean(options?.['useCompletionUrls']));
          }
          return Promise.resolve(void 0);
        },
        options: {
          resourceName: resource
        },
        vars(): Record<string, string> {
          if (resource) {
            return {
              AZURE_RESOURCE_NAME: resource
            };
          }
          return {};
        }
      };
    }),
    'azure-cognitive-services': () => {
      const resourceName = dep.get('AZURE_COGNITIVE_SERVICES_RESOURCE_NAME');
      return Effect.succeed({
        autoload: false,
        getModel(sdk: unknown, modelID: string, options?: Record<string, unknown>) {
          if (isSDK(sdk)) {
            return selectAzureLanguageModel(sdk, modelID, Boolean(options?.['useCompletionUrls']));
          }
          return Promise.resolve(void 0);
        },
        options: {
          baseURL: resourceName
            ? `https://${resourceName}.cognitiveservices.azure.com/openai`
            : void 0
        }
      });
    },
    'amazon-bedrock': Effect.fnUntraced(function* () {
      const providerConfig = (yield* dep.config()).provider?.['amazon-bedrock'];
      const auth = yield* dep.auth('amazon-bedrock');
      const env = dep.env();

      // Region precedence: 1) config file, 2) env var, 3) default
      const configRegion: unknown = providerConfig?.options?.region;
      const envRegion = env['AWS_REGION'];
      const defaultRegion = configRegion ?? envRegion ?? 'us-east-1';

      // Profile: config file takes precedence over env var
      const configProfile: unknown = providerConfig?.options?.profile;
      const envProfile = env['AWS_PROFILE'];
      const profile = configProfile ?? envProfile;

      const awsAccessKeyId = env['AWS_ACCESS_KEY_ID'];

      // TODO: Using process.env directly because Env.set only updates a process.env shallow copy,
      // until the scope of the Env API is clarified (test only or runtime?)
      const awsBearerToken = iife(() => {
        const envToken = process.env.AWS_BEARER_TOKEN_BEDROCK;
        if (envToken) {
          return envToken;
        }
        if (auth?.type === 'api') {
          process.env.AWS_BEARER_TOKEN_BEDROCK = auth.key;
          return auth.key;
        }
        return void 0;
      });

      const awsWebIdentityTokenFile = env['AWS_WEB_IDENTITY_TOKEN_FILE'];

      const containerCreds = Boolean(
        process.env.AWS_CONTAINER_CREDENTIALS_RELATIVE_URI ||
        process.env.AWS_CONTAINER_CREDENTIALS_FULL_URI
      );

      if (
        !profile &&
        !awsAccessKeyId &&
        !awsBearerToken &&
        !awsWebIdentityTokenFile &&
        !containerCreds
      ) {
        return { autoload: false };
      }

      const { fromNodeProviderChain } = yield* Effect.promise(
        () => import('@aws-sdk/credential-providers')
      );

      const providerOptions: Record<string, unknown> = {
        region: defaultRegion
      };

      // Only use credential chain if no bearer token exists
      // Bearer token takes precedence over credential chain (profiles, access keys, IAM roles, web identity tokens)
      if (!awsBearerToken) {
        // Build credential provider options (only pass profile if specified)
        const credentialProviderOptions = profile ? { profile } : profile;

        providerOptions.credentialProvider = fromNodeProviderChain(credentialProviderOptions);
      }

      // Add custom endpoint if specified (endpoint takes precedence over baseURL)
      const endpoint = (providerConfig?.options?.endpoint ?? providerConfig?.options?.baseURL) as
        string | undefined;
      if (endpoint) {
        providerOptions.baseURL = endpoint;
      }

      return {
        autoload: true,
        options: providerOptions,
        getModel(sdk: unknown, modelID: string, options?: Record<string, unknown>) {
          // Skip region prefixing if model already has a cross-region inference profile prefix
          // Models from models.dev may already include prefixes like us., eu., global., etc.
          const crossRegionPrefixes = ['global.', 'us.', 'eu.', 'jp.', 'apac.', 'au.'];
          if (
            crossRegionPrefixes.some(prefix => modelID.startsWith(prefix)) &&
            isSDK(sdk, 'languageModel')
          ) {
            return sdk.languageModel(modelID);
          }

          // Region resolution precedence (highest to lowest):
          // 1. options.region from opencode.json provider config
          // 2. defaultRegion from AWS_REGION environment variable
          // 3. Default "us-east-1" (baked into defaultRegion)
          const region = (options?.region ?? defaultRegion) as string;

          let regionPrefix = region.split('-')[0];

          switch (regionPrefix) {
            case 'us': {
              const modelRequiresPrefix = [
                'nova-micro',
                'nova-lite',
                'nova-pro',
                'nova-premier',
                'nova-2',
                'claude',
                'deepseek'
              ].some(m => modelID.includes(m));
              const isGovCloud = region.startsWith('us-gov');
              if (modelRequiresPrefix && !isGovCloud) {
                modelID = `${regionPrefix}.${modelID}`;
              }
              break;
            }
            case 'eu': {
              const regionRequiresPrefix = [
                'eu-west-1',
                'eu-west-2',
                'eu-west-3',
                'eu-north-1',
                'eu-central-1',
                'eu-south-1',
                'eu-south-2'
              ].some(r => region.includes(r));
              const modelRequiresPrefix = [
                'claude',
                'nova-lite',
                'nova-micro',
                'llama3',
                'pixtral'
              ].some(m => modelID.includes(m));
              if (regionRequiresPrefix && modelRequiresPrefix) {
                modelID = `${regionPrefix}.${modelID}`;
              }
              break;
            }
            case 'ap': {
              const isAustraliaRegion = ['ap-southeast-2', 'ap-southeast-4'].includes(region);
              const isTokyoRegion = region === 'ap-northeast-1';
              if (
                isAustraliaRegion &&
                ['anthropic.claude-sonnet-4-5', 'anthropic.claude-haiku'].some(m =>
                  modelID.includes(m)
                )
              ) {
                regionPrefix = 'au';
                modelID = `${regionPrefix}.${modelID}`;
              } else if (isTokyoRegion) {
                // Tokyo region uses jp. prefix for cross-region inference
                const modelRequiresPrefix = ['claude', 'nova-lite', 'nova-micro', 'nova-pro'].some(
                  m => modelID.includes(m)
                );
                if (modelRequiresPrefix) {
                  regionPrefix = 'jp';
                  modelID = `${regionPrefix}.${modelID}`;
                }
              } else {
                // Other APAC regions use apac. prefix
                const modelRequiresPrefix = ['claude', 'nova-lite', 'nova-micro', 'nova-pro'].some(
                  m => modelID.includes(m)
                );
                if (modelRequiresPrefix) {
                  regionPrefix = 'apac';
                  modelID = `${regionPrefix}.${modelID}`;
                }
              }
              break;
            }
          }

          if (isSDK(sdk, 'languageModel')) {
            return sdk.languageModel(modelID);
          }
          return Promise.resolve(void 0);
        }
      };
    }),
    llmgateway: () =>
      Effect.succeed({
        autoload: false,
        options: {
          headers: {
            'HTTP-Referer': 'https://opencode.ai/',
            'X-Title': 'opencode',
            'X-Source': 'opencode'
          }
        }
      }),
    openrouter: () =>
      Effect.succeed({
        autoload: false,
        options: {
          headers: {
            'HTTP-Referer': 'https://opencode.ai/',
            'X-Title': 'opencode'
          }
        }
      }),
    nvidia: provider =>
      Effect.succeed({
        autoload: provider.source === 'config',
        options: {
          headers: {
            'HTTP-Referer': 'https://opencode.ai/',
            'X-Title': 'opencode',
            'X-BILLING-INVOKE-ORIGIN': 'OpenCode'
          }
        }
      }),
    vercel: () =>
      Effect.succeed({
        autoload: false,
        options: {
          headers: {
            'http-referer': 'https://opencode.ai/',
            'x-title': 'opencode'
          }
        }
      }),
    'google-vertex': (provider: SchemaProvider.Info) => {
      const env = dep.env();
      // models.dev advertises GOOGLE_VERTEX_PROJECT for Vertex; keep the wider
      // Google Cloud project env names as fallbacks for existing ADC setups.
      const project =
        (provider.options?.project as string) ??
        env['GOOGLE_VERTEX_PROJECT'] ??
        env['GOOGLE_CLOUD_PROJECT'] ??
        env['GCP_PROJECT'] ??
        env['GCLOUD_PROJECT'];

      const location = String(
        (provider.options?.location as string) ??
          env['GOOGLE_VERTEX_LOCATION'] ??
          env['GOOGLE_CLOUD_LOCATION'] ??
          env['VERTEX_LOCATION'] ??
          'us-central1'
      );

      const autoload = Boolean(project);
      if (!autoload) {
        return Effect.succeed({ autoload: false });
      }
      return Effect.succeed({
        autoload: true,
        vars() {
          const endpoint =
            location === 'global'
              ? 'aiplatform.googleapis.com'
              : `${location}-aiplatform.googleapis.com`;
          return {
            ...(project && { GOOGLE_VERTEX_PROJECT: project }),
            GOOGLE_VERTEX_LOCATION: location,
            GOOGLE_VERTEX_ENDPOINT: endpoint
          };
        },
        options: {
          project,
          location,
          fetch: async (input: Request | string | URL, init?: RequestInit) => {
            const { GoogleAuth } = await import('google-auth-library');
            const auth = new GoogleAuth();
            const client = await auth.getApplicationDefault();
            const token = await client.credential.getAccessToken();

            const headers = new Headers(init?.headers);
            headers.set('Authorization', `Bearer ${token.token}`);

            return fetch(input, { ...init, headers });
          }
        },
        getModel(sdk: unknown, modelID: string) {
          const id = String(modelID).trim();
          if (isSDK(sdk, 'languageModel')) {
            return sdk.languageModel(id);
          }
          return Promise.resolve(void 0);
        }
      });
    },
    'google-vertex-anthropic': () => {
      const env = dep.env();
      const project = env['GOOGLE_CLOUD_PROJECT'] ?? env['GCP_PROJECT'] ?? env['GCLOUD_PROJECT'];
      const location = env['GOOGLE_CLOUD_LOCATION'] ?? env['VERTEX_LOCATION'] ?? 'global';
      const autoload = Boolean(project);
      if (!autoload) {
        return Effect.succeed({ autoload: false });
      }
      return Effect.succeed({
        autoload: true,
        options: {
          project,
          location
        },
        getModel(sdk: unknown, modelID) {
          const id = String(modelID).trim();
          if (isSDK(sdk, 'languageModel')) {
            return sdk.languageModel(id);
          }
          return Promise.resolve(void 0);
        }
      });
    },
    'sap-ai-core': Effect.fnUntraced(function* () {
      const auth = yield* dep.auth('sap-ai-core');
      // TODO: Using process.env directly because Env.set only updates a shallow copy (not process.env),
      // until the scope of the Env API is clarified (test only or runtime?)
      const envServiceKey = iife(() => {
        const envAICoreServiceKey = process.env.AICORE_SERVICE_KEY;
        if (envAICoreServiceKey) {
          return envAICoreServiceKey;
        }
        if (auth?.type === 'api') {
          process.env.AICORE_SERVICE_KEY = auth.key;
          return auth.key;
        }
        return void 0;
      });
      const deploymentId = process.env.AICORE_DEPLOYMENT_ID;
      const resourceGroup = process.env.AICORE_RESOURCE_GROUP;

      return {
        autoload: !!envServiceKey,
        options: envServiceKey ? { deploymentId, resourceGroup } : {},
        getModel(sdk: unknown, modelID: string) {
          if (isGetModel(sdk)) {
            return sdk(modelID);
          }
          return Promise.resolve(void 0);
        }
      };
    }),
    zenmux: () =>
      Effect.succeed({
        autoload: false,
        options: {
          headers: {
            'HTTP-Referer': 'https://opencode.ai/',
            'X-Title': 'opencode'
          }
        }
      }),
    gitlab: Effect.fnUntraced(
      function* (input: SchemaProvider.Info) {
        const {
          VERSION: GITLAB_PROVIDER_VERSION,
          isWorkflowModel,
          discoverWorkflowModels
        } = yield* Effect.promise(() => import('gitlab-ai-provider'));

        const instanceUrl = dep.get('GITLAB_INSTANCE_URL') || 'https://gitlab.com';

        const auth = yield* dep.auth(input.id);
        const apiKey = yield* Effect.sync(() => {
          if (auth?.type === 'oauth') {
            return auth.access;
          }
          if (auth?.type === 'api') {
            return auth.key;
          }
          return void 0;
        });
        const token = apiKey ?? dep.get('GITLAB_TOKEN');

        const providerConfig = (yield* dep.config()).provider?.['gitlab'];
        const directory = yield* InstanceContext.directory;

        const aiGatewayHeaders = {
          'User-Agent': `openchat/${pkg.version} gitlab-ai-provider/${GITLAB_PROVIDER_VERSION} (${os.platform()} ${os.release()}; ${os.arch()})`,
          'anthropic-beta': 'context-1m-2025-08-07',
          ...providerConfig?.options?.aiGatewayHeaders
        };

        const featureFlags = {
          duo_agent_platform_agentic_chat: true,
          duo_agent_platform: true,
          ...providerConfig?.options?.featureFlags
        };

        return {
          autoload: !!token,
          options: {
            instanceUrl,
            apiKey: token,
            aiGatewayHeaders,
            featureFlags
          },
          async getModel(sdk: unknown, modelID: string, options?: Record<string, unknown>) {
            if (modelID.startsWith('duo-workflow-')) {
              const workflowRef =
                typeof options?.workflowRef === 'string' ? options.workflowRef : void 0;
              // Use the static mapping if it exists, otherwise use duo-workflow with selectedModelRef
              const sdkModelID = isWorkflowModel(modelID) ? modelID : 'duo-workflow';
              const workflowDefinition =
                typeof options?.workflowDefinition === 'string'
                  ? options.workflowDefinition
                  : void 0;
              const model = isSDK(sdk, 'workflowChat')
                ? await sdk.workflowChat(sdkModelID, {
                    featureFlags,
                    workflowDefinition
                  })
                : void 0;
              if (!model) {
                return Promise.resolve(void 0);
              }
              if (workflowRef) {
                model.selectedModelRef = workflowRef;
              }
              return model;
            }
            if (isSDK(sdk, 'agenticChat')) {
              return sdk.agenticChat(modelID, {
                aiGatewayHeaders,
                featureFlags
              });
            }
          },
          async discoverModels(): Promise<Record<string, SchemaProvider.Model>> {
            if (!apiKey) {
              log.info('gitlab model discovery skipped: no apiKey');
              return {};
            }

            try {
              const token = apiKey;
              const getHeaders = (): Record<string, string> =>
                auth?.type === 'api'
                  ? { 'PRIVATE-TOKEN': token }
                  : { Authorization: `Bearer ${token}` };

              log.info('gitlab model discovery starting', { instanceUrl });
              const result = await discoverWorkflowModels(
                { instanceUrl, getHeaders },
                { workingDirectory: directory }
              );

              if (!result.models.length) {
                log.info('gitlab model discovery skipped: no models found', {
                  project: result.project
                    ? {
                        id: result.project.id,
                        path: result.project.pathWithNamespace
                      }
                    : null
                });
                return {};
              }

              const models: Record<string, SchemaProvider.Model> = {};
              for (const m of result.models) {
                if (!input.models[m.id]) {
                  models[m.id] = {
                    id: SchemaProvider.ModelID.make(m.id),
                    providerID: SchemaProvider.ProviderID.make('gitlab'),
                    name: `Agent Platform (${m.name})`,
                    family: '',
                    api: {
                      id: m.id,
                      url: instanceUrl,
                      npm: 'gitlab-ai-provider'
                    },
                    status: 'active',
                    headers: {},
                    options: { workflowRef: m.ref },
                    cost: { input: 0, output: 0, cache: { read: 0, write: 0 } },
                    limit: { context: m.context, output: m.output },
                    capabilities: {
                      temperature: false,
                      reasoning: true,
                      attachment: true,
                      toolcall: true,
                      input: {
                        text: true,
                        audio: false,
                        image: true,
                        video: false,
                        pdf: true
                      },
                      output: {
                        text: true,
                        audio: false,
                        image: false,
                        video: false,
                        pdf: false
                      },
                      interleaved: false
                    },
                    release_date: '',
                    variants: {}
                  };
                }
              }

              log.info('gitlab model discovery complete', {
                count: Object.keys(models).length,
                models: Object.keys(models)
              });
              return models;
            } catch (e) {
              log.warn('gitlab model discovery failed', { error: e });
              return {};
            }
          }
        };
      },
      Effect.provide(AppFileSystem.defaultLayer),
      Effect.orDie
    ),
    'cloudflare-workers-ai': Effect.fnUntraced(function* (input: SchemaProvider.Info) {
      // When baseURL is already configured (e.g. corporate config routing through a proxy/gateway),
      // skip the account ID check because the URL is already fully specified.
      if (input.options?.baseURL) {
        return { autoload: false };
      }

      const auth = yield* dep.auth(input.id);
      const env = dep.env();
      const accountId =
        env['CLOUDFLARE_ACCOUNT_ID'] || (auth?.type === 'api' ? auth.metadata?.accountId : void 0);
      if (!accountId) {
        return {
          autoload: false,
          getModel() {
            throw new Error(
              'CLOUDFLARE_ACCOUNT_ID is missing. Set it with: export CLOUDFLARE_ACCOUNT_ID=<your-account-id>'
            );
          }
        };
      }

      const apiKey = iife(() => {
        const envToken = env['CLOUDFLARE_API_KEY'];
        if (envToken) {
          return envToken;
        }
        if (auth?.type === 'api') {
          return auth.key;
        }
        return void 0;
      });

      return {
        autoload: !!apiKey,
        options: {
          apiKey,
          headers: {
            'User-Agent': `oepnchat/${pkg.version} cloudflare-workers-ai (${os.platform()} ${os.release()}; ${os.arch()})`
          }
        },
        getModel(sdk: unknown, modelID: string) {
          if (isSDK(sdk, 'languageModel')) {
            return sdk.languageModel(modelID);
          }
          return Promise.resolve(void 0);
        },
        vars() {
          return {
            CLOUDFLARE_ACCOUNT_ID: accountId
          };
        }
      };
    }),
    'cloudflare-ai-gateway': Effect.fnUntraced(function* (input: SchemaProvider.Info) {
      // When baseURL is already configured (e.g. corporate config), skip the ID checks.
      if (input.options?.baseURL) {
        return { autoload: false };
      }

      const auth = yield* dep.auth(input.id);
      const env = dep.env();
      const accountId =
        env['CLOUDFLARE_ACCOUNT_ID'] || (auth?.type === 'api' ? auth.metadata?.accountId : void 0);
      // The Cloudflare auth prompt stores this value as gatewayId metadata.
      const gateway =
        env['CLOUDFLARE_GATEWAY_ID'] || (auth?.type === 'api' ? auth.metadata?.gatewayId : void 0);

      if (!accountId || !gateway) {
        const missing = [
          !accountId ? 'CLOUDFLARE_ACCOUNT_ID' : void 0,
          !gateway ? 'CLOUDFLARE_GATEWAY_ID' : void 0
        ].filter((x): x is string => Boolean(x));
        return {
          autoload: false,
          getModel() {
            throw new Error(
              `${missing.join(' and ')} missing. Set with: ${missing.map(x => `export ${x}=<value>`).join(' && ')}`
            );
          }
        };
      }

      // Get API token from env or auth - required for authenticated gateways
      const apiToken = iife(() => {
        const envToken = env['CLOUDFLARE_API_TOKEN'] || env['CF_AIG_TOKEN'];
        if (envToken) {
          return envToken;
        }
        if (auth?.type === 'api') {
          return auth.key;
        }
        return void 0;
      });

      if (!apiToken) {
        throw new Error(
          'CLOUDFLARE_API_TOKEN (or CF_AIG_TOKEN) is required for Cloudflare AI Gateway. ' +
            'Set it via environment variable or run `opencode auth cloudflare-ai-gateway`.'
        );
      }

      // Use official ai-gateway-provider package (v2.x for AI SDK v5 compatibility)
      const { createAiGateway } = yield* Effect.promise(() => import('ai-gateway-provider'));
      const { createUnified } = yield* Effect.promise(
        () => import('ai-gateway-provider/providers/unified')
      );

      const metadata = iife(() => {
        if (input.options?.metadata) {
          return input.options.metadata as Record<string, unknown>;
        }
        if (TypeGuard.isRecord(input.options.headers)) {
          return TypeGuard.typeSafeParse(input.options.headers['cf-aig-metadata'] as string);
        }
      });
      const opts: Record<string, unknown> = {
        metadata,
        cacheTtl: input.options?.cacheTtl,
        cacheKey: input.options?.cacheKey,
        skipCache: input.options?.skipCache,
        collectLog: input.options?.collectLog,
        headers: {
          'User-Agent': `openchat/${pkg.version} cloudflare-ai-gateway (${os.platform()} ${os.release()}; ${os.arch()})`
        }
      };

      const aigateway = createAiGateway({
        accountId,
        gateway,
        apiKey: apiToken,
        ...(Object.values(opts).some(v => v !== void 0) ? { options: opts } : {})
      });
      const unified = createUnified();

      return {
        autoload: true,
        getModel(_sdk: unknown, modelID: string) {
          // Model IDs use Unified API format: provider/model (e.g., "anthropic/claude-sonnet-4-5")
          return Promise.resolve(aigateway(unified(modelID)));
        },
        options: {}
      };
    }),
    cerebras: () =>
      Effect.succeed({
        autoload: false,
        options: {
          headers: {
            'X-Cerebras-3rd-Party-Integration': 'opencode'
          }
        }
      }),
    kilo: () =>
      Effect.succeed({
        autoload: false,
        options: {
          headers: {
            'HTTP-Referer': 'https://opencode.ai/',
            'X-Title': 'opencode'
          }
        }
      })
  };
}
