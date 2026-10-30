/**
 * apps/bots/src/tools/fault-proxy.ts
 *
 * WebSocket fault-injection proxy sitting between bots and the real server.
 * Implements Canary suite mutations (Section 9):
 * - C1: Drop every 5th ENTITY_LEAVE
 * - C2: Drop every 10th ENTITY_MOVE
 * - C3: Add +1 to x in ENTITY_MOVE
 * - C4: Drop MOVE_ACK for 2 designated bots
 * - C5: Close sockets with a bad close code on reconnect
 * - C6: Delay all frames by 2s for 3 designated bots
 */

import { WebSocketServer, WebSocket } from 'ws';
import {
  decodeS2CFrame,
  encodeWelcome,
  encodeEntityEnter,
  encodeEntityLeave,
  encodeEntityMove,
  encodeMoveAck,
  encodeMoveReject,
  encodePong,
  encodeS2CJson,
  encodeKick,
  encodeEntityTeleport,
  concatMessages,
  S2C,
  type WelcomeMsg,
  type EntityEnterMsg,
  type EntityLeaveMsg,
  type EntityMoveMsg,
  type MoveAckMsg,
  type MoveRejectMsg,
  type PongMsg,
  type S2CJsonMsg,
  type KickMsg,
  type EntityTeleportMsg,
} from '@heist/shared';

export type CanaryMode = 'none' | 'C1' | 'C2' | 'C3' | 'C4' | 'C5' | 'C6';

export interface FaultProxyOptions {
  port?: number;
  upstreamWsUrl: string;
  mode: CanaryMode;
}

export class FaultProxy {
  private wss: WebSocketServer | null = null;
  private mode: CanaryMode;
  private upstreamWsUrl: string;
  private clientConnections = new Set<WebSocket>();
  private upstreamSockets = new Set<WebSocket>();

  // State for mutations
  private leaveCounter = 0;
  private moveCounter = 0;
  private seenTokens = new Set<string>();
  private clientCounter = 0;
  private clientIndexMap = new Map<WebSocket, number>();

  public faultsInjectedCount = 0;
  public listenPort = 0;

  constructor(options: FaultProxyOptions) {
    this.mode = options.mode;
    this.upstreamWsUrl = options.upstreamWsUrl;
    this.listenPort = options.port || 0;
  }

  setMode(mode: CanaryMode): void {
    this.mode = mode;
    this.leaveCounter = 0;
    this.moveCounter = 0;
    this.faultsInjectedCount = 0;
    this.seenTokens.clear();
    this.clientCounter = 0;
    this.clientIndexMap.clear();
  }

  async start(): Promise<string> {
    return new Promise((resolve, reject) => {
      const server = new WebSocketServer({ port: this.listenPort });
      this.wss = server;

      server.on('listening', () => {
        const addr = server.address();
        this.listenPort = typeof addr === 'object' && addr ? addr.port : 8089;
        resolve(`ws://127.0.0.1:${this.listenPort}`);
      });

      server.on('error', (err) => reject(err));

      server.on('connection', (clientWs, req) => {
        const clientIdx = this.clientCounter++;
        this.clientIndexMap.set(clientWs, clientIdx);
        this.clientConnections.add(clientWs);

        const reqUrl = req.url || '/ws';
        // Extract token
        const match = reqUrl.match(/[?&]token=([^&]+)/);
        const token = match ? match[1] : '';

        // C5: Close sockets with bad close code on reconnect
        if (this.mode === 'C5' && token) {
          if (this.seenTokens.has(token)) {
            this.faultsInjectedCount++;
            console.log(`[FaultProxy:C5] Closing reconnected bot (token=${token.slice(0, 8)}...) with bad code 4099`);
            setTimeout(() => {
              try {
                clientWs.close(4099, 'Canary C5: Injected reconnect termination');
              } catch {}
            }, 50);
            return;
          }
          this.seenTokens.add(token);
        } else if (token) {
          this.seenTokens.add(token);
        }

        const upstreamTarget = `${this.upstreamWsUrl}${reqUrl}`;
        const upstreamWs = new WebSocket(upstreamTarget);
        this.upstreamSockets.add(upstreamWs);

        // Forward Client -> Upstream
        clientWs.on('message', (data: Buffer | ArrayBuffer) => {
          if (upstreamWs.readyState === WebSocket.OPEN) {
            upstreamWs.send(data);
          }
        });

        clientWs.on('close', (code, reason) => {
          this.clientConnections.delete(clientWs);
          this.clientIndexMap.delete(clientWs);
          if (upstreamWs.readyState === WebSocket.OPEN) {
            try {
              if (code && code >= 1000 && code < 5000 && code !== 1005 && code !== 1006 && code !== 1015) {
                upstreamWs.close(code, reason);
              } else {
                upstreamWs.close(1000);
              }
            } catch {
              upstreamWs.terminate();
            }
          }
        });

        clientWs.on('error', () => {
          try {
            upstreamWs.terminate();
          } catch {}
        });

        // Forward Upstream -> Client (with mutations)
        upstreamWs.on('message', (raw: Buffer) => {
          this.handleUpstreamMessage(clientWs, clientIdx, raw);
        });

        upstreamWs.on('close', (code, reason) => {
          this.upstreamSockets.delete(upstreamWs);
          if (clientWs.readyState === WebSocket.OPEN) {
            try {
              if (code && code >= 1000 && code < 5000 && code !== 1005 && code !== 1006 && code !== 1015) {
                clientWs.close(code, reason);
              } else {
                clientWs.close(1000);
              }
            } catch {
              clientWs.terminate();
            }
          }
        });

        upstreamWs.on('error', () => {
          try {
            clientWs.terminate();
          } catch {}
        });
      });
    });
  }

  private handleUpstreamMessage(clientWs: WebSocket, clientIdx: number, raw: Buffer): void {
    if (clientWs.readyState !== WebSocket.OPEN) return;

    // C6: Delay all frames by 2 s for 3 designated bots (clients 0, 1, 2)
    if (this.mode === 'C6' && clientIdx < 3) {
      this.faultsInjectedCount++;
      setTimeout(() => {
        if (clientWs.readyState === WebSocket.OPEN) {
          clientWs.send(raw);
        }
      }, 2000);
      return;
    }

    if (this.mode === 'none' || this.mode === 'C5' || this.mode === 'C6') {
      clientWs.send(raw);
      return;
    }

    // Decode S2C messages for frame mutation
    let messages;
    try {
      messages = decodeS2CFrame(new Uint8Array(raw));
    } catch {
      // If unable to decode, forward raw
      clientWs.send(raw);
      return;
    }

    const modifiedPackets: Uint8Array[] = [];

    for (const msg of messages) {
      if (!msg) continue;

      if (this.mode === 'C1' && msg.opcode === S2C.ENTITY_LEAVE) {
        this.leaveCounter++;
        if (this.leaveCounter % 5 === 0) {
          this.faultsInjectedCount++;
          // Drop ENTITY_LEAVE
          continue;
        }
      }

      if (this.mode === 'C2' && msg.opcode === S2C.ENTITY_MOVE) {
        this.moveCounter++;
        if (this.moveCounter % 10 === 0) {
          this.faultsInjectedCount++;
          // Drop ENTITY_MOVE
          continue;
        }
      }

      if (this.mode === 'C3' && msg.opcode === S2C.ENTITY_MOVE) {
        this.faultsInjectedCount++;
        const m = msg as EntityMoveMsg;
        modifiedPackets.push(encodeEntityMove(m.id, m.x + 1, m.y, m.dir));
        continue;
      }

      if (this.mode === 'C4' && clientIdx < 2 && msg.opcode === S2C.MOVE_ACK) {
        this.faultsInjectedCount++;
        // Drop MOVE_ACK for first 2 bots
        continue;
      }

      // Re-encode unmodified message
      switch (msg.opcode) {
        case S2C.WELCOME: {
          const w = msg as WelcomeMsg;
          modifiedPackets.push(
            encodeWelcome(w.selfId, w.x, w.y, w.dir, w.tickRate, w.stepTicks, w.mapVersion, w.serverTick)
          );
          break;
        }
        case S2C.ENTITY_ENTER: {
          const e = msg as EntityEnterMsg;
          modifiedPackets.push(encodeEntityEnter(e.id, e.x, e.y, e.dir, e.name));
          break;
        }
        case S2C.ENTITY_LEAVE: {
          const l = msg as EntityLeaveMsg;
          modifiedPackets.push(encodeEntityLeave(l.id));
          break;
        }
        case S2C.ENTITY_MOVE: {
          const m = msg as EntityMoveMsg;
          modifiedPackets.push(encodeEntityMove(m.id, m.x, m.y, m.dir));
          break;
        }
        case S2C.MOVE_ACK: {
          const a = msg as MoveAckMsg;
          modifiedPackets.push(encodeMoveAck(a.seq, a.x, a.y));
          break;
        }
        case S2C.MOVE_REJECT: {
          const r = msg as MoveRejectMsg;
          modifiedPackets.push(encodeMoveReject(r.seq, r.x, r.y, r.dir));
          break;
        }
        case S2C.PONG: {
          const p = msg as PongMsg;
          modifiedPackets.push(encodePong(p.clientTime, p.serverTick));
          break;
        }
        case S2C.JSON: {
          const j = msg as S2CJsonMsg;
          modifiedPackets.push(encodeS2CJson(j.payload));
          break;
        }
        case S2C.KICK: {
          const k = msg as KickMsg;
          modifiedPackets.push(encodeKick(k.reason));
          break;
        }
        case S2C.ENTITY_TELEPORT: {
          const t = msg as EntityTeleportMsg;
          modifiedPackets.push(encodeEntityTeleport(t.id, t.x, t.y, (t as any).dir ?? 1));
          break;
        }
      }
    }

    if (modifiedPackets.length > 0) {
      const outFrame = concatMessages(modifiedPackets);
      clientWs.send(outFrame);
    }
  }

  async close(): Promise<void> {
    for (const ws of this.clientConnections) {
      try {
        ws.terminate();
      } catch {}
    }
    this.clientConnections.clear();

    for (const ws of this.upstreamSockets) {
      try {
        ws.terminate();
      } catch {}
    }
    this.upstreamSockets.clear();

    if (this.wss) {
      await new Promise<void>((resolve) => this.wss!.close(() => resolve()));
      this.wss = null;
    }
  }
}
