import { SchemaProvider } from '@/schema';
import { Effect } from 'effect';
import { InstanceContext } from '@/instance';
import { AppFileSystem } from '@/file';
import path from 'path';
import PROMPT_BEAST from './prompt/beast.md';
import PROMPT_CODEX from './prompt/codex.md';
import PROMPT_GPT from './prompt/gpt.md';
import PROMPT_GEMINI from './prompt/gemini.md';
import PROMPT_ANTHROPIC from './prompt/anthropic.md';
import PROMPT_TRINITY from './prompt/trinity.md';
import PROMPT_KIMI from './prompt/kimi.md';
import PROMPT_DEFAULT from './prompt/default.md';

const channelPromptMap = new Map<string, string>();

export const providerPrompt = (model: SchemaProvider.Model) => {
  if (
    model.api.id.includes('gpt-4') ||
    model.api.id.includes('o1') ||
    model.api.id.includes('o3')
  ) {
    return PROMPT_BEAST;
  }
  if (model.api.id.includes('gpt')) {
    if (model.api.id.includes('codex')) {
      return PROMPT_CODEX;
    }
    return PROMPT_GPT;
  }
  if (model.api.id.includes('gemini-')) {
    return PROMPT_GEMINI;
  }
  if (model.api.id.includes('claude')) {
    return PROMPT_ANTHROPIC;
  }
  if (model.api.id.toLowerCase().includes('trinity')) {
    return PROMPT_TRINITY;
  }
  if (model.api.id.toLowerCase().includes('kimi')) {
    return PROMPT_KIMI;
  }
  return PROMPT_DEFAULT;
};

export const channelPrompt = Effect.fn(function* (channelType: string, channelId: string) {
  const fs = yield* AppFileSystem.Service;
  const directory = yield* InstanceContext.directory;
  const key = `${encodeURIComponent(channelType)}-${channelId}`;

  if (channelPromptMap.has(key)) {
    return channelPromptMap.get(key)!;
  }
  yield* fs.ensureDir(path.join(directory, `./${key}`));
  const prompt = yield* fs
    .readFileStringSafe(path.join(directory, `./${key}/prompt.md`))
    .pipe(Effect.orDie);
  if (prompt) {
    channelPromptMap.set(key, prompt);
  }
  return prompt;
}, Effect.provide(AppFileSystem.defaultLayer));

export const globalPrompt = Effect.fn(function* () {
  const fs = yield* AppFileSystem.Service;
  const directory = yield* InstanceContext.directory;
  const globalKey = 'global';

  if (channelPromptMap.has(globalKey)) {
    return channelPromptMap.get(globalKey)!;
  }
  const prompt = yield* fs
    .readFileStringSafe(path.join(directory, `./prompt.md`))
    .pipe(Effect.orDie);
  if (prompt) {
    channelPromptMap.set(globalKey, prompt);
  }
  return prompt;
}, Effect.provide(AppFileSystem.defaultLayer));
