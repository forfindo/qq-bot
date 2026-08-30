import { Schema } from 'effect';
import { BusEvent } from '@/bus';
import { SessionID } from './session';

export const TodoInfo = Schema.Struct({
  content: Schema.String.annotate({ description: 'Brief description of the task' }),
  status: Schema.String.annotate({
    description: 'Current status of the task: pending, in_progress, completed, cancelled'
  }),
  priority: Schema.String.annotate({
    description: 'Priority level of the task: high, medium, low'
  })
}).annotate({ identifier: 'Todo' });
export type TodoInfo = Schema.Schema.Type<typeof TodoInfo>;

// TODO: Event
export const TodoUpdated = BusEvent.define(
  'todo.updated',
  Schema.Struct({
    sessionID: SessionID,
    todos: Schema.Array(TodoInfo)
  })
);
