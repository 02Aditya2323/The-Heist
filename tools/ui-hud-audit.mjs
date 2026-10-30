/**
 * HUD geometry audit.
 *
 * The client sizes the game canvas from hardcoded constants (--hud-top /
 * --hud-bottom in CSS, mirrored by literals in main.ts). This tool measures the
 * HUD's ACTUAL rendered height at many viewport widths and reports where the
 * assumption disagrees with reality, which is what produces overlap and gaps.
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

const EDGE = [
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
  'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  // CI runs on Linux, where the runner image ships Chrome.
  '/usr/bin/google-chrome',
  '/usr/bin/chromium-browser',
  '/usr/bin/chromium',
].find((p) => fs.existsSync(p));

// Measures what the HUD really occupies versus what the renderer assumes.
const MEASURE = `(()=>{
  const px = (v)=>parseFloat(v)||0;
  const cs = getComputedStyle(document.documentElement);
  const assumedTop = px(cs.getPropertyValue('--hud-top'));
  const assumedBottom = px(cs.getPropertyValue('--hud-bottom'));
  const canvas = document.getElementById('game-canvas');
  const cr = canvas ? canvas.getBoundingClientRect() : null;

  // Top chrome: everything fixed/visible above the canvas.
  const topSel = ['.hud-mast','.world-bar'];
  const botSel = ['.hud-wallet','.hud-directive','.hud-transmission','.hud-controls','#operator-hud'];
  const rects = (sels)=>sels.map(s=>{const e=document.querySelector(s); if(!e) return null;
    const r=e.getBoundingClientRect(); const st=getComputedStyle(e);
    if(st.display==='none'||st.visibility==='hidden'||r.width===0||r.height===0) return null;
    return {sel:s,top:Math.round(r.top),bottom:Math.round(r.bottom),h:Math.round(r.height)};}).filter(Boolean);

  const tops = rects(topSel), bots = rects(botSel);
  const realTop = tops.length ? Math.max(...tops.map(r=>r.bottom)) : 0;
  const realBottomTop = bots.length ? Math.min(...bots.map(r=>r.top)) : innerHeight;
  const realBottom = innerHeight - realBottomTop;

  // Which HUD pieces actually sit on top of the canvas area?
  const overlaps = [];
  if (cr) {
    for (const sel of botSel.concat(topSel)) {
      const e = document.querySelector(sel); if(!e) continue;
      const r = e.getBoundingClientRect(); const st=getComputedStyle(e);
      if(st.display==='none'||st.visibility==='hidden'||r.width===0||r.height===0) continue;
      const ox = Math.max(0, Math.min(cr.right,r.right)-Math.max(cr.left,r.left));
      const oy = Math.max(0, Math.min(cr.bottom,r.bottom)-Math.max(cr.top,r.top));
      if (ox>2 && oy>2) overlaps.push({sel, overlapW:Math.round(ox), overlapH:Math.round(oy)});
    }
  }
  return {
    win:{w:innerWidth,h:innerHeight,dpr:devicePixelRatio},
    assumedTop, assumedBottom,
    realTop, realBottom,
    topDelta: Math.round(realTop-assumedTop),
    bottomDelta: Math.round(realBottom-assumedBottom),
    canvas: cr?{top:Math.round(cr.top),bottom:Math.round(cr.bottom),w:Math.round(cr.width),h:Math.round(cr.height)}:null,
    tops, bots, overlaps,
    coveredFraction: [...document.querySelectorAll('.hud-mast,.hud-wallet,.hud-directive,.field-utilities,.field-objectives,.completion-dock')].reduce((sum, el) => {
      const st=getComputedStyle(el),r=el.getBoundingClientRect();
      return sum + (st.display==='none'||st.visibility==='hidden'?0:r.width*r.height);
    },0)/(innerWidth*innerHeight),
    collapsed: document.getElementById('hud-collapse')?.getAttribute('aria-expanded')==='false'
  };
})()`;

async function main() {
  const port = 9900 + Math.floor(Math.random() * 90);
  const proc = spawn(EDGE, ['--headless=new', `--remote-debugging-port=${port}`,
    `--user-data-dir=${path.join(OUT, 'edge-hud-' + port)}`, '--no-first-run', '--no-default-browser-check',
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

  const user = 'hud' + Date.now().toString().slice(-7);
  await cdp.evaluate(`(()=>{const u=document.getElementById('auth-username'),p=document.getElementById('auth-password');
    if(u&&p){u.value=${JSON.stringify(user)};p.value='Probe!2026pass';
    (document.getElementById('auth-btn-register')||document.getElementById('auth-btn-login'))?.click();}})()`);
  for (let i = 0; i < 60; i++) { await sleep(500); if (await cdp.evaluate(`Boolean(window.__GAME__?.store?.selfEntity)`).catch(()=>false)) break; }
  await sleep(2000);

  const brokenWidths = [];
  const widths = [2560, 1920, 1680, 1440, 1366, 1280, 1100, 1024, 950, 900, 860, 820, 768, 700, 640, 600, 540, 480, 414, 390, 360];
  const findings = [];
  for (const w of widths) {
    const h = w >= 1100 ? 900 : w >= 700 ? 800 : 844;
    await cdp.send('Emulation.setDeviceMetricsOverride', { width: w, height: h, deviceScaleFactor: 1, mobile: w < 700 });
    await sleep(900);
    const m = await cdp.evaluate(MEASURE);
    findings.push(m);
    const bad = !m.canvas || m.canvas.top !== 0 || Math.abs(m.canvas.w - m.win.w) > 2 || Math.abs(m.canvas.h - m.win.h) > 2 || m.coveredFraction > .25;
    if (bad) brokenWidths.push(w);
    console.log(`${String(w).padStart(5)}x${h}  assumed(top ${m.assumedTop}, bot ${m.assumedBottom})  real(top ${m.realTop}, bot ${m.realBottom})  delta(${m.topDelta >= 0 ? '+' : ''}${m.topDelta}, ${m.bottomDelta >= 0 ? '+' : ''}${m.bottomDelta})  overlaps=${m.overlaps.length}  ${bad ? '<<< BROKEN' : 'ok'}`);
    if (bad) await cdp.shot(path.join(OUT, `hud-${w}x${h}.png`));
  }

  // HUD collapse: does the canvas follow when the HUD shrinks with no window resize?
  await cdp.send('Emulation.setDeviceMetricsOverride', { width: 1600, height: 900, deviceScaleFactor: 1, mobile: false });
  await sleep(900);
  const before = await cdp.evaluate(MEASURE);
  await cdp.evaluate(`document.getElementById('hud-collapse')?.click()`);
  await sleep(1200);
  const after = await cdp.evaluate(MEASURE);
  await cdp.shot(path.join(OUT, 'hud-collapsed.png'));
  console.log(`\ncollapse: canvas h ${before.canvas?.h} -> ${after.canvas?.h}; real bottom ${before.realBottom} -> ${after.realBottom}; collapsed=${after.collapsed}`);
  console.log(`collapse verdict: ${before.canvas?.h !== after.canvas?.h || !after.collapsed ? '<<< CANVAS SHIFTED DURING HUD COLLAPSE' : 'canvas stable'}`);

  fs.writeFileSync(path.join(OUT, 'hud-audit.json'), JSON.stringify({ findings, collapse: { before, after } }, null, 2));
  proc.kill(); ws.close();

  // Floating HUD changes must never shift or shrink the world.
  const collapseBroken = before.canvas?.h !== after.canvas?.h || !after.collapsed;
  if (brokenWidths.length || collapseBroken) {
    const widthNote = brokenWidths.length ? ` (${brokenWidths.join(', ')})` : '';
    const collapseNote = collapseBroken ? '; canvas shifted during HUD collapse' : '';
    console.error('');
    console.error(`FAIL: ${brokenWidths.length} width(s) mis-sized${widthNote}${collapseNote}.`);
    process.exitCode = 1;
  } else {
    console.log('');
    console.log('PASS: full viewport world, at least 75% unobstructed area, and stable canvas through HUD collapse.');
  }
}
main().catch((e) => { console.error('HUD AUDIT FAILED:', e.message); process.exit(1); });
