/**
 * apps/server/src/world/chunk-grid.ts
 *
 * Spatial partitioning of entities into 16x16 tile chunks.
 * Uses numeric chunk keys for performance and minimal allocations.
 */

import {
  chunkKey,
  neighbours3x3,
  type ChunkCoord,
} from '@heist/shared';
import type { Entity } from './entity.js';

export class ChunkGrid {
  private chunks = new Map<number, Set<number>>();

  add(entity: Entity): void {
    const key = chunkKey(entity.chunk.cx, entity.chunk.cy);
    let set = this.chunks.get(key);
    if (!set) {
      set = new Set();
      this.chunks.set(key, set);
    }
    set.add(entity.id);
  }

  remove(entity: Entity): void {
    const key = chunkKey(entity.chunk.cx, entity.chunk.cy);
    const set = this.chunks.get(key);
    if (set) {
      set.delete(entity.id);
      if (set.size === 0) {
        this.chunks.delete(key);
      }
    }
  }

  update(entity: Entity, newChunk: ChunkCoord): void {
    if (entity.chunk.cx === newChunk.cx && entity.chunk.cy === newChunk.cy) {
      return;
    }
    this.remove(entity);
    entity.chunk = newChunk;
    this.add(entity);
  }

  private static readonly EMPTY_SET: ReadonlySet<number> = new Set();

  getEntitiesInChunk(key: number): ReadonlySet<number> {
    return this.chunks.get(key) ?? ChunkGrid.EMPTY_SET;
  }

  getEntitiesInChunkRaw(key: number): Set<number> | undefined {
    return this.chunks.get(key);
  }

  /**
   * Returns all entity IDs inside the 3x3 chunks surrounding chunkCoord.
   */
  getEntitiesInAoI(chunkCoord: ChunkCoord): Set<number> {
    const result = new Set<number>();
    const nKeys = neighbours3x3(chunkCoord.cx, chunkCoord.cy);
    for (const k of nKeys) {
      const set = this.chunks.get(k);
      if (set) {
        for (const id of set) {
          result.add(id);
        }
      }
    }
    return result;
  }

  /**
   * Returns a map of chunkKey -> entity count for debug endpoints.
   */
  getChunkCounts(): Record<string, number> {
    const counts: Record<string, number> = {};
    for (const [key, set] of this.chunks.entries()) {
      if (set.size > 0) {
        counts[String(key)] = set.size;
      }
    }
    return counts;
  }
}
