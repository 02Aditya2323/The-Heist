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

async function main() {
  const edgePath = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
  const tmpProfile = `C:\\Users\\ADVAY\\AppData\\Local\\Temp\\edge-gameplay-${Date.now()}`;
  const port = 9444;

  console.log('Launching Edge for live game capture...');
  const proc = spawn(edgePath, [
    '--headless=new',
    `--remote-debugging-port=${port}`,
    `--user-data-dir=${tmpProfile}`,
    '--window-size=1600,950',
    'http://localhost:5173',
  ]);

  try {
    const wsUrl = await getTargetWs(port);
    const ws = new WebSocket(wsUrl);
    await new Promise((r) => ws.on('open', r));
    const cdp = new CdpSession(ws);

    console.log('Connected to Game CDP. Logging in user...');
    await sleep(1500);

    const user = `agent_${Date.now().toString(36)}`;
    await cdp.evaluate(`
      (() => {
        const u = document.getElementById('auth-username');
        const p = document.getElementById('auth-password');
        const btnReg = document.getElementById('auth-btn-register');
        u.value = '${user}';
        p.value = 'agentpass1';
        btnReg.click();
      })()
    `);

    // Wait until connected and world is active
    for (let i = 0; i < 30; i++) {
      await sleep(200);
      const ready = await cdp.evaluate(`Boolean(window.__GAME__?.input?.enabled && window.__GAME__?.store?.selfEntity)`);
      if (ready) break;
    }

    await sleep(800);

    const spawnPos = await cdp.evaluate(`({ x: window.__GAME__.store.selfEntity.tileX, y: window.__GAME__.store.selfEntity.tileY, mode: window.__GAME__.renderer.renderMode })`);
    console.log(`Player spawned at (${spawnPos.x}, ${spawnPos.y}), mode: ${spawnPos.mode}`);

    // Screenshot 1: live game at spawn
    const spawnScreenshotPath = path.resolve(process.cwd(), 'screenshots/painted_spawn.png');
    await cdp.captureScreenshot(spawnScreenshotPath);
    console.log(`Saved spawn screenshot to: ${spawnScreenshotPath}`);

    // Now turn on F4 noclip collision overlay
    await cdp.evaluate(`window.__GAME__.input.debugCollisionVisible = true;`);

    // Walk north into the building / wall
    console.log('Walking player north into building wall...');
    for (let i = 0; i < 5; i++) {
      await cdp.evaluate(`window.__GAME__.input.activeKeys.add('KeyW')`);
      await sleep(280);
      await cdp.evaluate(`window.__GAME__.input.activeKeys.delete('KeyW')`);
      await sleep(50);
    }

    const collisionPos = await cdp.evaluate(`({ x: window.__GAME__.store.selfEntity.tileX, y: window.__GAME__.store.selfEntity.tileY, dir: window.__GAME__.store.selfEntity.dir })`);
    console.log(`Player stopped at (${collisionPos.x}, ${collisionPos.y}) facing dir ${collisionPos.dir}`);

    await sleep(500);

    // Screenshot 2: live game walking into a building with F4 collision overlay
    const collisionScreenshotPath = path.resolve(process.cwd(), 'screenshots/painted_collision.png');
    await cdp.captureScreenshot(collisionScreenshotPath);
    console.log(`Saved collision screenshot to: ${collisionScreenshotPath}`);

    cdp.close();
  } finally {
    proc.kill();
  }
}

main().catch(console.error);
