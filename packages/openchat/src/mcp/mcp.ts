import { Log, TypeGuard, withTimeout } from '@/utils';
import {
  ListToolsResultSchema,
  ToolSchema,
  type Tool as MCPTool,
  CallToolResultSchema,
  ToolListChangedNotificationSchema
} from '@modelcontextprotocol/sdk/types';
import { SSEClientTransport } from '@modelcontextprotocol/sdk/client/sse';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp';
import { Client as MCPClient } from '@modelcontextprotocol/sdk/client';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio';
import { UnauthorizedError } from '@modelcontextprotocol/sdk/client/auth';
import { Context, Effect, Exit, Layer, Option, Stream } from 'effect';
import { SchemaMcp, SchemaConfig } from '@/schema';
import { dynamicTool, jsonSchema, type JSONSchema7, type Tool } from 'ai';
import { ChildProcessSpawner, ChildProcess } from 'effect/unstable/process';
import * as McpAuth from './auth';
import { Bus } from '@/bus';
import pkg from '../../package.json' with { type: 'json' };
import { McpOAuthProvider } from '@/mcp/oauth-provider';
import { InstanceContext, ModuleState, EffectRunner } from '@/instance';
import { Config } from '@/config';
import { AppFileSystem } from '@/file-system';
import { cancelPending, ensureRunning } from '@/mcp/oauth-callback';
import { CrossSpawnSpawner } from '@/cross-spawn-spawner';

// Prompt cache types
type PromptInfo = Awaited<ReturnType<MCPClient['listPrompts']>>['prompts'][number];
type ResourceInfo = Awaited<ReturnType<MCPClient['listResources']>>['resources'][number];
type McpEntry = NonNullable<SchemaConfig.Info['mcp']>[string];
// Store transports for OAuth servers to allow finishing auth
type TransportWithAuth = StreamableHTTPClientTransport | SSEClientTransport;

interface CreateResult {
  mcpClient?: MCPClient;
  status: SchemaMcp.Status;
  defs?: MCPTool[];
}

interface AuthResult {
  authorizationUrl: string;
  oauthState: string;
  client?: MCPClient;
}

const log = Log.create({ service: 'mcp' });
const DEFAULT_TIMEOUT = 30_000;
const pendingOAuthMCPClient = new Map<string, MCPClient>();
const TolerantListToolsResultSchema = ListToolsResultSchema.extend({
  tools: ToolSchema.omit({ outputSchema: true }).array()
});
const sanitize = (s: string) => s.replace(/[^a-zA-Z0-9_-]/g, '_');

function isMcpConfigured(entry: McpEntry): entry is SchemaMcp.Info {
  return typeof entry === 'object' && entry !== null && 'type' in entry;
}

// Convert MCP tool definition to AI SDK Tool type
function convertMcpTool(mcpTool: MCPTool, client: MCPClient, timeout?: number): Tool {
  const inputSchema = mcpTool.inputSchema;

  // Spread first, then override type to ensure it's always "object"
  const schema: JSONSchema7 = {
    ...(inputSchema as JSONSchema7),
    type: 'object',
    properties: inputSchema.properties ?? {},
    additionalProperties: false
  };

  return dynamicTool({
    description: mcpTool.description ?? '',
    inputSchema: jsonSchema(schema),
    execute: async (args: unknown) => {
      return client.callTool(
        {
          name: mcpTool.name,
          arguments: (args || {}) as Record<string, unknown>
        },
        CallToolResultSchema,
        {
          resetTimeoutOnProgress: true,
          timeout
        }
      );
    }
  });
}

function isOutputSchemaValidationError(error: Error) {
  return /can't resolve reference|resolves to more than one schema|outputSchema|schema.*reference|reference.*schema/i.test(
    error.message
  );
}

function listTools(key: string, client: MCPClient, timeout: number) {
  return Effect.tryPromise({
    try: () => client.listTools(void 0, { timeout }),
    catch: err => (err instanceof Error ? err : new Error(String(err)))
  }).pipe(
    Effect.map(result => result.tools),
    Effect.catch(error => {
      if (!isOutputSchemaValidationError(error)) {
        return Effect.fail(error);
      }

      log.warn(
        'failed to validate MCP tool output schemas, retrying without output schema validation',
        { key, error }
      );
      return Effect.tryPromise({
        try: () =>
          client.request({ method: 'tools/list' }, TolerantListToolsResultSchema, {
            timeout
          }),
        catch: err => (err instanceof Error ? err : new Error(String(err)))
      }).pipe(
        Effect.map(result =>
          result.tools.map(tool => ({
            name: tool.name,
            description: tool.description,
            inputSchema: tool.inputSchema
          }))
        )
      );
    })
  );
}

function defs(key: string, client: MCPClient, timeout?: number) {
  return listTools(key, client, timeout ?? DEFAULT_TIMEOUT).pipe(
    Effect.catch(err => {
      log.error('failed to get tools from client', { key, error: err });
      return Effect.succeed(void 0);
    })
  );
}

function remoteURL(key: string, value: string) {
  if (URL.canParse(value)) {
    return new URL(value);
  }
  log.warn('invalid remote mcp url', { key });
}

function fetchFromClient<T extends { name: string }>(
  clientName: string,
  client: MCPClient,
  listFn: (c: MCPClient) => Promise<T[]>,
  label: string
) {
  return Effect.tryPromise({
    try: () => listFn(client),
    catch: (e: unknown) => {
      if (TypeGuard.isRecord(e)) {
        log.error(`failed to get ${label}`, { clientName, error: e.message });
      }
      return e;
    }
  }).pipe(
    Effect.map(items => {
      const out: Record<string, T & { client: string }> = {};
      const sanitizedClient = sanitize(clientName);
      for (const item of items) {
        out[sanitizedClient + ':' + sanitize(item.name)] = { ...item, client: clientName };
      }
      return out;
    }),
    Effect.orElseSucceed(() => void 0)
  );
}

function collectFromConnected<T extends { name: string }>(
  s: State,
  listFn: (c: MCPClient) => Promise<T[]>,
  label: string
) {
  return Effect.forEach(
    Object.entries(s.clients).filter(([name]) => s.status[name]?.status === 'connected'),
    ([clientName, client]) =>
      fetchFromClient(clientName, client, listFn, label).pipe(
        Effect.map(items => Object.entries(items ?? {}))
      ),
    { concurrency: 'unbounded' }
  ).pipe(Effect.map(results => Object.fromEntries<T & { client: string }>(results.flat())));
}

function closeClient(s: State, name: string) {
  const client = s.clients[name];
  delete s.defs[name];
  if (!client) {
    return Effect.void;
  }
  return Effect.tryPromise(() => client.close()).pipe(Effect.ignore);
}

// --- Effect Service ---

interface State {
  status: Record<string, SchemaMcp.Status>;
  clients: Record<string, MCPClient>;
  defs: Record<string, MCPTool[]>;
}

export interface Interface {
  readonly status: () => Effect.Effect<Record<string, SchemaMcp.Status>>;
  readonly clients: () => Effect.Effect<Record<string, MCPClient>>;
  readonly tools: () => Effect.Effect<Record<string, Tool>>;
  readonly prompts: () => Effect.Effect<Record<string, PromptInfo & { client: string }>>;
  readonly resources: () => Effect.Effect<Record<string, ResourceInfo & { client: string }>>;
  readonly add: (
    name: string,
    mcp: SchemaMcp.Info
  ) => Effect.Effect<{
    status: Record<string, SchemaMcp.Status> | SchemaMcp.Status;
  }>;
  readonly connect: (name: string) => Effect.Effect<void>;
  readonly disconnect: (name: string) => Effect.Effect<void>;
  readonly getPrompt: (
    clientName: string,
    name: string,
    args?: Record<string, string>
  ) => Effect.Effect<Awaited<ReturnType<MCPClient['getPrompt']>> | undefined>;
  readonly readResource: (
    clientName: string,
    resourceUri: string
  ) => Effect.Effect<Awaited<ReturnType<MCPClient['readResource']>> | undefined>;
  readonly startAuth: (
    mcpName: string
  ) => Effect.Effect<{ authorizationUrl: string; oauthState: string }>;
  readonly finishAuth: (
    mcpName: string,
    authorizationCode: string
  ) => Effect.Effect<SchemaMcp.Status>;
  readonly removeAuth: (mcpName: string) => Effect.Effect<void>;
  readonly supportsOAuth: (mcpName: string) => Effect.Effect<boolean>;
  readonly hasStoredTokens: (mcpName: string) => Effect.Effect<boolean>;
  readonly getAuthStatus: (mcpName: string) => Effect.Effect<AuthStatus>;
}

export class Service extends Context.Service<Service, Interface>()('@openchat/MCP') {}

export const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const spawner = yield* ChildProcessSpawner.ChildProcessSpawner;
    const auth = yield* McpAuth.Service;
    const bus = yield* Bus.Service;
    const cfgSvc = yield* Config.Service;
    const fs = yield* AppFileSystem.Service;

    type Transport = StdioClientTransport | StreamableHTTPClientTransport | SSEClientTransport;

    const DISABLED_RESULT: CreateResult = { status: { status: 'disabled' } };

    /**
     * Connect a client via the given transport with resource safety:
     * on failure the transport is closed; on success the caller owns it.
     */
    const connectTransport = (transport: Transport, timeout: number) =>
      Effect.acquireUseRelease(
        Effect.succeed(new MCPClient({ name: 'openchat', version: pkg.version })),
        client =>
          Effect.tryPromise({
            try: async () => {
              await withTimeout(client.connect(transport), timeout);
              return client;
            },
            catch: e => e
          }),
        (client, exit) =>
          Exit.isFailure(exit)
            ? Effect.tryPromise(() => client.close()).pipe(Effect.ignore)
            : Effect.void
      );

    const connectRemote = Effect.fn('MCP.connectRemote')(function* (
      key: string,
      mcp: SchemaMcp.Info & { type: 'remote' }
    ) {
      const oauthDisabled = mcp.oauth === false;
      const oauthConfig = typeof mcp.oauth === 'object' ? mcp.oauth : void 0;
      const url = remoteURL(key, mcp.url);
      if (!url) {
        return {
          client: void 0,
          status: { status: 'failed' as const, error: `Invalid MCP URL for "${key}"` }
        };
      }
      let authProvider: McpOAuthProvider | undefined;

      if (!oauthDisabled) {
        authProvider = new McpOAuthProvider(
          key,
          mcp.url,
          {
            clientId: oauthConfig?.clientId,
            clientSecret: oauthConfig?.clientSecret,
            scope: oauthConfig?.scope,
            redirectUri: oauthConfig?.redirectUri
          },
          {
            onRedirect: url => {
              log.info('oauth redirect requested', { key, url: url.toString() });
            }
          },
          auth
        );
      }

      const transports: Array<{ name: string; transport: TransportWithAuth }> = [
        {
          name: 'StreamableHTTP',
          transport: new StreamableHTTPClientTransport(url, {
            authProvider,
            requestInit: mcp.headers ? { headers: mcp.headers } : void 0
          })
        },
        {
          name: 'SSE',
          transport: new SSEClientTransport(url, {
            authProvider,
            requestInit: mcp.headers ? { headers: mcp.headers } : void 0
          })
        }
      ];

      const connectTimeout = mcp.timeout ?? DEFAULT_TIMEOUT;
      let lastStatus: SchemaMcp.Status | undefined;

      for (const { name, transport } of transports) {
        const result = yield* connectTransport(transport, connectTimeout).pipe(
          Effect.map((client): { client: MCPClient | undefined; transportName: string } => ({
            client,
            transportName: name
          })),
          Effect.catch(error => {
            const lastError = error instanceof Error ? error : new Error(String(error));
            const isAuthError =
              error instanceof UnauthorizedError ||
              (authProvider && lastError.message.includes('OAuth'));

            if (isAuthError) {
              log.info('mcp server requires authentication', { key, transport: name });

              if (
                lastError.message.includes('registration') ||
                lastError.message.includes('client_id')
              ) {
                lastStatus = {
                  status: 'needs_client_registration' as const,
                  error:
                    'Server does not support dynamic client registration. Please provide clientId in config.'
                };
                return Effect.void;
                // TODO
                // return bus
                //   .publish(TuiEvent.ToastShow, {
                //     title: 'MCP Authentication Required',
                //     message: `Server "${key}" requires a pre-registered client ID. Add clientId to your config.`,
                //     variant: 'warning',
                //     duration: 8000
                //   })
                //   .pipe(Effect.ignore, Effect.as(void 0));
              } else {
                lastStatus = { status: 'needs_auth' as const };
                return Effect.void;
                // TODO
                // return bus
                //   .publish(TuiEvent.ToastShow, {
                //     title: 'MCP Authentication Required',
                //     message: `Server "${key}" requires authentication. Run: opencode mcp auth ${key}`,
                //     variant: 'warning',
                //     duration: 8000
                //   })
                //   .pipe(Effect.ignore, Effect.as(void 0));
              }
            }

            log.debug('transport connection failed', {
              key,
              transport: name,
              url: mcp.url,
              error: lastError.message
            });
            lastStatus = { status: 'failed' as const, error: lastError.message };
            return Effect.succeed(void 0);
          })
        );
        if (result) {
          log.info('connected', { key, transport: result.transportName });
          return { client: result.client, status: { status: 'connected' as const } };
        }
        // If this was an auth error, stop trying other transports
        if (
          lastStatus?.status === 'needs_auth' ||
          lastStatus?.status === 'needs_client_registration'
        ) {
          break;
        }
      }

      return {
        client: void 0,
        status: lastStatus ?? { status: 'failed', error: 'Unknown error' }
      };
    });

    const connectLocal = Effect.fn('MCP.connectLocal')(
      function* (key: string, mcp: SchemaMcp.Info & { type: 'local' }) {
        const [cmd, ...args] = mcp.command;
        const cwd = yield* InstanceContext.directory;
        const transport = new StdioClientTransport({
          stderr: 'pipe',
          command: cmd!,
          args,
          cwd,
          env: {
            ...process.env,
            ...(cmd === 'opencode' ? { BUN_BE_BUN: '1' } : {}),
            ...mcp.environment
          }
        });
        transport.stderr?.on('data', (chunk: Buffer) => {
          log.info(`mcp stderr: ${chunk.toString()}`, { key });
        });

        const connectTimeout = mcp.timeout ?? DEFAULT_TIMEOUT;
        return yield* connectTransport(transport, connectTimeout).pipe(
          Effect.map((client): { client: MCPClient | undefined; status: SchemaMcp.Status } => ({
            client,
            status: { status: 'connected' }
          })),
          Effect.catch(
            (error): Effect.Effect<{ client: MCPClient | undefined; status: SchemaMcp.Status }> => {
              const msg = error instanceof Error ? error.message : String(error);
              log.error('local mcp startup failed', { key, command: mcp.command, cwd, error: msg });
              return Effect.succeed({ client: void 0, status: { status: 'failed', error: msg } });
            }
          )
        );
      },
      Effect.provideService(AppFileSystem.Service, fs)
    );

    const withClient = Effect.fnUntraced(function* <A>(
      clientName: string,
      fn: (client: MCPClient) => Promise<A>,
      label: string,
      meta?: Record<string, unknown>
    ) {
      const s = yield* ModuleState.get(state);
      const client = s.clients[clientName];
      if (!client) {
        log.warn(`client not found for ${label}`, { clientName });
        return void 0;
      }
      return yield* Effect.tryPromise({
        try: () => fn(client),
        catch: (e: unknown) => {
          if (TypeGuard.isRecord(e)) {
            log.error(`failed to ${label}`, { clientName, ...meta, error: e?.message });
          }
          return e;
        }
      }).pipe(Effect.orElseSucceed(() => void 0));
    });

    const storeClient = Effect.fnUntraced(function* (
      s: State,
      name: string,
      client: MCPClient,
      listed: MCPTool[],
      timeout?: number
    ) {
      const runner = yield* EffectRunner.make();
      yield* closeClient(s, name);
      s.status[name] = { status: 'connected' };
      s.clients[name] = client;
      s.defs[name] = listed;
      watch(s, name, client, runner, timeout);
      return s.status[name];
    });

    const create = Effect.fn('MCP.create')(function* (key: string, mcp: SchemaMcp.Info) {
      if (mcp.enabled === false) {
        log.info('mcp server disabled', { key });
        return DISABLED_RESULT;
      }

      log.info('found', { key, type: mcp.type });

      const { client: mcpClient, status } =
        mcp.type === 'remote' ? yield* connectRemote(key, mcp) : yield* connectLocal(key, mcp);

      if (!mcpClient) {
        return { status } satisfies CreateResult;
      }

      const listed = yield* defs(key, mcpClient, mcp.timeout);
      if (!listed) {
        yield* Effect.tryPromise(() => mcpClient.close()).pipe(Effect.ignore);
        return {
          status: { status: 'failed', error: 'Failed to get tools' }
        } satisfies CreateResult;
      }

      log.info('create() successfully created client', { key, toolCount: listed.length });
      return { mcpClient, status, defs: listed } satisfies CreateResult;
    });

    const watch = (
      s: State,
      name: string,
      client: MCPClient,
      runner: EffectRunner.Shape,
      timeout?: number
    ) => {
      client.setNotificationHandler(ToolListChangedNotificationSchema, async () => {
        log.info('tools list changed notification received', { server: name });
        if (s.clients[name] !== client || s.status[name]?.status !== 'connected') {
          return;
        }

        const listed = await runner.promise(defs(name, client, timeout));
        if (!listed) {
          return;
        }
        if (s.clients[name] !== client || s.status[name]?.status !== 'connected') {
          return;
        }

        s.defs[name] = listed;
        await runner.promise(
          bus.publish(SchemaMcp.ToolsChanged, { server: name }).pipe(Effect.ignore)
        );
      });
    };

    const descendants = Effect.fnUntraced(
      function* (pid: number) {
        if (process.platform === 'win32') {
          return [] as number[];
        }
        const pids: number[] = [];
        const queue = [pid];
        while (queue.length > 0) {
          const current = queue.shift()!;
          const handle = yield* spawner.spawn(
            ChildProcess.make('pgrep', ['-P', String(current)], { stdin: 'ignore' })
          );
          const text = yield* Stream.mkString(Stream.decodeText(handle.stdout));
          yield* handle.exitCode;
          for (const tok of text.split('\n')) {
            const cpid = parseInt(tok, 10);
            if (!isNaN(cpid) && !pids.includes(cpid)) {
              pids.push(cpid);
              queue.push(cpid);
            }
          }
        }
        return pids;
      },
      Effect.scoped,
      Effect.catch(() => Effect.succeed([] as number[]))
    );

    const createAndStore = Effect.fn('MCP.createAndStore')(function* (
      name: string,
      mcp: SchemaMcp.Info
    ) {
      const s = yield* ModuleState.get(state);
      const result = yield* create(name, mcp);

      s.status[name] = result.status;
      if (!result.mcpClient) {
        yield* closeClient(s, name);
        delete s.clients[name];
        return result.status;
      }

      return yield* storeClient(s, name, result.mcpClient, result.defs!, mcp.timeout);
    });

    const getMcpConfig = Effect.fnUntraced(function* (mcpName: string) {
      const cfg = yield* cfgSvc.get();
      const mcpConfig = cfg.mcp?.[mcpName];
      if (!mcpConfig || !isMcpConfigured(mcpConfig)) {
        return void 0;
      }
      return mcpConfig;
    });

    const state = yield* ModuleState.make<State>(
      Effect.fn('MCP.state')(function* () {
        const cfg = yield* cfgSvc.get();
        const runner = yield* EffectRunner.make();
        const config = cfg.mcp ?? {};
        const s: State = {
          status: {},
          clients: {},
          defs: {}
        };

        yield* Effect.forEach(
          Object.entries(config),
          ([key, mcp]) =>
            Effect.gen(function* () {
              if (!isMcpConfigured(mcp)) {
                log.error('Ignoring MCP config entry without type', { key });
                return;
              }

              if (mcp.enabled === false) {
                s.status[key] = { status: 'disabled' };
                return;
              }

              const result = yield* create(key, mcp).pipe(Effect.catch(() => Effect.void));
              if (!result) {
                return;
              }

              s.status[key] = result.status;
              if (result.mcpClient) {
                s.clients[key] = result.mcpClient;
                s.defs[key] = result.defs!;
                watch(s, key, result.mcpClient, runner, mcp.timeout);
              }
            }),
          { concurrency: 'unbounded' }
        );

        yield* Effect.addFinalizer(() =>
          Effect.gen(function* () {
            yield* Effect.forEach(
              Object.values(s.clients),
              client =>
                Effect.gen(function* () {
                  const pid =
                    client.transport instanceof StdioClientTransport ? client.transport.pid : null;
                  if (typeof pid === 'number') {
                    const pids = yield* descendants(pid);
                    for (const dpid of pids) {
                      try {
                        process.kill(dpid, 'SIGTERM');
                      } catch {
                        /* empty */
                      }
                    }
                  }
                  yield* Effect.tryPromise(() => client.close()).pipe(Effect.ignore);
                }),
              { concurrency: 'unbounded' }
            );
            pendingOAuthMCPClient.clear();
          })
        );

        return s;
      })
    );

    const status = Effect.fn('MCP.status')(function* () {
      const s = yield* ModuleState.get(state);

      const cfg = yield* cfgSvc.get();
      const config = cfg.mcp ?? {};
      const result: Record<string, SchemaMcp.Status> = {};

      for (const [key, mcp] of Object.entries(config)) {
        if (!isMcpConfigured(mcp)) {
          continue;
        }
        result[key] = s.status[key] ?? { status: 'disabled' };
      }

      return result;
    });

    const clients = Effect.fn('MCP.clients')(function () {
      return ModuleState.use(state, s => s.clients);
    });

    const tools = Effect.fn('MCP.tools')(function* () {
      const result: Record<string, Tool> = {};
      const s = yield* ModuleState.get(state);

      const cfg = yield* cfgSvc.get();
      const config = cfg.mcp ?? {};
      const defaultTimeout = cfg.experimental?.mcp_timeout;

      const connectedClients = Object.entries(s.clients).filter(
        ([clientName]) => s.status[clientName]?.status === 'connected'
      );

      for (const [clientName, client] of connectedClients) {
        const mcpConfig = config[clientName];
        const entry = mcpConfig && isMcpConfigured(mcpConfig) ? mcpConfig : void 0;

        const listed = s.defs[clientName];
        if (!listed) {
          log.warn('missing cached tools for connected server', { clientName });
          continue;
        }

        const timeout = entry?.timeout ?? defaultTimeout;
        for (const mcpTool of listed) {
          result[sanitize(clientName) + '_' + sanitize(mcpTool.name)] = convertMcpTool(
            mcpTool,
            client,
            timeout
          );
        }
      }

      return result;
    });

    const prompts = Effect.fn('MCP.prompts')(function* () {
      const s = yield* ModuleState.get(state);
      return yield* collectFromConnected(s, c => c.listPrompts().then(r => r.prompts), 'prompts');
    });

    const resources = Effect.fn('MCP.resources')(function* () {
      const s = yield* ModuleState.get(state);
      return yield* collectFromConnected(
        s,
        c => c.listResources().then(r => r.resources),
        'resources'
      );
    });

    const add = Effect.fn('MCP.add')(function* (name: string, mcp: SchemaMcp.Info) {
      yield* createAndStore(name, mcp);
      const s = yield* ModuleState.get(state);
      return { status: s.status };
    });

    const connect = Effect.fn('MCP.connect')(function* (name: string) {
      const mcp = yield* getMcpConfig(name);
      if (!mcp) {
        log.error('MCP config not found or invalid', { name });
        return;
      }
      yield* createAndStore(name, { ...mcp, enabled: true });
    });

    const disconnect = Effect.fn('MCP.disconnect')(function* (name: string) {
      const s = yield* ModuleState.get(state);
      yield* closeClient(s, name);
      delete s.clients[name];
      s.status[name] = { status: 'disabled' };
    });

    const getPrompt = Effect.fn('MCP.getPrompt')(function* (
      clientName: string,
      name: string,
      args?: Record<string, string>
    ) {
      return yield* withClient(
        clientName,
        client => client.getPrompt({ name, arguments: args }),
        'getPrompt',
        {
          promptName: name
        }
      );
    });

    const readResource = Effect.fn('MCP.readResource')(function* (
      clientName: string,
      resourceUri: string
    ) {
      return yield* withClient(
        clientName,
        client => client.readResource({ uri: resourceUri }),
        'readResource',
        {
          resourceUri
        }
      );
    });

    const startAuth = Effect.fn('MCP.startAuth')(function* (mcpName: string) {
      const mcpConfig = yield* getMcpConfig(mcpName);
      if (!mcpConfig) {
        throw new Error(`MCP server ${mcpName} not found or disabled`);
      }
      if (mcpConfig.type !== 'remote') {
        throw new Error(`MCP server ${mcpName} is not a remote server`);
      }
      if (mcpConfig.oauth === false) {
        throw new Error(`MCP server ${mcpName} has OAuth explicitly disabled`);
      }
      const url = remoteURL(mcpName, mcpConfig.url);
      if (!url) {
        throw new Error(`Invalid MCP URL for "${mcpName}"`);
      }

      // OAuth config is optional - if not provided, we'll use auto-discovery
      const oauthConfig = typeof mcpConfig.oauth === 'object' ? mcpConfig.oauth : void 0;

      // Start the callback server with custom redirectUri if configured
      yield* Effect.promise(() => ensureRunning(oauthConfig?.redirectUri));

      // cleanup old client
      if (pendingOAuthMCPClient.has(mcpName)) {
        const oldClient = pendingOAuthMCPClient.get(mcpName)!;
        pendingOAuthMCPClient.delete(mcpName);
        yield* Effect.tryPromise(() => oldClient.close()).pipe(Effect.ignore);
      }

      const oauthState = Array.from(crypto.getRandomValues(new Uint8Array(32)))
        .map(b => b.toString(16).padStart(2, '0'))
        .join('');
      yield* auth.updateOAuthState(mcpName, oauthState);
      let capturedUrl: URL | undefined;
      const authProvider = new McpOAuthProvider(
        mcpName,
        mcpConfig.url,
        {
          clientId: oauthConfig?.clientId,
          clientSecret: oauthConfig?.clientSecret,
          scope: oauthConfig?.scope,
          redirectUri: oauthConfig?.redirectUri
        },
        {
          onRedirect: url => {
            capturedUrl = url;
          }
        },
        auth
      );

      const transports: TransportWithAuth[] = [
        new StreamableHTTPClientTransport(url, { authProvider }),
        new SSEClientTransport(url, { authProvider })
      ];
      const errers: unknown[] = [];

      for (const transport of transports) {
        const client = new MCPClient({ name: 'openchat', version: pkg.version });
        const result = yield* Effect.tryPromise({
          try: async () => {
            await client.connect(transport);
            return { authorizationUrl: '', oauthState, client } satisfies AuthResult;
          },
          catch: error => error
        }).pipe(
          Effect.catch(error => {
            if (error instanceof UnauthorizedError && capturedUrl) {
              pendingOAuthMCPClient.set(mcpName, client);
              return Effect.succeed({
                authorizationUrl: capturedUrl.toString(),
                oauthState
              } satisfies AuthResult);
            }
            errers.push(error);
            return Effect.gen(function* () {
              yield* Effect.tryPromise(() => client.close()).pipe(Effect.ignore);
              return void 0;
            });
          })
        );
        if (result) {
          return result;
        }
      }
      return yield* Effect.die(
        new AggregateError(
          errers,
          `Failed to connect to MCP server "${mcpName}" for OAuth authentication`
        )
      );
    });

    const finishAuth = Effect.fn('MCP.finishAuth')(function* (
      mcpName: string,
      authorizationCode: string
    ) {
      const mcpClient = pendingOAuthMCPClient.get(mcpName);
      const transport = mcpClient?.transport as TransportWithAuth;
      if (!transport) {
        throw new Error(`No pending OAuth flow for MCP server: ${mcpName}`);
      }

      const result = yield* Effect.tryPromise({
        try: () => transport.finishAuth(authorizationCode).then(() => true as const),
        catch: error => {
          log.error('failed to finish oauth', { mcpName, error });
          return error;
        }
      }).pipe(Effect.option);

      if (Option.isNone(result)) {
        return { status: 'failed' as const, error: 'OAuth completion failed' };
      }

      yield* auth.clearCodeVerifier(mcpName);
      yield* Effect.tryPromise(() => mcpClient!.close()).pipe(Effect.ignore);
      pendingOAuthMCPClient.delete(mcpName);

      const mcpConfig = yield* getMcpConfig(mcpName);
      if (!mcpConfig) {
        return { status: 'failed' as const, error: 'MCP config not found after auth' };
      }

      return yield* createAndStore(mcpName, mcpConfig);
    });

    const removeAuth = Effect.fn('MCP.removeAuth')(function* (mcpName: string) {
      yield* auth.remove(mcpName);
      cancelPending(mcpName);
      pendingOAuthMCPClient.delete(mcpName);
      log.info('removed oauth credentials', { mcpName });
    });

    const supportsOAuth = Effect.fn('MCP.supportsOAuth')(function* (mcpName: string) {
      const mcpConfig = yield* getMcpConfig(mcpName);
      if (!mcpConfig) {
        return false;
      }
      return mcpConfig.type === 'remote' && mcpConfig.oauth !== false;
    });

    const hasStoredTokens = Effect.fn('MCP.hasStoredTokens')(function* (mcpName: string) {
      const entry = yield* auth.get(mcpName);
      return !!entry?.tokens;
    });

    const getAuthStatus = Effect.fn('MCP.getAuthStatus')(function* (mcpName: string) {
      const entry = yield* auth.get(mcpName);
      if (!entry?.tokens) {
        return 'not_authenticated';
      }
      const expired = yield* auth.isTokenExpired(mcpName);
      return expired ? 'expired' : 'authenticated';
    });

    return Service.of({
      status,
      clients,
      tools,
      prompts,
      resources,
      add,
      connect,
      disconnect,
      getPrompt,
      readResource,
      startAuth,
      finishAuth,
      removeAuth,
      supportsOAuth,
      hasStoredTokens,
      getAuthStatus
    });
  })
);

export type AuthStatus = 'authenticated' | 'expired' | 'not_authenticated';

// --- Per-service runtime ---

export const defaultLayer = layer.pipe(
  Layer.provide(McpAuth.layer),
  Layer.provide(Bus.layer),
  Layer.provide(Config.defaultLayer),
  Layer.provide(CrossSpawnSpawner.defaultLayer),
  Layer.provide(AppFileSystem.defaultLayer)
);
