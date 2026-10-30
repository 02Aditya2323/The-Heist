import type { GameStore } from '../game/store.js';

export type RenderMode = 'procedural' | 'painted';

export interface CoverRect {
  x: number;
  y: number;
  w: number;
  h: number;
  mode?: 'color' | 'clone';
  color?: string;
  srcX?: number;
  srcY?: number;
}

export interface PaintedManifest {
  image: string;
  tileSize: number;
  widthTiles: number;
  heightTiles: number;
  coverRects: CoverRect[];
}

export interface GameRenderer {
  renderMode: RenderMode;
  zoom?: number;
  setZoom?(zoom: number): void;
  resize(winW: number, winH: number): void;
  render(
    store: GameStore,
    showDebugOverlay: boolean,
    showCollisionOverlay: boolean,
    now: number
  ): void;
}
