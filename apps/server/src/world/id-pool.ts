/**
 * apps/server/src/world/id-pool.ts
 *
 * u16 Entity ID allocator with delayed reuse quarantine.
 * Prevents late packet delivery from confusing client replicas.
 */

import { MAX_ENTITY_ID, ENTITY_ID_REUSE_DELAY_MS } from '@heist/shared';

interface QuarantinedId {
  id: number;
  availableAt: number;
}

export class EntityIdPool {
  private nextNewId = 1;
  private freeList: number[] = [];
  private quarantine: QuarantinedId[] = [];
  private reuseDelayMs: number;

  constructor(reuseDelayMs = ENTITY_ID_REUSE_DELAY_MS) {
    this.reuseDelayMs = reuseDelayMs;
  }

  /**
   * Acquire an entity ID from the pool.
   * Returns null if all 65535 IDs are exhausted.
   */
  acquire(): number | null {
    this.releaseQuarantine();

    if (this.freeList.length > 0) {
      return this.freeList.pop()!;
    }

    if (this.nextNewId <= MAX_ENTITY_ID) {
      return this.nextNewId++;
    }

    return null;
  }

  /**
   * Release an entity ID into quarantine.
   */
  release(id: number): void {
    this.quarantine.push({
      id,
      availableAt: Date.now() + this.reuseDelayMs,
    });
  }

  private releaseQuarantine(): void {
    if (this.quarantine.length === 0) return;
    const now = Date.now();
    let writeIdx = 0;
    for (let i = 0; i < this.quarantine.length; i++) {
      const item = this.quarantine[i];
      if (item.availableAt <= now) {
        this.freeList.push(item.id);
      } else {
        this.quarantine[writeIdx++] = item;
      }
    }
    this.quarantine.length = writeIdx;
  }
}
