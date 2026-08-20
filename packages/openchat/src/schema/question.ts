import { Schema } from 'effect';
import { MessageID, SessionID } from '@/schema/message';
import { NewType } from '@/schema/common';
import { Identifier } from '@/id';
import { BusEvent } from '@/bus';

export class QuestionID extends NewType<QuestionID>()(
  'QuestionID',
  Schema.String.check(Schema.isStartsWith('que'))
) {
  static ascending(id?: string): QuestionID {
    return this.make(Identifier.ascending('question', id));
  }
}

export class Option extends Schema.Class<Option>('QuestionOption')({
  label: Schema.String.annotate({
    description: 'Display text (1-5 words, concise)'
  }),
  description: Schema.String.annotate({
    description: 'Explanation of choice'
  })
}) {}

const base = {
  question: Schema.String.annotate({
    description: 'Complete question'
  }),
  header: Schema.String.annotate({
    description: 'Very short label (max 30 chars)'
  }),
  options: Schema.Array(Option).annotate({
    description: 'Available choices'
  }),
  multiple: Schema.optional(Schema.Boolean).annotate({
    description: 'Allow selecting multiple choices'
  })
};

export class Prompt extends Schema.Class<Prompt>('QuestionPrompt')(base) {}

export const Answer = Schema.Array(Schema.String).annotate({ identifier: 'QuestionAnswer' });
export type Answer = Schema.Schema.Type<typeof Answer>;

export class Info extends Schema.Class<Info>('QuestionInfo')({
  ...base,
  custom: Schema.optional(Schema.Boolean).annotate({
    description: 'Allow typing a custom answer (default: true)'
  })
}) {}

export class Tool extends Schema.Class<Tool>('QuestionTool')({
  messageID: MessageID,
  callID: Schema.String
}) {}

export class Request extends Schema.Class<Request>('QuestionRequest')({
  id: QuestionID,
  sessionID: SessionID,
  questions: Schema.Array(Info).annotate({
    description: 'Questions to ask'
  }),
  tool: Schema.optional(Tool)
}) {}

export const decodeRequest = Schema.decodeUnknownSync(Request);

// Error
export class RejectedError extends Schema.TaggedErrorClass<RejectedError>()(
  'QuestionRejectedError',
  {}
) {
  override get message() {
    return 'The user dismissed this question';
  }
}

// Event
class Replied extends Schema.Class<Replied>('QuestionReplied')({
  sessionID: SessionID,
  requestID: QuestionID,
  answers: Schema.Array(Answer)
}) {}

class Rejected extends Schema.Class<Rejected>('QuestionRejected')({
  sessionID: SessionID,
  requestID: QuestionID
}) {}
export const Event = {
  Asked: BusEvent.define('question.asked', Request),
  Replied: BusEvent.define('question.replied', Replied),
  Rejected: BusEvent.define('question.rejected', Rejected)
};
