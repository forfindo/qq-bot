import { Effect } from 'effect';

export interface Interface {
  readonly prompt: () => Effect.Effect<void>;
}
