import { Effect } from 'effect';
import { InstanceContext } from '@/instance/instance-context';
import { InstanceRef } from '@/instance/refrences';

type Refs = {
  instance?: InstanceContext;
};

export function attachWith<A, E, R>(
  effect: Effect.Effect<A, E, R>,
  refs: Refs
): Effect.Effect<A, E, R> {
  if (!refs.instance) {
    return effect;
  }
  return effect.pipe(Effect.provideService(InstanceRef, refs.instance));
}
