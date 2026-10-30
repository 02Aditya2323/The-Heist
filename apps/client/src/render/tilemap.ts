/**
 * Chunk-based static map baking, 8-neighbor wall autotiling,
 * deterministic road/sidewalk generation, and hotspot landmark props.
 */

import type { GameMap, Hotspot } from '@heist/shared';
import { TileId, TILE_SIZE, type TileAtlas } from '../assets/atlas.js';
import { hashFloat, hashInt } from '../assets/hash.js';
import { globalDistricts } from '../game/districts.js';

export interface BakedChunk {
  cx: number;
  cy: number;
  groundCanvas: HTMLCanvasElement;
  overhangCanvas: HTMLCanvasElement;
}

export class TilemapRenderer {
  private chunkCache = new Map<string, BakedChunk>();
  public lastBlitsCount = 0;
  private hotspotMap = new Map<number, Hotspot>();

  constructor(public atlas: TileAtlas) {}

  clearCache(): void {
    this.chunkCache.clear();
    this.hotspotMap.clear();
  }

  getCacheSize(): number {
    return this.chunkCache.size;
  }

  private indexHotspots(map: GameMap): void {
    if (this.hotspotMap.size === 0 && map.hotspots) {
      for (const h of map.hotspots) {
        this.hotspotMap.set(h.y * map.width + h.x, h);
      }
    }
  }

  getOrBakeChunk(map: GameMap, cx: number, cy: number): BakedChunk {
    const key = `${cx}_${cy}`;
    let chunk = this.chunkCache.get(key);
    if (!chunk) {
      this.indexHotspots(map);
      chunk = this.bakeChunk(map, cx, cy);
      this.chunkCache.set(key, chunk);
    }
    return chunk;
  }

  private bakeChunk(map: GameMap, cx: number, cy: number): BakedChunk {
    const chunkSizePx = 16 * TILE_SIZE; // 256px
    const groundCanvas = document.createElement('canvas');
    groundCanvas.width = chunkSizePx;
    groundCanvas.height = chunkSizePx;
    const gctx = groundCanvas.getContext('2d')!;
    gctx.imageSmoothingEnabled = false;

    const overhangCanvas = document.createElement('canvas');
    overhangCanvas.width = chunkSizePx;
    overhangCanvas.height = chunkSizePx;
    const octx = overhangCanvas.getContext('2d')!;
    octx.imageSmoothingEnabled = false;

    const startTileX = cx * 16;
    const startTileY = cy * 16;
    const mapVersion = map.version || 1;

    for (let ty = 0; ty < 16; ty++) {
      for (let tx = 0; tx < 16; tx++) {
        const x = startTileX + tx;
        const y = startTileY + ty;

        if (x < 0 || x >= map.width || y < 0 || y >= map.height) {
          continue;
        }

        const isWall = map.collision[y * map.width + x] === 1;
        const px = tx * TILE_SIZE;
        const py = ty * TILE_SIZE;

        const hotspot = this.hotspotMap.get(y * map.width + x);

        if (isWall) {
          this.bakeWallTile(map, x, y, px, py, gctx, octx, mapVersion, hotspot);
        } else {
          this.bakeGroundTile(map, x, y, px, py, gctx, mapVersion, hotspot);
        }
      }
    }

    return { cx, cy, groundCanvas, overhangCanvas };
  }

  private bakeWallTile(
    map: GameMap,
    x: number,
    y: number,
    px: number,
    py: number,
    gctx: CanvasRenderingContext2D,
    octx: CanvasRenderingContext2D,
    mapVersion: number,
    hotspot?: Hotspot
  ): void {
    const w = map.width;
    const h = map.height;

    // Outer map boundary renders as monolithic skyline
    if (x === 0 || y === 0 || x === w - 1 || y === h - 1) {
      this.atlas.drawTile(gctx, TileId.SKYLINE_BORDER_TOP, px, py);
      return;
    }

    const southIsWalkable = map.collision[(y + 1) * w + x] === 0;

    if (southIsWalkable) {
      // ── WALL FACADE (Facing street south) ──
      if (hotspot && hotspot.name.toLowerCase().includes('bank')) {
        this.atlas.drawTile(gctx, TileId.HOTSPOT_BANK, px, py);
      } else if (hotspot && hotspot.name.toLowerCase().includes('police')) {
        this.atlas.drawTile(gctx, TileId.HOTSPOT_POLICE, px, py);
      } else {
        const f = hashFloat(x, y, mapVersion * 17);
        if (f < 0.35) {
          this.atlas.drawTile(gctx, TileId.FACADE_PLAIN, px, py);
        } else if (f < 0.55) {
          this.atlas.drawTile(gctx, TileId.FACADE_WINDOW_LIT_CYAN, px, py);
        } else if (f < 0.70) {
          this.atlas.drawTile(gctx, TileId.FACADE_WINDOW_LIT_AMBER, px, py);
        } else if (f < 0.80) {
          this.atlas.drawTile(gctx, TileId.FACADE_WINDOW_LIT_MAGENTA, px, py);
        } else if (f < 0.90) {
          this.atlas.drawTile(gctx, TileId.FACADE_WINDOW_UNLIT, px, py);
        } else if (f < 0.95) {
          this.atlas.drawTile(gctx, TileId.FACADE_DOOR, px, py);
        } else {
          this.atlas.drawTile(gctx, TileId.FACADE_VENT_PIPES, px, py);
        }
      }

      // Roof lip overhang
      this.atlas.drawTile(octx, TileId.OVERHANG_ROOF_LIP, px, py);

      // Deterministic awning in overhang layer (covers players standing south)
      const awningHash = hashFloat(x, y, mapVersion * 43);
      if (awningHash < 0.20) {
        this.atlas.drawTile(octx, TileId.OVERHANG_AWNING_CYAN, px, py);
      } else if (awningHash < 0.35) {
        this.atlas.drawTile(octx, TileId.OVERHANG_AWNING_MAGENTA, px, py);
      }
    } else {
      // ── WALL ROOFTOP (Solid wall tiles) ──
      const northIsWall = y > 0 && map.collision[(y - 1) * w + x] === 1;
      const westIsWall = x > 0 && map.collision[y * w + (x - 1)] === 1;
      const eastIsWall = x < w - 1 && map.collision[y * w + (x + 1)] === 1;

      if (!northIsWall && !westIsWall) {
        this.atlas.drawTile(gctx, TileId.ROOF_CORNER_NW, px, py);
      } else if (!northIsWall && !eastIsWall) {
        this.atlas.drawTile(gctx, TileId.ROOF_CORNER_NE, px, py);
      } else if (!northIsWall) {
        this.atlas.drawTile(gctx, TileId.ROOF_EDGE_N, px, py);
      } else if (!westIsWall) {
        this.atlas.drawTile(gctx, TileId.ROOF_EDGE_W, px, py);
      } else if (!eastIsWall) {
        this.atlas.drawTile(gctx, TileId.ROOF_EDGE_E, px, py);
      } else {
        // Interior rooftop equipment variation
        const rf = hashFloat(x, y, mapVersion * 31);
        if (rf < 0.60) {
          this.atlas.drawTile(gctx, TileId.ROOF_FLAT_BASE, px, py);
        } else if (rf < 0.75) {
          this.atlas.drawTile(gctx, TileId.ROOF_AC_UNIT, px, py);
        } else if (rf < 0.85) {
          this.atlas.drawTile(gctx, TileId.ROOF_VENT, px, py);
        } else if (rf < 0.93) {
          this.atlas.drawTile(gctx, TileId.ROOF_SKYLIGHT, px, py);
        } else {
          this.atlas.drawTile(gctx, TileId.ROOF_ANTENNA, px, py);
        }
      }
    }
  }

  private bakeGroundTile(
    map: GameMap,
    x: number,
    y: number,
    px: number,
    py: number,
    gctx: CanvasRenderingContext2D,
    mapVersion: number,
    hotspot?: Hotspot
  ): void {
    const w = map.width;
    const h = map.height;

    const northIsWall = y > 0 && map.collision[(y - 1) * w + x] === 1;
    const southIsWall = y < h - 1 && map.collision[(y + 1) * w + x] === 1;
    const westIsWall = x > 0 && map.collision[y * w + (x - 1)] === 1;
    const eastIsWall = x < w - 1 && map.collision[y * w + (x + 1)] === 1;

    // 1. Sidewalk / Curb detection (Walkable tiles adjacent to walls)
    if (northIsWall && westIsWall) {
      this.atlas.drawTile(gctx, TileId.SIDEWALK_CORNER_TL, px, py);
      return;
    }
    if (northIsWall && eastIsWall) {
      this.atlas.drawTile(gctx, TileId.SIDEWALK_CORNER_TR, px, py);
      return;
    }
    if (northIsWall) {
      this.atlas.drawTile(gctx, TileId.SIDEWALK_CURB_TOP, px, py);
      return;
    }
    if (southIsWall) {
      this.atlas.drawTile(gctx, TileId.SIDEWALK_CURB_BOTTOM, px, py);
      return;
    }
    if (westIsWall) {
      this.atlas.drawTile(gctx, TileId.SIDEWALK_CURB_LEFT, px, py);
      return;
    }
    if (eastIsWall) {
      this.atlas.drawTile(gctx, TileId.SIDEWALK_CURB_RIGHT, px, py);
      return;
    }

    // 2. Hotspot Ground marker
    if (hotspot) {
      if (hotspot.name.toLowerCase().includes('bank')) {
        this.atlas.drawTile(gctx, TileId.HOTSPOT_PLAZA_BANK, px, py);
      } else {
        this.atlas.drawTile(gctx, TileId.PLAZA_TILES_2, px, py);
      }
      return;
    }

    // 3. Open Plazas around hotspots
    if (map.hotspots) {
      for (const h of map.hotspots) {
        if (Math.abs(h.x - x) <= 7 && Math.abs(h.y - y) <= 7) {
          const pf = (x + y) % 2 === 0 ? TileId.PLAZA_TILES_1 : TileId.PLAZA_TILES_2;
          this.atlas.drawTile(gctx, pf, px, py);
          return;
        }
      }
    }

    // 4. Main Road Corridors (Avenues every 32 tiles)
    const isHorizRoadCenter = (y % 32 === 1);
    const isVertRoadCenter = (x % 32 === 1);

    if (isHorizRoadCenter && isVertRoadCenter) {
      this.atlas.drawTile(gctx, TileId.ROAD_CROSSWALK_H, px, py);
      return;
    }
    if (isHorizRoadCenter) {
      const rf = x % 6 === 0 ? TileId.ROAD_LINE_YELLOW_H : TileId.ROAD_LINE_WHITE_H;
      this.atlas.drawTile(gctx, rf, px, py);
      return;
    }
    if (isVertRoadCenter) {
      const rf = y % 6 === 0 ? TileId.ROAD_LINE_YELLOW_V : TileId.ROAD_LINE_WHITE_V;
      this.atlas.drawTile(gctx, rf, px, py);
      return;
    }

    // 5. Painted lane markings along stretches
    if (y % 4 === 0 && x % 4 === 0) {
      this.atlas.drawTile(gctx, TileId.ROAD_LINE_WHITE_H, px, py);
      return;
    }

    // 6. Asphalt surface variation
    const af = hashFloat(x, y, mapVersion * 59);
    if (af < 0.50) {
      this.atlas.drawTile(gctx, TileId.ASPHALT_PLAIN, px, py);
    } else if (af < 0.65) {
      this.atlas.drawTile(gctx, TileId.ASPHALT_CRACKED_1, px, py);
    } else if (af < 0.78) {
      this.atlas.drawTile(gctx, TileId.ASPHALT_CRACKED_2, px, py);
    } else if (af < 0.88) {
      this.atlas.drawTile(gctx, TileId.ASPHALT_DRAIN_GRATE, px, py);
    } else if (af < 0.94) {
      this.atlas.drawTile(gctx, TileId.ASPHALT_PUDDLE_CYAN, px, py);
    } else {
      this.atlas.drawTile(gctx, TileId.ASPHALT_PATCH, px, py);
    }
  }

  renderVisibleChunks(
    ctx: CanvasRenderingContext2D,
    map: GameMap,
    camX: number,
    camY: number,
    viewportW: number,
    viewportH: number,
    layer: 'ground' | 'overhang'
  ): number {
    const chunkSizePx = 16 * TILE_SIZE; // 256px
    const minCx = Math.max(0, Math.floor(camX / chunkSizePx));
    const maxCx = Math.min(Math.floor((map.width - 1) / 16), Math.floor((camX + viewportW) / chunkSizePx));
    const minCy = Math.max(0, Math.floor(camY / chunkSizePx));
    const maxCy = Math.min(Math.floor((map.height - 1) / 16), Math.floor((camY + viewportH) / chunkSizePx));

    let blits = 0;

    for (let cy = minCy; cy <= maxCy; cy++) {
      for (let cx = minCx; cx <= maxCx; cx++) {
        const chunk = this.getOrBakeChunk(map, cx, cy);
        const drawX = cx * chunkSizePx - camX;
        const drawY = cy * chunkSizePx - camY;

        const targetCanvas = layer === 'ground' ? chunk.groundCanvas : chunk.overhangCanvas;
        ctx.drawImage(targetCanvas, drawX, drawY);
        blits++;
      }
    }

    if (layer === 'ground') {
      this.lastBlitsCount = blits;
    }

    return blits;
  }

  drawHotspotSigns(
    ctx: CanvasRenderingContext2D,
    map: GameMap,
    camX: number,
    camY: number
  ): void {
    if (!map.hotspots) return;

    ctx.save();
    ctx.font = 'bold 8px monospace';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'bottom';

    for (const spot of map.hotspots) {
      const sx = spot.x * TILE_SIZE + TILE_SIZE / 2 - camX;
      const sy = spot.y * TILE_SIZE - camY;

      // Only draw if within visible viewport padding
      if (sx < -60 || sx > 480 + 60 || sy < -40 || sy > 270 + 40) {
        continue;
      }

      const palette = globalDistricts.getPaletteAt(spot.x, spot.y);

      // Glowing badge backing
      const label = spot.name.toUpperCase();
      const textWidth = ctx.measureText(label).width;
      const boxW = textWidth + 8;
      const boxH = 11;
      const bx = sx - boxW / 2;
      const by = sy - boxH - 2;

      ctx.fillStyle = 'rgba(7, 10, 19, 0.9)';
      ctx.fillRect(bx, by, boxW, boxH);
      ctx.strokeStyle = palette.neon.primary;
      ctx.lineWidth = 1;
      ctx.strokeRect(bx + 0.5, by + 0.5, boxW - 1, boxH - 1);

      // Text label with neon glow
      ctx.fillStyle = palette.neon.primary;
      ctx.fillText(label, sx, by + boxH - 1);
    }

    ctx.restore();
  }
}
