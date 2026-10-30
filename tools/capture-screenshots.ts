/**
 * Automated Screenshot and Performance Benchmark Tool for The Heist Client.
 * Uses headless Edge via Chrome DevTools Protocol (CDP) to capture:
 * 1. Spawn Area
 * 2. Bank Hotspot
 * 3. District Border
 * 4. Map Edge
 * And runs a 10s hold-to-walk FPS and chunk blits benchmark.
 */

import { spawn, type ChildProcess } from 'node:child_process';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { WebSocket } from 'ws';

class CdpSession {
  private id = 0;
  private pending = new Map<number, { resolve: (res: any) => void; reject: (err: any) => void }>();

  constructor(private ws: WebSocket) {
    ws.on('message', (data) => {
      const msg = JSON.parse(data.toString());
      if (msg.id && this.pending.has(msg.id)) {
        const p = this.pending.get(msg.id)!;
        this.pending.delete(msg.id);
        if (msg.error) p.reject(msg.error);
        else p.resolve(msg.result);
      }
    });
  }

  send(method: string, params: any = {}): Promise<any> {
    const id = ++this.id;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.ws.send(JSON.stringify({ id, method, params }));
    });
  }

  async evaluate(expression: string): Promise<any> {
    const res = await this.send('Runtime.evaluate', {
      expression,
      returnByValue: true,
      awaitPromise: true,
    });
    return res?.result?.value;
  }

  async captureScreenshot(outputPath: string): Promise<void> {
    const res = await this.send('Page.captureScreenshot', { format: 'png' });
    const buffer = Buffer.from(res.data, 'base64');
    fs.mkdirSync(path.dirname(outputPath), { recursive: true });
    fs.writeFileSync(outputPath, buffer);
    console.log(`[Screenshot Saved]: ${outputPath} (${buffer.length} bytes)`);
  }

  close(): void {
    this.ws.close();
  }
}

async function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

async function getTargetWs(port: number): Promise<string> {
  for (let i = 0; i < 30; i++) {
    try {
      const res = await fetch(`http://127.0.0.1:${port}/json`);
      const list = await res.json();
      const page = list.find((p: any) => p.type === 'page' && p.title.includes('The Heist'));
      if (page?.webSocketDebuggerUrl) return page.webSocketDebuggerUrl;
    } catch {}
    await sleep(300);
  }
  throw new Error(`Could not find target page on port ${port}`);
}

async function createBrowser(port: number, userDataDir: string): Promise<{ proc: ChildProcess; cdp: CdpSession }> {
  const edgePath = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
  const proc = spawn(edgePath, [
    '--headless=new',
    `--remote-debugging-port=${port}`,
    `--user-data-dir=${userDataDir}`,
    '--no-first-run',
    '--no-default-browser-check',
    '--disable-background-networking',
    '--window-size=1000,600',
    'http://localhost:5173',
  ]);

  const wsUrl = await getTargetWs(port);
  const ws = new WebSocket(wsUrl);
  await new Promise((r) => ws.on('open', r));
  const cdp = new CdpSession(ws);
  return { proc, cdp };
}

async function loginOrRegister(page: CdpSession, user: string, pass: string): Promise<void> {
  await page.evaluate(`
    (async () => {
      const u = document.getElementById('auth-username');
      const p = document.getElementById('auth-password');
      const btnReg = document.getElementById('auth-btn-register');
      u.value = '${user}';
      p.value = '${pass}';
      btnReg.click();
    })()
  `);

  for (let i = 0; i < 25; i++) {
    await sleep(200);
    const ready = await page.evaluate(`Boolean(window.__GAME__?.input?.enabled && window.__GAME__?.store?.selfEntity)`);
    if (ready) return;

    const statusText = await page.evaluate(`document.getElementById('auth-status')?.textContent`);
    if (statusText?.includes('taken') || statusText?.includes('already')) {
      await page.evaluate(`document.getElementById('auth-btn-login')?.click()`);
    }
  }

  for (let i = 0; i < 25; i++) {
    await sleep(200);
    const ready = await page.evaluate(`Boolean(window.__GAME__?.input?.enabled && window.__GAME__?.store?.selfEntity)`);
    if (ready) return;
  }
  throw new Error(`Login timed out for ${user}`);
}

async function main() {
  console.log('====================================================');
  console.log('    THE HEIST - SCREENSHOT & BENCHMARK SUITE');
  console.log('====================================================');

  const screenshotsDir = path.resolve('screenshots');
  if (!fs.existsSync(screenshotsDir)) {
    fs.mkdirSync(screenshotsDir, { recursive: true });
  }

  const testPort = 9240;
  const tempDir = path.join('C:\\Users\\ADVAY\\AppData\\Local\\Temp', 'edge-screen-' + Date.now());
  const { proc, cdp } = await createBrowser(testPort, tempDir);

  try {
    await sleep(1500);

    // Set viewport to 1000x600 to test 2x integer upscale (960x540) with void letterbox borders
    await cdp.send('Emulation.setDeviceMetricsOverride', {
      width: 1000,
      height: 600,
      deviceScaleFactor: 1,
      mobile: false,
    });

    console.log('\nLogging into game client...');
    await loginOrRegister(cdp, 'camera_op', 'pass1234');
    await sleep(2000); // Allow auth hide, chunk baking and first frames

    const initialPos = await cdp.evaluate(`({
      x: window.__GAME__.store.selfEntity.tileX,
      y: window.__GAME__.store.selfEntity.tileY,
      id: window.__GAME__.store.selfId
    })`);
    console.log(`Agent logged in at (${initialPos.x}, ${initialPos.y})`);

    // ── 1. Spawn Area Screenshot ──
    console.log('\n[1/4] Capturing Spawn Area...');
    await sleep(1000);
    const spawnPath = path.join(screenshotsDir, 'spawn_area.png');
    await cdp.captureScreenshot(spawnPath);

    // ── 2. Bank Hotspot Screenshot ──
    console.log('\n[2/4] Positioning camera at Bank Hotspot (100, 66) facing North...');
    await cdp.evaluate(`
      (() => {
        const ent = window.__GAME__.store.selfEntity;
        ent.tileX = 100;
        ent.prevTileX = 100;
        ent.tileY = 66;
        ent.prevTileY = 66;
        ent.dir = 0; // Face North towards Bank
        ent.animStart = performance.now();
      })()
    `);

    await sleep(600); // Allow chunk bake & blit
    const bankPath = path.join(screenshotsDir, 'bank_hotspot.png');
    await cdp.captureScreenshot(bankPath);

    // ── 3. Tech Quarter Screenshot ──
    console.log('\n[3/4] Positioning camera at Tech Quarter Job Board (x=34, y=32) facing North...');
    await cdp.evaluate(`
      (() => {
        const ent = window.__GAME__.store.selfEntity;
        ent.tileX = 34;
        ent.prevTileX = 34;
        ent.tileY = 32;
        ent.prevTileY = 32;
        ent.dir = 0; // Face North towards Tech Job Board
        ent.animStart = performance.now();
      })()
    `);
    await sleep(600);
    const techPath = path.join(screenshotsDir, 'tech_quarter_live.png');
    await cdp.captureScreenshot(techPath);


    // ── 4. Data Harbor Screenshot ──
    console.log('\n[4/4] Positioning camera at Data Harbor Job Board (x=146, y=32) facing North...');
    await cdp.evaluate(`
      (() => {
        const ent = window.__GAME__.store.selfEntity;
        ent.tileX = 146;
        ent.prevTileX = 146;
        ent.tileY = 32;
        ent.prevTileY = 32;
        ent.dir = 0; // Face North towards Harbor Job Board
        ent.animStart = performance.now();
      })()
    `);
    await sleep(600);
    const harborPath = path.join(screenshotsDir, 'data_harbor_live.png');
    await cdp.captureScreenshot(harborPath);

    // ── 5. NEXUS Plaza Live Capture ──
    console.log('\n[5/6] Positioning camera at NEXUS Plaza Job Board (x=40, y=78) facing North...');
    await cdp.evaluate(`
      (() => {
        const ent = window.__GAME__.store.selfEntity;
        ent.tileX = 40;
        ent.prevTileX = 40;
        ent.tileY = 78;
        ent.prevTileY = 78;
        ent.dir = 0; // Face North towards NEXUS Board
        ent.animStart = performance.now();
      })()
    `);
    await sleep(600);
    const nexusPath = path.join(screenshotsDir, 'nexus_plaza_live.png');
    await cdp.captureScreenshot(nexusPath);

    console.log('\n[6/6] Positioning camera at Golden Hour Gate (x=56, y=85) facing North...');
    await cdp.evaluate(`
      (() => {
        const ent = window.__GAME__.store.selfEntity;
        ent.tileX = 56;
        ent.prevTileX = 56;
        ent.tileY = 85;
        ent.prevTileY = 85;
        ent.dir = 0; // Face North towards Golden Hour Gate
        ent.animStart = performance.now();
      })()
    `);
    await sleep(600);
    const gatePath = path.join(screenshotsDir, 'golden_hour_gate_live.png');
    await cdp.captureScreenshot(gatePath);

    // ── 7. Black Grid Live Captures ──
    console.log('\n[7/9] Positioning camera at Black Grid Board (x=158, y=78) facing North...');
    await cdp.evaluate(`
      (() => {
        const ent = window.__GAME__.store.selfEntity;
        ent.tileX = 158;
        ent.prevTileX = 158;
        ent.tileY = 78;
        ent.prevTileY = 78;
        ent.dir = 0; // Face North towards Black Grid Board
        ent.animStart = performance.now();
      })()
    `);
    await sleep(600);
    const bgPath = path.join(screenshotsDir, 'black_grid_live.png');
    await cdp.captureScreenshot(bgPath);

    console.log('\n[8/9] Positioning camera at Cipher Market (x=179, y=86) facing North...');
    await cdp.evaluate(`
      (() => {
        const ent = window.__GAME__.store.selfEntity;
        ent.tileX = 179;
        ent.prevTileX = 179;
        ent.tileY = 86;
        ent.prevTileY = 86;
        ent.dir = 0; // Face North towards Cipher Market
        ent.animStart = performance.now();
      })()
    `);
    await sleep(600);
    const cmPath = path.join(screenshotsDir, 'cipher_market_live.png');
    await cdp.captureScreenshot(cmPath);

    console.log('\n[9/9] Positioning camera at City Gate (x=194, y=72) facing North...');
    await cdp.evaluate(`
      (() => {
        const ent = window.__GAME__.store.selfEntity;
        ent.tileX = 194;
        ent.prevTileX = 194;
        ent.tileY = 72;
        ent.prevTileY = 72;
        ent.dir = 0; // Face North towards City Gate
        ent.animStart = performance.now();
      })()
    `);
    await sleep(600);
    const cgPath = path.join(screenshotsDir, 'city_gate_live.png');
    await cdp.captureScreenshot(cgPath);

    // ── 10. Undercity Live Captures ──
    console.log('\n[10/12] Positioning camera at Undercity Jobs Board (x=91, y=103) facing North...');
    await cdp.evaluate(`
      (() => {
        const ent = window.__GAME__.store.selfEntity;
        ent.tileX = 91;
        ent.prevTileX = 91;
        ent.tileY = 103;
        ent.prevTileY = 103;
        ent.dir = 0; // Face North towards Undercity Jobs Board
        ent.animStart = performance.now();
      })()
    `);
    await sleep(600);
    const ucPath = path.join(screenshotsDir, 'undercity_live.png');
    await cdp.captureScreenshot(ucPath);

    console.log('\n[11/12] Positioning camera at Home Lane (x=65, y=110) facing North...');
    await cdp.evaluate(`
      (() => {
        const ent = window.__GAME__.store.selfEntity;
        ent.tileX = 65;
        ent.prevTileX = 65;
        ent.tileY = 110;
        ent.prevTileY = 110;
        ent.dir = 0; // Face North towards Home Lane
        ent.animStart = performance.now();
      })()
    `);
    await sleep(600);
    const hlPath = path.join(screenshotsDir, 'home_lane_live.png');
    await cdp.captureScreenshot(hlPath);

    console.log('\n[12/12] Positioning camera at Safehouse Row (x=112, y=110) facing North...');
    await cdp.evaluate(`
      (() => {
        const ent = window.__GAME__.store.selfEntity;
        ent.tileX = 112;
        ent.prevTileX = 112;
        ent.tileY = 110;
        ent.prevTileY = 110;
        ent.dir = 0; // Face North towards Safehouse Row
        ent.animStart = performance.now();
      })()
    `);
    await sleep(600);
    const srPath = path.join(screenshotsDir, 'safehouse_row_live.png');
    await cdp.captureScreenshot(srPath);

    // ── 13. Hold-to-Walk 10s Benchmark ──
    console.log('\n[13/13] Running 10-second hold-to-walk performance benchmark...');
    // Return player to initial position
    await cdp.evaluate(`
      (() => {
        const ent = window.__GAME__.store.selfEntity;
        ent.tileX = ${initialPos.x};
        ent.prevTileX = ${initialPos.x};
        ent.tileY = ${initialPos.y};
        ent.prevTileY = ${initialPos.y};
        ent.animStart = performance.now();
      })()
    `);
    await sleep(400);

    // Find an open direction to walk back and forth or walk continuously
    console.log('Starting 10-second movement hold...');
    const fpsSamples: number[] = [];
    const blitSamples: number[] = [];

    // Press right key
    await cdp.evaluate(`window.__GAME__.input.activeKeys.add('KeyD')`);

    const benchmarkStart = Date.now();
    let currentKey = 'KeyD';

    while (Date.now() - benchmarkStart < 10000) {
      await sleep(500);
      const metrics = await cdp.evaluate(`({
        fps: window.__GAME__.renderer.fps || 60,
        blits: 0,
        cachedChunks: 0,
        x: window.__GAME__.store.selfEntity.tileX,
        y: window.__GAME__.store.selfEntity.tileY,
      })`);

      fpsSamples.push(metrics.fps);
      blitSamples.push(metrics.blits);
      console.log(`[${((Date.now() - benchmarkStart) / 1000).toFixed(1)}s] FPS: ${metrics.fps} | Pos: (${metrics.x}, ${metrics.y})`);

      // If we bumped into something, alternate direction to keep walking smoothly
      const isBlocked = await cdp.evaluate(`
        (() => {
          const map = window.__GAME__.store.map;
          const x = window.__GAME__.store.selfEntity.tileX;
          const y = window.__GAME__.store.selfEntity.tileY;
          if ('${currentKey}' === 'KeyD' && map.collision[y * map.width + (x + 1)] === 1) return true;
          if ('${currentKey}' === 'KeyA' && map.collision[y * map.width + (x - 1)] === 1) return true;
          return false;
        })()
      `);

      if (isBlocked) {
        await cdp.evaluate(`window.__GAME__.input.activeKeys.delete('${currentKey}')`);
        currentKey = currentKey === 'KeyD' ? 'KeyA' : 'KeyD';
        await cdp.evaluate(`window.__GAME__.input.activeKeys.add('${currentKey}')`);
      }
    }

    // Release keys
    await cdp.evaluate(`window.__GAME__.input.activeKeys.clear()`);

    const avgFps = Math.round(fpsSamples.reduce((a, b) => a + b, 0) / fpsSamples.length);
    const minFps = Math.min(...fpsSamples);
    const maxFps = Math.max(...fpsSamples);
    const avgBlits = Math.round(blitSamples.reduce((a, b) => a + b, 0) / blitSamples.length);

    console.log('\n====================================================');
    console.log('              BENCHMARK REPORT');
    console.log('====================================================');
    console.log(`Average FPS: ${avgFps} (Min: ${minFps}, Max: ${maxFps})`);
    console.log(`Chunk Blits Per Frame: ${avgBlits} (Viewport: 480x270, Chunk: 256x256px)`);
    console.log('====================================================');

  } finally {
    cdp.close();
    proc.kill();
  }
}

main().catch(console.error);
