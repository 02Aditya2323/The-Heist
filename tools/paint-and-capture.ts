import { spawn } from 'node:child_process';
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

  async captureScreenshot(outPath: string): Promise<void> {
    const res = await this.send('Page.captureScreenshot', { format: 'png' });
    const buffer = Buffer.from(res.data, 'base64');
    fs.mkdirSync(path.dirname(outPath), { recursive: true });
    fs.writeFileSync(outPath, buffer);
  }

  close(): void {
    this.ws.close();
  }
}

async function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

async function getTargetWs(port: number, titleMatch = ''): Promise<string> {
  for (let i = 0; i < 30; i++) {
    try {
      const res = await fetch(`http://127.0.0.1:${port}/json`);
      const list = await res.json();
      const page = list.find((p: any) => p.type === 'page' && (!titleMatch || p.title.includes(titleMatch) || p.url.includes(titleMatch)));
      if (page?.webSocketDebuggerUrl) return page.webSocketDebuggerUrl;
    } catch {}
    await sleep(300);
  }
  throw new Error(`Could not find target page on port ${port}`);
}

async function main() {
  const edgePath = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
  const tmpProfile = `C:\\Users\\ADVAY\\AppData\\Local\\Temp\\edge-painter-${Date.now()}`;
  const port = 9333;

  console.log('Launching Edge for Painter Tool...');
  const proc = spawn(edgePath, [
    '--headless=new',
    `--remote-debugging-port=${port}`,
    `--user-data-dir=${tmpProfile}`,
    '--window-size=1600,1000',
    'http://localhost:5173/painter.html',
  ]);

  try {
    const wsUrl = await getTargetWs(port, 'painter');
    const ws = new WebSocket(wsUrl);
    await new Promise((r) => ws.on('open', r));
    const cdp = new CdpSession(ws);

    console.log('Connected to Painter CDP.');
    await sleep(1500);

    // Wait for image loaded
    for (let i = 0; i < 30; i++) {
      const loaded = await cdp.evaluate(`Boolean(window.__PAINTER__?.imageLoaded)`);
      if (loaded) break;
      await sleep(200);
    }

    console.log('Painter image loaded. Running Auto-Suggest with threshold 32%...');
    await cdp.evaluate(`
      (() => {
        const p = window.__PAINTER__;
        p.runAutoSuggest(32);
        p.applyDraft();
        p.blockLegendRegion();

        // Clear a wide open walkable corridor through the street (y: 13-16, x: 9-48)
        for (let y = 13; y <= 16; y++) {
          for (let x = 9; x <= 48; x++) {
            p.collision[y][x] = 0;
          }
        }

        // Add vertical street branches
        for (let y = 5; y <= 24; y++) {
          for (let x = 24; x <= 27; x++) {
            p.collision[y][x] = 0;
          }
        }

        // Add key spawns on the open walkable street
        p.spawns = [
          { x: 12, y: 14 },
          { x: 20, y: 14 },
          { x: 26, y: 14 },
          { x: 34, y: 14 },
        ];

        // Add named hotspots
        p.hotspots = [
          { name: 'Central Bank', x: 26, y: 14 },
          { name: 'Job Board', x: 38, y: 14 },
          { name: 'Harbor Gate', x: 48, y: 14 },
          { name: 'Tech Core', x: 25, y: 8 },
        ];

        p.showOverlay = true;
        p.overlayOpacity = 0.55;
        p.render();
      })()
    `);

    await sleep(500);

    // Capture painter overlay screenshot
    const painterScreenshotPath = path.resolve(process.cwd(), 'screenshots/painter_overlay.png');
    console.log(`Saving painter screenshot to: ${painterScreenshotPath}`);
    await cdp.captureScreenshot(painterScreenshotPath);

    // Export server map and painted manifest
    const serverMap = await cdp.evaluate(`window.__PAINTER__.exportServerMap()`);
    const paintedManifest = await cdp.evaluate(`window.__PAINTER__.exportPaintedManifest()`);

    fs.writeFileSync(path.resolve(process.cwd(), 'map.json'), JSON.stringify(serverMap, null, 2), 'utf-8');
    fs.writeFileSync(path.resolve(process.cwd(), 'painted.json'), JSON.stringify(paintedManifest, null, 2), 'utf-8');
    fs.writeFileSync(path.resolve(process.cwd(), 'apps/client/public/art/painted.json'), JSON.stringify(paintedManifest, null, 2), 'utf-8');

    console.log('✅ Exported map.json and painted.json successfully!');

    cdp.close();
  } finally {
    proc.kill();
  }
}

main().catch(console.error);
