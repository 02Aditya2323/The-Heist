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

async function getTargetWs(port: number, titleMatch = ''): Promise<string> {
  for (let i = 0; i < 30; i++) {
    try {
      const res = await fetch(`http://127.0.0.1:${port}/json`);
      const list = await res.json();
      const page = list.find(
        (p: any) => p.type === 'page' && (!titleMatch || p.title.includes(titleMatch) || p.url.includes(titleMatch))
      );
      if (page?.webSocketDebuggerUrl) return page.webSocketDebuggerUrl;
    } catch {}
    await sleep(300);
  }
  throw new Error(`Could not find target page on port ${port}`);
}

async function launchBrowser(port: number, tempDir: string, url: string): Promise<{ proc: ChildProcess; cdp: CdpSession }> {
  const edgePath = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
  const proc = spawn(edgePath, [
    '--headless=new',
    `--remote-debugging-port=${port}`,
    `--user-data-dir=${tempDir}`,
    '--no-first-run',
    '--no-default-browser-check',
    '--disable-background-networking',
    '--window-size=1920,1080',
    url,
  ]);

  const wsUrl = await getTargetWs(port);
  const ws = new WebSocket(wsUrl);
  await new Promise((r) => ws.on('open', r));
  const cdp = new CdpSession(ws);
  return { proc, cdp };
}

async function main() {
  console.log('=== Capturing Prompt 5 Screenshots ===');
  const screenshotsDir = path.resolve('screenshots');
  fs.mkdirSync(screenshotsDir, { recursive: true });

  const port = 9345;
  const tempDir = `C:\\Users\\ADVAY\\AppData\\Local\\Temp\\edge-prompt5-${Date.now()}`;

  // 1. Capture Game at 1920x1080 (1:1 and 0.75x)
  console.log('\n--- (1) Testing Live Game at 1920x1080 ---');
  const { proc, cdp } = await launchBrowser(port, tempDir, 'http://localhost:5173/?renderMode=painted');

  try {
    // Set 1920x1080 viewport with 1.0 device scale factor
    await cdp.send('Emulation.setDeviceMetricsOverride', {
      width: 1920,
      height: 1080,
      deviceScaleFactor: 1,
      mobile: false,
    });

    await sleep(1500);

    // Register / login unique agent
    const user = `agent_${Date.now().toString(36)}`;
    const pass = 'topsecret123';
    console.log(`Authenticating as: ${user}`);

    await cdp.evaluate(`
      (async () => {
        const u = document.getElementById('auth-username');
        const p = document.getElementById('auth-password');
        const btnReg = document.getElementById('auth-btn-register');
        if (u && p && btnReg) {
          u.value = '${user}';
          p.value = '${pass}';
          btnReg.click();
        }
      })()
    `);

    // Wait for connection and selfEntity
    for (let i = 0; i < 40; i++) {
      await sleep(200);
      const ready = await cdp.evaluate(`Boolean(window.__GAME__?.store?.selfEntity && window.__GAME__?.renderer?.imageLoaded)`);
      if (ready) break;
    }

    // Force resize to ensure 1920x1080 canvas
    await cdp.evaluate(`
      (() => {
        window.__GAME__.renderer.resize(1920, 1080);
      })()
    `);
    await sleep(600);

    // (a) Live game in 1920x1080 window at 1:1 scale
    await cdp.evaluate(`window.__GAME__.renderer.setZoom(1.0);`);
    await sleep(400);

    const shot1Path = path.join(screenshotsDir, 'live_game_1080p_1x.png');
    await cdp.captureScreenshot(shot1Path);
    console.log(`(a) Captured live game at 1:1 scale (1920x1080): ${shot1Path}`);

    // (b) Live game in 1920x1080 window at zoom 0.75
    await cdp.evaluate(`window.__GAME__.renderer.setZoom(0.75);`);
    await sleep(500);

    const shot2Path = path.join(screenshotsDir, 'live_game_1080p_075x.png');
    await cdp.captureScreenshot(shot2Path);
    console.log(`(b) Captured live game at zoom 0.75 (1920x1080): ${shot2Path}`);

    // Log step 2 scale metrics reported by client
    const metrics = await cdp.evaluate(`
      (() => {
        const r = window.__GAME__?.renderer;
        return {
          scaleX: r?.scaleX,
          scaleY: r?.scaleY,
          scaleDiffPercent: r?.scaleDiffPercent,
          zoom: r?.zoom,
          winW: r?.winW,
          winH: r?.winH
        };
      })()
    `);
    console.log('\nStep 2 Fidelity Metrics from client:', JSON.stringify(metrics, null, 2));

    // 2. Capture Painter Tool with Foot-test mode visible
    console.log('\n--- (2) Testing Painter Tool with Foot-test visible ---');
    await cdp.send('Page.navigate', { url: 'http://localhost:5173/painter.html' });
    await sleep(1500);

    for (let i = 0; i < 30; i++) {
      const ready = await cdp.evaluate(`Boolean(window.__PAINTER__?.imageLoaded)`);
      if (ready) break;
      await sleep(200);
    }

    // Activate Foot-test mode and position cursor on tile (26, 14) to show footprint & silhouette
    await cdp.evaluate(`
      (() => {
        const p = window.__PAINTER__;
        p.footTestMode = true;
        document.getElementById('btn-toggle-foot-test')?.classList.add('active');

        // Center on tile (26, 14)
        p.hoverTileX = 26;
        p.hoverTileY = 14;
        p.panX = 200;
        p.panY = 100;
        p.zoom = 1.2;
        p.render();
      })()
    `);
    await sleep(500);

    const shot3Path = path.join(screenshotsDir, 'painter_foot_test.png');
    await cdp.captureScreenshot(shot3Path);
    console.log(`(c) Captured Painter with Foot-test visible: ${shot3Path}`);

    console.log('\n✅ All Prompt 5 screenshots captured successfully!');
  } finally {
    cdp.close();
    proc.kill();
  }
}

main().catch((err) => {
  console.error('Fatal error during screenshot capture:', err);
  process.exit(1);
});
