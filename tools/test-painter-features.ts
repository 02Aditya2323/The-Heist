import { spawn, type ChildProcess } from 'node:child_process';
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

  close(): void {
    this.ws.close();
  }
}

async function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

async function main() {
  const edgePath = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
  const port = 9346;
  const tempDir = `C:\\Users\\ADVAY\\AppData\\Local\\Temp\\edge-test-painter-${Date.now()}`;

  const proc = spawn(edgePath, [
    '--headless=new',
    `--remote-debugging-port=${port}`,
    `--user-data-dir=${tempDir}`,
    'http://localhost:5173/painter.html',
  ]);

  let cdp: CdpSession | null = null;
  try {
    for (let i = 0; i < 30; i++) {
      try {
        const res = await fetch(`http://127.0.0.1:${port}/json`);
        const list = await res.json();
        const page = list.find((p: any) => p.type === 'page');
        if (page?.webSocketDebuggerUrl) {
          const ws = new WebSocket(page.webSocketDebuggerUrl);
          await new Promise((r) => ws.on('open', r));
          cdp = new CdpSession(ws);
          break;
        }
      } catch {}
      await sleep(300);
    }

    if (!cdp) throw new Error('CDP connection failed');

    await sleep(1500);

    // 1. Test Magic Wand
    console.log('Testing Magic Wand...');
    const wandResult = await cdp.evaluate(`
      (() => {
        const p = window.__PAINTER__;
        p.wandTolerance = 25;
        p.runMagicWand(26, 14);
        const count = p.wandSelectedTiles.size;
        // Test mark walkable
        p.applyWandSelection(0);
        const walkableCount = p.collision.flat().filter(x => x === 0).length;
        // Revert to all blocked
        p.setAllBlocked();
        const afterBlockedCount = p.collision.flat().filter(x => x === 1).length;
        return { count, walkableCount, afterBlockedCount, total: p.widthTiles * p.heightTiles };
      })()
    `);
    console.log('Magic Wand Test Result:', wandResult);

    if (wandResult.count <= 0) throw new Error('Magic Wand selected 0 tiles');
    if (wandResult.walkableCount !== wandResult.count) throw new Error('applyWandSelection did not update tiles');
    if (wandResult.afterBlockedCount !== wandResult.total) throw new Error('setAllBlocked failed');

    // 2. Test Walk Test mode
    console.log('Testing Walk Test mode...');
    const walkResult = await cdp.evaluate(`
      (() => {
        const p = window.__PAINTER__;
        // Make tile (26, 14) and (26, 15) walkable for test
        p.collision[14][26] = 0;
        p.collision[15][26] = 0;

        p.startWalkTest();
        const active1 = p.walkTestActive;
        const initialTile = { ...p.walkAvatar };

        // Simulate stepping DOWN (KeyS)
        p.activeWalkKeys.add('KeyS');
        // Let walk loop process
        return { active1, initialTile };
      })()
    `);
    console.log('Walk Test Activation:', walkResult);

    await sleep(400);

    const stepResult = await cdp.evaluate(`
      (() => {
        const p = window.__PAINTER__;
        p.activeWalkKeys.delete('KeyS');
        const pos = { tileX: p.walkAvatar.tileX, tileY: p.walkAvatar.tileY, dir: p.walkAvatar.dir };
        p.stopWalkTest();
        const active2 = p.walkTestActive;
        // Reset to all blocked
        p.setAllBlocked();
        return { pos, active2 };
      })()
    `);
    console.log('Walk Test Movement Result:', stepResult);

    if (stepResult.pos.tileY !== 15) throw new Error(`Walk Test avatar failed to move down: ${JSON.stringify(stepResult)}`);

    // 3. Test Export map and manifest
    console.log('Testing Export functions...');
    const exportResult = await cdp.evaluate(`
      (() => {
        const p = window.__PAINTER__;
        const map = p.exportServerMap();
        const manifest = p.exportPaintedManifest();
        return {
          mapWidth: map.width,
          mapHeight: map.height,
          collisionRows: map.collision.length,
          allBlocked: map.collision.every(r => r === '1'.repeat(map.width)),
          spawns: map.spawns,
          hotspots: map.hotspots,
          manifestCovers: manifest.coverRects
        };
      })()
    `);
    console.log('Export Test Result:', exportResult);

    if (!exportResult.allBlocked) throw new Error('Exported map was not fully blocked');
    if (exportResult.spawns.length !== 1 || exportResult.spawns[0].x !== 26 || exportResult.spawns[0].y !== 14) {
      throw new Error(`Unexpected spawns: ${JSON.stringify(exportResult.spawns)}`);
    }
    if (exportResult.hotspots.length !== 0) throw new Error('Hotspots was not empty');
    if (exportResult.manifestCovers.length !== 0) throw new Error('Cover rects was not empty by default');

    console.log('✅ All painter features verified and working perfectly!');
  } finally {
    if (cdp) cdp.close();
    proc.kill();
  }
}

main().catch((err) => {
  console.error('Test error:', err);
  process.exit(1);
});
