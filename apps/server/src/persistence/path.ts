import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

/** Identical paths from npm workspaces, the root CLI and Render's start command. */
export function resolveSqlitePath(url = 'sqlite:./data/heist.db'): string {
  const path = url.replace(/^sqlite:/, '');
  if (path === ':memory:') return path;
  if (!path || /^[a-z][a-z0-9+.-]*:\/\//i.test(path)) throw new Error('DB_URL must name a local SQLite file');
  return resolve(fileURLToPath(new URL('../../../../', import.meta.url)), path);
}
