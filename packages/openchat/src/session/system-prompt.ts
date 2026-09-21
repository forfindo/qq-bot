import { SchemaAgent, SchemaProvider } from '@/schema';
import { Context, Effect, Layer } from 'effect';
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
import { Skill } from '@/skill';
import { Permission } from '@/permission';
import { LayerNode } from '@/runtime';

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
  const key = `${channelType}-${channelId}`;

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
});

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
});

export interface Interface {
  readonly environment: (model: SchemaProvider.Model) => Effect.Effect<string[]>;
  readonly skills: (agent: SchemaAgent.Info) => Effect.Effect<string | undefined>;
}

export class Service extends Context.Service<Service, Interface>()('@openchat/SystemPrompt') {}

const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const skill = yield* Skill.Service;
    const fs = yield* AppFileSystem.Service;

    return Service.of({
      environment: Effect.fn('SystemPrompt.environment')(
        function* (model: SchemaProvider.Model) {
          const directory = yield* InstanceContext.directory;
          return [
            [
              `You are powered by the model named ${model.api.id}. The exact model ID is ${model.providerID}/${model.api.id}`,
              `Here is some useful information about the environment you are running in:`,
              `<env>`,
              `  Working directory: ${directory}`,
              `  Platform: ${process.platform}`,
              `  Today's date: ${new Date().toDateString()}`,
              `</env>`
            ].join('\n')
          ];
        },
        Effect.provideService(AppFileSystem.Service, fs)
      ),

      skills: Effect.fn('SystemPrompt.skills')(function* (agent: SchemaAgent.Info) {
        if (Permission.disabled(['skill'], agent.permission).has('skill')) {
          return;
        }

        const list = yield* skill.available(agent);

        return [
          'Skills provide specialized instructions and workflows for specific tasks.',
          'Use the skill tool to load a skill when a task matches its description.',
          // the agents seem to ingest the information about skills a bit better if we present a more verbose
          // version of them here and a less verbose version in tool description, rather than vice versa.
          Skill.fmt(list, { verbose: true })
        ].join('\n');
      })
    });
  })
);

export const node = LayerNode.make({
  service: Service,
  layer,
  deps: [Skill.node, AppFileSystem.node]
});
