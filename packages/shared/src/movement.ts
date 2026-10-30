/**
 * @heist/shared - movement.ts
 *
 * Server-authoritative movement logic. Used by both server and client (for prediction).
 * This is THE single source of truth for "can this entity move in this direction?"
 *
 * Spec rules:
 * - Players do NOT collide with each other (overlap allowed).
 * - No separate "turn" mechanic; every move input moves one tile and sets facing.
 * - tryStep checks bounds + collision grid only.
 */

import { DIR_DELTA, type Direction } from './constants.js';
import { isWalkable, type GameMap } from './map.js';

export interface StepResult {
  ok: boolean;
  x: number;
  y: number;
}

/**
 * Attempt to move from (x, y) in direction `dir`.
 * Returns { ok: true, x: nx, y: ny } if the destination is walkable,
 * or { ok: false, x, y } (original position) if blocked.
 *
 * This function is pure — no side effects, no state mutation.
 */
export function tryStep(
  map: GameMap,
  x: number,
  y: number,
  dir: Direction,
): StepResult {
  const delta = DIR_DELTA[dir];
  if (!delta) {
    return { ok: false, x, y };
  }
  const [dx, dy] = delta;
  const nx = x + dx;
  const ny = y + dy;

  if (isWalkable(map, nx, ny)) {
    return { ok: true, x: nx, y: ny };
  }

  return { ok: false, x, y };
}
