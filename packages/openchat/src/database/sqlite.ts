import { Context } from 'effect';
import type { drizzle } from 'drizzle-orm/bun-sqlite';

export type DrizzleClient = ReturnType<typeof drizzle>;
export class Native extends Context.Service<Native, unknown>()(
  '@@openchat/database/SqliteNative'
) {}
export class Drizzle extends Context.Service<Drizzle, DrizzleClient>()(
  '@openchat/database/SqliteDrizzle'
) {}
