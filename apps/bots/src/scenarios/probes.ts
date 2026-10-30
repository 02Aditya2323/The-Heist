/**
 * apps/bots/src/scenarios/probes.ts
 *
 * Phase 0 Conformance Probes (P1 to P8) from Section 6 of verification spec.
 */

import { WebSocket } from 'ws';
import {
  loadMap,
  isWalkable,
  tryStep,
  DIR,
  DIR_DELTA,
  S2C,
  CLOSE_CODE,
  decodeS2CFrame,
  encodeMove,
  encodePing,
  findPath,
  pathToDirections,
  type GameMap,
  type MapData,
  type Direction,
  type WelcomeMsg,
  type MoveAckMsg,
  type MoveRejectMsg,
  type EntityLeaveMsg,
} from '@heist/shared';

export interface ProbeResult {
  id: string;
  name: string;
  passed: boolean;
  evidence: string;
  details?: string[];
}

export class ConformanceProbes {
  private httpUrl: string;
  private wsUrl: string;
  private debugToken?: string;
  private map!: GameMap;
  private config: {
    tickRate: number;
    stepTicks: number;
    chunkSize: number;
    ghostGraceMs: number;
    snapshotIntervalMs: number;
    heartbeatTimeoutMs: number;
  } = {
    tickRate: 20,
    stepTicks: 5,
    chunkSize: 16,
    ghostGraceMs: 30000,
    snapshotIntervalMs: 30000,
    heartbeatTimeoutMs: 15000,
  };

  constructor(options: { httpUrl: string; wsUrl: string; debugToken?: string }) {
    this.httpUrl = options.httpUrl;
    this.wsUrl = options.wsUrl;
    this.debugToken = options.debugToken;
  }

  private getHeaders(): Record<string, string> {
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
    };
    if (this.debugToken) {
      headers['x-debug-token'] = this.debugToken;
    }
    return headers;
  }

  async init(): Promise<void> {
    // 1. Fetch map
    const mapRes = await fetch(`${this.httpUrl}/api/map`);
    if (!mapRes.ok) throw new Error(`Failed to fetch map: ${mapRes.status}`);
    const mapData = (await mapRes.json()) as MapData;
    this.map = loadMap(mapData);

    // 2. Fetch server debug config
    try {
      const cfgRes = await fetch(`${this.httpUrl}/debug/config`, {
        headers: this.getHeaders(),
      });
      if (cfgRes.ok) {
        const c = (await cfgRes.json()) as any;
        this.config = {
          tickRate: c.tickRate || c.TICK_RATE || 20,
          stepTicks: c.stepTicks || c.STEP_TICKS || 5,
          chunkSize: c.chunkSize || c.CHUNK_SIZE || 16,
          ghostGraceMs: c.ghostGraceMs || c.GHOST_GRACE_MS || 30000,
          snapshotIntervalMs: c.snapshotIntervalMs || c.SNAPSHOT_INTERVAL_MS || 30000,
          heartbeatTimeoutMs: c.heartbeatTimeoutMs || c.HEARTBEAT_TIMEOUT_MS || 15000,
        };
      }
    } catch {}
  }

  private async createAuthUser(prefix: string): Promise<{ username: string; token: string; playerId: string }> {
    const username = `${prefix}_${Math.random().toString(36).slice(2, 8)}`;
    const password = 'Password_123!';

    const reg = await fetch(`${this.httpUrl}/api/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username, password }),
    });

    if (reg.ok) {
      const data = (await reg.json()) as any;
      return { username, token: data.token, playerId: data.playerId };
    }

    const login = await fetch(`${this.httpUrl}/api/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username, password }),
    });
    const data = (await login.json()) as any;
    return { username, token: data.token, playerId: data.playerId };
  }

  /**
   * Helper: connect WS and wait for WELCOME
   */
  private async connectWs(token: string): Promise<{ ws: WebSocket; welcome: WelcomeMsg }> {
    return new Promise((resolve, reject) => {
      const ws = new WebSocket(`${this.wsUrl}/ws?token=${token}`);
      let welcomeResolved = false;

      const timer = setTimeout(() => {
        if (!welcomeResolved) {
          ws.terminate();
          reject(new Error('Timeout waiting for WELCOME'));
        }
      }, 5000);

      ws.on('message', (raw: Buffer) => {
        const msgs = decodeS2CFrame(new Uint8Array(raw));
        for (const m of msgs) {
          if (m && m.opcode === S2C.WELCOME) {
            welcomeResolved = true;
            clearTimeout(timer);
            resolve({ ws, welcome: m as WelcomeMsg });
            return;
          }
        }
      });

      ws.on('error', (err) => {
        clearTimeout(timer);
        reject(err);
      });

      ws.on('close', (code, reason) => {
        if (!welcomeResolved) {
          clearTimeout(timer);
          reject(new Error(`WS closed before WELCOME: ${code} ${reason?.toString()}`));
        }
      });
    });
  }

  /**
   * P1: Step into a known wall tile
   * Expected: REJECT, position unchanged, next valid move still works
   */
  async runP1(): Promise<ProbeResult> {
    console.log('  Running Probe P1 (Step into wall)...');
    const { token } = await this.createAuthUser('probe_p1');
    const { ws, welcome } = await this.connectWs(token);

    try {
      // Find a walkable tile adjacent to a wall
      let curX = welcome.x;
      let curY = welcome.y;
      let wallDir: Direction = DIR.UP;
      let validDir: Direction = DIR.DOWN;

      let found = false;
      for (let r = 0; r < 30 && !found; r++) {
        for (let dy = -r; dy <= r && !found; dy++) {
          for (let dx = -r; dx <= r && !found; dx++) {
            const tx = curX + dx;
            const ty = curY + dy;
            if (isWalkable(this.map, tx, ty)) {
              for (const d of [DIR.UP, DIR.DOWN, DIR.LEFT, DIR.RIGHT] as Direction[]) {
                const [ddx, ddy] = DIR_DELTA[d];
                if (!isWalkable(this.map, tx + ddx, ty + ddy)) {
                  const path = findPath(this.map, curX, curY, tx, ty);
                  if (path) {
                    const dirs = pathToDirections(curX, curY, path);
                    for (const sd of dirs) {
                      ws.send(encodeMove(99, sd as Direction));
                      await new Promise((res) => setTimeout(res, 260));
                    }
                    wallDir = d;
                    for (const vd of [DIR.UP, DIR.DOWN, DIR.LEFT, DIR.RIGHT] as Direction[]) {
                      if (vd !== d && isWalkable(this.map, tx + DIR_DELTA[vd][0], ty + DIR_DELTA[vd][1])) {
                        validDir = vd;
                        break;
                      }
                    }
                    curX = tx;
                    curY = ty;
                    found = true;
                    break;
                  }
                }
              }
            }
          }
        }
      }

      let rejectReceived: any = null;
      let ackReceived: any = null;

      const msgPromise = new Promise<void>((resolve) => {
        ws.on('message', (raw: Buffer) => {
          const msgs = decodeS2CFrame(new Uint8Array(raw));
          for (const m of msgs) {
            if (!m) continue;
            if (m.opcode === S2C.MOVE_REJECT) {
              rejectReceived = m as MoveRejectMsg;
            }
            if (m.opcode === S2C.MOVE_ACK) {
              ackReceived = m as MoveAckMsg;
            }
          }
          if (rejectReceived && ackReceived) {
            resolve();
          }
        });
      });

      // 1. Send invalid wall move
      ws.send(encodeMove(1, wallDir));
      await new Promise((r) => setTimeout(r, 350));

      // 2. Send next valid move
      ws.send(encodeMove(2, validDir));

      await Promise.race([msgPromise, new Promise((r) => setTimeout(r, 1000))]);

      const passed =
        rejectReceived !== null &&
        rejectReceived.x === curX &&
        rejectReceived.y === curY &&
        ackReceived !== null;

      const evidence = `rejectReceived=${Boolean(rejectReceived)} pos=(${rejectReceived?.x},${rejectReceived?.y}) ackReceived=${Boolean(ackReceived)} ackPos=(${ackReceived?.x},${ackReceived?.y})`;

      return {
        id: 'P1',
        name: 'Step into a known wall tile',
        passed,
        evidence,
      };
    } finally {
      ws.terminate();
    }
  }

  /**
   * P2: Send MOVE every 40 ms for 5 s in an open corridor
   * Expected: Server-confirmed displacement <= ceil(5 / stepSec) + 1 tiles; excess moves answered with REJECT; bot position equals /debug/positions
   */
  async runP2(): Promise<ProbeResult> {
    console.log('  Running Probe P2 (Rate-limit move burst)...');
    const { token, playerId } = await this.createAuthUser('probe_p2');
    const { ws, welcome } = await this.connectWs(token);

    try {
      let acks = 0;
      let rejects = 0;
      let lastX = welcome.x;
      let lastY = welcome.y;

      ws.on('message', (raw: Buffer) => {
        const msgs = decodeS2CFrame(new Uint8Array(raw));
        for (const m of msgs) {
          if (!m) continue;
          if (m.opcode === S2C.MOVE_ACK) {
            acks++;
            const a = m as MoveAckMsg;
            lastX = a.x;
            lastY = a.y;
          } else if (m.opcode === S2C.MOVE_REJECT) {
            rejects++;
          }
        }
      });

      const startTime = Date.now();
      let seq = 1;
      while (Date.now() - startTime < 5000) {
        ws.send(encodeMove(seq++, DIR.DOWN));
        await new Promise((r) => setTimeout(r, 40));
      }

      await new Promise((r) => setTimeout(r, 600));

      const elapsedSec = (Date.now() - startTime) / 1000;
      const stepSec = (this.config.stepTicks / this.config.tickRate);
      const maxAllowedDisplacement = Math.ceil(elapsedSec / stepSec) + 1;

      // Query /debug/positions
      const posRes = await fetch(`${this.httpUrl}/debug/positions`, {
        headers: this.getHeaders(),
      });
      const posData = (await posRes.json()) as any;
      const serverEnt = posData.entities?.find((e: any) => e.playerId === playerId);

      const displacement = Math.abs(lastX - welcome.x) + Math.abs(lastY - welcome.y);
      const posMatches = serverEnt && serverEnt.x === lastX && serverEnt.y === lastY;
      const passed = displacement <= maxAllowedDisplacement && rejects > 0 && posMatches;

      const evidence = `displacement=${displacement} (limit=${maxAllowedDisplacement}), acks=${acks}, rejects=${rejects}, posMatch=${posMatches} (${lastX},${lastY} vs ${serverEnt?.x},${serverEnt?.y})`;

      return {
        id: 'P2',
        name: 'Send MOVE every 40 ms for 5 s',
        passed,
        evidence,
      };
    } finally {
      ws.terminate();
    }
  }

  /**
   * P3: Flood 500 PINGs/s for 3 s
   * Expected: Flooder dropped or kicked (4003); a control bot's RTT p95 stays < 150 ms during the flood
   */
  async runP3(): Promise<ProbeResult> {
    console.log('  Running Probe P3 (PING flood & control bot)...');
    const userControl = await this.createAuthUser('probe_p3_ctrl');
    const userFlooder = await this.createAuthUser('probe_p3_flood');

    const { ws: ctrlWs } = await this.connectWs(userControl.token);
    const { ws: floodWs } = await this.connectWs(userFlooder.token);

    try {
      const rttSamples: number[] = [];
      let flooderClosedCode: number | null = null;

      floodWs.on('close', (code) => {
        flooderClosedCode = code;
      });

      ctrlWs.on('message', (raw: Buffer) => {
        const msgs = decodeS2CFrame(new Uint8Array(raw));
        for (const m of msgs) {
          if (!m) continue;
          if (m.opcode === S2C.PONG) {
            const now = performance.now() | 0;
            const clientTime = (m as any).clientTime;
            const rtt = Math.max(0, now - clientTime);
            rttSamples.push(rtt);
          }
        }
      });

      // Control bot pings every 50ms
      const ctrlInterval = setInterval(() => {
        if (ctrlWs.readyState === WebSocket.OPEN) {
          ctrlWs.send(encodePing(performance.now() | 0));
        }
      }, 50);

      // Flooder bot sends 500 PINGs/s for 3 s (total 1500 pings)
      const floodStart = Date.now();
      let sentCount = 0;
      while (Date.now() - floodStart < 3000) {
        for (let i = 0; i < 25; i++) {
          if (floodWs.readyState === WebSocket.OPEN) {
            floodWs.send(encodePing(Date.now() | 0));
            sentCount++;
          }
        }
        await new Promise((r) => setTimeout(r, 50));
      }

      await new Promise((r) => setTimeout(r, 1000));
      clearInterval(ctrlInterval);

      rttSamples.sort((a, b) => a - b);
      const p95Idx = Math.floor(rttSamples.length * 0.95);
      const p95Rtt = rttSamples.length > 0 ? rttSamples[p95Idx] : 0;

      const flooderKicked = flooderClosedCode === CLOSE_CODE.RATE_LIMIT || flooderClosedCode === 4003 || floodWs.readyState !== WebSocket.OPEN;
      const passed = flooderKicked && p95Rtt < 150;

      const evidence = `flooderClosedCode=${flooderClosedCode}, sentCount=${sentCount}, ctrlRttSamples=${rttSamples.length}, ctrlP95Rtt=${p95Rtt}ms (<150ms)`;

      return {
        id: 'P3',
        name: 'Flood 500 PINGs/s for 3 s',
        passed,
        evidence,
      };
    } finally {
      ctrlWs.terminate();
      floodWs.terminate();
    }
  }

  /**
   * P4: Send unknown opcode, truncated MOVE, direction value 7, a 2 KB frame
   * Expected: Server survives, malformedMessages increments, control bot unaffected
   */
  async runP4(): Promise<ProbeResult> {
    console.log('  Running Probe P4 (Malformed frames & robustness)...');
    const userControl = await this.createAuthUser('probe_p4_ctrl');
    const userAttacker = await this.createAuthUser('probe_p4_atk');

    const { ws: ctrlWs } = await this.connectWs(userControl.token);
    const { ws: atkWs } = await this.connectWs(userAttacker.token);

    try {
      // 1. Initial metrics
      const m1Res = await fetch(`${this.httpUrl}/metrics`);
      const m1 = (await m1Res.json()) as any;
      const initialMalformed = m1.network?.malformedMessages || 0;

      // 2. Send unknown opcode 0xEE
      atkWs.send(Buffer.from([0xee, 0x01, 0x02, 0x03]));
      await new Promise((r) => setTimeout(r, 100));

      // 3. Truncated MOVE (2 bytes instead of 4)
      atkWs.send(Buffer.from([0x01, 0x05]));
      await new Promise((r) => setTimeout(r, 100));

      // 4. Direction value 7 (valid are 0..3)
      atkWs.send(Buffer.from([0x01, 0x01, 0x00, 0x07]));
      await new Promise((r) => setTimeout(r, 100));

      // 5. 2 KB frame (> 1024 max frame size)
      atkWs.send(Buffer.alloc(2048, 0xaa));
      await new Promise((r) => setTimeout(r, 300));

      // 6. Check metrics
      const m2Res = await fetch(`${this.httpUrl}/metrics`);
      const m2 = (await m2Res.json()) as any;
      const finalMalformed = m2.network?.malformedMessages || 0;

      // 7. Test control bot still responsive
      let pongReceived = false;
      ctrlWs.on('message', (raw: Buffer) => {
        const msgs = decodeS2CFrame(new Uint8Array(raw));
        for (const m of msgs) {
          if (m && m.opcode === S2C.PONG) pongReceived = true;
        }
      });
      ctrlWs.send(encodePing(Date.now() | 0));
      await new Promise((r) => setTimeout(r, 300));

      const malformedDelta = finalMalformed - initialMalformed;
      const passed = malformedDelta > 0 && pongReceived;
      const evidence = `malformedDelta=${malformedDelta} (before=${initialMalformed}, after=${finalMalformed}), controlPongReceived=${pongReceived}`;

      return {
        id: 'P4',
        name: 'Malformed frames and unknown opcodes',
        passed,
        evidence,
      };
    } finally {
      ctrlWs.terminate();
      atkWs.terminate();
    }
  }

  /**
   * P5: Wrong token, missing token, same token twice
   * Expected: 4001 for bad/missing; first socket closed with 4002; entity position unchanged
   */
  async runP5(): Promise<ProbeResult> {
    console.log('  Running Probe P5 (Token validation & duplicate sessions)...');
    let badTokenCloseCode: number | null = null;
    let missingTokenCloseCode: number | null = null;

    // A. Missing token
    await new Promise<void>((resolve) => {
      const ws = new WebSocket(`${this.wsUrl}/ws`);
      ws.on('close', (code) => {
        missingTokenCloseCode = code;
        resolve();
      });
      ws.on('error', () => resolve());
    });

    // B. Wrong token
    await new Promise<void>((resolve) => {
      const ws = new WebSocket(`${this.wsUrl}/ws?token=invalid_probe_token_12345`);
      ws.on('close', (code) => {
        badTokenCloseCode = code;
        resolve();
      });
      ws.on('error', () => resolve());
    });

    // C. Same token twice
    const user = await this.createAuthUser('probe_p5_dup');
    const { ws: ws1, welcome: w1 } = await this.connectWs(user.token);

    let ws1CloseCode: number | null = null;
    ws1.on('close', (code) => {
      ws1CloseCode = code;
    });

    // Connect ws2 with SAME token
    const { ws: ws2, welcome: w2 } = await this.connectWs(user.token);
    await new Promise((r) => setTimeout(r, 400));

    const posRes = await fetch(`${this.httpUrl}/debug/positions`, {
      headers: this.getHeaders(),
    });
    const posData = (await posRes.json()) as any;
    const serverEnt = posData.entities?.find((e: any) => e.playerId === user.playerId);

    const posUnchanged = serverEnt && serverEnt.x === w1.x && serverEnt.y === w1.y && w2.x === w1.x && w2.y === w1.y;
    const passed =
      missingTokenCloseCode === 4001 &&
      badTokenCloseCode === 4001 &&
      ws1CloseCode === 4002 &&
      posUnchanged;

    const evidence = `missingTokenClose=${missingTokenCloseCode}, badTokenClose=${badTokenCloseCode}, ws1Close=${ws1CloseCode}, posUnchanged=${posUnchanged} (pos=${w1.x},${w1.y})`;

    ws1.terminate();
    ws2.terminate();

    return {
      id: 'P5',
      name: 'Wrong token, missing token, duplicate token',
      passed,
      evidence,
    };
  }

  /**
   * P6: Ghost + persistence:
   * (a) drop and reconnect within 10 s;
   * (b) another bot idles SNAPSHOT_INTERVAL + 2 s, drops, waits GHOST_GRACE + 5 s, reconnects
   * Expected:
   * (a) WELCOME position equals the old one, observer bot sees no LEAVE/ENTER flicker.
   * (b) Observer sees ENTITY_LEAVE after grace; on return, position equals the persisted position exactly
   */
  async runP6(): Promise<ProbeResult> {
    console.log('  Running Probe P6 (Ghost + persistence)...');

    // ── Part A: Drop and reconnect within 10s ──────────────────────────────
    console.log('    [P6.a] Testing ghost reconnect within grace period (10s)...');
    const obsUserA = await this.createAuthUser('probe_p6_obsa');
    const { ws: obsWsA, welcome: obsWelcomeA } = await this.connectWs(obsUserA.token);

    let observerLeavesA = 0;
    obsWsA.on('message', (raw: Buffer) => {
      const msgs = decodeS2CFrame(new Uint8Array(raw));
      for (const m of msgs) {
        if (m && m.opcode === S2C.ENTITY_LEAVE) observerLeavesA++;
      }
    });

    const obsPingIntervalA = setInterval(() => {
      if (obsWsA.readyState === WebSocket.OPEN) {
        obsWsA.send(encodePing(performance.now() | 0));
      }
    }, 2000);

    let botA!: { username: string; token: string; playerId: string };
    let wsA1!: WebSocket;
    let wA1!: WelcomeMsg;

    while (true) {
      const candUser = await this.createAuthUser('probe_p6_a');
      const candConn = await this.connectWs(candUser.token);
      if (candConn.welcome.x === obsWelcomeA.x && candConn.welcome.y === obsWelcomeA.y) {
        botA = candUser;
        wsA1 = candConn.ws;
        wA1 = candConn.welcome;
        break;
      }
      candConn.ws.terminate();
    }

    // Move botA one valid step
    let stepDirA: Direction = DIR.DOWN;
    for (const d of [DIR.DOWN, DIR.RIGHT, DIR.UP, DIR.LEFT] as Direction[]) {
      const [dx, dy] = DIR_DELTA[d];
      if (isWalkable(this.map, wA1.x + dx, wA1.y + dy)) {
        stepDirA = d;
        break;
      }
    }
    let expectedAX = wA1.x;
    let expectedAY = wA1.y;
    wsA1.on('message', (raw: Buffer) => {
      const msgs = decodeS2CFrame(new Uint8Array(raw));
      for (const m of msgs) {
        if (m && m.opcode === S2C.MOVE_ACK) {
          expectedAX = (m as any).x;
          expectedAY = (m as any).y;
        }
      }
    });
    wsA1.send(encodeMove(1, stepDirA));
    await new Promise((r) => setTimeout(r, 400));

    const leavesBeforeDropA = observerLeavesA;
    wsA1.terminate();

    // Wait 3s (within 10s grace)
    await new Promise((r) => setTimeout(r, 3000));
    const leavesDuringGhostA = observerLeavesA - leavesBeforeDropA;

    // Reconnect bot A
    const { ws: wsA2, welcome: wA2 } = await this.connectWs(botA.token);
    wsA2.terminate();
    clearInterval(obsPingIntervalA);
    obsWsA.terminate();

    const partAPassed = wA2.x === expectedAX && wA2.y === expectedAY && leavesDuringGhostA === 0;

    // ── Part B: Snapshot persistence & ghost expiry ────────────────────────
    console.log('    [P6.b] Testing snapshot persistence & ghost expiry (waiting for snapshot & ghost grace)...');
    const obsUserB = await this.createAuthUser('probe_p6_obsb');
    const { ws: obsWsB, welcome: obsWelcomeB } = await this.connectWs(obsUserB.token);

    let observerLeavesB = 0;
    obsWsB.on('message', (raw: Buffer) => {
      const msgs = decodeS2CFrame(new Uint8Array(raw));
      for (const m of msgs) {
        if (m && m.opcode === S2C.ENTITY_LEAVE) observerLeavesB++;
      }
    });

    const obsPingIntervalB = setInterval(() => {
      if (obsWsB.readyState === WebSocket.OPEN) {
        obsWsB.send(encodePing(performance.now() | 0));
      }
    }, 2000);

    let botB!: { username: string; token: string; playerId: string };
    let wsB1!: WebSocket;
    let wB1!: WelcomeMsg;

    while (true) {
      const candUser = await this.createAuthUser('probe_p6_b');
      const candConn = await this.connectWs(candUser.token);
      if (candConn.welcome.x === obsWelcomeB.x && candConn.welcome.y === obsWelcomeB.y) {
        botB = candUser;
        wsB1 = candConn.ws;
        wB1 = candConn.welcome;
        break;
      }
      candConn.ws.terminate();
    }

    // Move botB in a walkable direction and verify ACK
    let stepDirB: Direction = DIR.RIGHT;
    for (const d of [DIR.RIGHT, DIR.DOWN, DIR.UP, DIR.LEFT] as Direction[]) {
      const [dx, dy] = DIR_DELTA[d];
      if (isWalkable(this.map, wB1.x + dx, wB1.y + dy)) {
        stepDirB = d;
        break;
      }
    }
    let expectedPersistX = wB1.x;
    let expectedPersistY = wB1.y;
    wsB1.on('message', (raw: Buffer) => {
      const msgs = decodeS2CFrame(new Uint8Array(raw));
      for (const m of msgs) {
        if (m && m.opcode === S2C.MOVE_ACK) {
          expectedPersistX = (m as any).x;
          expectedPersistY = (m as any).y;
        }
      }
    });
    wsB1.send(encodeMove(1, stepDirB));
    await new Promise((r) => setTimeout(r, 400));

    // Keep wsB1 alive while waiting for snapshot flush
    const b1PingInterval = setInterval(() => {
      if (wsB1.readyState === WebSocket.OPEN) {
        wsB1.send(encodePing(performance.now() | 0));
      }
    }, 2000);

    // Wait for snapshot flush
    const snapWaitMs = Math.min(this.config.snapshotIntervalMs + 2000, 32000);
    console.log(`    Waiting ${Math.round(snapWaitMs / 1000)}s for snapshotter flush...`);
    await new Promise((r) => setTimeout(r, snapWaitMs));

    clearInterval(b1PingInterval);
    const leavesBeforeGrace = observerLeavesB;
    wsB1.terminate();

    // Wait for ghost expiration
    const graceWaitMs = Math.min(this.config.ghostGraceMs + 5000, 35000);
    console.log(`    Waiting ${Math.round(graceWaitMs / 1000)}s for ghost expiration...`);
    await new Promise((r) => setTimeout(r, graceWaitMs));

    clearInterval(obsPingIntervalB);
    const leavesAfterGrace = observerLeavesB - leavesBeforeGrace;

    // Reconnect bot B from DB persistent state
    const { ws: wsB2, welcome: wB2 } = await this.connectWs(botB.token);
    wsB2.terminate();
    obsWsB.terminate();

    const partBPassed = wB2.x === expectedPersistX && wB2.y === expectedPersistY && leavesAfterGrace > 0;

    const passed = partAPassed && partBPassed;
    const evidence = `partA(reconnectInGrace)=${partAPassed} (posA=${wA2.x},${wA2.y}, ghostFlickerLeaves=${leavesDuringGhostA}), partB(dbRestore)=${partBPassed} (expectedPos=${expectedPersistX},${expectedPersistY}, actualPos=${wB2.x},${wB2.y}, leavesAfterGrace=${leavesAfterGrace})`;

    return {
      id: 'P6',
      name: 'Ghost + persistence lifecycle',
      passed,
      evidence,
    };
  }

  /**
   * P7: Send nothing for HEARTBEAT_TIMEOUT + 5 s
   * Expected: Server closes (4005); entity becomes a ghost, then expires
   */
  async runP7(): Promise<ProbeResult> {
    console.log('  Running Probe P7 (Heartbeat timeout)...');
    const user = await this.createAuthUser('probe_p7_hb');
    const { ws, welcome } = await this.connectWs(user.token);

    try {
      let closeCode: number | null = null;
      ws.on('close', (code) => {
        closeCode = code;
      });

      // Send nothing for HEARTBEAT_TIMEOUT + 5 s
      const waitMs = this.config.heartbeatTimeoutMs + 5000;
      console.log(`    Idling ${Math.round(waitMs / 1000)}s with no packets...`);
      await new Promise((r) => setTimeout(r, waitMs));

      const passed = closeCode === CLOSE_CODE.HEARTBEAT_TIMEOUT || closeCode === 4005;
      const evidence = `closedCode=${closeCode} (expected 4005/HEARTBEAT_TIMEOUT)`;

      return {
        id: 'P7',
        name: 'Heartbeat timeout disconnection',
        passed,
        evidence,
      };
    } finally {
      ws.terminate();
    }
  }

  /**
   * P8: HTTP:
   * register duplicate username -> 409
   * login wrong password -> 401
   * login right password -> 200 with token
   * fetch /api/map 100 times -> all 200 and < 100 ms p95
   */
  async runP8(): Promise<ProbeResult> {
    console.log('  Running Probe P8 (HTTP endpoints & map latency)...');
    const username = `probe_p8_${Math.random().toString(36).slice(2, 8)}`;
    const password = 'CorrectPassword_123';

    // 1. Initial register
    const reg1 = await fetch(`${this.httpUrl}/api/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username, password }),
    });
    const reg1Ok = reg1.status === 201;

    // 2. Duplicate username -> 409
    const reg2 = await fetch(`${this.httpUrl}/api/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username, password }),
    });
    const duplicate409 = reg2.status === 409;

    // 3. Wrong password -> 401
    const loginWrong = await fetch(`${this.httpUrl}/api/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username, password: 'WrongPassword_000' }),
    });
    const wrong401 = loginWrong.status === 401;

    // 4. Right password -> 200 with token
    const loginRight = await fetch(`${this.httpUrl}/api/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username, password }),
    });
    const rightData = (await loginRight.json()) as any;
    const right200 = loginRight.status === 200 && Boolean(rightData.token);

    // 5. Fetch /api/map 100 times
    const mapLatencies: number[] = [];
    let mapErrors = 0;
    for (let i = 0; i < 100; i++) {
      const t0 = performance.now();
      const res = await fetch(`${this.httpUrl}/api/map`);
      const lat = performance.now() - t0;
      if (!res.ok) mapErrors++;
      mapLatencies.push(lat);
    }

    mapLatencies.sort((a, b) => a - b);
    const p95Idx = Math.floor(mapLatencies.length * 0.95);
    const p95Latency = mapLatencies[p95Idx];

    const passed = reg1Ok && duplicate409 && wrong401 && right200 && mapErrors === 0 && p95Latency < 100;
    const evidence = `duplicate409=${duplicate409}, wrong401=${wrong401}, right200=${right200}, mapCount=100, mapErrors=${mapErrors}, mapP95=${p95Latency.toFixed(2)}ms (<100ms)`;

    return {
      id: 'P8',
      name: 'HTTP auth & map delivery conformance',
      passed,
      evidence,
    };
  }

  async runAll(): Promise<ProbeResult[]> {
    console.log('\n======================================================');
    console.log('🚀 Phase 0 Conformance Probes (P1 to P8)');
    console.log('======================================================');

    const results: ProbeResult[] = [];
    results.push(await this.runP1());
    results.push(await this.runP2());
    results.push(await this.runP3());
    results.push(await this.runP4());
    results.push(await this.runP5());
    results.push(await this.runP6());
    results.push(await this.runP7());
    results.push(await this.runP8());

    console.log('\n======================================================');
    console.log('📊 Phase 0 Conformance Probes Results');
    console.log('======================================================');
    for (const r of results) {
      console.log(`[${r.passed ? 'PASS' : 'FAIL'}] ${r.id}: ${r.name}`);
      console.log(`       Evidence: ${r.evidence}`);
    }
    console.log('======================================================\n');

    return results;
  }
}
