/**
 * apps/server/src/net/connection.ts
 *
 * Per-WebSocket client connection state and token bucket rate limiter.
 */

import type { WebSocket } from 'ws';

export interface ClientConnection {
  readonly role?: import('@heist/shared').AccountRole;
  readonly id: string; // Connection ID
  readonly playerId: string;
  readonly username: string;
  readonly ws: WebSocket;
  entityId: number;

  // Outbox for batching messages in the tick
  outbox: Uint8Array[];

  // Token bucket rate limiter
  tokens: number;
  lastTokenRefill: number;
  violationsCount: number;

  // Heartbeat tracking
  lastHeartbeat: number;

  // Backpressure monitoring
  backpressureStallSince: number | null;

  send(data: Uint8Array): void;
  close(code?: number, reason?: string): void;
}

export class ConnectionManager {
  private connections = new Map<number, ClientConnection>(); // by entityId
  private connectionsByPlayer = new Map<string, ClientConnection>(); // by playerId

  add(conn: ClientConnection): void {
    this.connections.set(conn.entityId, conn);
    this.connectionsByPlayer.set(conn.playerId, conn);
  }

  remove(conn: ClientConnection): void {
    if (this.connections.get(conn.entityId) === conn) {
      this.connections.delete(conn.entityId);
    }
    if (this.connectionsByPlayer.get(conn.playerId) === conn) {
      this.connectionsByPlayer.delete(conn.playerId);
    }
  }

  get(entityId: number): ClientConnection | undefined {
    return this.connections.get(entityId);
  }

  getByPlayerId(playerId: string): ClientConnection | undefined {
    return this.connectionsByPlayer.get(playerId);
  }

  rebind(entityId: number, conn: ClientConnection): void {
    this.connections.set(entityId, conn);
    this.connectionsByPlayer.set(conn.playerId, conn);
  }

  getAll(): IterableIterator<ClientConnection> {
    return this.connections.values();
  }

  get count(): number {
    return this.connections.size;
  }
}
