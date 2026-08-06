import { Context } from 'effect';
import type { InstanceContext } from '@/instance/instance-context';

export const InstanceRef = Context.Reference<InstanceContext | undefined>('~openchat/InstanceRef', {
  defaultValue: () => void 0
});
