import { randomBytes } from 'node:crypto';
import { hash } from 'argon2';
import type { Database } from './interfaces.js';

/** Trusted server environment only; never exposed through player registration. */
export async function bootstrapStaff(database: Database, env: NodeJS.ProcessEnv = process.env) {
  const username=env.HEIST_ADMIN_USERNAME, password=env.HEIST_ADMIN_PASSWORD;
  if (!username && !password) return;
  if (!username || !/^[a-zA-Z0-9_]{3,20}$/.test(username) || !password || password.length<12)
    throw new Error('Set HEIST_ADMIN_USERNAME (3–20 letters/digits/underscores) and HEIST_ADMIN_PASSWORD (at least 12 characters) together');
  const existing=await database.players.findByUsername(username);
  if (existing) {
    if (existing.role!=='superadmin') throw new Error('Bootstrap username belongs to a non-superadmin account; refusing promotion');
    return; // Restart never overwrites an existing password.
  }
  await database.players.createPlayer(randomBytes(16).toString('hex'),username,await hash(password),'superadmin');
}
