/**
 * Real WebSocket-based GameBackend implementation.
 * Follows AGENTS.md and FRONTEND_CONTRACT.md Sections 3-7.
 */

import {
  decodeS2CFrame,
  encodeMove,
  encodePing,
  encodeC2SJson,
  S2C,
  CLOSE_CODE,
  type Direction,
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
import { getWsBaseUrl } from './api.js';
import { TypedEventBus } from './events.js';

export type ConnectionState =
  | 'DISCONNECTED'
  | 'CONNECTING'
  | 'CONNECTED'
  | 'RECONNECTING';

export interface ConnectionStatusInfo {
  state: ConnectionState;
  reconnectAttempt?: number;
  nextDelayMs?: number;
  closeCode?: number;
  closeReason?: string;
}

export interface BackendCallbacks {
  onWelcome: (msg: WelcomeMsg) => void;
  onEntityEnter: (msg: EntityEnterMsg) => void;
  onEntityLeave: (msg: EntityLeaveMsg) => void;
  onEntityMove: (msg: EntityMoveMsg) => void;
  onMoveAck: (msg: MoveAckMsg) => void;
  onMoveReject: (msg: MoveRejectMsg) => void;
  onPong: (rttMs: number, serverTick: number) => void;
  onKick: (msg: KickMsg) => void;
  onTeleport: (msg: EntityTeleportMsg) => void;
  onJsonMessage: (payload: unknown) => void;
  onStatusChange: (status: ConnectionStatusInfo) => void;
  onCloseCode: (code: number, reason: string) => void;
}

export interface GameBackend {
  connect(token: string): void;
  disconnect(): void;
  sendMove(seq: number, dir: Direction): void;
  sendJson(payload: unknown): void;
  isConnected(): boolean;
}

const BACKOFF_DELAYS = [500, 1000, 2000, 4000, 5000] as const;

export class RealBackend implements GameBackend {
  private ws: WebSocket | null = null;
  private token: string | null = null;
  private pingIntervalId: number | null = null;
  private reconnectTimeoutId: number | null = null;
  private backoffIndex = 0;
  private intentionalDisconnect = false;
  public readonly eventBus = new TypedEventBus();

  constructor(private callbacks: BackendCallbacks) {}

  connect(token: string): void {
    if (this.reconnectTimeoutId !== null) {
      clearTimeout(this.reconnectTimeoutId);
      this.reconnectTimeoutId = null;
    }
    this.token = token;
    this.intentionalDisconnect = false;
    this.backoffIndex = 0;
    this.establishConnection();
  }

  private establishConnection(): void {
    if (!this.token) return;

    if (this.ws) {
      try {
        this.ws.close();
      } catch {}
      this.ws = null;
    }

    this.callbacks.onStatusChange({
      state: this.backoffIndex === 0 ? 'CONNECTING' : 'RECONNECTING',
      reconnectAttempt: this.backoffIndex,
    });

    const url = `${getWsBaseUrl()}?token=${encodeURIComponent(this.token)}`;
    const ws = new WebSocket(url);
    ws.binaryType = 'arraybuffer';

    ws.onopen = () => {
      if (this.ws !== ws) return;
      this.startHeartbeat();
    };

    ws.onmessage = (event: MessageEvent<ArrayBuffer>) => {
      if (this.ws !== ws) return;
      this.handleIncomingFrame(new Uint8Array(event.data));
    };

    ws.onclose = (event: CloseEvent) => {
      if (this.ws !== ws) return;
      this.handleSocketClose(event.code, event.reason);
    };

    ws.onerror = (err) => {
      console.warn('[RealBackend] WebSocket error event encountered:', err);
    };

    this.ws = ws;
  }

  private handleIncomingFrame(data: Uint8Array): void {
    let messages;
    try {
      messages = decodeS2CFrame(data);
    } catch (err) {
      console.error('[RealBackend] Failed to decode incoming binary frame:', err);
      return;
    }

    for (const msg of messages) {
      if (!msg) continue;
      switch (msg.opcode) {
        case S2C.WELCOME:
          this.backoffIndex = 0;
          this.callbacks.onStatusChange({ state: 'CONNECTED' });
          this.callbacks.onWelcome(msg as WelcomeMsg);
          break;
        case S2C.ENTITY_ENTER:
          this.callbacks.onEntityEnter(msg as EntityEnterMsg);
          break;
        case S2C.ENTITY_LEAVE:
          this.callbacks.onEntityLeave(msg as EntityLeaveMsg);
          break;
        case S2C.ENTITY_MOVE:
          this.callbacks.onEntityMove(msg as EntityMoveMsg);
          break;
        case S2C.MOVE_ACK:
          this.callbacks.onMoveAck(msg as MoveAckMsg);
          break;
        case S2C.MOVE_REJECT:
          this.callbacks.onMoveReject(msg as MoveRejectMsg);
          break;
        case S2C.PONG: {
          const pong = msg as PongMsg;
          const now = performance.now() | 0;
          const rtt = Math.max(0, now - pong.clientTime);
          this.callbacks.onPong(rtt, pong.serverTick);
          break;
        }
        case S2C.JSON: {
          const jsonMsg = msg as S2CJsonMsg;
          let parsed: unknown = jsonMsg.payload;
          try {
            parsed = JSON.parse(jsonMsg.payload);
          } catch {
            // Keep raw string payload
          }
          this.eventBus.emit(parsed);
          this.callbacks.onJsonMessage(parsed);
          break;
        }
        case S2C.KICK: {
          const kick = msg as KickMsg;
          this.callbacks.onKick(kick);
          break;
        }
        case S2C.ENTITY_TELEPORT:
          this.callbacks.onTeleport(msg as EntityTeleportMsg);
          break;
      }
    }
  }

  private handleSocketClose(code: number, reason: string): void {
    this.stopHeartbeat();
    this.callbacks.onCloseCode(code, reason);

    if (this.intentionalDisconnect) {
      this.callbacks.onStatusChange({ state: 'DISCONNECTED', closeCode: code, closeReason: reason });
      return;
    }

    // Evaluate close code policies per AGENTS.md
    switch (code) {
      case 1000: // Normal closure
        this.callbacks.onStatusChange({ state: 'DISCONNECTED', closeCode: code, closeReason: reason });
        break;

      case CLOSE_CODE.INVALID_TOKEN: // 4001: Clear token and go to login; do not auto-reconnect
        try {
          sessionStorage.removeItem('heist_session_token');
        } catch {}
        this.token = null;
        this.callbacks.onStatusChange({ state: 'DISCONNECTED', closeCode: code, closeReason: reason });
        break;

      case CLOSE_CODE.REPLACED: // 4002: Session opened in another window; do not auto-reconnect
        this.callbacks.onStatusChange({ state: 'DISCONNECTED', closeCode: code, closeReason: reason });
        break;

      case CLOSE_CODE.RATE_LIMIT: // 4003: Throttle and auto-reconnect
        this.scheduleReconnect(code, reason);
        break;

      case CLOSE_CODE.SERVER_FULL: // 4004: Server full, retry later; do not auto-reconnect
        this.callbacks.onStatusChange({ state: 'DISCONNECTED', closeCode: code, closeReason: reason });
        break;

      case CLOSE_CODE.HEARTBEAT_TIMEOUT: // 4005
      case 1006: // Abnormal closure (server crash / network drop)
      default:
        this.scheduleReconnect(code, reason);
        break;
    }
  }

  private scheduleReconnect(code: number, reason: string): void {
    if (this.reconnectTimeoutId !== null) return;

    const delay = BACKOFF_DELAYS[Math.min(this.backoffIndex, BACKOFF_DELAYS.length - 1)];
    this.backoffIndex = Math.min(this.backoffIndex + 1, BACKOFF_DELAYS.length - 1);

    this.callbacks.onStatusChange({
      state: 'RECONNECTING',
      reconnectAttempt: this.backoffIndex,
      nextDelayMs: delay,
      closeCode: code,
      closeReason: reason,
    });

    this.reconnectTimeoutId = window.setTimeout(() => {
      this.reconnectTimeoutId = null;
      this.establishConnection();
    }, delay);
  }

  private startHeartbeat(): void {
    this.stopHeartbeat();
    // Rule: PING every 2500ms
    this.pingIntervalId = window.setInterval(() => {
      const clientTime = performance.now() | 0;
      this.send(encodePing(clientTime));
    }, 2500);
  }

  private stopHeartbeat(): void {
    if (this.pingIntervalId !== null) {
      clearInterval(this.pingIntervalId);
      this.pingIntervalId = null;
    }
  }

  sendMove(seq: number, dir: Direction): void {
    this.send(encodeMove(seq, dir));
  }

  sendJson(payload: unknown): void {
    const serialized = typeof payload === 'string' ? payload : JSON.stringify(payload);
    this.send(encodeC2SJson(serialized));
  }

  private send(data: Uint8Array): void {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(data);
    }
  }

  isConnected(): boolean {
    return this.ws !== null && this.ws.readyState === WebSocket.OPEN;
  }

  disconnect(): void {
    this.intentionalDisconnect = true;
    this.stopHeartbeat();
    if (this.reconnectTimeoutId !== null) {
      clearTimeout(this.reconnectTimeoutId);
      this.reconnectTimeoutId = null;
    }
    if (this.ws) {
      try {
        this.ws.close(1000, 'Client disconnected');
      } catch {}
      this.ws = null;
    }
    this.callbacks.onStatusChange({ state: 'DISCONNECTED', closeCode: 1000 });
  }
}

export class MockBackend implements GameBackend {
  private connected = false;

  constructor(private callbacks?: BackendCallbacks) {}

  connect(_token: string): void {
    this.connected = true;
    this.callbacks?.onStatusChange({ state: 'CONNECTED' });
  }

  disconnect(): void {
    this.connected = false;
    this.callbacks?.onStatusChange({ state: 'DISCONNECTED' });
  }

  sendMove(_seq: number, _dir: Direction): void {}

  sendJson(_payload: unknown): void {}

  isConnected(): boolean {
    return this.connected;
  }
}
