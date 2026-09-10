import { describe, expect } from 'vitest';
import { Effect, Stream } from 'effect';
import { LLM, MessageSender } from '@/session';
import { SchemaMessage, SchemaProvider, SchemaSession } from '@/schema';
import { Agent } from '@/agent';
import { Provider } from '@/provider';
import { InstanceRef } from '@/instance/refrences';

describe('llm service', () => {
  it('normal', async () => {
    await Effect.gen(function* () {
      const llm = yield* LLM.Service;
      const agent = yield* Agent.Service;
      const provider = yield* Provider.Service;
      const sender = yield* MessageSender.Service;

      const providerId = SchemaProvider.ProviderID.make('deepseek');
      const modelId = SchemaProvider.ModelID.make('deepseek-v4-pro');
      const agentInfo = yield* agent.get('build');

      expect(agentInfo).toBeTruthy();

      const stream = llm.stream({
        user: {
          role: 'user',
          time: { created: Date.now() },
          agent: 'build',
          model: {
            providerID: providerId,
            modelID: modelId
          },
          id: SchemaMessage.MessageID.make('msg_fhdjakshlreff22'),
          sessionID: SchemaSession.SessionID.make('ses_sdfajkluuure1235')
        },
        sessionID: '',
        model: yield* provider.getModel(providerId, modelId),
        agent: agentInfo!,
        system: [],
        messages: [
          {
            role: 'user',
            content: MessageSender.withSenderInfo('你能干什么', sender)
          }
        ],
        tools: {}
      });

      const result = yield* stream.pipe(Stream.runCollect);
      let thinking = '';
      let text = '';
      result.forEach(val => {
        if (val.type === 'text-delta') {
          text += val.text;
        } else if (val.type === 'reasoning-delta') {
          thinking += val.text;
        }
      });
      console.log(thinking, '\n', text);
    }).pipe(
      Effect.provide(LLM.defaultLayer),
      Effect.provide(Agent.defaultLayer),
      Effect.provide(Provider.defaultLayer),
      Effect.provideService(MessageSender.Service, {
        uid: '3530766280',
        nickname: '大肥鱼',
        channelType: '群聊',
        channelID: '123454654',
        channelName: '测试群',
        timestamp: Date.now()
      }),
      Effect.provideService(InstanceRef, {
        uid: '3530766280',
        owner: '3530766280',
        name: '派蒙'
      }),
      Effect.runPromise
    );
  });
});
