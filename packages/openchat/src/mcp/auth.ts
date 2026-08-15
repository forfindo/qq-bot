import { Context, Effect, Layer, Option } from 'effect';
import { SchemaMcp } from '@/schema';
import { AppFileSystem } from '@/file';
import path from 'path';
import { Global } from '@/utils';

const filepath = path.join(Global.Path.data, 'mcp-auth.json');

export interface Interface {
  readonly all: () => Effect.Effect<Record<string, SchemaMcp.Entry>>;
  readonly get: (mcpName: string) => Effect.Effect<SchemaMcp.Entry | undefined>;
  readonly getForUrl: (
    mcpName: string,
    serverUrl: string
  ) => Effect.Effect<SchemaMcp.Entry | undefined>;
  readonly set: (
    mcpName: string,
    entry: SchemaMcp.Entry,
    serverUrl?: string
  ) => Effect.Effect<void>;
  readonly remove: (mcpName: string) => Effect.Effect<void>;
  readonly updateTokens: (
    mcpName: string,
    tokens: SchemaMcp.Tokens,
    serverUrl?: string
  ) => Effect.Effect<void>;
  readonly updateClientInfo: (
    mcpName: string,
    clientInfo: SchemaMcp.ClientInfo,
    serverUrl?: string
  ) => Effect.Effect<void>;
  readonly updateCodeVerifier: (mcpName: string, codeVerifier: string) => Effect.Effect<void>;
  readonly clearCodeVerifier: (mcpName: string) => Effect.Effect<void>;
  readonly updateOAuthState: (mcpName: string, oauthState: string) => Effect.Effect<void>;
  readonly getOAuthState: (mcpName: string) => Effect.Effect<string | undefined>;
  readonly clearOAuthState: (mcpName: string) => Effect.Effect<void>;
  readonly isTokenExpired: (mcpName: string) => Effect.Effect<boolean | null>;
}

export class Service extends Context.Service<Service, Interface>()('@openchat/McpAuth') {}

export const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const fs = yield* AppFileSystem.Service;

    const all: () => Effect.Effect<SchemaMcp.AuthData> = Effect.fn('McpAuth.all')(function* () {
      return yield* fs.readJson(filepath).pipe(
        Effect.map((data): SchemaMcp.AuthData =>
          Option.getOrElse(SchemaMcp.decodeAuthData(data), () => ({}))
        ),
        Effect.catch(() => Effect.succeed({}))
      );
    });

    const get = Effect.fn('McpAuth.get')(function* (mcpName: string) {
      const data = yield* all();
      return data[mcpName];
    });

    const getForUrl = Effect.fn('McpAuth.getForUrl')(function* (
      mcpName: string,
      serverUrl: string
    ) {
      const entry = yield* get(mcpName);
      if (!entry) {
        return void 0;
      }
      if (!entry.serverUrl) {
        return void 0;
      }
      if (entry.serverUrl !== serverUrl) {
        return void 0;
      }
      return entry;
    });

    const set = Effect.fn('McpAuth.set')(function* (
      mcpName: string,
      entry: SchemaMcp.Entry,
      serverUrl?: string
    ) {
      const data = yield* all();
      if (serverUrl) {
        entry.serverUrl = serverUrl;
      }
      yield* fs.writeJson(filepath, { ...data, [mcpName]: entry }, 0o600).pipe(Effect.orDie);
    });

    const remove = Effect.fn('McpAuth.remove')(function* (mcpName: string) {
      const data = yield* all();
      delete data[mcpName];
      yield* fs.writeJson(filepath, data, 0o600).pipe(Effect.orDie);
    });

    const updateField = <K extends keyof SchemaMcp.Entry>(field: K, spanName: string) =>
      Effect.fn(`McpAuth.${spanName}`)(function* (
        mcpName: string,
        value: NonNullable<SchemaMcp.Entry[K]>,
        serverUrl?: string
      ) {
        const entry = (yield* get(mcpName)) ?? {};
        entry[field] = value;
        yield* set(mcpName, entry, serverUrl);
      });

    const clearField = (field: keyof SchemaMcp.Entry, spanName: string) =>
      Effect.fn(`McpAuth.${spanName}`)(function* (mcpName: string) {
        const entry = yield* get(mcpName);
        if (entry) {
          delete entry[field];
          yield* set(mcpName, entry);
        }
      });

    const updateTokens = updateField('tokens', 'updateTokens');
    const updateClientInfo = updateField('clientInfo', 'updateClientInfo');
    const updateCodeVerifier = updateField('codeVerifier', 'updateCodeVerifier');
    const updateOAuthState = updateField('oauthState', 'updateOAuthState');
    const clearCodeVerifier = clearField('codeVerifier', 'clearCodeVerifier');
    const clearOAuthState = clearField('oauthState', 'clearOAuthState');

    const getOAuthState = Effect.fn('McpAuth.getOAuthState')(function* (mcpName: string) {
      const entry = yield* get(mcpName);
      return entry?.oauthState;
    });

    const isTokenExpired = Effect.fn('McpAuth.isTokenExpired')(function* (mcpName: string) {
      const entry = yield* get(mcpName);
      if (!entry?.tokens) {
        return null;
      }
      if (!entry.tokens.expiresAt) {
        return false;
      }
      return entry.tokens.expiresAt < Date.now() / 1000;
    });

    return Service.of({
      all,
      get,
      getForUrl,
      set,
      remove,
      updateTokens,
      updateClientInfo,
      updateCodeVerifier,
      clearCodeVerifier,
      updateOAuthState,
      getOAuthState,
      clearOAuthState,
      isTokenExpired
    });
  })
);

export const defaultLayer = layer.pipe(Layer.provide(AppFileSystem.defaultLayer));
