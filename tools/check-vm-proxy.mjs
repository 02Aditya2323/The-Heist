/** Real Nginx + isolated game fixture. Never targets the saved server or Atlas. */
import { spawn, spawnSync } from 'node:child_process';
import { createServer } from 'node:net';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { request as httpRequest } from 'node:http';
import { request as httpsRequest } from 'node:https';
import assert from 'node:assert/strict';
import WebSocket from 'ws';
import { decodeS2CFrame, encodePing, S2C } from '@heist/shared';
import { renderNginx } from './render-vm-nginx.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));
const args = process.argv.slice(2);
const nginxArg = args.find(a => a.startsWith('--nginx='))?.slice(8);
const opensslArg = args.find(a => a.startsWith('--openssl='))?.slice(10);
if (args.length !== 2 || !nginxArg || !opensslArg) throw new Error('Usage: node tools/check-vm-proxy.mjs --nginx=PATH --openssl=PATH');
const nginx = resolve(nginxArg), openssl = resolve(opensslArg);
if (!existsSync(nginx) || !existsSync(openssl)) throw new Error('Provide installed Nginx and OpenSSL executable paths');
// All generated configs/certificates belong to this disposable ignored QA directory.
mkdirSync(resolve(root, 'bot-runs'), { recursive: true });
const scratch = mkdtempSync(resolve(root, 'bot-runs/nginx-smoke-'));
const nginxPath = value => value.replaceAll('\\', '/');
const quote = value => `"${nginxPath(value)}"`;
mkdirSync(join(scratch, 'logs'));
mkdirSync(join(scratch, 'temp'));
let phase = 'fixture startup';
let activeProxy;
const children = [];
const peers = [];
const output = [];
const reports = [];
const delay = ms => new Promise(r => setTimeout(r, ms));
const child = (command, args, env = {}) => {
  const p = spawn(command, args, { cwd: root, windowsHide: true,
    env: { ...process.env, NODE_ENV: 'production', DEBUG_ENDPOINTS: 'false',
      ALLOW_REGISTER: 'true', DATABASE_BACKEND: 'sqlite', ...env }, stdio: ['ignore', 'pipe', 'pipe'] });
  children.push(p);
  p.stdout.on('data', b => output.push(b.toString()));
  // Do not print child logs or URLs containing authentication tokens.
  p.stderr.on('data', () => {});
  p.on('error', () => {});
  return p;
};
async function until(check, label, timeout = 15000) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    if (await check()) return;
    await delay(50);
  }
  throw new Error(label);
}
async function freePort() {
  const server = createServer();
  await new Promise((ok, fail) => { server.once('error', fail); server.listen(0, '127.0.0.1', ok); });
  const port = server.address().port;
  await new Promise(ok => server.close(ok));
  return port;
}
function run(command, argv) {
  const result = spawnSync(command, argv, { cwd: scratch, windowsHide: true, stdio: 'pipe' });
  if (result.status !== 0) throw new Error('Isolated configuration/certificate command failed');
}
function request(port, path, { method = 'GET', headers = {}, body } = {}, ca) {
  return new Promise((ok, fail) => {
    const r = (ca ? httpsRequest : httpRequest)({ hostname: '127.0.0.1', port, path, method,
      ...(ca ? { ca } : {}), headers: { ...headers, ...(body ? { 'content-length': Buffer.byteLength(body) } : {}) } }, response => {
      const chunks = [];
      response.on('data', b => chunks.push(b));
      response.on('end', () => { const buffer = Buffer.concat(chunks); ok({ status: response.statusCode,
        headers: response.headers, text: () => buffer.toString(), json: () => JSON.parse(buffer.toString()) }); });
    });
    r.on('error', fail); r.setTimeout(5000, () => r.destroy(new Error('Request timeout')));
    r.end(body);
  });
}
function makeConfig(servers) {
  return `worker_processes 1;\npid ${quote(join(scratch, 'nginx.pid'))};\nerror_log ${quote(join(scratch, 'logs/startup.log'))} crit;\nevents { worker_connections 128; }\nhttp {\ninclude ${quote(resolve(root, 'deploy/azure/nginx-upgrade.conf'))};\n${servers}\n}\n`;
}
async function stopProxy(p) {
  if (p.exitCode !== null) return;
  const exited = new Promise(ok => p.once('exit', ok));
  // Signal the exact PID/prefix, never a global nginx service.
  run(nginx, ['-p', nginxPath(scratch) + '/', '-c', nginxPath(join(scratch, 'nginx.conf')), '-s', 'quit']);
  await Promise.race([exited, delay(4000)]);
  if (p.exitCode === null && p.signalCode === null) throw new Error('Isolated proxy did not stop');
}
try {
  const fixture = child(process.execPath, [resolve(root, 'node_modules/tsx/dist/cli.mjs'),
    'tools/workbench-qa-server.mts', '--contract-ux', '--station', 'data-centre']);
  let fixturePort;
  await until(() => {
    const match = output.join('').match(/Isolated UI QA: http:\/\/localhost:(\d+)\//);
    fixturePort = match ? Number(match[1]) : undefined;
    if (fixture.exitCode !== null) throw new Error('Isolated game fixture failed to start');
    return !!fixturePort;
  }, 'Game fixture readiness timed out');
  const port = await freePort(), httpPort = await freePort();
  const domain = 'heist.proxy.test';
  const acme = join(scratch, 'acme');
  mkdirSync(join(acme, '.well-known/acme-challenge'), { recursive: true });
  writeFileSync(join(acme, '.well-known/acme-challenge/proof'), 'isolated-proof');
  const configPath = join(scratch, 'nginx.conf');
  const adapt = text => text.replaceAll('listen 80;', `listen 127.0.0.1:${httpPort};`)
    .replaceAll('listen 443 ssl;', `listen 127.0.0.1:${port} ssl;`)
    .replaceAll('/var/www/heist-acme', nginxPath(acme))
    .replaceAll('/dev/null', process.platform === 'win32' ? 'nul' : '/dev/null');
  const startProxy = servers => {
    writeFileSync(configPath, makeConfig(servers));
    const argv = ['-p', nginxPath(scratch) + '/', '-c', nginxPath(configPath)];
    run(nginx, [...argv, '-t']);
    activeProxy = child(nginx, [...argv, '-g', 'daemon off;']);
    return activeProxy;
  };
  phase = 'bootstrap configuration and ACME-only routing';
  let proxy = startProxy(adapt(renderNginx(domain, 'bootstrap')));
  await until(async () => { try { return (await request(httpPort, '/')).status === 404; } catch { return false; } }, 'Bootstrap readiness timed out');
  assert.equal((await request(httpPort, '/api/login', { method: 'POST' })).status, 404);
  assert.equal((await request(httpPort, '/ws')).status, 404);
  assert.equal((await request(httpPort, '/.well-known/acme-challenge/proof')).text(), 'isolated-proof');
  await stopProxy(proxy);
  reports.push('Actual bootstrap config serves ACME proof but no plaintext game/login/WebSocket');
  phase = 'disposable certificate generation';
  const cert = join(scratch, 'fullchain.pem'), key = join(scratch, 'privkey.pem');
  run(openssl, ['req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-days', '1', '-subj', '/CN=127.0.0.1',
    '-addext', 'subjectAltName=IP:127.0.0.1', '-keyout', key, '-out', cert]);
  const ca = readFileSync(cert);
  const player = readFileSync(resolve(root, 'deploy/azure/nginx-player.conf'), 'utf8')
    .replaceAll('127.0.0.1:8080', `127.0.0.1:${fixturePort}`)
    .replaceAll('/dev/null', process.platform === 'win32' ? 'nul' : '/dev/null');
  const playerPath = join(scratch, 'player.conf'); writeFileSync(playerPath, player);
  let servers = adapt(renderNginx(domain, 'https'))
    .replace(`/etc/letsencrypt/live/${domain}/fullchain.pem`, quote(cert))
    .replace(`/etc/letsencrypt/live/${domain}/privkey.pem`, quote(key))
    .replace('/etc/nginx/snippets/heist-player.conf', quote(playerPath));
  phase = 'HTTPS configuration and redirect';
  proxy = startProxy(servers);
  const secure = (path, init) => request(port, path, init, ca);
  await until(async () => { try { return (await secure('/')).status === 200; } catch { return false; } }, 'TLS proxy readiness timed out');
  const redirect = await request(httpPort, '/?test=1');
  assert.equal(redirect.status, 308); assert.equal(redirect.headers.location, `https://${domain}/?test=1`);
  assert.equal((await request(httpPort, '/.well-known/acme-challenge/proof')).status, 200);
  reports.push('Actual HTTPS template validates with trusted local certificate; HTTP redirects and ACME renewal path work');
  phase = 'public assets and private-path restrictions';
  const html = (await secure('/')).text();
  assert(html.includes('The Heist'));
  const assets = [...html.matchAll(/(?:src|href)="(\/assets\/[^\"]+)"/g)].map(m => m[1]);
  assert(assets.length >= 2, 'Expected built frontend script/style assets');
  for (const path of [...assets, `${assets[0]}?v=proxy-qa`, '/art/world.json', '/art/scenes/v2-central.webp', '/api/map', '/api/event']) {
    const r = await secure(path); assert.equal(r.status, 200, `Allowed route ${path}`);
    assert.equal(r.headers['x-content-type-options'], 'nosniff');
  }
  reports.push('Built frontend, real assets, map and event delivered through Nginx HTTPS');
  for (const path of ['/metrics', '/health', '/debug/entities', '/admin.html', '/painter.html',
    '/api/admin/event', '/api/staff/challenges', '/.env', '/bot-runs/private-fixture.json',
    '/assets/..%5cadmin.html', '/assets/..%2fadmin.html', '/art/..%5cpainter.html',
    '/assets/%252e%252e%252fadmin.html', '/@fs/.env', '/assets/private.env']) {
    const r = await secure(path); assert.equal(r.status, 404, `Blocked route ${path}`);
  }
  reports.push('Private paths, encoded traversals and non-asset files blocked');
  phase = 'body limits, login and encrypted multiplayer';
  const oversized = await secure('/api/login', { method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ username: 'fixture', password: 'x'.repeat(20000) }) });
  assert.equal(oversized.status, 413);
  reports.push('Oversized login body rejected before ordinary login processing');
  const login = await secure('/api/login', { method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ username: 'workbench_qa', password: 'Local-QA-only-123' }) });
  assert.equal(login.status, 200);
  const { token } = await login.json();
  assert.equal(typeof token, 'string');
  const account = await secure('/api/account', { headers: { authorization: `Bearer ${token}` } });
  assert.equal(account.status, 200); assert.equal((await account.json()).role, 'player');
  const ws = new WebSocket(`wss://127.0.0.1:${port}/ws?token=${encodeURIComponent(token)}`, { ca });
  peers.push(ws);
  let welcomed = false, pong = false, event = false;
  ws.on('message', data => {
    for (const frame of decodeS2CFrame(new Uint8Array(data))) {
      if (frame.opcode === S2C.WELCOME) { welcomed = true; ws.send(encodePing(performance.now() | 0)); }
      if (frame.opcode === S2C.PONG) pong = true;
      if (frame.opcode === S2C.JSON && JSON.parse(frame.payload).type === 'event_state') event = true;
    }
  });
  ws.on('error', () => {});
  await until(() => welcomed && pong && event, 'Authenticated WebSocket/protocol flow failed');
  ws.close();
  reports.push('Real fixture login/account, WELCOME, PING/PONG and event state survive WSS proxy');
  await stopProxy(proxy);
  console.log(JSON.stringify({ status: 'PASS', checks: reports,
    scope: 'Isolated HTTPS/WSS with disposable trusted certificate; public issuance/Azure deployment not tested' }, null, 2));
} catch {
  // Do not expose child logs, tokens, or database configuration on failure.
  console.error(`VM proxy smoke failed during ${phase}. Inspect the isolated fixture/proxy privately; no production event was targeted.`);
  process.exitCode = 1;
} finally {
  for (const ws of peers) ws.terminate();
  if (activeProxy?.exitCode === null) {
    try { await stopProxy(activeProxy); } catch { /* Terminate owned children below. */ }
  }
  for (const p of children.reverse()) {
    if (p.exitCode !== null) continue;
    const exited = new Promise(ok => p.once('exit', ok));
    p.kill('SIGTERM');
    await Promise.race([exited, delay(4000)]);
    if (p.exitCode === null && p.signalCode === null) p.kill('SIGKILL');
  }
}
