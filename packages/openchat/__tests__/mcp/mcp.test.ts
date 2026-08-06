import { describe, expect } from 'vitest';
import { Effect, Layer, ManagedRuntime } from 'effect';
import { MCP } from '@/mcp';
import { InstanceRefs } from '@/instance';

describe('mcp service', () => {
  const runtime = ManagedRuntime.make(
    MCP.defaultLayer.pipe(
      Layer.provideMerge(Layer.succeed(InstanceRefs.InstanceRef, { uid: '3530766280' }))
    ),
    { memoMap: Layer.makeMemoMapUnsafe() }
  );

  it('auth', async () => {
    await runtime.runPromise(
      Effect.gen(function* () {
        const mcp = yield* MCP.Service;
        const result = yield* mcp.status();
        const status = result['deep-wiki']?.status;
        expect(status).toBe('needs_auth');
        const { authorizationUrl, oauthState } = yield* mcp.startAuth('deep-wiki');
        console.log(authorizationUrl, oauthState);
      })
    );
  });
});
