#!/usr/bin/env node
/**
 * Runs the browser-based UI audits against a disposable server.
 *
 * The HUD defects these catch — a canvas sized from stale constants, panels
 * overlapping each other, a clock clipped off the top of a phone screen — are
 * invisible to a type check and to every test that does not render a page.
 * They need a real browser and a real server, so this starts one.
 *
 * The world is sqlite in a temporary directory and the event is started through
 * a one-shot organizer token, so nothing here can reach a configured database.
 * DATABASE_BACKEND is forced in the child environment, which wins over the root
 * .env because `loadEnvFile` does not overwrite variables that are already set.
 */
import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import * as path from 'node:path';
import { randomBytes } from 'node:crypto';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const repo = path.resolve(import.meta.dirname, '..');

if (!existsSync(path.join(repo, 'apps/server/dist/main.js'))) {
  console.error('Build first: apps/server/dist/main.js is missing.');
  process.exit(1);
}

const port = 8100 + Math.floor(Math.random() * 400);
const dir = mkdtempSync(path.join(tmpdir(), 'heist-ui-audit-'));
const token = randomBytes(16).toString('hex');
const base = `http://127.0.0.1:${port}/game.html`;

const server = spawn(process.execPath, [path.join(repo, 'apps/server/dist/main.js')], {
  cwd: repo,
  stdio: ['ignore', 'pipe', 'pipe'],
  env: {
    ...process.env,
    DATABASE_BACKEND: 'sqlite',
    MONGODB_URI: '',
    DB_URL: `sqlite:${path.join(dir, 'world.db')}`,
    EVENT_DB_PATH: '',
    PORT: String(port),
    HOST: '127.0.0.1',
    NODE_ENV: 'development',
    ALLOW_REGISTER: 'true',
    MAX_PLAYERS: '60',
    HEIST_ADMIN_TOKEN: token,
  },
});
let serverLog = '';
server.stdout.on('data', (d) => { serverLog += d; });
server.stderr.on('data', (d) => { serverLog += d; });

const stop = () => {
  try { server.kill(); } catch {}
  try { rmSync(dir, { recursive: true, force: true }); } catch {}
};
process.on('exit', stop);
process.on('SIGINT', () => { stop(); process.exit(130); });

const run = (args) =>
  new Promise((resolve) => {
    const child = spawn(process.execPath, args, { cwd: repo, stdio: 'inherit' });
    child.on('exit', (code) => resolve(code ?? 1));
  });

async function main() {
  let up = false;
  for (let i = 0; i < 80 && !up; i++) {
    await sleep(250);
    try {
      const res = await fetch(`http://127.0.0.1:${port}/health`);
      if (res.ok) up = true;
    } catch {}
  }
  if (!up) {
    console.error('Server did not become healthy.\n' + serverLog.slice(-2000));
    return 1;
  }

  // A started event is what makes the activity banner and the live HUD exist.
  // Without it the audit silently skips the panels that overlap most often.
  try {
    const res = await fetch(`http://127.0.0.1:${port}/api/admin/event`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-heist-admin': token },
      body: JSON.stringify({ action: 'start' }),
    });
    if (!res.ok) console.warn(`Could not start the event (${res.status}); auditing lobby state only.`);
  } catch (e) {
    console.warn(`Could not start the event (${e.message}); auditing lobby state only.`);
  }

  const out = path.join(dir, 'reports');
  console.log('\n── HUD geometry audit ──────────────────────────────────────');
  const hud = await run([path.join(repo, 'tools/ui-hud-audit.mjs'), out, base]);
  console.log('\n── HUD overlap audit ───────────────────────────────────────');
  const overlap = await run([path.join(repo, 'tools/ui-overlap-audit.mjs'), out, base]);

  if (hud !== 0 || overlap !== 0) {
    console.error(`\nUI audits failed (hud=${hud}, overlap=${overlap}).`);
    return 1;
  }
  console.log('\nUI audits passed.');
  return 0;
}

main().then((code) => { stop(); process.exit(code); },
  (e) => { console.error(e); stop(); process.exit(1); });
