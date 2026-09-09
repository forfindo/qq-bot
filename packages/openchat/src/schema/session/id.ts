import { Schema } from 'effect';
import { withStatics } from '@/schema/common';
import { Identifier } from '@/id';

export const SessionID = Schema.String.check(Schema.isStartsWith('ses')).pipe(
  Schema.brand('SessionID'),
  withStatics(s => ({
    descending: (id?: string) => s.make(Identifier.descending('session', id))
  }))
);
export type SessionID = Schema.Schema.Type<typeof SessionID>;
