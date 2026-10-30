/**
 * apps/server/src/world/tick.ts
 *
 * Fixed-timestep, drift-corrected authoritative game loop (20 Hz / 50ms).
 * Strictly NO I/O, NO awaits, NO DB queries inside the tick loop.
 */

import type { Logger } from 'pino';
import {
  tryStep,
  chunkOf,
  neighbours3x3,
  aoiDiff,
  sameChunk,
  encodeMoveAck,
  encodeMoveReject,
  encodeEntityMove,
  encodeEntityEnter,
  encodeEntityLeave,
  concatMessages,
  CLOSE_CODE,
} from '@heist/shared';
import type { Config } from '../config.js';
import type { MetricsTracker } from '../metrics/metrics.js';
import type { Snapshotter } from '../persistence/snapshotter.js';
import type { ConnectionManager } from '../net/connection.js';
import type { World } from './world.js';
import type { Entity } from './entity.js';

export class TickLoop {
  private running = false;
  private timer: NodeJS.Timeout | null = null;
  private lastNs = 0n;
  private accumulatorNs = 0n;
  private readonly tickIntervalNs: bigint;

  constructor(
    private world: World,
    private connections: ConnectionManager,
    private config: Config,
    private metrics: MetricsTracker,
    private snapshotter: Snapshotter,
    private logger: Logger
  ) {
    this.tickIntervalNs = BigInt(Math.round(1_000_000_000 / config.tickRate));
  }

  start(): void {
    if (this.running) return;
    this.running = true;
    this.lastNs = process.hrtime.bigint();
    this.accumulatorNs = 0n;
    this.scheduleNext();
  }

  stop(): void {
    this.running = false;
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
  }

  private scheduleNext(): void {
    if (!this.running) return;

    // Use a short timeout to yield to the event loop, then process ticks
    this.timer = setTimeout(() => {
      this.step();
      this.scheduleNext();
    }, 1);
  }

  private step(): void {
    const currentNs = process.hrtime.bigint();
    let deltaNs = currentNs - this.lastNs;
    this.lastNs = currentNs;

    // Cap deltaNs to avoid spiral of death on severe pauses
    const maxDeltaNs = this.tickIntervalNs * 5n;
    if (deltaNs > maxDeltaNs) {
      deltaNs = maxDeltaNs;
    }

    this.accumulatorNs += deltaNs;

    let catchUp = 0;
    while (this.accumulatorNs >= this.tickIntervalNs) {
      if (catchUp >= 2) {
        // Spec: if behind, run at most 2 catch-up ticks, then skip and increment tickOverruns
        this.metrics.tickOverruns++;
        this.accumulatorNs = 0n;
        break;
      }

      this.executeTick();
      this.accumulatorNs -= this.tickIntervalNs;
      catchUp++;
    }
  }

  private executeTick(): void {
    const startNs = process.hrtime.bigint();
    this.world.tick++;

    // 1. Process movement for all entities ready for their next move
    for (const entity of this.world.getAllEntities()) {
      if (this.world.tick >= entity.nextMoveTick && entity.pending.length > 0) {
        this.processEntityMove(entity);
      }
    }

    // 2. Periodic house-keeping every ~20 ticks (1 second)
    if (this.world.tick % this.config.tickRate === 0) {
      this.performPeriodicChecks();
    }

    // 3. Flush outboxes to connections
    this.flushOutboxes();

    // 4. Record tick execution time
    const endNs = process.hrtime.bigint();
    const durationMs = Number(endNs - startNs) / 1_000_000;
    this.metrics.recordTick(durationMs);

    if (durationMs > 25) {
      this.logger.warn({ tick: this.world.tick, durationMs }, 'Tick duration exceeded 25ms threshold');
    }
  }

  private processEntityMove(entity: Entity): void {
    const move = entity.pending.shift()!;
    if (this.world.eventRuntime && !this.world.eventRuntime.canMove(entity.playerId)) {
      this.connections.get(entity.id)?.outbox.push(encodeMoveReject(move.seq,entity.x,entity.y,entity.dir));
      entity.pending.length=0;
      return;
    }
    const step = tryStep(this.world.map, entity.x, entity.y, move.dir);
    const conn = this.connections.get(entity.id);

    if (step.ok) {
      const oldChunk = entity.chunk;
      const newChunk = chunkOf(step.x, step.y, this.config.chunkSize);

      entity.x = step.x;
      entity.y = step.y;
      entity.dir = move.dir;
      entity.nextMoveTick = this.world.tick + this.config.stepTicks;
      entity.dirty = true;

      // 1. Send MOVE_ACK to the mover
      if (conn) {
        conn.outbox.push(encodeMoveAck(move.seq, entity.x, entity.y));
      }

      // 2. Check chunk boundaries
      if (sameChunk(oldChunk, newChunk)) {
        // Same chunk move: broadcast ENTITY_MOVE to all watchers except mover
        const moveMsg = encodeEntityMove(entity.id, entity.x, entity.y, entity.dir);
        this.broadcastToAoI(entity.chunk, moveMsg, entity.id);
      } else {
        // Chunk boundary crossed!
        this.world.chunkGrid.update(entity, newChunk);

        const { entered, left, stayed } = aoiDiff(oldChunk.cx, oldChunk.cy, newChunk.cx, newChunk.cy);

        // A. Update the Mover's view of other entities
        if (conn) {
          // Entities in chunks that mover left -> send ENTITY_LEAVE to mover
          for (const chunkKey of left) {
            for (const otherId of this.world.chunkGrid.getEntitiesInChunk(chunkKey)) {
              if (otherId !== entity.id) {
                conn.outbox.push(encodeEntityLeave(otherId));
              }
            }
          }
          // Entities in chunks that mover entered -> send ENTITY_ENTER to mover
          for (const chunkKey of entered) {
            for (const otherId of this.world.chunkGrid.getEntitiesInChunk(chunkKey)) {
              if (otherId !== entity.id) {
                const other = this.world.getEntity(otherId);
                if (other) {
                  conn.outbox.push(
                    encodeEntityEnter(other.id, other.x, other.y, other.dir, other.name)
                  );
                }
              }
            }
          }
        }

        // B. Update Other Players' view of the Mover
        // Players in chunks that lost sight of mover -> receive ENTITY_LEAVE(mover)
        if (left.length > 0) {
          const leaveMsg = encodeEntityLeave(entity.id);
          for (const chunkKey of left) {
            for (const watcherId of this.world.chunkGrid.getEntitiesInChunk(chunkKey)) {
              if (watcherId !== entity.id) {
                const watcherConn = this.connections.get(watcherId);
                if (watcherConn) watcherConn.outbox.push(leaveMsg);
              }
            }
          }
        }

        // Players in chunks that newly gained sight of mover -> receive ENTITY_ENTER(mover)
        if (entered.length > 0) {
          const enterMsg = encodeEntityEnter(entity.id, entity.x, entity.y, entity.dir, entity.name);
          for (const chunkKey of entered) {
            for (const watcherId of this.world.chunkGrid.getEntitiesInChunk(chunkKey)) {
              if (watcherId !== entity.id) {
                const watcherConn = this.connections.get(watcherId);
                if (watcherConn) watcherConn.outbox.push(enterMsg);
              }
            }
          }
        }

        // Players in chunks that could see mover before and after -> receive ENTITY_MOVE(mover)
        if (stayed.length > 0) {
          const moveMsg = encodeEntityMove(entity.id, entity.x, entity.y, entity.dir);
          for (const chunkKey of stayed) {
            for (const watcherId of this.world.chunkGrid.getEntitiesInChunk(chunkKey)) {
              if (watcherId !== entity.id) {
                const watcherConn = this.connections.get(watcherId);
                if (watcherConn) watcherConn.outbox.push(moveMsg);
              }
            }
          }
        }
      }
    } else {
      // Movement blocked by map collision: send MOVE_REJECT, no cooldown
      if (conn) {
        conn.outbox.push(encodeMoveReject(move.seq, entity.x, entity.y, entity.dir));
      }
    }
  }

  /**
   * Broadcast a message to all players watching the given chunk, optionally excluding one ID.
   */
  private broadcastToAoI(chunkCoord: { cx: number; cy: number }, msg: Uint8Array, excludeId?: number): void {
    const nKeys = neighbours3x3(chunkCoord.cx, chunkCoord.cy);
    for (let i = 0; i < nKeys.length; i++) {
      const set = this.world.chunkGrid.getEntitiesInChunkRaw(nKeys[i]);
      if (set) {
        for (const watcherId of set) {
          if (watcherId !== excludeId) {
            const watcherConn = this.connections.get(watcherId);
            if (watcherConn) {
              watcherConn.outbox.push(msg);
            }
          }
        }
      }
    }
  }

  private flushOutboxes(): void {
    for (const conn of this.connections.getAll()) {
      if (conn.outbox.length === 0) continue;

      // Check backpressure threshold
      if (conn.ws.bufferedAmount > this.config.backpressureBytes) {
        this.metrics.backpressureEvents++;
        if (conn.backpressureStallSince === null) {
          conn.backpressureStallSince = Date.now();
        } else if (Date.now() - conn.backpressureStallSince > 5000) {
          this.logger.warn({ entityId: conn.entityId }, 'Client bufferedAmount stalled > 5s, dropping');
          conn.close(CLOSE_CODE.RATE_LIMIT, 'Backpressure threshold exceeded');
          continue;
        }
        // Skip flushing non-critical frames during buffer congestion
        conn.outbox = [];
        continue;
      }

      conn.backpressureStallSince = null;
      const frame = concatMessages(conn.outbox);
      conn.send(frame);
      this.metrics.recordBytesOut(frame.byteLength);
      this.metrics.recordFlush(conn.outbox.length);
      conn.outbox = [];
    }
  }

  private performPeriodicChecks(): void {
    const now = Date.now();

    // 1. Roll over per-second metrics
    this.metrics.rollSecond();

    // 2. Check connection heartbeats
    for (const conn of this.connections.getAll()) {
      if (now - conn.lastHeartbeat > this.config.heartbeatTimeoutMs) {
        this.logger.info({ entityId: conn.entityId }, 'Connection heartbeat timed out');
        conn.close(CLOSE_CODE.HEARTBEAT_TIMEOUT, 'Heartbeat timed out');
      }
    }

    // 3. Check ghost expiries
    for (const entity of this.world.getAllEntities()) {
      if (!entity.connected && entity.disconnectedAt !== undefined) {
        if (now - entity.disconnectedAt > this.config.ghostGraceMs) {
          this.logger.info({ id: entity.id, name: entity.name }, 'Ghost expired, finalizing removal');

          // Send ENTITY_LEAVE to watchers
          const leaveMsg = encodeEntityLeave(entity.id);
          this.broadcastToAoI(entity.chunk, leaveMsg, entity.id);

          // Queue state to snapshotter
          this.snapshotter.enqueue({
            playerId: entity.playerId,
            x: entity.x,
            y: entity.y,
            dir: entity.dir,
            data: JSON.stringify(entity.data),
            updatedAt: new Date(),
          });

          // Remove from world and quarantine ID
          this.world.removeEntity(entity.id);
        }
      }
    }
  }
}
