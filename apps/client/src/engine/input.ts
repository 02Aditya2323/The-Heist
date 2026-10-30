/**
 * Keyboard input handler for movement controls and debug toggles.
 * Strictly disabled until authoritative WELCOME packet arrives.
 */

import { DIR, type Direction } from '@heist/shared';

export interface InputHandler {
  enabled: boolean;
  debugOverlayVisible: boolean;
  debugCollisionVisible: boolean;
  getActiveDirection(): Direction | null;
  enable(): void;
  disable(): void;
  toggleDebugOverlay(): void;
  toggleDebugCollision(): void;
}

export class KeyboardInputHandler implements InputHandler {
  public enabled = false;
  public debugOverlayVisible = false;
  public debugCollisionVisible = false; // F4 toggle for noclip/collision overlay
  public activeKeys = new Set<string>();
  private tappedDirection: Direction | null = null;
  private touchDirection: Direction | null = null;

  constructor() {
    window.addEventListener('keydown', (e) => {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement || e.target instanceof HTMLSelectElement) return;
      if (e.code === 'F3') {
        e.preventDefault();
        this.toggleDebugOverlay();
        return;
      }

      if (e.code === 'F4') {
        e.preventDefault();
        this.toggleDebugCollision();
        return;
      }

      if (!this.enabled) return;

      if (['KeyW', 'KeyA', 'KeyS', 'KeyD', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(e.code)) {
        e.preventDefault();
        this.activeKeys.delete(e.code);
        this.activeKeys.add(e.code);
        this.tappedDirection = this.directionFor(e.code);
      }
    });

    window.addEventListener('keyup', (e) => {
      this.activeKeys.delete(e.code);
    });
    window.addEventListener('blur', () => { this.activeKeys.clear(); this.tappedDirection = null; this.touchDirection=null; });
    document.addEventListener('visibilitychange', () => { if (document.hidden) { this.activeKeys.clear(); this.tappedDirection = null; this.touchDirection=null; } });
  }

  setTouchDirection(direction:Direction|null):void {
    if(direction===null){this.touchDirection=null;return;}
    if(!this.enabled)return;
    this.touchDirection=direction;this.tappedDirection=direction;
  }

  getActiveDirection(): Direction | null {
    if (!this.enabled) return null;
    const held = [...this.activeKeys].reverse().map(code => this.directionFor(code)).find(dir => dir !== null);
    const direction = this.touchDirection ?? held ?? this.tappedDirection;
    this.tappedDirection = null;
    return direction;
  }

  private directionFor(code: string): Direction | null {
    if (code === 'KeyW' || code === 'ArrowUp') return DIR.UP;
    if (code === 'KeyS' || code === 'ArrowDown') return DIR.DOWN;
    if (code === 'KeyA' || code === 'ArrowLeft') return DIR.LEFT;
    if (code === 'KeyD' || code === 'ArrowRight') return DIR.RIGHT;
    return null;
  }

  enable(): void {
    this.enabled = true;
  }

  disable(): void {
    this.enabled = false;
    this.activeKeys.clear();
    this.tappedDirection = null;
    this.touchDirection = null;
  }

  toggleDebugOverlay(): void {
    this.debugOverlayVisible = !this.debugOverlayVisible;
  }

  toggleDebugCollision(): void {
    this.debugCollisionVisible = !this.debugCollisionVisible;
  }
}
