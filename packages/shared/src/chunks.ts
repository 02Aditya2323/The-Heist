/**
 * @heist/shared - chunks.ts
 *
 * Chunk-based Area of Interest math.
 * A chunk is CHUNK_SIZE x CHUNK_SIZE tiles.
 * A player watches its own chunk + 8 neighbours (3x3 grid).
 *
 * All functions are pure and allocation-light for use inside the tick loop.
 */

import { DEFAULTS } from './constants.js';

export interface ChunkCoord {
  cx: number;
  cy: number;
}

/**
 * Compute the chunk coordinate for a tile position.
 * Uses bit-shift for power-of-two chunk sizes.
 */
export function chunkOf(x: number, y: number, chunkSize: number = DEFAULTS.CHUNK_SIZE): ChunkCoord {
  // chunkSize must be power of two for bit shift to work correctly
  const shift = Math.log2(chunkSize) | 0;
  return { cx: x >> shift, cy: y >> shift };
}

/**
 * Encode a chunk coordinate into a single numeric key for use in Maps/Sets.
 * Supports chunk coords up to ±32767 (more than enough for a 256x256 map with chunk size 16).
 */
export function chunkKey(cx: number, cy: number): number {
  // Shift to make non-negative, then pack into a single int
  // For a 256x256 map with chunk size 16, max chunk coord is 15
  // Use a formula that works for any reasonable range
  return ((cy + 32768) << 16) | (cx + 32768);
}

/** Decode a chunk key back to coordinates */
export function chunkFromKey(key: number): ChunkCoord {
  const cx = (key & 0xffff) - 32768;
  const cy = ((key >> 16) & 0xffff) - 32768;
  return { cx, cy };
}

const CACHE_SIZE = 32;
const NEIGHBOURS_CACHE: number[][] = new Array(CACHE_SIZE * CACHE_SIZE);
for (let cy = 0; cy < CACHE_SIZE; cy++) {
  for (let cx = 0; cx < CACHE_SIZE; cx++) {
    const keys: number[] = [];
    for (let dy = -1; dy <= 1; dy++) {
      for (let dx = -1; dx <= 1; dx++) {
        keys.push(chunkKey(cx + dx, cy + dy));
      }
    }
    NEIGHBOURS_CACHE[cy * CACHE_SIZE + cx] = keys;
  }
}

/**
 * Get the 3x3 neighbourhood of chunks around (cx, cy), including (cx, cy) itself.
 * Returns 9 chunk keys. Uses precomputed cache for all in-bound coordinates.
 */
export function neighbours3x3(cx: number, cy: number): number[] {
  if (cx >= 0 && cx < CACHE_SIZE && cy >= 0 && cy < CACHE_SIZE) {
    return NEIGHBOURS_CACHE[cy * CACHE_SIZE + cx];
  }
  const keys: number[] = [];
  for (let dy = -1; dy <= 1; dy++) {
    for (let dx = -1; dx <= 1; dx++) {
      keys.push(chunkKey(cx + dx, cy + dy));
    }
  }
  return keys;
}

/**
 * Get the 3x3 neighbourhood as ChunkCoord objects.
 */
export function neighbours3x3Coords(cx: number, cy: number): ChunkCoord[] {
  const coords: ChunkCoord[] = [];
  for (let dy = -1; dy <= 1; dy++) {
    for (let dx = -1; dx <= 1; dx++) {
      coords.push({ cx: cx + dx, cy: cy + dy });
    }
  }
  return coords;
}

/**
 * Compute the set difference: items in `a` that are not in `b`.
 * Both arrays must be sorted or at least contain unique chunk keys.
 * Used for AoI diffing on chunk change.
 */
export function chunkSetDiff(a: number[], b: number[]): number[] {
  const bSet = new Set(b);
  return a.filter(k => !bSet.has(k));
}

/**
 * Compute AoI diff when an entity moves from chunk A to chunk B.
 * Returns:
 *   - `left`: chunk keys in old watch but not new (entity leaves these watchers' view)
 *   - `entered`: chunk keys in new watch but not old (entity enters these watchers' view)
 *   - `stayed`: chunk keys in both (entity remains visible, send MOVE)
 */
export function aoiDiff(
  oldCx: number, oldCy: number,
  newCx: number, newCy: number,
): { left: number[]; entered: number[]; stayed: number[] } {
  const oldWatch = neighbours3x3(oldCx, oldCy);
  const newWatch = neighbours3x3(newCx, newCy);

  const oldSet = new Set(oldWatch);
  const newSet = new Set(newWatch);

  const left: number[] = [];
  const stayed: number[] = [];
  const entered: number[] = [];

  for (const k of oldWatch) {
    if (newSet.has(k)) {
      stayed.push(k);
    } else {
      left.push(k);
    }
  }
  for (const k of newWatch) {
    if (!oldSet.has(k)) {
      entered.push(k);
    }
  }

  return { left, entered, stayed };
}

/**
 * Check if two chunk coordinates are the same.
 */
export function sameChunk(a: ChunkCoord, b: ChunkCoord): boolean {
  return a.cx === b.cx && a.cy === b.cy;
}
