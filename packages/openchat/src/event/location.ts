import { Context } from 'effect';
import { SchemaEvent } from '@/schema';

export const LocationRef = Context.Reference<SchemaEvent.LocationRef | undefined>(
  '~openchat/LocationRef',
  {
    defaultValue: () => void 0
  }
);
