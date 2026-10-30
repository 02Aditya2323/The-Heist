import { resolveSqlitePath } from './path.js';
/**
 * apps/server/src/persistence/index.ts
 */

import type { Database } from './interfaces.js';
import { SqliteDatabase } from './sqlite.js';

export * from './interfaces.js';
export * from './sqlite.js';
export * from './snapshotter.js';

export async function createDatabase(dbUrl: string): Promise<Database> {
  const db = new SqliteDatabase(resolveSqlitePath(dbUrl));
  try { await db.initialize(); return db; }
  catch (error) { await db.close().catch(() => {}); throw error; }
}
