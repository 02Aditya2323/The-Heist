import { DIR, type Direction } from '@heist/shared';

export const OPERATOR_CELL = { width: 48, height: 64, footX: 24, footY: 54 } as const;
/** The sheet uses explicit shared direction mappings, never assumed enum order. */
export function operatorRow(direction: Direction) {
  switch (direction) { case DIR.DOWN: return 0; case DIR.UP: return 1; case DIR.RIGHT: return 2; case DIR.LEFT: return 3; }
}
export function operatorFrame(progress: number, moving: boolean, parity: number) {
  if (!moving) return 0;
  // Eight poses per full gait, four per tile. Locomotion remains visible even
  // with reduced motion: it communicates movement rather than decoration.
  return 2 + ((Math.floor(Math.min(.999, Math.max(0, progress)) * 4) + parity * 4) % 8 + 8) % 8;
}
