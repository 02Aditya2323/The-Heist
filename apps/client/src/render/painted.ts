/**
 * Painted World Renderer.
 * Renders hand-crafted painted art maps on a 32px tile grid.
 * Actual window size at 1:1 scale (DPR-aware, no scaling of the world by default).
 * Zoomable between 0.5x and 1.5x via mouse wheel, +/-, and 0 to reset.
 * Smooth scaling for painted background, nearest-neighbour for sprites and entities.
 * Entities: 32x48 rectangles anchored at feet in world pixels, Y-sorted.
 * Hotspots: floating animated markers.
 * Debug overlays: F3 diagnostic panel, F4 noclip server collision overlay.
 */

import { DIR, type Direction } from '@heist/shared';
import type { GameStore, WorldEntity } from '../game/store.js';
import type { CoverRect, GameRenderer, PaintedManifest, RenderMode } from './types.js';

export const PAINTED_TILE_SIZE = 32;
export const VOID_COLOR = '#030508';

export class PaintedRenderer implements GameRenderer {
  public renderMode: RenderMode = 'painted';

  private displayCtx: CanvasRenderingContext2D;
  private bgImage: HTMLImageElement | null = null;
  public imageLoaded = false;
  private manifest: PaintedManifest | null = null;

  // Viewport & Scale metrics
  public winW = window.innerWidth;
  public winH = window.innerHeight;
  public dpr = window.devicePixelRatio || 1;

  // Zoom: 0.5x to 1.5x, default 1.0x (1:1 world pixels to CSS pixels)
  public zoom = 1.0;

  // Image fidelity metrics
  public scaleX = 1.0;
  public scaleY = 1.0;
  public scaleDiffPercent = 0.0;

  // Camera & viewport offsets
  public camX = 0;
  public camY = 0;
  public offsetX = 0;
  public offsetY = 0;

  // FPS tracking
  private lastFpsTime = performance.now();
  private framesThisSec = 0;
  public currentFps = 60;

  private isDestroyed = false;

  constructor(
    private displayCanvas: HTMLCanvasElement,
    manifest?: PaintedManifest | null
  ) {
    const dctx = displayCanvas.getContext('2d', { alpha: false });
    if (!dctx) throw new Error('Could not get display 2D context');
    this.displayCtx = dctx;

    this.initZoomListeners();

    if (manifest) {
      this.setManifest(manifest);
    } else {
      this.loadImage('/art/tech_quarter.png');
    }
  }

  public setManifest(manifest: PaintedManifest): void {
    this.manifest = manifest;
    this.loadImage(manifest.image);
  }

  public loadImage(src: string): void {
    const img = new Image();
    img.src = src;
    img.onload = () => {
      this.bgImage = img;
      this.imageLoaded = true;

      // Compute scale factors and log/warn according to spec
      const mapWidthTiles = this.manifest?.widthTiles ?? 52;
      const mapHeightTiles = this.manifest?.heightTiles ?? 29;
      const targetW = PAINTED_TILE_SIZE * mapWidthTiles;
      const targetH = PAINTED_TILE_SIZE * mapHeightTiles;

      this.scaleX = targetW / img.width;
      this.scaleY = targetH / img.height;

      const avgScale = (this.scaleX + this.scaleY) / 2;
      this.scaleDiffPercent = (Math.abs(this.scaleX - this.scaleY) / avgScale) * 100;

      console.log(
        `[Painted Image Fidelity] scaleX: ${this.scaleX.toFixed(6)} (${targetW}px / ${img.width}px), ` +
        `scaleY: ${this.scaleY.toFixed(6)} (${targetH}px / ${img.height}px)`
      );

      if (this.scaleDiffPercent > 1.0) {
        console.warn(
          `[Painted Image Fidelity Warning] Scale factors differ by ${this.scaleDiffPercent.toFixed(2)}% (> 1%)! ` +
          `Aspect ratio distortion detected.`
        );
      }
    };
  }

  public setZoom(newZoom: number): void {
    this.zoom = Math.max(0.5, Math.min(1.5, Math.round(newZoom * 100) / 100));
  }

  private initZoomListeners(): void {
    // Mouse wheel zoom
    window.addEventListener(
      'wheel',
      (e) => {
        if (this.isDestroyed) return;
        // Check if wheeling over main window/canvas
        const delta = e.deltaY < 0 ? 0.05 : -0.05;
        this.setZoom(this.zoom + delta);
      },
      { passive: true }
    );

    // Keyboard zoom controls (+, -, 0)
    window.addEventListener('keydown', (e) => {
      if (this.isDestroyed) return;
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;

      if (e.key === '+' || e.key === '=' || e.code === 'NumpadAdd') {
        this.setZoom(this.zoom + 0.1);
      } else if (e.key === '-' || e.key === '_' || e.code === 'NumpadSubtract') {
        this.setZoom(this.zoom - 0.1);
      } else if (e.key === '0' || e.code === 'Digit0' || e.code === 'Numpad0') {
        this.setZoom(1.0);
      }
    });
  }

  public resize(winW: number, winH: number): void {
    this.winW = winW;
    this.winH = winH;
    this.dpr = window.devicePixelRatio || 1;

    // DPR-aware canvas buffer
    this.displayCanvas.width = Math.round(winW * this.dpr);
    this.displayCanvas.height = Math.round(winH * this.dpr);
    this.displayCanvas.style.width = `${winW}px`;
    this.displayCanvas.style.height = `${winH}px`;
  }

  public render(
    store: GameStore,
    showDebugOverlay: boolean,
    showCollisionOverlay: boolean,
    now: number
  ): void {
    this.trackFps(now);

    const dctx = this.displayCtx;
    const map = store.map;
    const self = store.selfEntity;

    // Reset transform to identity and scale by DPR for razor-sharp rendering
    dctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);

    // 1. Fill entire window viewport with void color
    dctx.fillStyle = VOID_COLOR;
    dctx.fillRect(0, 0, this.winW, this.winH);

    if (!map || !self) {
      this.drawConnectingScreen(dctx);
      return;
    }

    const mapWidthTiles = this.manifest?.widthTiles ?? map.width;
    const mapHeightTiles = this.manifest?.heightTiles ?? map.height;
    const mapPixelW = mapWidthTiles * PAINTED_TILE_SIZE;
    const mapPixelH = mapHeightTiles * PAINTED_TILE_SIZE;

    // 2. Camera calculation:
    // Follow interpolated player position, clamped to map bounds
    const elapsed = now - self.animStart;
    const t = Math.min(1.0, Math.max(0, elapsed / self.animDuration));
    const smoothX = self.prevTileX + (self.tileX - self.prevTileX) * t;
    const smoothY = self.prevTileY + (self.tileY - self.prevTileY) * t;

    const playerPixelX = (smoothX + 0.5) * PAINTED_TILE_SIZE;
    const playerPixelY = (smoothY + 0.5) * PAINTED_TILE_SIZE;

    // World size at current zoom level
    const renderedMapW = mapPixelW * this.zoom;
    const renderedMapH = mapPixelH * this.zoom;

    // How many world pixels fit into the window viewport
    const visibleWorldW = this.winW / this.zoom;
    const visibleWorldH = this.winH / this.zoom;

    let camX = 0;
    let viewportOffsetX = 0;

    if (this.winW >= renderedMapW) {
      // Window is larger than map horizontally: centre the map
      camX = 0;
      viewportOffsetX = (this.winW - renderedMapW) / 2;
    } else {
      // Camera follows player and clamps to map bounds
      viewportOffsetX = 0;
      const maxCamX = Math.max(0, mapPixelW - visibleWorldW);
      const rawCamX = playerPixelX - visibleWorldW / 2;
      camX = Math.max(0, Math.min(maxCamX, rawCamX));
    }

    let camY = 0;
    let viewportOffsetY = 0;

    if (this.winH >= renderedMapH) {
      // Window is larger than map vertically: centre the map
      camY = 0;
      viewportOffsetY = (this.winH - renderedMapH) / 2;
    } else {
      // Camera follows player and clamps to map bounds
      viewportOffsetY = 0;
      const maxCamY = Math.max(0, mapPixelH - visibleWorldH);
      const rawCamY = playerPixelY - visibleWorldH / 2;
      camY = Math.max(0, Math.min(maxCamY, rawCamY));
    }

    this.camX = camX;
    this.camY = camY;
    this.offsetX = viewportOffsetX;
    this.offsetY = viewportOffsetY;

    // 3. Render Painted Background
    // High-quality smoothing for painted background layer only
    const bgScreenX = viewportOffsetX - camX * this.zoom;
    const bgScreenY = viewportOffsetY - camY * this.zoom;

    if (this.bgImage && this.imageLoaded) {
      dctx.save();
      dctx.imageSmoothingEnabled = true;
      dctx.imageSmoothingQuality = 'high';
      dctx.drawImage(this.bgImage, bgScreenX, bgScreenY, renderedMapW, renderedMapH);
      dctx.restore();
    } else {
      dctx.fillStyle = '#0f172a';
      dctx.fillRect(bgScreenX, bgScreenY, renderedMapW, renderedMapH);
    }

    // 4. Render Cover Rectangles (supporting 'clone' mode)
    // Default: no cover if coverRects is empty
    this.renderCoverRects(dctx, mapPixelW, mapPixelH, bgScreenX, bgScreenY);

    // From here on, all sprite and UI rendering uses nearest-neighbour
    dctx.imageSmoothingEnabled = false;

    // 5. Render Hotspot Markers (floating diamond pins)
    this.renderHotspots(dctx, map, now);

    // 6. Render Entities (Y-sorted: 32x48 world pixels, nearest-neighbour)
    this.renderEntities(dctx, self, Array.from(store.entities.values()), now);

    // 7. Noclip Debug Collision Overlay (F4 toggle)
    if (showCollisionOverlay) {
      this.renderCollisionOverlay(dctx, map);
    }

    // 8. F3 Diagnostic Overlay
    if (showDebugOverlay) {
      this.drawF3Overlay(dctx, store, self, map, showCollisionOverlay);
    }
  }

  private renderCoverRects(
    ctx: CanvasRenderingContext2D,
    mapPixelW: number,
    mapPixelH: number,
    _bgScreenX: number,
    _bgScreenY: number
  ): void {
    const covers = this.manifest?.coverRects ?? [];
    if (covers.length === 0) return;

    for (const rect of covers) {
      const rx = this.offsetX + (rect.x - this.camX) * this.zoom;
      const ry = this.offsetY + (rect.y - this.camY) * this.zoom;
      const rw = rect.w * this.zoom;
      const rh = rect.h * this.zoom;

      if (rect.mode === 'clone' && this.bgImage && this.imageLoaded) {
        // Clone mode: copy adjacent region of the same image
        const srcWorldX = rect.srcX ?? (rect.x + rect.w <= mapPixelW ? rect.x + rect.w : Math.max(0, rect.x - rect.w));
        const srcWorldY = rect.srcY ?? rect.y;

        const imgX = (srcWorldX / mapPixelW) * this.bgImage.width;
        const imgY = (srcWorldY / mapPixelH) * this.bgImage.height;
        const imgW = (rect.w / mapPixelW) * this.bgImage.width;
        const imgH = (rect.h / mapPixelH) * this.bgImage.height;

        ctx.save();
        ctx.imageSmoothingEnabled = true;
        ctx.imageSmoothingQuality = 'high';
        ctx.drawImage(this.bgImage, imgX, imgY, imgW, imgH, rx, ry, rw, rh);
        ctx.restore();
      } else {
        // Solid color fallback
        ctx.fillStyle = rect.color || VOID_COLOR;
        ctx.fillRect(rx, ry, rw, rh);
      }
    }
  }

  private renderHotspots(
    ctx: CanvasRenderingContext2D,
    map: any,
    now: number
  ): void {
    if (!map.hotspots || !Array.isArray(map.hotspots)) return;

    for (const hs of map.hotspots) {
      const tileCenterX = hs.x * PAINTED_TILE_SIZE + PAINTED_TILE_SIZE / 2;
      const tileTopY = hs.y * PAINTED_TILE_SIZE;

      const screenX = this.offsetX + (tileCenterX - this.camX) * this.zoom;
      const floatOffset = Math.sin(now / 280) * 4;
      const screenY = this.offsetY + (tileTopY - 14 - this.camY + floatOffset) * this.zoom;

      ctx.save();

      // Floating diamond pin
      ctx.fillStyle = '#f59e0b';
      ctx.shadowColor = '#f59e0b';
      ctx.shadowBlur = 8;
      ctx.beginPath();
      ctx.moveTo(screenX, screenY + 6 * this.zoom);
      ctx.lineTo(screenX + 6 * this.zoom, screenY);
      ctx.lineTo(screenX, screenY - 6 * this.zoom);
      ctx.lineTo(screenX - 6 * this.zoom, screenY);
      ctx.closePath();
      ctx.fill();

      ctx.shadowBlur = 0;
      ctx.strokeStyle = '#ffffff';
      ctx.lineWidth = 1;
      ctx.stroke();

      // Label background & text
      const label = hs.name.toUpperCase();
      ctx.font = `bold ${Math.max(9, Math.round(10 * this.zoom))}px monospace`;
      const textW = ctx.measureText(label).width;
      const badgeW = textW + 10;
      const badgeH = 14 * this.zoom;

      ctx.fillStyle = 'rgba(15, 23, 42, 0.9)';
      ctx.fillRect(screenX - badgeW / 2, screenY - 22 * this.zoom, badgeW, badgeH);

      ctx.strokeStyle = '#f59e0b';
      ctx.lineWidth = 1;
      ctx.strokeRect(screenX - badgeW / 2 + 0.5, screenY - 22 * this.zoom + 0.5, badgeW - 1, badgeH - 1);

      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillStyle = '#fbbf24';
      ctx.fillText(label, screenX, screenY - 15 * this.zoom);

      ctx.restore();
    }
  }

  private renderEntities(
    ctx: CanvasRenderingContext2D,
    self: WorldEntity,
    otherEntities: WorldEntity[],
    now: number
  ): void {
    const all = [self, ...otherEntities];

    // Compute smooth positions and sort by feet world Y
    const renderList = all.map((entity) => {
      const elapsed = now - entity.animStart;
      const t = Math.min(1.0, Math.max(0, elapsed / entity.animDuration));
      const smoothX = entity.prevTileX + (entity.tileX - entity.prevTileX) * t;
      const smoothY = entity.prevTileY + (entity.tileY - entity.prevTileY) * t;

      // Feet at tile bottom-center in world pixels:
      // Rectangle size 32x48:
      // rectLeft = smoothX * 32
      // rectTop = (smoothY + 1) * 32 - 48
      const worldLeft = smoothX * PAINTED_TILE_SIZE;
      const worldTop = (smoothY + 1) * PAINTED_TILE_SIZE - 48;
      const feetWorldY = (smoothY + 1) * PAINTED_TILE_SIZE;

      const screenX = this.offsetX + (worldLeft - this.camX) * this.zoom;
      const screenY = this.offsetY + (worldTop - this.camY) * this.zoom;

      return {
        entity,
        isSelf: entity.id === self.id,
        screenX,
        screenY,
        feetWorldY,
      };
    });

    // Y-sorting: lowest feetWorldY rendered first (back-to-front)
    renderList.sort((a, b) => a.feetWorldY - b.feetWorldY);

    for (const item of renderList) {
      const { entity, isSelf, screenX, screenY } = item;
      const w = 32 * this.zoom;
      const h = 48 * this.zoom;

      ctx.save();

      // 1. Drop shadow under feet
      ctx.fillStyle = 'rgba(0, 0, 0, 0.45)';
      ctx.beginPath();
      ctx.ellipse(screenX + 16 * this.zoom, screenY + 46 * this.zoom, 12 * this.zoom, 4 * this.zoom, 0, 0, Math.PI * 2);
      ctx.fill();

      // 2. Entity body (32x48 world pixels scaled by zoom)
      const primaryColor = isSelf ? '#00f0ff' : '#a855f7';
      const secondaryColor = isSelf ? '#0284c7' : '#7e22ce';

      const grad = ctx.createLinearGradient(screenX, screenY, screenX, screenY + h);
      grad.addColorStop(0, primaryColor);
      grad.addColorStop(1, secondaryColor);

      ctx.fillStyle = grad;
      ctx.fillRect(screenX, screenY, w, h);

      // Inner border / neon outline
      ctx.strokeStyle = isSelf ? '#ffffff' : '#e9d5ff';
      ctx.lineWidth = Math.max(1, 1.5 * this.zoom);
      ctx.strokeRect(screenX + 0.75, screenY + 0.75, w - 1.5, h - 1.5);

      // Direction indicator (visor/eyes)
      ctx.fillStyle = '#ffffff';
      const eyeY = screenY + 10 * this.zoom;
      switch (entity.dir) {
        case DIR.UP:
          ctx.fillStyle = '#0f172a';
          ctx.fillRect(screenX + 14 * this.zoom, screenY + 8 * this.zoom, 4 * this.zoom, 18 * this.zoom);
          break;
        case DIR.DOWN:
          ctx.fillRect(screenX + 8 * this.zoom, eyeY, 6 * this.zoom, 3 * this.zoom);
          ctx.fillRect(screenX + 18 * this.zoom, eyeY, 6 * this.zoom, 3 * this.zoom);
          break;
        case DIR.LEFT:
          ctx.fillRect(screenX + 4 * this.zoom, eyeY, 8 * this.zoom, 3 * this.zoom);
          break;
        case DIR.RIGHT:
          ctx.fillRect(screenX + 20 * this.zoom, eyeY, 8 * this.zoom, 3 * this.zoom);
          break;
      }

      // 3. Name label above head
      ctx.font = `bold ${Math.max(8, Math.round(9 * this.zoom))}px monospace`;
      ctx.textAlign = 'center';
      const label = entity.name || `Agent #${entity.id}`;
      const lw = ctx.measureText(label).width;

      const badgeX = screenX + 16 * this.zoom;
      const badgeY = screenY - 8 * this.zoom;

      ctx.fillStyle = 'rgba(3, 5, 8, 0.85)';
      ctx.fillRect(badgeX - lw / 2 - 4, badgeY - 10, lw + 8, 12);
      ctx.strokeStyle = isSelf ? '#00f0ff' : '#c084fc';
      ctx.lineWidth = 1;
      ctx.strokeRect(badgeX - lw / 2 - 4 + 0.5, badgeY - 10 + 0.5, lw + 7, 11);

      ctx.fillStyle = isSelf ? '#38bdf8' : '#e9d5ff';
      ctx.fillText(label, badgeX, badgeY - 1);

      ctx.restore();
    }
  }

  private renderCollisionOverlay(
    ctx: CanvasRenderingContext2D,
    map: any
  ): void {
    ctx.save();

    const startTileX = Math.max(0, Math.floor(this.camX / PAINTED_TILE_SIZE));
    const endTileX = Math.min(map.width - 1, Math.ceil((this.camX + this.winW / this.zoom) / PAINTED_TILE_SIZE));
    const startTileY = Math.max(0, Math.floor(this.camY / PAINTED_TILE_SIZE));
    const endTileY = Math.min(map.height - 1, Math.ceil((this.camY + this.winH / this.zoom) / PAINTED_TILE_SIZE));

    ctx.fillStyle = 'rgba(239, 68, 68, 0.42)';
    ctx.strokeStyle = 'rgba(239, 68, 68, 0.85)';
    ctx.lineWidth = 1;

    for (let ty = startTileY; ty <= endTileY; ty++) {
      for (let tx = startTileX; tx <= endTileX; tx++) {
        const isBlocked = map.collision[ty * map.width + tx] === 1;
        if (isBlocked) {
          const sx = this.offsetX + (tx * PAINTED_TILE_SIZE - this.camX) * this.zoom;
          const sy = this.offsetY + (ty * PAINTED_TILE_SIZE - this.camY) * this.zoom;
          const sz = PAINTED_TILE_SIZE * this.zoom;
          ctx.fillRect(sx, sy, sz, sz);
          ctx.strokeRect(sx + 0.5, sy + 0.5, sz - 1, sz - 1);
        }
      }
    }

    // Active status pill
    ctx.fillStyle = 'rgba(239, 68, 68, 0.9)';
    ctx.fillRect(this.winW / 2 - 120, 10, 240, 22);
    ctx.strokeStyle = '#ffffff';
    ctx.strokeRect(this.winW / 2 - 120 + 0.5, 10.5, 239, 21);
    ctx.font = 'bold 10px monospace';
    ctx.textAlign = 'center';
    ctx.fillStyle = '#ffffff';
    ctx.fillText('[F4 NOCLIP COLLISION OVERLAY: ON]', this.winW / 2, 25);

    ctx.restore();
  }

  private trackFps(now: number): void {
    this.framesThisSec++;
    const elapsed = now - this.lastFpsTime;
    if (elapsed >= 500) {
      this.currentFps = Math.round((this.framesThisSec * 1000) / elapsed);
      this.framesThisSec = 0;
      this.lastFpsTime = now;
    }
  }

  private drawConnectingScreen(ctx: CanvasRenderingContext2D): void {
    ctx.font = '14px monospace';
    ctx.fillStyle = '#00f0ff';
    ctx.textAlign = 'center';
    ctx.fillText('ESTABLISHING SECURE UPLINK TO PAINTED WORLD...', this.winW / 2, this.winH / 2);
  }

  private drawF3Overlay(
    ctx: CanvasRenderingContext2D,
    store: GameStore,
    self: WorldEntity,
    map: any,
    showCollisionOverlay: boolean
  ): void {
    const lines = [
      `[HEIST OS // F3 DEBUG (PAINTED WORLD)]`,
      `FPS: ${this.currentFps} | Zoom: ${this.zoom.toFixed(2)}x (1:1 World Px)`,
      `Window: ${this.winW}x${this.winH} (DPR: ${this.dpr})`,
      `Pos: X:${self.tileX} Y:${self.tileY} (Grid ${PAINTED_TILE_SIZE}px)`,
      `Map: ${map.width}x${map.height} tiles (${map.width * PAINTED_TILE_SIZE}x${map.height * PAINTED_TILE_SIZE}px)`,
      `Fidelity: X=${this.scaleX.toFixed(4)}, Y=${this.scaleY.toFixed(4)} (diff: ${this.scaleDiffPercent.toFixed(2)}%)`,
      `Noclip Debug (F4): ${showCollisionOverlay ? 'ENABLED' : 'DISABLED'}`,
      `RTT: ${store.pingMs}ms | Server Tick: ${store.serverTick}`,
      `AoI Entities: ${store.entities.size + 1}`,
      `Rejects: ${store.rejectsCount}`,
      `State: ${store.connectionStatus.state}`,
      `Mode: painted (DPR-aware, smooth background, 1:1 scale)`,
    ];

    ctx.save();
    ctx.font = '9px monospace';
    ctx.textAlign = 'left';

    const padding = 8;
    const lineHeight = 13;
    const boxW = 280;
    const boxH = lines.length * lineHeight + padding * 2;

    ctx.fillStyle = 'rgba(3, 5, 8, 0.9)';
    ctx.fillRect(10, 10, boxW, boxH);
    ctx.strokeStyle = '#00f0ff';
    ctx.lineWidth = 1;
    ctx.strokeRect(10.5, 10.5, boxW - 1, boxH - 1);

    lines.forEach((line, i) => {
      ctx.fillStyle = i === 0 ? '#00f0ff' : '#cbd5e1';
      ctx.fillText(line, 16, 10 + padding + (i + 0.8) * lineHeight);
    });

    ctx.restore();
  }

  public destroy(): void {
    this.isDestroyed = true;
  }
}
