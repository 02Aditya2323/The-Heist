import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';

/** Fail closed on the dedicated VM service; never print secret values. */
export function validateVmEnv(env) {
  for (const [key, expected] of Object.entries({
    DATABASE_BACKEND: 'mongodb', NODE_ENV: 'production', DEBUG_ENDPOINTS: 'false',
    HOST: '127.0.0.1', PORT: '8080',
  })) {
    if (env[key] !== expected) throw new Error(`VM configuration requires ${key}=${expected}`);
  }
  if (!env.MONGODB_DATABASE?.trim()) throw new Error('MONGODB_DATABASE is required');
  let uri;
  try { uri = new URL(env.MONGODB_URI); }
  catch { throw new Error('MONGODB_URI must be a valid private MongoDB connection string'); }
  if (!['mongodb:', 'mongodb+srv:'].includes(uri.protocol) ||
      !uri.hostname || uri.username === 'USERNAME' || uri.password === 'PASSWORD' ||
      uri.hostname.toLowerCase() === 'host' || env.MONGODB_URI.includes('REPLACE_')) {
    throw new Error('Replace the MONGODB_URI template with valid private credentials');
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const [major, minor] = process.versions.node.split('.').map(Number);
    if (major < 22 || (major === 22 && minor < 19)) throw new Error('Node 22.19 or newer is required');
    validateVmEnv(process.env);
    for (const path of ['apps/server/dist/main.js', 'apps/client/dist/index.html', 'maps/art-world.json']) {
      if (!existsSync(path)) throw new Error(`Missing ${path}; install dependencies and build before starting`);
    }
    if (existsSync('.env')) throw new Error('VM service uses /etc/heist/heist.env; remove the duplicate checkout .env after securely preserving its settings');
    console.log('VM preflight passed: production, MongoDB, private listener, built game');
  } catch (error) {
    // Errors above contain configuration names only, not database URIs/passwords.
    console.error(error.message);
    process.exitCode = 1;
  }
}
