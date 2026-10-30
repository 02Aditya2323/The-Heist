/**
 * HUD overlap and clipping audit.
 *
 * Finds HUD panels that collide with each other or spill outside the viewport,
 * across a range of window sizes. Players reported "overlapping in a lot of
 * places"; this turns that into a list with coordinates instead of a feeling.
 *
 * Only siblings are compared. A child sitting inside its parent is the normal
 * case and is never a finding.
 */
import { spawn } from 'node:child_process';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { WebSocket } from 'ws';

const OUT = process.argv[2] || '.';
const URL = process.argv[3] || 'http://127.0.0.1:8099/game.html';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

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
  }
}

const BROWSERS = [
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
  'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  '/usr/bin/google-chrome', '/usr/bin/chromium-browser', '/usr/bin/chromium',
];

// The HUD surfaces a player actually sees while walking the city.
const AUDIT = `(() => {
  const SELECTORS = ['.hud-mast','.world-heading','.hud-wallet','.hud-directive','.hud-transmission',
    '#touch-movement','.world-bottom','.world-help','.world-controls','#activity-banner',
    '.field-utilities','.field-objectives','.completion-dock','#field-notifications','#game-toast','.world-status','.hud-clock'];
  const seen = [];
  for (const sel of SELECTORS) {
    for (const el of document.querySelectorAll(sel)) {
      const st = getComputedStyle(el);
      if (st.display === 'none' || st.visibility === 'hidden' || Number(st.opacity) === 0) continue;
      const r = el.getBoundingClientRect();
      if (r.width < 2 || r.height < 2) continue;
      seen.push({ sel, el, r, z: st.zIndex });
    }
  }
  const findings = { offscreen: [], collisions: [] };
  for (const item of seen) {
    const { r } = item;
    if (r.right > innerWidth + 1 || r.left < -1 || r.bottom > innerHeight + 1 || r.top < -1) {
      findings.offscreen.push({ sel: item.sel,
        x: Math.round(r.left), y: Math.round(r.top),
        right: Math.round(r.right), bottom: Math.round(r.bottom),
        overflowRight: Math.round(Math.max(0, r.right - innerWidth)),
        overflowBottom: Math.round(Math.max(0, r.bottom - innerHeight)),
        overflowLeft: Math.round(Math.max(0, -r.left)) });
    }
  }
  for (let i = 0; i < seen.length; i++) {
    for (let j = i + 1; j < seen.length; j++) {
      const a = seen[i], b = seen[j];
      // Nesting is normal layout, not a collision.
      if (a.el.contains(b.el) || b.el.contains(a.el)) continue;
      const ox = Math.min(a.r.right, b.r.right) - Math.max(a.r.left, b.r.left);
      const oy = Math.min(a.r.bottom, b.r.bottom) - Math.max(a.r.top, b.r.top);
      if (ox > 2 && oy > 2) {
        findings.collisions.push({ a: a.sel, b: b.sel, w: Math.round(ox), h: Math.round(oy),
          area: Math.round(ox * oy) });
      }
    }
  }
  return findings;
})()`;

async function main() {
  const exe = BROWSERS.find((p) => fs.existsSync(p));
  if (!exe) throw new Error('no browser found');
  const port = 9300 + Math.floor(Math.random() * 90);
  const proc = spawn(exe, ['--headless=new', `--remote-debugging-port=${port}`,
    `--user-data-dir=${path.join(OUT, 'profile-' + port)}`, '--no-first-run', '--no-default-browser-check',
    '--disable-gpu', '--no-sandbox', '--hide-scrollbars', '--window-size=1600,900', URL], { stdio: 'ignore' });

  let wsUrl = null;
  for (let i = 0; i < 60 && !wsUrl; i++) {
    try {
      const list = await (await fetch(`http://127.0.0.1:${port}/json`)).json();
      const pg = list.find((p) => p.type === 'page' && !p.url.startsWith('devtools'));
      if (pg?.webSocketDebuggerUrl) wsUrl = pg.webSocketDebuggerUrl;
    } catch {}
    if (!wsUrl) await sleep(300);
  }
  const ws = new WebSocket(wsUrl);
  await new Promise((r) => ws.on('open', r));
  const cdp = new Cdp(ws);
  await cdp.send('Page.enable'); await cdp.send('Runtime.enable');
  await cdp.send('Emulation.setDeviceMetricsOverride', { width: 1600, height: 900, deviceScaleFactor: 1, mobile: false });
  await sleep(2500);

  const user = 'ovl' + Date.now().toString().slice(-7);
  await cdp.evaluate(`(()=>{const u=document.getElementById('auth-username'),p=document.getElementById('auth-password');
    if(u&&p){u.value=${JSON.stringify(user)};p.value='Probe!2026pass';
    (document.getElementById('auth-btn-register')||document.getElementById('auth-btn-login'))?.click();}})()`);
  for (let i = 0; i < 60; i++) { await sleep(500); if (await cdp.evaluate(`Boolean(window.__GAME__?.store?.selfEntity)`).catch(()=>false)) break; }
  await sleep(2500);

  const sizes = [[2560,1440],[1920,1080],[1600,900],[1440,900],[1366,768],[1280,800],[1180,820],
                 [1100,900],[1024,768],[960,800],[900,800],[820,800],[768,1024],[700,760],
                 [640,844],[600,844],[540,800],[480,844],[414,896],[390,844],[360,740]];
  const all = [];
  let totalCollisions = 0, totalOffscreen = 0;
  for (const [w, h] of sizes) {
    await cdp.send('Emulation.setDeviceMetricsOverride', { width: w, height: h, deviceScaleFactor: 1, mobile: w < 700 });
    await sleep(850);
    const f = await cdp.evaluate(AUDIT);
    all.push({ viewport: `${w}x${h}`, ...f });
    totalCollisions += f.collisions.length; totalOffscreen += f.offscreen.length;
    const flag = f.collisions.length || f.offscreen.length ? 'ISSUES' : 'clean';
    console.log(`${String(w).padStart(5)}x${String(h).padEnd(5)} collisions=${f.collisions.length} offscreen=${f.offscreen.length}  ${flag}`);
    for (const c of f.collisions) console.log(`      collide: ${c.a}  x  ${c.b}   (${c.w}x${c.h}px)`);
    for (const o of f.offscreen) console.log(`      offscreen: ${o.sel}  right+${o.overflowRight} bottom+${o.overflowBottom} left+${o.overflowLeft}`);
    if (process.env.SHOT_ALL === '1' || f.collisions.length || f.offscreen.length) await cdp.shot(path.join(OUT, `overlap-${w}x${h}.png`));
  }
  fs.writeFileSync(path.join(OUT, 'overlap-audit.json'), JSON.stringify(all, null, 2));
  console.log(`\nTOTAL across ${sizes.length} viewports: ${totalCollisions} collisions, ${totalOffscreen} offscreen`);
  proc.kill(); ws.close();
  if (totalCollisions || totalOffscreen) process.exitCode = 1;
}
main().catch((e) => { console.error('OVERLAP AUDIT FAILED:', e.message); process.exit(1); });
