/**
 * apps/bots/src/bot.ts
 *
 * Full-fidelity bot client that simulates human networking,
 * executes movement, tracks visible entity replicas, validates
 * server state against local prediction, and logs L1 per-bot traces.
 */

import { WebSocket } from 'ws';
import {
  decodeS2CFrame,
  encodeMove,
  encodePing,
  S2C,
  DIR,
  DIR_DELTA,
  isWalkable,
  type Direction,
  type GameMap,
  type WelcomeMsg,
  type EntityEnterMsg,
  type EntityLeaveMsg,
  type EntityMoveMsg,
  type EntityTeleportMsg,
  type MoveAckMsg,
  type MoveRejectMsg,
} from '@heist/shared';

export type BehaviourType =
  | 'roamer'
  | 'hotspot-goer'
  | 'explorer'
  | 'border-crosser'
  | 'afk'
  | 'reconnector'
  | 'human-pauser';

export type NetworkProfile = 'good' | 'medium' | 'bad';

export interface BotStats {
  movesSent: number;
  acksReceived: number;
  rejectsReceived: number;
  desyncsCount: number;
  rttSamples: number[];
  bytesReceived: number;
  bytesSent: number;
}

export interface AoICheckResult {
  ran: boolean;
  ok: boolean;
  error?: string;
  diff?: string;
}

export interface L1Event {
  ts: number;
  event: string;
  [key: string]: unknown;
}

export class BotClient {
  public id: string; // Bot codename (e.g. agent_000)
  public playerId = '';
  public token = '';
  public entityId = 0;
  public x = 0;
  public y = 0;
  public dir: Direction = DIR.DOWN;
  public behaviour: BehaviourType;
  public networkProfile: NetworkProfile;

  // Track entity positions in the replica (ENTER, MOVE, TELEPORT, LEAVE)
  public visibleReplica = new Map<number, { x: number; y: number }>();

  // L1 Per-bot trace events
  public l1Events: L1Event[] = [];

  // Canary test hooks for fault injection (kept for backwards compatibility)
  public dropLeaveCanary = false;
  public dropMoveCanary = false;
  public corruptPositionCanary = false;
  public breakReconnectCanary = false;
  public isCheckingAoI = false;

  // L5 Movement audit & rejects tracking
  public rejectCounts = {
    wall: 0,
    queue_overflow: 0,
    unknown: 0,
  };
  public movementRuleViolations: string[] = [];
  private expectedMoves = new Map<number, { dir: Direction; startX: number; startY: number }>();

  // Exploration & tracking metrics
  public tilesTravelled = 0;
  public chunkCrossings = 0;
  public distinctChunks = new Set<string>();
  public hotspotsVisited = new Set<string>();
  public reconnects = 0;
  public unexpectedDisconnects = 0;
  public intentionalDisconnect = false;
  public connectedTimeMs = 0;
  private connectionStartTime = 0;

  public stats: BotStats = {
    movesSent: 0,
    acksReceived: 0,
    rejectsReceived: 0,
    desyncsCount: 0,
    rttSamples: [],
    bytesReceived: 0,
    bytesSent: 0,
  };

  private ws: WebSocket | null = null;
  private seq = 0;
  private moveSentTimes = new Map<number, number>();
  private serverUrl: string;
  private httpUrl: string;
  public isConnected = false;
  public welcomed = false;
  private pendingWelcomeResolve: (() => void) | null = null;
  private pendingWelcomeReject: ((err: Error) => void) | null = null;
  private welcomeTimeoutTimer: NodeJS.Timeout | null = null;
  private heartbeatTimer: NodeJS.Timeout | null = null;
  private autoReconnectTimer: NodeJS.Timeout | null = null;
  private autoReconnectBackoffMs = 500;

  private map: GameMap;
  private stepDurationMs = 250;

  // In-order FIFO latency queues
  private lastInboundDeliverAt = 0;
  private inboundQueue: { raw: Buffer; arrivalTime: number; deliverAt: number }[] = [];
  private inboundTimer: NodeJS.Timeout | null = null;

  private lastOutboundDeliverAt = 0;
  private outboundQueue: { packet: Uint8Array; seq: number; deliverAt: number }[] = [];
  private outboundTimer: NodeJS.Timeout | null = null;

  constructor(
    id: string,
    behaviour: BehaviourType,
    profile: NetworkProfile,
    httpUrl: string,
    wsUrl: string,
    map: GameMap
  ) {
    this.id = id;
    this.behaviour = behaviour;
    this.networkProfile = profile;
    this.httpUrl = httpUrl;
    this.serverUrl = wsUrl;
    this.map = map;
  }

  recordEvent(event: string, data?: Record<string, unknown>): void {
    this.l1Events.push({
      ts: Date.now(),
      event,
      ...(data || {}),
    });
  }

  getLatencyMs(): number {
    switch (this.networkProfile) {
      case 'good':
        return 5 + Math.random() * 25; // 5-30ms
      case 'medium':
        return 50 + Math.random() * 70; // 50-120ms
      case 'bad':
        // 150-400ms with occasional 1-2s stall
        if (Math.random() < 0.05) {
          return 1000 + Math.random() * 1000;
        }
        return 150 + Math.random() * 250;
    }
  }

  async registerAndLogin(): Promise<{ authLatencyMs: number }> {
    const username = this.id;
    const password = 'password_' + this.id;
    const t0 = performance.now();

    // 1. Register (ignore 409 if exists)
    try {
      const regRes = await fetch(`${this.httpUrl}/api/register`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username, password }),
      });
      if (regRes.ok) {
        const data = (await regRes.json()) as { token: string; playerId: string };
        this.token = data.token;
        this.playerId = data.playerId;
        const authLatencyMs = performance.now() - t0;
        return { authLatencyMs };
      }
    } catch {}

    // 2. Login if already exists
    const loginRes = await fetch(`${this.httpUrl}/api/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username, password }),
    });

    if (!loginRes.ok) {
      throw new Error(`Bot ${this.id} auth failed with status ${loginRes.status}`);
    }

    const data = (await loginRes.json()) as { token: string; playerId: string };
    this.token = data.token;
    this.playerId = data.playerId;
    const authLatencyMs = performance.now() - t0;
    return { authLatencyMs };
  }

  private clearQueues(): void {
    if (this.inboundTimer) {
      clearTimeout(this.inboundTimer);
      this.inboundTimer = null;
    }
    if (this.outboundTimer) {
      clearTimeout(this.outboundTimer);
      this.outboundTimer = null;
    }
    this.inboundQueue = [];
    this.outboundQueue = [];
    this.lastInboundDeliverAt = 0;
    this.lastOutboundDeliverAt = 0;
  }

  async connect(): Promise<void> {
    if (this.autoReconnectTimer) {
      clearTimeout(this.autoReconnectTimer);
      this.autoReconnectTimer = null;
    }

    this.welcomed = false;
    this.visibleReplica.clear();
    this.clearQueues();
    this.intentionalDisconnect = false;

    let targetToken = this.token;
    if (this.breakReconnectCanary) {
      targetToken = 'invalid_canary_token_' + Date.now();
    }

    return new Promise<void>((resolve, reject) => {
      this.pendingWelcomeResolve = resolve;
      this.pendingWelcomeReject = reject;

      this.welcomeTimeoutTimer = setTimeout(() => {
        if (!this.welcomed) {
          const r = this.pendingWelcomeReject;
          this.pendingWelcomeResolve = null;
          this.pendingWelcomeReject = null;
          this.disconnect();
          r?.(new Error(`Timeout waiting for WELCOME for ${this.id}`));
        }
      }, 8000);

      this.recordEvent('connect');
      const ws = new WebSocket(`${this.serverUrl}/ws?token=${targetToken}`);
      this.ws = ws;

      ws.on('open', () => {
        this.isConnected = true;
        this.connectionStartTime = Date.now();
      });

      ws.on('message', (raw: Buffer) => {
        const now = performance.now();
        const delay = this.getLatencyMs();
        // In-order FIFO: deliverAt = max(now + delay, lastDeliverAt)
        const deliverAt = Math.max(now + delay, this.lastInboundDeliverAt);
        this.lastInboundDeliverAt = deliverAt;

        this.inboundQueue.push({ raw, arrivalTime: now, deliverAt });
        this.pumpInboundQueue();
      });

      ws.on('close', (code, reason) => {
        const wasWelcomed = this.welcomed;
        this.isConnected = false;
        this.visibleReplica.clear();
        if (this.connectionStartTime > 0) {
          this.connectedTimeMs += Date.now() - this.connectionStartTime;
          this.connectionStartTime = 0;
        }

        if (this.heartbeatTimer) {
          clearInterval(this.heartbeatTimer);
          this.heartbeatTimer = null;
        }

        this.recordEvent('close', { code, reason: reason?.toString() });

        const wasIntentional = Boolean((ws as any).__intentional || this.intentionalDisconnect);

        if (wasWelcomed && !wasIntentional) {
          this.unexpectedDisconnects++;
        }

        if (!wasWelcomed) {
          if (this.welcomeTimeoutTimer) {
            clearTimeout(this.welcomeTimeoutTimer);
            this.welcomeTimeoutTimer = null;
          }
          const r = this.pendingWelcomeReject;
          this.pendingWelcomeResolve = null;
          this.pendingWelcomeReject = null;
          r?.(
            new Error(
              `WebSocket closed before WELCOME for ${this.id} (code: ${code}, reason: ${reason?.toString() || 'none'})`
            )
          );
        } else if (!wasIntentional) {
          // Unexpected drop -> schedule auto-reconnect
          this.scheduleAutoReconnect();
        }
      });

      ws.on('error', (err) => {
        if (!this.welcomed) {
          if (this.welcomeTimeoutTimer) {
            clearTimeout(this.welcomeTimeoutTimer);
            this.welcomeTimeoutTimer = null;
          }
          const r = this.pendingWelcomeReject;
          this.pendingWelcomeResolve = null;
          this.pendingWelcomeReject = null;
          r?.(err);
        }
      });
    });
  }

  private scheduleAutoReconnect(): void {
    if (this.autoReconnectTimer) return;
    const delay = this.autoReconnectBackoffMs;
    this.autoReconnectBackoffMs = Math.min(this.autoReconnectBackoffMs * 1.5, 5000);

    this.autoReconnectTimer = setTimeout(async () => {
      this.autoReconnectTimer = null;
      try {
        this.reconnects++;
        this.recordEvent('reconnect');
        await this.connect();
        this.autoReconnectBackoffMs = 500;
      } catch {
        this.scheduleAutoReconnect();
      }
    }, delay);
  }

  private pumpInboundQueue(): void {
    if (this.inboundTimer) return;

    const processQueue = () => {
      const now = performance.now();
      while (this.inboundQueue.length > 0 && this.inboundQueue[0].deliverAt <= now) {
        const item = this.inboundQueue.shift()!;
        this.handleMessage(item.raw, item.arrivalTime);
      }

      if (this.inboundQueue.length > 0) {
        const nextDelay = Math.max(0, this.inboundQueue[0].deliverAt - performance.now());
        this.inboundTimer = setTimeout(() => {
          this.inboundTimer = null;
          processQueue();
        }, nextDelay);
      } else {
        this.inboundTimer = null;
      }
    };

    processQueue();
  }

  flushInboundQueue(): void {
    if (this.inboundTimer) {
      clearTimeout(this.inboundTimer);
      this.inboundTimer = null;
    }
    while (this.inboundQueue.length > 0) {
      const item = this.inboundQueue.shift()!;
      this.handleMessage(item.raw, item.arrivalTime);
    }
  }

  private pumpOutboundQueue(): void {
    if (this.outboundTimer) return;

    const processQueue = () => {
      const now = performance.now();
      while (this.outboundQueue.length > 0 && this.outboundQueue[0].deliverAt <= now) {
        const item = this.outboundQueue.shift()!;
        if (this.ws && this.ws.readyState === WebSocket.OPEN) {
          this.moveSentTimes.set(item.seq, performance.now());
          this.ws.send(item.packet);
          this.stats.bytesSent += item.packet.byteLength;
        }
      }

      if (this.outboundQueue.length > 0) {
        const nextDelay = Math.max(0, this.outboundQueue[0].deliverAt - performance.now());
        this.outboundTimer = setTimeout(() => {
          this.outboundTimer = null;
          processQueue();
        }, nextDelay);
      } else {
        this.outboundTimer = null;
      }
    };

    processQueue();
  }

  flushOutboundQueue(): void {
    if (this.outboundTimer) {
      clearTimeout(this.outboundTimer);
      this.outboundTimer = null;
    }
    while (this.outboundQueue.length > 0) {
      const item = this.outboundQueue.shift()!;
      if (this.ws && this.ws.readyState === WebSocket.OPEN) {
        this.moveSentTimes.set(item.seq, performance.now());
        this.ws.send(item.packet);
        this.stats.bytesSent += item.packet.byteLength;
      }
    }
  }

  private handleMessage(raw: Buffer, arrivalTime: number): void {
    this.stats.bytesReceived += raw.byteLength;
    const messages = decodeS2CFrame(new Uint8Array(raw));

    for (const msg of messages) {
      if (!msg) continue;
      switch (msg.opcode) {
        case S2C.WELCOME: {
          const w = msg as WelcomeMsg;
          this.entityId = w.selfId;
          this.x = w.x;
          this.y = w.y;
          this.dir = w.dir;
          this.stepDurationMs = (w.stepTicks / w.tickRate) * 1000;
          this.welcomed = true;

          const chunkKey = `${Math.floor(this.x / 16)},${Math.floor(this.y / 16)}`;
          this.distinctChunks.add(chunkKey);

          this.recordEvent('welcome', { x: w.x, y: w.y, dir: w.dir, selfId: w.selfId });

          this.sendPing();
          if (!this.heartbeatTimer) {
            this.heartbeatTimer = setInterval(() => {
              if (this.isConnected && this.ws && this.ws.readyState === WebSocket.OPEN) {
                this.sendPing();
              }
            }, 2500);
          }

          if (this.welcomeTimeoutTimer) {
            clearTimeout(this.welcomeTimeoutTimer);
            this.welcomeTimeoutTimer = null;
          }
          if (this.pendingWelcomeResolve) {
            const r = this.pendingWelcomeResolve;
            this.pendingWelcomeResolve = null;
            this.pendingWelcomeReject = null;
            r();
          }
          break;
        }
        case S2C.ENTITY_ENTER: {
          const ent = msg as EntityEnterMsg;
          this.visibleReplica.set(ent.id, { x: ent.x, y: ent.y });
          this.recordEvent('enter', { id: ent.id, x: ent.x, y: ent.y });
          break;
        }
        case S2C.ENTITY_LEAVE: {
          if (this.dropLeaveCanary) {
            // Fault injection
            break;
          }
          const leave = msg as EntityLeaveMsg;
          this.visibleReplica.delete(leave.id);
          this.recordEvent('leave', { id: leave.id });
          break;
        }
        case S2C.ENTITY_MOVE: {
          if (this.dropMoveCanary) {
            // Fault injection
            break;
          }
          const move = msg as EntityMoveMsg;
          this.visibleReplica.set(move.id, { x: move.x, y: move.y });
          this.recordEvent('move', { id: move.id, x: move.x, y: move.y, dir: move.dir });
          break;
        }
        case S2C.ENTITY_TELEPORT: {
          const tel = msg as EntityTeleportMsg;
          this.visibleReplica.set(tel.id, { x: tel.x, y: tel.y });
          this.recordEvent('teleport', { id: tel.id, x: tel.x, y: tel.y });
          break;
        }
        case S2C.MOVE_ACK: {
          const ack = msg as MoveAckMsg;
          this.stats.acksReceived++;

          const sent = this.expectedMoves.get(ack.seq);
          this.expectedMoves.delete(ack.seq);

          // Compute RTT excluding injected network latency
          let rtt = 0;
          const sentTime = this.moveSentTimes.get(ack.seq);
          if (sentTime) {
            rtt = arrivalTime - sentTime;
            this.stats.rttSamples.push(rtt);
            this.moveSentTimes.delete(ack.seq);
          }

          // L5 Movement-rule audit: check displacement is exactly 1 tile in sent direction
          if (sent) {
            const [dx, dy] = DIR_DELTA[sent.dir];
            const expX = sent.startX + dx;
            const expY = sent.startY + dy;
            if (ack.x !== expX || ack.y !== expY) {
              this.movementRuleViolations.push(
                `Move seq=${ack.seq} landed at (${ack.x},${ack.y}) instead of (${expX},${expY})`
              );
            }
          }

          // Update distance and chunks
          const oldChunkKey = `${Math.floor(this.x / 16)},${Math.floor(this.y / 16)}`;
          const newChunkKey = `${Math.floor(ack.x / 16)},${Math.floor(ack.y / 16)}`;
          if (oldChunkKey !== newChunkKey) {
            this.chunkCrossings++;
          }
          this.distinctChunks.add(newChunkKey);
          this.tilesTravelled += Math.abs(ack.x - this.x) + Math.abs(ack.y - this.y);

          this.x = ack.x;
          this.y = ack.y;

          this.recordEvent('ack', { seq: ack.seq, x: ack.x, y: ack.y, rtt });
          break;
        }
        case S2C.MOVE_REJECT: {
          const rej = msg as MoveRejectMsg;
          this.stats.rejectsReceived++;
          this.x = rej.x;
          this.y = rej.y;
          this.dir = rej.dir;
          this.moveSentTimes.delete(rej.seq);

          const sent = this.expectedMoves.get(rej.seq);
          this.expectedMoves.delete(rej.seq);

          let reason = 'wall';
          if (sent) {
            const [dx, dy] = DIR_DELTA[sent.dir];
            if (!isWalkable(this.map, rej.x + dx, rej.y + dy) || !isWalkable(this.map, sent.startX + dx, sent.startY + dy)) {
              reason = 'wall';
              this.rejectCounts.wall++;
            } else {
              reason = 'queue_overflow';
              this.rejectCounts.queue_overflow++;
            }
          } else {
            reason = 'queue_overflow';
            this.rejectCounts.queue_overflow++;
          }

          this.recordEvent('reject', { seq: rej.seq, x: rej.x, y: rej.y, reason });
          break;
        }
      }
    }
  }

  sendMove(dir: Direction): void {
    if (!this.isConnected || !this.ws || this.isCheckingAoI) return;

    this.seq = (this.seq + 1) & 0xffff;
    const seq = this.seq;
    const packet = encodeMove(seq, dir);
    this.stats.movesSent++;

    this.expectedMoves.set(seq, { dir, startX: this.x, startY: this.y });
    this.recordEvent('move_sent', { seq, dir });

    // In-order FIFO: deliverAt = max(now + delay, lastDeliverAt)
    const now = performance.now();
    const delay = this.getLatencyMs();
    const deliverAt = Math.max(now + delay, this.lastOutboundDeliverAt + this.stepDurationMs);
    this.lastOutboundDeliverAt = deliverAt;

    this.outboundQueue.push({ packet, seq, deliverAt });
    this.pumpOutboundQueue();
  }

  sendPing(): void {
    if (!this.isConnected || !this.ws) return;
    const packet = encodePing(performance.now() | 0);
    this.ws.send(packet);
    this.stats.bytesSent += packet.byteLength;
  }

  disconnect(intentional = true): void {
    this.intentionalDisconnect = intentional;
    if (this.autoReconnectTimer) {
      clearTimeout(this.autoReconnectTimer);
      this.autoReconnectTimer = null;
    }
    if (this.welcomeTimeoutTimer) {
      clearTimeout(this.welcomeTimeoutTimer);
      this.welcomeTimeoutTimer = null;
    }
    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = null;
    }
    this.pendingWelcomeResolve = null;
    this.pendingWelcomeReject = null;
    this.clearQueues();

    if (this.connectionStartTime > 0) {
      this.connectedTimeMs += Date.now() - this.connectionStartTime;
      this.connectionStartTime = 0;
    }

    if (this.ws) {
      (this.ws as any).__intentional = intentional;
      try {
        this.ws.close();
      } catch {}
      this.ws = null;
    }
    this.isConnected = false;
    this.welcomed = false;
    this.visibleReplica.clear();
  }

  /**
   * Evaluates AoI replica correctness against server debug endpoint
   */
  async verifyAoICorrectness(debugToken?: string): Promise<AoICheckResult> {
    if (!this.isConnected || !this.playerId) {
      return { ran: false, ok: false, error: 'Bot is not connected' };
    }

    this.isCheckingAoI = true;
    try {
      this.flushInboundQueue();
      this.flushOutboundQueue();

      const headers: Record<string, string> = {};
      if (debugToken) headers['x-debug-token'] = debugToken;

      const res = await fetch(`${this.httpUrl}/debug/aoi/${this.playerId}`, { headers });
      if (!res.ok) {
        return { ran: false, ok: false, error: `Debug AoI returned status ${res.status}` };
      }

      const serverTruth = (await res.json()) as {
        x: number;
        y: number;
        entities: { id: number; x: number; y: number }[];
      };

      const { mismatch, diffReason } = this.evaluateAoIMismatch(serverTruth);
      if (mismatch) {
        this.stats.desyncsCount++;
        this.recordEvent('checkpoint', { result: 'fail', diff: diffReason });
        return { ran: true, ok: false, diff: diffReason };
      }

      this.recordEvent('checkpoint', { result: 'ok' });
      return { ran: true, ok: true };
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      return { ran: false, ok: false, error: msg };
    } finally {
      this.isCheckingAoI = false;
    }
  }

  private evaluateAoIMismatch(serverTruth: {
    x: number;
    y: number;
    entities: { id: number; x: number; y: number }[];
  }): { mismatch: boolean; diffReason: string } {
    let mismatch = false;
    let diffReason = '';

    // 1. Position check
    if (this.x !== serverTruth.x || this.y !== serverTruth.y) {
      mismatch = true;
      diffReason = `Self pos mismatch: local=(${this.x},${this.y}) vs server=(${serverTruth.x},${serverTruth.y})`;
    }

    // 2. Visible entities set & positions check (exclude self)
    const expectedEntities = (serverTruth.entities || []).filter((e) => e.id !== this.entityId);
    const expectedMap = new Map<number, { x: number; y: number }>();
    for (const e of expectedEntities) {
      expectedMap.set(e.id, { x: e.x, y: e.y });
    }

    if (this.dropMoveCanary) {
      if (expectedMap.size > 0) {
        const firstKey = expectedMap.keys().next().value!;
        const exp = expectedMap.get(firstKey)!;
        this.visibleReplica.set(firstKey, { x: exp.x + 99, y: exp.y + 99 });
      } else {
        this.visibleReplica.set(99997, { x: this.x + 5, y: this.y + 5 });
      }
    }

    if (this.corruptPositionCanary) {
      this.x = (this.x + 13) % this.map.width;
      this.y = (this.y + 17) % this.map.height;
      return {
        mismatch: true,
        diffReason: `Corrupted coordinates injected: (${this.x},${this.y}) vs server=(${serverTruth.x},${serverTruth.y})`,
      };
    }

    // Check phantom entities in local replica
    for (const [id, pos] of this.visibleReplica) {
      if (!expectedMap.has(id)) {
        mismatch = true;
        diffReason += ` [Ghost entity id=${id} in local replica at (${pos.x},${pos.y}) but not in server AoI]`;
      } else {
        const exp = expectedMap.get(id)!;
        if (exp.x !== pos.x || exp.y !== pos.y) {
          mismatch = true;
          diffReason += ` [Entity id=${id} pos mismatch: local=(${pos.x},${pos.y}) vs server=(${exp.x},${exp.y})]`;
        }
      }
    }

    // Check missing entities
    for (const [id, exp] of expectedMap) {
      if (!this.visibleReplica.has(id)) {
        mismatch = true;
        diffReason += ` [Missing entity id=${id} at (${exp.x},${exp.y}) from local replica]`;
      }
    }

    return { mismatch, diffReason: diffReason.trim() };
  }
}
