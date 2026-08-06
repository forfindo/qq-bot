import { Schema } from 'effect';
import { PositiveInt } from '@/schema/common';
import { NamedError } from '@/utils/error';
import { BusEvent } from '@/bus';

export const Local = Schema.Struct({
  type: Schema.Literal('local').annotate({ description: 'Type of MCP server connection' }),
  command: Schema.mutable(Schema.Array(Schema.String)).annotate({
    description: 'Command and arguments to run the MCP server'
  }),
  environment: Schema.optional(Schema.Record(Schema.String, Schema.String)).annotate({
    description: 'Environment variables to set when running the MCP server'
  }),
  enabled: Schema.optional(Schema.Boolean).annotate({
    description: 'Enable or disable the MCP server on startup'
  }),
  timeout: Schema.optional(PositiveInt).annotate({
    description:
      'Timeout in ms for MCP server requests. Defaults to 5000 (5 seconds) if not specified.'
  })
}).annotate({ identifier: 'McpLocalConfig' });
export type Local = Schema.Schema.Type<typeof Local>;

export const OAuth = Schema.Struct({
  clientId: Schema.optional(Schema.String).annotate({
    description:
      'OAuth client ID. If not provided, dynamic client registration (RFC 7591) will be attempted.'
  }),
  clientSecret: Schema.optional(Schema.String).annotate({
    description: 'OAuth client secret (if required by the authorization server)'
  }),
  scope: Schema.optional(Schema.String).annotate({
    description: 'OAuth scopes to request during authorization'
  }),
  redirectUri: Schema.optional(Schema.String).annotate({
    description: 'OAuth redirect URI (default: http://127.0.0.1:19876/mcp/oauth/callback).'
  })
}).annotate({ identifier: 'McpOAuthConfig' });
export type OAuth = Schema.Schema.Type<typeof OAuth>;

export const Remote = Schema.Struct({
  type: Schema.Literal('remote').annotate({ description: 'Type of MCP server connection' }),
  url: Schema.String.annotate({ description: 'URL of the remote MCP server' }),
  enabled: Schema.optional(Schema.Boolean).annotate({
    description: 'Enable or disable the MCP server on startup'
  }),
  headers: Schema.optional(Schema.Record(Schema.String, Schema.String)).annotate({
    description: 'Headers to send with the request'
  }),
  oauth: Schema.optional(Schema.Union([OAuth, Schema.Literal(false)])).annotate({
    description:
      'OAuth authentication configuration for the MCP server. Set to false to disable OAuth auto-detection.'
  }),
  timeout: Schema.optional(PositiveInt).annotate({
    description:
      'Timeout in ms for MCP server requests. Defaults to 5000 (5 seconds) if not specified.'
  })
}).annotate({ identifier: 'McpRemoteConfig' });
export type Remote = Schema.Schema.Type<typeof Remote>;

export const Info = Schema.Union([Local, Remote]).annotate({ discriminator: 'type' });
export type Info = Schema.Schema.Type<typeof Info>;

export const Resource = Schema.Struct({
  name: Schema.String,
  uri: Schema.String,
  description: Schema.optional(Schema.String),
  mimeType: Schema.optional(Schema.String),
  client: Schema.String
}).annotate({ identifier: 'McpResource' });
export type Resource = Schema.Schema.Type<typeof Resource>;

const StatusConnected = Schema.Struct({ status: Schema.Literal('connected') }).annotate({
  identifier: 'MCPStatusConnected'
});
const StatusDisabled = Schema.Struct({ status: Schema.Literal('disabled') }).annotate({
  identifier: 'MCPStatusDisabled'
});
const StatusFailed = Schema.Struct({
  status: Schema.Literal('failed'),
  error: Schema.String
}).annotate({
  identifier: 'MCPStatusFailed'
});
const StatusNeedsAuth = Schema.Struct({ status: Schema.Literal('needs_auth') }).annotate({
  identifier: 'MCPStatusNeedsAuth'
});
const StatusNeedsClientRegistration = Schema.Struct({
  status: Schema.Literal('needs_client_registration'),
  error: Schema.String
}).annotate({ identifier: 'MCPStatusNeedsClientRegistration' });

export const Status = Schema.Union([
  StatusConnected,
  StatusDisabled,
  StatusFailed,
  StatusNeedsAuth,
  StatusNeedsClientRegistration
]).annotate({ identifier: 'MCPStatus', discriminator: 'status' });
export type Status = Schema.Schema.Type<typeof Status>;

export const Tokens = Schema.Struct({
  accessToken: Schema.mutableKey(Schema.String),
  refreshToken: Schema.mutableKey(Schema.optional(Schema.String)),
  expiresAt: Schema.mutableKey(Schema.optional(Schema.Number)),
  scope: Schema.mutableKey(Schema.optional(Schema.String))
});
export type Tokens = Schema.Schema.Type<typeof Tokens>;

export const ClientInfo = Schema.Struct({
  clientId: Schema.mutableKey(Schema.String),
  clientSecret: Schema.mutableKey(Schema.optional(Schema.String)),
  clientIdIssuedAt: Schema.mutableKey(Schema.optional(Schema.Number)),
  clientSecretExpiresAt: Schema.mutableKey(Schema.optional(Schema.Number))
});
export type ClientInfo = Schema.Schema.Type<typeof ClientInfo>;

export const Entry = Schema.Struct({
  tokens: Schema.mutableKey(Schema.optional(Tokens)),
  clientInfo: Schema.mutableKey(Schema.optional(ClientInfo)),
  codeVerifier: Schema.mutableKey(Schema.optional(Schema.String)),
  oauthState: Schema.mutableKey(Schema.optional(Schema.String)),
  serverUrl: Schema.mutableKey(Schema.optional(Schema.String))
});
export type Entry = Schema.Schema.Type<typeof Entry>;

export const decodeAuthData = Schema.decodeUnknownOption(Schema.Record(Schema.String, Entry));
export type AuthData = Record<string, Entry>;

// Error
export const Failed = NamedError.create('MCPFailed', {
  name: Schema.String
});

// TODO: Event
export const ToolsChanged = BusEvent.define(
  'mcp.tools.changed',
  Schema.Struct({
    server: Schema.String
  })
);

export const BrowserOpenFailed = BusEvent.define(
  'mcp.browser.open.failed',
  Schema.Struct({
    mcpName: Schema.String,
    url: Schema.String
  })
);
