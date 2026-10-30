/**
 * Opens each player-facing panel in turn and screenshots it.
 *
 * The audits prove panels do not collide or spill off screen. They say nothing
 * about whether a panel looks right, and a panel nobody has looked at is a
 * panel nobody has checked. This is the eyeball pass, scripted so it is
 * repeatable during a visual change rather than done once by hand.
 *
 * Run: node tools/ui-panel-shots.mjs <outDir> <url> [width] [height]
 */
import { spawn } from 'node:child_process';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { WebSocket } from 'ws';

const OUT = process.argv[2] || '.';
const URL = process.argv[3] || 'http://127.0.0.1:8099/game.html';
const W = Number(process.argv[4] || 1440);
const H = Number(process.argv[5] || 900);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const BROWSERS = [
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
  'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  '/usr/bin/google-chrome', '/usr/bin/chromium-browser', '/usr/bin/chromium',
];

class Cdp {
  constructor(ws) {
    this.ws = ws; this.id = 0; this.pending = new Map();
    ws.on('message', (d) => {
      const m = JSON.parse(d.toString());
      if (m.id && this.pending.has(m.id)) {
        const p = this.pending.get(m.id); this.pending.delete(m.id);
        if (m.error) p.reject(new Error(JSON.stringify(m.error))); else p.resolve(m.result);
      }
    });
  }
  send(method, params = {}) {
    const id = ++this.id;
    return new Promise((res, rej) => { this.pending.set(id, { resolve: res, reject: rej }); this.ws.send(JSON.stringify({ id, method, params })); });
  }
  async evaluate(expression) {
    const r = await this.send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
    if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description || 'eval failed');
    return r.result?.value;
  }
  async shot(file) {
    const r = await this.send('Page.captureScreenshot', { format: 'png' });
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, Buffer.from(r.data, 'base64'));
    console.log('  saved', path.basename(file));
  }
}

async function main() {
  const exe = BROWSERS.find((p) => fs.existsSync(p));
  if (!exe) throw new Error('no browser found');
  fs.mkdirSync(OUT, { recursive: true });
  const port = 9200 + Math.floor(Math.random() * 90);
  const proc = spawn(exe, ['--headless=new', `--remote-debugging-port=${port}`,
    `--user-data-dir=${path.join(OUT, 'profile-' + port)}`, '--no-first-run', '--no-default-browser-check',
    '--disable-gpu', '--no-sandbox', '--hide-scrollbars', `--window-size=${W},${H}`, URL], { stdio: 'ignore' });

  let wsUrl = null;
  for (let i = 0; i < 60 && !wsUrl; i++) {
    try {
      const list = await (await fetch(`http://127.0.0.1:${port}/json`)).json();
      const pg = list.find((p) => p.type === 'page' && !p.url.startsWith('devtools'));
      if (pg?.webSocketDebuggerUrl) wsUrl = pg.webSocketDebuggerUrl;
    } catch {}
    if (!wsUrl) await sleep(300);
  }
  if (!wsUrl) { proc.kill(); throw new Error('no CDP target'); }

  const ws = new WebSocket(wsUrl);
  await new Promise((r) => ws.on('open', r));
  const cdp = new Cdp(ws);
  await cdp.send('Page.enable'); await cdp.send('Runtime.enable');
  await cdp.send('Emulation.setDeviceMetricsOverride', { width: W, height: H, deviceScaleFactor: 1, mobile: false });
  await sleep(2500);

  const user = 'shot' + Date.now().toString().slice(-7);
  await cdp.evaluate(`(()=>{const u=document.getElementById('auth-username'),p=document.getElementById('auth-password');
    if(u&&p){u.value=${JSON.stringify(user)};p.value='Probe!2026pass';
    (document.getElementById('auth-btn-register')||document.getElementById('auth-btn-login'))?.click();}})()`);
  let ready = false;
  for (let i = 0; i < 60; i++) { await sleep(500); ready = await cdp.evaluate(`Boolean(window.__GAME__?.store?.selfEntity)`).catch(()=>false); if (ready) break; }
  console.log('in city:', ready);
  await sleep(2800);

  const closeAll = `document.querySelectorAll('dialog[open]').forEach(d=>d.close())`;

  const panels = [
    ['city', async () => { await cdp.evaluate(closeAll); }],
    ['help', async () => {
      await cdp.evaluate(closeAll); await sleep(250);
      await cdp.evaluate(`document.getElementById('help-open')?.click()`);
    }],
    ['atlas', async () => {
      await cdp.evaluate(closeAll); await sleep(250);
      await cdp.evaluate(`document.dispatchEvent(new KeyboardEvent('keydown',{key:'m',code:'KeyM',bubbles:true}))`);
    }],
    ['journal', async () => {
      await cdp.evaluate(closeAll); await sleep(250);
      await cdp.evaluate(`document.getElementById('open-journal')?.click()`);
    }],
  ];

  for (const [name, open] of panels) {
    await open();
    await sleep(1100);
    const state = await cdp.evaluate(`(()=>{const d=document.querySelector('dialog[open]');
      return d?{id:d.id, w:Math.round(d.getBoundingClientRect().width), h:Math.round(d.getBoundingClientRect().height)}:null;})()`);
    console.log(`${name}: ${state ? `${state.id} ${state.w}x${state.h}` : 'no dialog open'}`);
    await cdp.shot(path.join(OUT, `panel-${name}.png`));
  }

  proc.kill(); ws.close();
}
main().catch((e) => { console.error('PANEL SHOTS FAILED:', e.message); process.exit(1); });
