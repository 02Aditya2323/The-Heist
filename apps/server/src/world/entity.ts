/**
 * apps/server/src/world/entity.ts
 *
 * In-memory entity representation in the authoritative world.
 * Spec Section 5:
 * - Directions: 0 = UP (y-1), 1 = DOWN (y+1), 2 = LEFT (x-1), 3 = RIGHT (x+1)
 * - Players do not collide with each other (overlap allowed)
 * - data: Record<string, unknown> reserved for later phases
 */

import type { Direction, ChunkCoord } from '@heist/shared';

export interface PendingMove {
  seq: number;
  dir: Direction;
}

export interface Entity {
  id: number; // u16 (1 - 65535)
  playerId: string; // DB player ID
  name: string;
  x: number;
  y: number;
  dir: Direction;
  nextMoveTick: number;
  pending: PendingMove[];
  chunk: ChunkCoord;
  connected: boolean;
  disconnectedAt?: number;
  dirty: boolean;
  data: Record<string, unknown>;
}
