import { createHash } from 'crypto';

export function fast(input: string | Buffer): string {
  return createHash('sha1').update(input).digest('hex');
}
