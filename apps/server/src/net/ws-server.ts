/**
 * apps/server/src/net/ws-server.ts
 *
 * WebSocket server handler.
 * Manages client connections, token bucket rate limiting, binary message decoding,
 * and entity lifecycle (connect, reconnect, ghosting, leave).
 */

import { WebSocketServer, type WebSocket } from "ws";
import type { IncomingMessage, Server as HttpServer } from "node:http";
import type { Logger } from "pino";
import {
  C2S,
  CLOSE_CODE,
  MAX_FRAME_SIZE,
  decodeC2SFrame,
  encodeWelcome,
  encodeEntityEnter,
  encodePong,
  encodeMoveReject,
  concatMessages,
  type MoveMsg,
  type PingMsg,
  type C2SJsonMsg,
} from "@heist/shared";
import type { Config } from "../config.js";
import type { Database } from "../persistence/interfaces.js";
import type { MetricsTracker } from "../metrics/metrics.js";
import type { World } from "../world/world.js";
import { ConnectionManager, type ClientConnection } from "./connection.js";
import { handleWorldAction } from "../world/interactions.js";

export class GameWsServer {
  private wss: WebSocketServer;
  private closing = false;
  private lifecycleTurn = Promise.resolve();

  /** One lifecycle operation per event-loop turn, so 40 durable presence writes
   * cannot starve movement timers in a single close/accept callback batch. */
  private yieldLifecycle(): Promise<void> {
    const turn = this.lifecycleTurn.then(
      () => new Promise<void>((resolve) => setImmediate(resolve)),
    );
    this.lifecycleTurn = turn;
    return turn;
  }

  constructor(
    httpServer: HttpServer,
    private world: World,
    public readonly connections: ConnectionManager,
    private database: Database,
    private config: Config,
    private metrics: MetricsTracker,
    private logger: Logger,
  ) {
    this.wss = new WebSocketServer({
      server: httpServer,
      path: "/ws",
      maxPayload: MAX_FRAME_SIZE,
    });

    this.wss.on("error", (err) => {
      this.logger.error({ err }, "WebSocket server error");
    });

    this.wss.on("connection", (ws, req) => {
      this.handleConnection(ws, req).catch((err) => {
        this.logger.error({ err }, "Unhandled WS connection error");
        ws.close(1011, "Internal server error");
      });
    });
  }

  private async handleConnection(
    ws: WebSocket,
    req: IncomingMessage,
  ): Promise<void> {
    if (this.closing) {
      ws.close(1001, "Server shutting down");
      return;
    }
    const url = new URL(req.url ?? "", "http://localhost");
    const token = url.searchParams.get("token");

    if (!token) {
      ws.close(CLOSE_CODE.INVALID_TOKEN, "Missing session token");
      return;
    }

    // 1. Authenticate token
    const session = await this.database.sessions.findByToken(token);
    if (!session) {
      ws.close(CLOSE_CODE.INVALID_TOKEN, "Invalid session token");
      return;
    }

    const player = await this.database.players.findById(session.playerId);
    if (!player) {
      ws.close(CLOSE_CODE.INVALID_TOKEN, "Player not found");
      return;
    }
    const staff=player.role==='admin'||player.role==='superadmin';
    if(staff)this.world.staffPlayers.add(player.id);else this.world.staffPlayers.delete(player.id);
    const capacityFull=()=>{
      const entities=[...this.world.getAllEntities()];
      return staff?entities.filter(e=>this.world.staffPlayers.has(e.playerId)).length>=4:entities.filter(e=>!this.world.staffPlayers.has(e.playerId)).length>=this.config.maxPlayers;
    };

    // Update session last_seen asynchronously
    this.database.sessions.updateLastSeen(token).catch(() => {});

    // 2. Check server capacity
    if (
      capacityFull() &&
      !this.world.getEntityByPlayerId(player.id)
    ) {
      ws.close(CLOSE_CODE.SERVER_FULL, "Server full");
      return;
    }

    // Complete asynchronous reads before replacing a session. The final attach is synchronous.
    const savedState = this.world.getEntityByPlayerId(player.id)
      ? null
      : await this.database.state.findByPlayerId(player.id);
    await this.yieldLifecycle();
    if (this.closing) {
      ws.close(1001, "Server shutting down");
      return;
    }
    if (ws.readyState !== ws.OPEN) return;
    if (
      capacityFull() &&
      !this.world.getEntityByPlayerId(player.id)
    ) {
      ws.close(CLOSE_CODE.SERVER_FULL, "Server full");
      return;
    }
    // 3. Check for existing active connection (reconnection / tab replacement)
    if (this.world.eventRuntime) {
      try {
        await this.world.eventRuntime.admit(player.id, player.username, player.role);
      } catch (error) {
        const reason =
          error instanceof Error
            ? error.message
            : "Event enrollment unavailable";
        // Logged because this is the one refusal with no other trace. A player
        // turned away here sees only a close code, and the organizer had no way
        // to tell a closed registration from a full server.
        this.logger.warn(
          { playerId: player.id, username: player.username, reason },
          "Refused event enrollment",
        );
        ws.close(CLOSE_CODE.SERVER_FULL, reason);
        return;
      }
    }
    const existingConn = this.connections.getByPlayerId(player.id);
    if(this.closing||ws.readyState!==ws.OPEN){if(!this.closing)await this.world.eventRuntime?.offline(player.id);return;}
    if (existingConn) {
      this.logger.info(
        { playerId: player.id },
        "Replacing existing active connection",
      );
      existingConn.close(CLOSE_CODE.REPLACED, "Replaced by newer connection");
      this.connections.remove(existingConn);
    }

    // 4. Create or resume entity
    const existingEntity = this.world.getEntityByPlayerId(player.id);
    const isResume = existingEntity !== undefined;

    const entity = this.world.createOrResumeEntity(
      player.id,
      player.username,
      savedState,
    );

    // 5. Build ClientConnection
    const conn: ClientConnection = {
      id: Math.random().toString(36).slice(2, 10),
      playerId: player.id,
      username: player.username,
      role: player.role??'player',
      ws,
      entityId: entity.id,
      outbox: [],
      tokens: this.config.msgBurst,
      lastTokenRefill: Date.now(),
      violationsCount: 0,
      lastHeartbeat: Date.now(),
      backpressureStallSince: null,
      send(data: Uint8Array) {
        if (ws.readyState === ws.OPEN) {
          const buf = Buffer.isBuffer(data)
            ? data
            : Buffer.from(data.buffer, data.byteOffset, data.byteLength);
          ws.send(buf, { binary: true });
        }
      },
      close(code?: number, reason?: string) {
        try {
          ws.close(code, reason);
        } catch {}
      },
    };

    this.connections.add(conn);

    // 6. Send WELCOME + initial visible entities to connecting player
    const welcomeMsg = encodeWelcome(
      entity.id,
      entity.x,
      entity.y,
      entity.dir,
      this.config.tickRate,
      this.config.stepTicks,
      this.world.map.version,
      this.world.tick,
    );
    conn.outbox.push(welcomeMsg);
    this.world.eventRuntime?.sendState(conn);

    // Send ENTITY_ENTER for all currently visible entities
    const visibleEntities = this.world.getVisibleEntities(entity);
    for (const other of visibleEntities) {
      if (other.id !== entity.id) {
        conn.outbox.push(
          encodeEntityEnter(other.id, other.x, other.y, other.dir, other.name),
        );
      }
    }

    // If brand new entity, broadcast ENTITY_ENTER to watchers
    if (!isResume) {
      const enterMsg = encodeEntityEnter(
        entity.id,
        entity.x,
        entity.y,
        entity.dir,
        entity.name,
      );
      const watcherIds = this.world.chunkGrid.getEntitiesInAoI(entity.chunk);
      for (const watcherId of watcherIds) {
        if (watcherId !== entity.id) {
          const watcherConn = this.connections.get(watcherId);
          if (watcherConn) watcherConn.outbox.push(enterMsg);
        }
      }
    }

    // Immediately flush initial frame
    if (conn.outbox.length > 0) {
      const initialFrame = concatMessages(conn.outbox);
      conn.send(initialFrame);
      this.metrics.recordBytesOut(initialFrame.byteLength);
      this.metrics.recordFlush(conn.outbox.length);
      conn.outbox = [];
    }

    // 7. Wire socket event handlers
    ws.on("message", (rawData: Buffer | ArrayBuffer) => {
      this.handleSocketMessage(conn, rawData);
    });

    ws.on("close", () => {
      this.handleSocketClose(conn);
    });

    ws.on("error", (err) => {
      this.logger.warn({ err, entityId: conn.entityId }, "WebSocket error");
      this.handleSocketClose(conn);
    });
  }

  private handleSocketMessage(
    conn: ClientConnection,
    rawData: Buffer | ArrayBuffer,
  ): void {
    const data =
      rawData instanceof Buffer
        ? new Uint8Array(rawData.buffer, rawData.byteOffset, rawData.byteLength)
        : new Uint8Array(rawData);
    this.metrics.recordMsgIn(data.byteLength);

    if (data.byteLength > MAX_FRAME_SIZE) {
      this.metrics.malformedMessages++;
      conn.close(CLOSE_CODE.RATE_LIMIT, "Frame size exceeded limit");
      return;
    }

    // Token bucket rate limiting
    const now = Date.now();
    conn.lastHeartbeat = now;
    const elapsedSec = (now - conn.lastTokenRefill) / 1000;
    conn.tokens = Math.min(
      this.config.msgBurst,
      conn.tokens + elapsedSec * this.config.msgRatePerSec,
    );
    conn.lastTokenRefill = now;

    if (conn.tokens < 1) {
      this.metrics.rateLimitDrops++;
      conn.violationsCount++;
      if (conn.violationsCount > 15) {
        this.logger.warn(
          { entityId: conn.entityId },
          "Kicking client for sustained message rate violation",
        );
        conn.close(CLOSE_CODE.RATE_LIMIT, "Rate limit exceeded");
      }
      return;
    }

    conn.tokens -= 1;
    conn.violationsCount = Math.max(0, conn.violationsCount - 0.05);

    // Decode binary messages in frame
    let messages;
    try {
      messages = decodeC2SFrame(data);
    } catch {
      this.metrics.malformedMessages++;
      return;
    }

    this.metrics.recordDecodedMessages(messages.filter(Boolean).length);
    for (const msg of messages) {
      if (!msg) {
        this.metrics.malformedMessages++;
        continue;
      }
      if (msg.opcode === C2S.MOVE) {
        const move = msg as MoveMsg;
        if (move.dir < 0 || move.dir > 3) {
          this.metrics.malformedMessages++;
          continue;
        }
        const queued = this.world.queueMove(conn.entityId, move.seq, move.dir);
        if (!queued) {
          // Queue full: immediate reject with authoritative position
          const entity = this.world.getEntity(conn.entityId);
          if (entity) {
            conn.outbox.push(
              encodeMoveReject(move.seq, entity.x, entity.y, entity.dir),
            );
          }
        }
      } else if (msg.opcode === C2S.PING) {
        const ping = msg as PingMsg;
        conn.outbox.push(encodePong(ping.clientTime, this.world.tick));
      } else if (msg.opcode === C2S.JSON) {
        handleWorldAction(
          this.world,
          this.connections,
          conn,
          (msg as C2SJsonMsg).payload,
        );
      }
    }
  }

  private handleSocketClose(conn: ClientConnection): void {
    if (this.connections.get(conn.entityId) !== conn) {
      // Connection was already replaced by a newer connection
      return;
    }
    this.connections.remove(conn);
    const entity = this.world.getEntity(conn.entityId);
    if (entity) {
      entity.pending.length = 0;
      entity.connected = false;
      entity.disconnectedAt = Date.now();
      this.logger.debug(
        { id: entity.id, name: entity.name },
        "Entity marked as disconnected ghost",
      );
    }
    const disconnectedAt = Date.now();
    void this.yieldLifecycle()
      .then(() => {
        if (this.closing) return;
        // A new session may have resumed/replaced this socket before its turn.
        if (!this.connections.getByPlayerId(conn.playerId))
          void this.world.eventRuntime?.offline(conn.playerId, disconnectedAt).catch(()=>this.logger.error('Presence authority unavailable'));
      })
      .catch((err) =>
        this.logger.error(
          { err, playerId: conn.playerId },
          "Presence persistence failed",
        ),
      );
  }

  close(): void {
    this.closing = true;
    for (const ws of this.wss.clients) {
      try {
        ws.terminate();
      } catch {}
    }
    this.wss.close();
  }
}
