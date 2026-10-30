/**
 * apps/server/src/persistence/snapshotter.ts
 *
 * Periodic background snapshotter for player state.
 *
 * Rules:
 * - Collects dirty entities outside the tick loop or on disconnect/shutdown.
 * - Coalesces by playerId (latest state wins).
 * - Only one async DB write batch in flight at a time.
 * - Non-blocking to the tick loop.
 */

import type { Logger } from 'pino';
import type { StateRepo, PlayerStateRecord } from './interfaces.js';

export interface SnapshotEntityProvider {
  getDirtyEntities(): Array<{
    playerId: string;
    x: number;
    y: number;
    dir: number;
    data: Record<string, unknown>;
    clearDirty: () => void;
  }>;
}

export class Snapshotter {
  private queue = new Map<string, PlayerStateRecord>();
  private inFlight: Promise<void> | null = null;
  private timer: NodeJS.Timeout | null = null;
  private maxQueueSize = 5000;

  constructor(
    private stateRepo: StateRepo,
    private intervalMs: number,
    private entityProvider: SnapshotEntityProvider,
    private logger: Logger
  ) {}

  start(): void {
    if (this.timer) return;
    this.timer = setInterval(() => {
      this.collectDirty();
      this.flushQueue().catch((err) => {
        this.logger.error({ err }, 'Periodic snapshot flush error');
      });
    }, this.intervalMs);
  }

  stop(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  /**
   * Enqueue a specific player's state (e.g. on disconnect/ghost expiry).
   */
  enqueue(record: PlayerStateRecord): void {
    if (this.queue.size < this.maxQueueSize) {
      this.queue.set(record.playerId, record);
    } else {
      this.logger.warn({ playerId: record.playerId }, 'Snapshot queue full, dropping state');
    }
  }

  /**
   * Collect all dirty entities from the world and clear their dirty flags.
   */
  collectDirty(): void {
    const dirty = this.entityProvider.getDirtyEntities();
    const now = new Date();
    for (const ent of dirty) {
      this.queue.set(ent.playerId, {
        playerId: ent.playerId,
        x: ent.x,
        y: ent.y,
        dir: ent.dir,
        data: JSON.stringify(ent.data),
        updatedAt: now,
      });
      ent.clearDirty();
    }
  }

  /**
   * Flush pending writes to the database.
   */
  flushQueue(): Promise<void> {
    if (this.inFlight) return this.inFlight;
    if (this.queue.size === 0) return Promise.resolve();
    const batch = Array.from(this.queue.values());
    this.queue.clear();
    this.inFlight = (async () => {
      try {
        await this.stateRepo.saveBatch(batch);
        this.logger.debug({ count: batch.length }, 'Flushed player state snapshot batch');
      } catch (error) {
        for (const item of batch) if (!this.queue.has(item.playerId)) this.queue.set(item.playerId, item);
        throw error;
      } finally { this.inFlight = null; }
    })();
    return this.inFlight;
  }

  /**
   * Waits for every queued and in-flight snapshot before the worker closes.
   */
  async flushAll(): Promise<void> {
    this.collectDirty();
    if (this.inFlight) await this.inFlight;
    while (this.queue.size > 0) await this.flushQueue();
  }
}
