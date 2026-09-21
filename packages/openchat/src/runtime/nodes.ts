import { makeGlobalNode } from '@/runtime/layer-node';
import { FileSystem } from 'effect';
import { NodeFileSystem } from '@effect/platform-node';
import { FetchHttpClient, HttpClient } from 'effect/unstable/http';

export const filesystem = makeGlobalNode({
  service: FileSystem.FileSystem,
  layer: NodeFileSystem.layer,
  deps: []
});
export const httpClient = makeGlobalNode({
  service: HttpClient.HttpClient,
  layer: FetchHttpClient.layer,
  deps: []
});
