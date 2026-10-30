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
      const page = list.find((p: any) => p.type === 'page');
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
    '--window-size=1280,720',
    url,
  ]);

  const wsUrl = await getTargetWs(port);
  const ws = new WebSocket(wsUrl);
  await new Promise((r) => ws.on('open', r));
  const cdp = new CdpSession(ws);
  return { proc, cdp };
}

async function main() {
  console.log('=== Capturing Central Exchange Live In-Game Screenshot ===');
  const port = 9482;
  const tempDir = `C:\\Users\\ADVAY\\AppData\\Local\\Temp\\edge-ce-${Date.now()}`;
  const { proc, cdp } = await launchBrowser(port, tempDir, 'http://localhost:5173');

  try {
    await sleep(1500);

    const user = `advay_${Date.now().toString(36)}`;
    const pass = 'topsecret123';

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

    for (let i = 0; i < 50; i++) {
      await sleep(200);
      const ready = await cdp.evaluate(`Boolean(window.__GAME__?.store?.selfEntity)`);
      if (ready) break;
    }

    await sleep(1200);

    const outPath = path.resolve('screenshots/central_exchange_live.png');
    await cdp.captureScreenshot(outPath);
    console.log(`Successfully captured: ${outPath}`);
  } finally {
    cdp.close();
    proc.kill();
  }
}

main().catch((err) => {
  console.error('Error during capture:', err);
  process.exit(1);
});
