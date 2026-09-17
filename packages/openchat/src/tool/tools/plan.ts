import { Effect, Schema } from 'effect';
import { define } from '@/tool/tool';
import { Session } from '@/session';
import { Question } from '@/question';
import { Provider } from '@/provider';
import EXIT_DESCRIPTION from './plan-exit.md';
import { SchemaMessage, SchemaQuestion, SchemaTool } from '@/schema';
import path from 'path';
import { InstanceContext } from '@/instance';
import { AppFileSystem } from '@/file';

export const Parameters = Schema.Struct({});

export const PlanExitTool = define(
  'plan_exit',
  Effect.gen(function* () {
    const session = yield* Session.Service;
    const question = yield* Question.Service;
    const provider = yield* Provider.Service;
    const fs = yield* AppFileSystem.Service;

    return {
      description: EXIT_DESCRIPTION,
      parameters: Parameters,
      execute: (_params: unknown, ctx: SchemaTool.Context) =>
        Effect.gen(function* () {
          const directory = yield* InstanceContext.directory;
          const info = yield* session.get(ctx.sessionID);
          const plan = path.relative(directory, Session.plan(info, directory));
          const answers = yield* question.ask({
            sessionID: ctx.sessionID,
            questions: [
              {
                question: `Plan at ${plan} is complete. Would you like to switch to the build agent and start implementing?`,
                header: 'Build Agent',
                custom: false,
                options: [
                  {
                    label: 'Yes',
                    description: 'Switch to build agent and start implementing the plan'
                  },
                  { label: 'No', description: 'Stay with plan agent to continue refining the plan' }
                ]
              }
            ],
            tool: ctx.callID ? { messageID: ctx.messageID, callID: ctx.callID } : void 0
          });

          if (answers[0]?.[0] === 'No') {
            yield* new SchemaQuestion.RejectedError();
          }

          const messages = yield* session.messages({ sessionID: ctx.sessionID }).pipe(Effect.orDie);
          const lastUser = messages.findLast(item => item.info.role === 'user' && item.info.model);
          const model =
            lastUser?.info.role === 'user' && lastUser.info.model
              ? lastUser.info.model
              : yield* provider.defaultModel();

          const msg: SchemaMessage.User = {
            id: SchemaMessage.MessageID.ascending(),
            sessionID: ctx.sessionID,
            role: 'user',
            time: { created: Date.now() },
            agent: 'build',
            model
          };
          yield* session.updateMessage(msg);
          yield* session.updatePart({
            id: SchemaMessage.PartID.ascending(),
            messageID: msg.id,
            sessionID: ctx.sessionID,
            type: 'text',
            text: `The plan at ${plan} has been approved, you can now edit files. Execute the plan`,
            synthetic: true
          } satisfies SchemaMessage.TextPart);

          return {
            title: 'Switching to build agent',
            output: 'User approved switching to build agent. Wait for further instructions.',
            metadata: {}
          };
        }).pipe(Effect.provideService(AppFileSystem.Service, fs), Effect.orDie)
    };
  })
);
