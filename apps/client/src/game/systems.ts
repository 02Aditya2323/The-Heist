/**
 * Game systems interface and stubs (movement, interpolation, collision).
 */

import type { GameStore } from './store.js';

export interface GameSystem {
  update(store: GameStore, dt: number): void;
}

export class MovementSystem implements GameSystem {
  update(_store: GameStore, _dt: number): void {
    // Stub: To be implemented in gameplay phase
  }
}
