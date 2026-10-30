/**
 * Collision Painter Studio.
 * Visual interactive map collision editor for painted world art.
 * Exports exact server map.json and painted.json manifests.
 */

import { DIR, type Direction } from '@heist/shared';

export interface HotspotItem {
  name: string;
  x: number;
  y: number;
}

export interface SpawnItem {
  x: number;
  y: number;
}

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

export interface ServerMapData {
  version: number;
  width: number;
  height: number;
  collision: string[];
  spawns: SpawnItem[];
  hotspots: HotspotItem[];
}

export class CollisionPainter {
  private canvas: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D;
  private viewport: HTMLElement;

  // Map settings
  public widthTiles = 52;
  public heightTiles = 29;
  public tileSize = 32;
  public imagePath = '/art/tech_quarter.png';
  public bgImage: HTMLImageElement | null = null;
  public imageLoaded = false;

  // Collision Grid: 0 = walkable, 1 = blocked (default: fully blocked)
  public collision: number[][] = [];
  public draftCollision: number[][] | null = null;

  // Markers: default to single center spawn, empty hotspots, no coverRects
  public hotspots: HotspotItem[] = [];
  public spawns: SpawnItem[] = [{ x: 26, y: 14 }];
  public coverRects: CoverRect[] = [];

  // Tool states: 'brush' | 'rect' | 'fill' | 'eraser' | 'wand' | 'hotspot' | 'spawn'
  public currentTool: 'brush' | 'rect' | 'fill' | 'eraser' | 'wand' | 'hotspot' | 'spawn' = 'brush';
  public paintValue = 1; // 1 = blocked, 0 = walkable
  public brushSize = 1;
  public showOverlay = true;
  public overlayOpacity = 0.5;
  public showGrid = true;
  public showCoverRects = true;

  // Magic Wand Tool State
  public wandTolerance = 22; // 0 - 100%
  public wandSelectedTiles: Set<string> = new Set();
  private tileColorCache: Array<Array<{ r: number; g: number; b: number }>> = [];

  // Foot-test Mode
  public footTestMode = false;

  // Walk-test Avatar State (250ms real step rate)
  public walkTestActive = false;
  public walkAvatar = {
    tileX: 26,
    tileY: 14,
    prevTileX: 26,
    prevTileY: 14,
    dir: DIR.DOWN as Direction,
    animStart: 0,
    animDuration: 250,
    isMoving: false,
  };
  private activeWalkKeys = new Set<string>();
  private walkLoopId: number | null = null;

  // Pan & Zoom
  public zoom = 1.0;
  public panX = 40;
  public panY = 40;
  private isPanning = false;
  private panStartX = 0;
  private panStartY = 0;

  // Interaction
  private isMouseDown = false;
  private dragStartTileX = 0;
  private dragStartTileY = 0;
  public hoverTileX = -1;
  public hoverTileY = -1;

  // History stack (Undo/Redo)
  private undoStack: string[] = [];
  private redoStack: string[] = [];

  constructor() {
    this.canvas = document.getElementById('editor-canvas') as HTMLCanvasElement;
    this.ctx = this.canvas.getContext('2d')!;
    this.viewport = document.getElementById('viewport')!;

    this.initGrid();
    this.loadFromLocalStorage();
    this.syncUI();
    this.initEventListeners();
    this.loadImage(this.imagePath);
    this.updateMarkerLists();
    this.render();
  }

  public syncUI(): void {
    const inputW = document.getElementById('input-tiles-w') as HTMLInputElement | null;
    const inputH = document.getElementById('input-tiles-h') as HTMLInputElement | null;
    const selectArt = document.getElementById('select-art') as HTMLSelectElement | null;

    if (inputW) inputW.value = String(this.widthTiles);
    if (inputH) inputH.value = String(this.heightTiles);
    if (selectArt && this.imagePath) {
      selectArt.value = this.imagePath;
    }
  }

  public resolveImagePath(path: string): string {
    if (!path) return '';
    if (path.startsWith('data:') || path.startsWith('blob:') || path.startsWith('http')) return path;

    // Normalize path by stripping leading slash or public prefixes
    const clean = path.replace(/^\/?(apps\/client\/public\/|public\/)?/, '');

    // Check if running in a subpath like Live Server (/apps/client/painter.html) or file://
    const pathname = window.location.pathname;
    const isFileProto = window.location.protocol === 'file:';
    const isSubpath = pathname.includes('/apps/client/');

    if (isFileProto || isSubpath) {
      return './public/' + clean;
    }

    return '/' + clean;
  }

  /**
   * Initializes the grid to fully BLOCKED (all 1s), per Prompt 5 spec.
   */
  public initGrid(): void {
    this.collision = [];
    for (let y = 0; y < this.heightTiles; y++) {
      const row: number[] = [];
      for (let x = 0; x < this.widthTiles; x++) {
        row.push(1); // Default ALL blocked
      }
      this.collision.push(row);
    }
  }

  public setAllBlocked(): void {
    this.saveState();
    for (let y = 0; y < this.heightTiles; y++) {
      for (let x = 0; x < this.widthTiles; x++) {
        this.collision[y][x] = 1;
      }
    }
    this.saveToLocalStorage();
    this.render();
  }

  public clearAllWalkable(): void {
    this.saveState();
    for (let y = 0; y < this.heightTiles; y++) {
      for (let x = 0; x < this.widthTiles; x++) {
        this.collision[y][x] = 0;
      }
    }
    this.saveToLocalStorage();
    this.render();
  }

  private saveState(): void {
    const serialized = JSON.stringify({
      collision: this.collision,
      hotspots: this.hotspots,
      spawns: this.spawns,
      widthTiles: this.widthTiles,
      heightTiles: this.heightTiles,
    });
    this.undoStack.push(serialized);
    if (this.undoStack.length > 50) this.undoStack.shift();
    this.redoStack = [];
    this.saveToLocalStorage();
  }

  public undo(): void {
    if (this.undoStack.length === 0) return;
    const currentState = JSON.stringify({
      collision: this.collision,
      hotspots: this.hotspots,
      spawns: this.spawns,
      widthTiles: this.widthTiles,
      heightTiles: this.heightTiles,
    });
    this.redoStack.push(currentState);
    const prev = JSON.parse(this.undoStack.pop()!);
    this.collision = prev.collision;
    this.hotspots = prev.hotspots;
    this.spawns = prev.spawns;
    this.updateMarkerLists();
    this.render();
  }

  public redo(): void {
    if (this.redoStack.length === 0) return;
    const currentState = JSON.stringify({
      collision: this.collision,
      hotspots: this.hotspots,
      spawns: this.spawns,
      widthTiles: this.widthTiles,
      heightTiles: this.heightTiles,
    });
    this.undoStack.push(currentState);
    const next = JSON.parse(this.redoStack.pop()!);
    this.collision = next.collision;
    this.hotspots = next.hotspots;
    this.spawns = next.spawns;
    this.updateMarkerLists();
    this.render();
  }

  private saveToLocalStorage(): void {
    try {
      const data = {
        widthTiles: this.widthTiles,
        heightTiles: this.heightTiles,
        imagePath: this.imagePath,
        collision: this.collision,
        hotspots: this.hotspots,
        spawns: this.spawns,
      };
      localStorage.setItem('heist_painter_state', JSON.stringify(data));
    } catch {}
  }

  private loadFromLocalStorage(): void {
    try {
      const raw = localStorage.getItem('heist_painter_state');
      if (!raw) return;
      const data = JSON.parse(raw);
      if (typeof data.widthTiles === 'number') this.widthTiles = data.widthTiles;
      if (typeof data.heightTiles === 'number') this.heightTiles = data.heightTiles;
      if (typeof data.imagePath === 'string') this.imagePath = data.imagePath;
      if (
        Array.isArray(data.collision) &&
        data.collision.length === this.heightTiles &&
        Array.isArray(data.collision[0]) &&
        data.collision[0].length === this.widthTiles
      ) {
        this.collision = data.collision;
      } else {
        this.initGrid();
      }
      if (Array.isArray(data.hotspots)) this.hotspots = data.hotspots;
      if (Array.isArray(data.spawns) && data.spawns.length > 0) this.spawns = data.spawns;
    } catch {
      this.initGrid();
    }
  }

  public loadImage(path: string): void {
    this.imagePath = path;
    const resolved = this.resolveImagePath(path);
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.src = resolved;
    img.onload = () => {
      this.bgImage = img;
      this.imageLoaded = true;
      this.computeTileColorCache();
      this.render();
    };
    img.onerror = () => {
      console.warn(`[Painter] Failed to load image at "${resolved}". Attempting fallback...`);
      const fallback = resolved.startsWith('./public/')
        ? '/' + resolved.replace('./public/', '')
        : './public/' + resolved.replace(/^\//, '');
      if (fallback !== resolved) {
        const retry = new Image();
        retry.crossOrigin = 'anonymous';
        retry.src = fallback;
        retry.onload = () => {
          this.bgImage = retry;
          this.imageLoaded = true;
          this.computeTileColorCache();
          this.render();
        };
        retry.onerror = () => {
          console.error(`[Painter] Failed to load image at fallback "${fallback}".`);
        };
      }
    };
  }

  private computeTileColorCache(): void {
    if (!this.bgImage || !this.imageLoaded) return;

    try {
      const sampleCanvas = document.createElement('canvas');
      sampleCanvas.width = this.widthTiles * this.tileSize;
      sampleCanvas.height = this.heightTiles * this.tileSize;
      const sctx = sampleCanvas.getContext('2d', { willReadFrequently: true });
      if (!sctx) return;

      sctx.drawImage(this.bgImage, 0, 0, sampleCanvas.width, sampleCanvas.height);
      const imgData = sctx.getImageData(0, 0, sampleCanvas.width, sampleCanvas.height).data;

      this.tileColorCache = [];
      for (let ty = 0; ty < this.heightTiles; ty++) {
        const row: Array<{ r: number; g: number; b: number }> = [];
        for (let tx = 0; tx < this.widthTiles; tx++) {
          let sumR = 0, sumG = 0, sumB = 0, count = 0;
          for (let py = 4; py < 28; py += 4) {
            for (let px = 4; px < 28; px += 4) {
              const idx = ((ty * 32 + py) * sampleCanvas.width + (tx * 32 + px)) * 4;
              sumR += imgData[idx];
              sumG += imgData[idx + 1];
              sumB += imgData[idx + 2];
              count++;
            }
          }
          row.push({
            r: sumR / count,
            g: sumG / count,
            b: sumB / count,
          });
        }
        this.tileColorCache.push(row);
      }
    } catch (e) {
      console.warn('[Painter] Could not compute tile color cache:', e);
    }
  }

  // ── Magic Wand Implementation ────────────────────────────────────

  public runMagicWand(startX: number, startY: number): void {
    if (
      startX < 0 ||
      startX >= this.widthTiles ||
      startY < 0 ||
      startY >= this.heightTiles ||
      !this.tileColorCache[startY]
    ) {
      return;
    }

    const baseColor = this.tileColorCache[startY][startX];
    if (!baseColor) return;

    const selected = new Set<string>();
    const queue: [number, number][] = [[startX, startY]];
    selected.add(`${startX},${startY}`);

    // Color distance tolerance threshold (0 - 100% normalized by max sqrt(255^2 * 3) ~ 441.67)
    const maxDistance = (this.wandTolerance / 100) * 441.67;

    while (queue.length > 0) {
      const [cx, cy] = queue.shift()!;
      const neighbors: [number, number][] = [
        [cx + 1, cy],
        [cx - 1, cy],
        [cx, cy + 1],
        [cx, cy - 1],
      ];

      for (const [nx, ny] of neighbors) {
        if (nx < 0 || nx >= this.widthTiles || ny < 0 || ny >= this.heightTiles) continue;
        const key = `${nx},${ny}`;
        if (selected.has(key)) continue;

        const neighborColor = this.tileColorCache[ny]?.[nx];
        if (!neighborColor) continue;

        const dist = Math.sqrt(
          (neighborColor.r - baseColor.r) ** 2 +
          (neighborColor.g - baseColor.g) ** 2 +
          (neighborColor.b - baseColor.b) ** 2
        );

        if (dist <= maxDistance) {
          selected.add(key);
          queue.push([nx, ny]);
        }
      }
    }

    this.wandSelectedTiles = selected;
    this.updateWandUI();
    this.render();
  }

  public applyWandSelection(value: number): void {
    if (this.wandSelectedTiles.size === 0) return;
    this.saveState();
    for (const key of this.wandSelectedTiles) {
      const [xStr, yStr] = key.split(',');
      const x = parseInt(xStr);
      const y = parseInt(yStr);
      if (y >= 0 && y < this.heightTiles && x >= 0 && x < this.widthTiles) {
        this.collision[y][x] = value;
      }
    }
    this.wandSelectedTiles.clear();
    this.updateWandUI();
    this.saveToLocalStorage();
    this.render();
  }

  public clearWandSelection(): void {
    this.wandSelectedTiles.clear();
    this.updateWandUI();
    this.render();
  }

  private updateWandUI(): void {
    const status = document.getElementById('wand-selection-status');
    const rowActions = document.getElementById('row-wand-actions');
    const btnDeselect = document.getElementById('btn-wand-deselect');

    if (this.wandSelectedTiles.size > 0) {
      if (status) status.innerHTML = `<strong>${this.wandSelectedTiles.size} tiles selected</strong>`;
      if (rowActions) rowActions.style.display = 'flex';
      if (btnDeselect) btnDeselect.style.display = 'flex';
    } else {
      if (status) status.textContent = 'Click any tile to select connected similar colors.';
      if (rowActions) rowActions.style.display = 'none';
      if (btnDeselect) btnDeselect.style.display = 'none';
    }
  }

  // ── Walk Test Implementation ────────────────────────────────────

  public toggleWalkTest(): void {
    if (this.walkTestActive) {
      this.stopWalkTest();
    } else {
      this.startWalkTest();
    }
  }

  public startWalkTest(): void {
    this.walkTestActive = true;

    // Spawn avatar at hover tile or first spawn point or center
    let sx = this.hoverTileX >= 0 ? this.hoverTileX : this.spawns[0]?.x ?? 26;
    let sy = this.hoverTileY >= 0 ? this.hoverTileY : this.spawns[0]?.y ?? 14;

    this.walkAvatar = {
      tileX: sx,
      tileY: sy,
      prevTileX: sx,
      prevTileY: sy,
      dir: DIR.DOWN,
      animStart: performance.now(),
      animDuration: 250, // 250ms cadence
      isMoving: false,
    };

    const banner = document.getElementById('walk-banner');
    if (banner) banner.style.display = 'flex';
    document.getElementById('btn-toggle-walk-test')?.classList.add('active');

    this.activeWalkKeys.clear();
    this.startWalkLoop();
    this.render();
  }

  public stopWalkTest(): void {
    this.walkTestActive = false;
    if (this.walkLoopId !== null) {
      cancelAnimationFrame(this.walkLoopId);
      this.walkLoopId = null;
    }
    const banner = document.getElementById('walk-banner');
    if (banner) banner.style.display = 'none';
    document.getElementById('btn-toggle-walk-test')?.classList.remove('active');
    this.render();
  }

  private startWalkLoop(): void {
    const loop = (now: number) => {
      if (!this.walkTestActive) return;

      const avatar = this.walkAvatar;

      // Handle step completion
      if (avatar.isMoving) {
        const elapsed = now - avatar.animStart;
        if (elapsed >= avatar.animDuration) {
          avatar.prevTileX = avatar.tileX;
          avatar.prevTileY = avatar.tileY;
          avatar.isMoving = false;
        }
      }

      // If not currently stepping, evaluate key inputs
      if (!avatar.isMoving) {
        let dir: Direction | null = null;
        let dx = 0;
        let dy = 0;

        if (this.activeWalkKeys.has('KeyW') || this.activeWalkKeys.has('ArrowUp')) {
          dir = DIR.UP;
          dy = -1;
        } else if (this.activeWalkKeys.has('KeyS') || this.activeWalkKeys.has('ArrowDown')) {
          dir = DIR.DOWN;
          dy = 1;
        } else if (this.activeWalkKeys.has('KeyA') || this.activeWalkKeys.has('ArrowLeft')) {
          dir = DIR.LEFT;
          dx = -1;
        } else if (this.activeWalkKeys.has('KeyD') || this.activeWalkKeys.has('ArrowRight')) {
          dir = DIR.RIGHT;
          dx = 1;
        }

        if (dir !== null) {
          avatar.dir = dir;
          const nx = avatar.tileX + dx;
          const ny = avatar.tileY + dy;

          // Check against current editor collision grid
          if (
            nx >= 0 &&
            nx < this.widthTiles &&
            ny >= 0 &&
            ny < this.heightTiles &&
            this.collision[ny][nx] === 0
          ) {
            // Walkable! Start step
            avatar.prevTileX = avatar.tileX;
            avatar.prevTileY = avatar.tileY;
            avatar.tileX = nx;
            avatar.tileY = ny;
            avatar.animStart = now;
            avatar.animDuration = 250;
            avatar.isMoving = true;
          }
        }
      }

      this.render();
      this.walkLoopId = requestAnimationFrame(loop);
    };

    this.walkLoopId = requestAnimationFrame(loop);
  }

  // ── Drawing & Tools Helpers ─────────────────────────────────────

  private setTile(x: number, y: number, value: number): void {
    if (x < 0 || x >= this.widthTiles || y < 0 || y >= this.heightTiles) return;
    this.collision[y][x] = value;
  }

  private applyBrush(centerX: number, centerY: number, value: number): void {
    const half = Math.floor(this.brushSize / 2);
    for (let dy = -half; dy <= half; dy++) {
      for (let dx = -half; dx <= half; dx++) {
        this.setTile(centerX + dx, centerY + dy, value);
      }
    }
  }

  private floodFill(startX: number, startY: number, targetVal: number): void {
    if (startX < 0 || startX >= this.widthTiles || startY < 0 || startY >= this.heightTiles) return;
    const sourceVal = this.collision[startY][startX];
    if (sourceVal === targetVal) return;

    this.saveState();
    const queue: [number, number][] = [[startX, startY]];
    const visited = new Set<string>();

    while (queue.length > 0) {
      const [x, y] = queue.pop()!;
      const key = `${x},${y}`;
      if (visited.has(key)) continue;
      visited.add(key);

      if (x < 0 || x >= this.widthTiles || y < 0 || y >= this.heightTiles) continue;
      if (this.collision[y][x] !== sourceVal) continue;

      this.collision[y][x] = targetVal;
      queue.push([x + 1, y], [x - 1, y], [x, y + 1], [x, y - 1]);
    }
  }

  private applyRectFill(x1: number, y1: number, x2: number, y2: number, value: number): void {
    this.saveState();
    const minX = Math.max(0, Math.min(x1, x2));
    const maxX = Math.min(this.widthTiles - 1, Math.max(x1, x2));
    const minY = Math.max(0, Math.min(y1, y2));
    const maxY = Math.min(this.heightTiles - 1, Math.max(y1, y2));

    for (let y = minY; y <= maxY; y++) {
      for (let x = minX; x <= maxX; x++) {
        this.collision[y][x] = value;
      }
    }
  }

  public addHotspot(name: string, x: number, y: number): void {
    this.saveState();
    this.hotspots = this.hotspots.filter((h) => !(h.x === x && h.y === y));
    this.hotspots.push({ name, x, y });
    this.updateMarkerLists();
    this.render();
  }

  public removeHotspot(idx: number): void {
    this.saveState();
    this.hotspots.splice(idx, 1);
    this.updateMarkerLists();
    this.render();
  }

  public toggleSpawn(x: number, y: number): void {
    this.saveState();
    const existing = this.spawns.findIndex((s) => s.x === x && s.y === y);
    if (existing >= 0) {
      this.spawns.splice(existing, 1);
    } else {
      this.spawns.push({ x, y });
    }
    this.updateMarkerLists();
    this.render();
  }

  public removeSpawn(idx: number): void {
    this.saveState();
    this.spawns.splice(idx, 1);
    this.updateMarkerLists();
    this.render();
  }

  private updateMarkerLists(): void {
    const hsList = document.getElementById('hotspot-list');
    if (hsList) {
      hsList.innerHTML = this.hotspots
        .map(
          (h, i) => `
        <div class="list-item">
          <span>📍 <strong>${h.name}</strong> (${h.x}, ${h.y})</span>
          <button data-idx="${i}" class="btn-del-hs">✕</button>
        </div>`
        )
        .join('');

      hsList.querySelectorAll('.btn-del-hs').forEach((b) => {
        b.addEventListener('click', (e) => {
          const idx = parseInt((e.target as HTMLElement).getAttribute('data-idx')!);
          this.removeHotspot(idx);
        });
      });
    }

    const spList = document.getElementById('spawn-list');
    if (spList) {
      spList.innerHTML = this.spawns
        .map(
          (s, i) => `
        <div class="list-item">
          <span>🚩 Spawn #${i + 1} (${s.x}, ${s.y})</span>
          <button data-idx="${i}" class="btn-del-sp">✕</button>
        </div>`
        )
        .join('');

      spList.querySelectorAll('.btn-del-sp').forEach((b) => {
        b.addEventListener('click', (e) => {
          const idx = parseInt((e.target as HTMLElement).getAttribute('data-idx')!);
          this.removeSpawn(idx);
        });
      });
    }
  }

  public exportServerMap(): ServerMapData {
    const collisionRows: string[] = [];
    for (let y = 0; y < this.heightTiles; y++) {
      let row = '';
      for (let x = 0; x < this.widthTiles; x++) {
        row += this.collision[y][x] === 1 ? '1' : '0';
      }
      collisionRows.push(row);
    }

    // Default to centre spawn if none painted
    const defaultSpawns = [{ x: Math.floor(this.widthTiles / 2), y: Math.floor(this.heightTiles / 2) }];

    return {
      version: 1,
      width: this.widthTiles,
      height: this.heightTiles,
      collision: collisionRows,
      spawns: this.spawns.length > 0 ? this.spawns : defaultSpawns,
      hotspots: this.hotspots, // Strict: no auto-placement
    };
  }

  public exportPaintedManifest(): PaintedManifest {
    return {
      image: this.imagePath,
      tileSize: this.tileSize,
      widthTiles: this.widthTiles,
      heightTiles: this.heightTiles,
      coverRects: this.coverRects, // Default empty (no cover)
    };
  }

  public downloadFile(filename: string, content: string): void {
    const blob = new Blob([content], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }

  // ── Auto-Suggest (Heuristic under Advanced) ─────────────────────

  public runAutoSuggest(thresholdPercent: number): void {
    if (!this.bgImage || !this.imageLoaded) return;

    const sampleCanvas = document.createElement('canvas');
    sampleCanvas.width = this.widthTiles * this.tileSize;
    sampleCanvas.height = this.heightTiles * this.tileSize;
    const sctx = sampleCanvas.getContext('2d')!;
    sctx.drawImage(this.bgImage, 0, 0, sampleCanvas.width, sampleCanvas.height);

    const imgData = sctx.getImageData(0, 0, sampleCanvas.width, sampleCanvas.height).data;
    const draft: number[][] = [];
    const threshold = (thresholdPercent / 100) * 255;

    for (let ty = 0; ty < this.heightTiles; ty++) {
      const row: number[] = [];
      for (let tx = 0; tx < this.widthTiles; tx++) {
        if (tx === 0 || ty === 0 || tx === this.widthTiles - 1 || ty === this.heightTiles - 1) {
          row.push(1);
          continue;
        }

        let totalLum = 0;
        let count = 0;
        for (let py = 6; py < 26; py += 4) {
          for (let px = 6; px < 26; px += 4) {
            const ix = (ty * 32 + py) * sampleCanvas.width + (tx * 32 + px);
            const r = imgData[ix * 4];
            const g = imgData[ix * 4 + 1];
            const b = imgData[ix * 4 + 2];
            totalLum += 0.299 * r + 0.587 * g + 0.114 * b;
            count++;
          }
        }
        const avgLum = totalLum / count;
        row.push(avgLum < threshold ? 1 : 0);
      }
      draft.push(row);
    }

    this.draftCollision = draft;
    const btnApply = document.getElementById('btn-apply-draft');
    if (btnApply) btnApply.style.display = 'flex';
    this.render();
  }

  public applyDraft(): void {
    if (!this.draftCollision) return;
    this.saveState();
    this.collision = this.draftCollision;
    this.draftCollision = null;
    const btnApply = document.getElementById('btn-apply-draft');
    if (btnApply) btnApply.style.display = 'none';
    this.render();
  }

  // ── Rendering Pipeline ──────────────────────────────────────────

  public render(): void {
    const mapPixelW = this.widthTiles * this.tileSize;
    const mapPixelH = this.heightTiles * this.tileSize;

    this.canvas.width = mapPixelW;
    this.canvas.height = mapPixelH;

    this.canvas.style.transformOrigin = '0 0';
    this.canvas.style.transform = `translate(${this.panX}px, ${this.panY}px) scale(${this.zoom})`;

    const ctx = this.ctx;
    ctx.imageSmoothingEnabled = false;
    ctx.clearRect(0, 0, mapPixelW, mapPixelH);

    // 1. Base Painted Image
    if (this.bgImage && this.imageLoaded) {
      ctx.drawImage(this.bgImage, 0, 0, mapPixelW, mapPixelH);
    } else {
      ctx.fillStyle = '#0f172a';
      ctx.fillRect(0, 0, mapPixelW, mapPixelH);
    }

    // 2. Cover Rectangles (supporting 'clone' mode)
    if (this.showCoverRects) {
      for (const rect of this.coverRects) {
        if (rect.mode === 'clone' && this.bgImage && this.imageLoaded) {
          const srcX = rect.srcX ?? (rect.x + rect.w <= mapPixelW ? rect.x + rect.w : Math.max(0, rect.x - rect.w));
          const srcY = rect.srcY ?? rect.y;

          const imgX = (srcX / mapPixelW) * this.bgImage.width;
          const imgY = (srcY / mapPixelH) * this.bgImage.height;
          const imgW = (rect.w / mapPixelW) * this.bgImage.width;
          const imgH = (rect.h / mapPixelH) * this.bgImage.height;

          ctx.drawImage(this.bgImage, imgX, imgY, imgW, imgH, rect.x, rect.y, rect.w, rect.h);
        } else {
          ctx.fillStyle = rect.color || '#030508';
          ctx.fillRect(rect.x, rect.y, rect.w, rect.h);
        }
      }
    }

    // 3. Collision Overlay
    if (this.showOverlay) {
      ctx.fillStyle = `rgba(239, 68, 68, ${this.overlayOpacity})`;
      for (let y = 0; y < this.heightTiles; y++) {
        for (let x = 0; x < this.widthTiles; x++) {
          if (this.collision[y][x] === 1) {
            ctx.fillRect(x * this.tileSize, y * this.tileSize, this.tileSize, this.tileSize);
          }
        }
      }

      // Draft suggestion preview (amber tint)
      if (this.draftCollision) {
        ctx.fillStyle = 'rgba(251, 191, 36, 0.4)';
        for (let y = 0; y < this.heightTiles; y++) {
          for (let x = 0; x < this.widthTiles; x++) {
            if (this.draftCollision[y][x] === 1 && this.collision[y][x] === 0) {
              ctx.fillRect(x * this.tileSize, y * this.tileSize, this.tileSize, this.tileSize);
            }
          }
        }
      }
    }

    // 4. Magic Wand Selected Tiles Preview (cyan highlight)
    if (this.wandSelectedTiles.size > 0) {
      ctx.fillStyle = 'rgba(6, 182, 212, 0.45)';
      ctx.strokeStyle = '#00f0ff';
      ctx.lineWidth = 1;

      for (const key of this.wandSelectedTiles) {
        const [xStr, yStr] = key.split(',');
        const x = parseInt(xStr);
        const y = parseInt(yStr);
        ctx.fillRect(x * this.tileSize, y * this.tileSize, this.tileSize, this.tileSize);
        ctx.strokeRect(x * this.tileSize + 0.5, y * this.tileSize + 0.5, this.tileSize - 1, this.tileSize - 1);
      }
    }

    // 5. 32px Grid Lines
    if (this.showGrid) {
      ctx.strokeStyle = 'rgba(255, 255, 255, 0.12)';
      ctx.lineWidth = 1;

      for (let x = 0; x <= this.widthTiles; x++) {
        ctx.beginPath();
        ctx.moveTo(x * this.tileSize + 0.5, 0);
        ctx.lineTo(x * this.tileSize + 0.5, mapPixelH);
        ctx.stroke();
      }

      for (let y = 0; y <= this.heightTiles; y++) {
        ctx.beginPath();
        ctx.moveTo(0, y * this.tileSize + 0.5);
        ctx.lineTo(mapPixelW, y * this.tileSize + 0.5);
        ctx.stroke();
      }
    }

    // 6. Landmarks / Hotspots
    for (const hs of this.hotspots) {
      const cx = hs.x * this.tileSize + this.tileSize / 2;
      const cy = hs.y * this.tileSize + this.tileSize / 2;

      ctx.fillStyle = '#f59e0b';
      ctx.beginPath();
      ctx.arc(cx, cy, 10, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = '#ffffff';
      ctx.lineWidth = 2;
      ctx.stroke();

      ctx.font = 'bold 11px monospace';
      ctx.textAlign = 'center';
      ctx.fillStyle = '#0f172a';
      ctx.fillText('H', cx, cy + 4);

      // Label
      ctx.fillStyle = 'rgba(15, 23, 42, 0.85)';
      const txt = hs.name.toUpperCase();
      const tw = ctx.measureText(txt).width;
      ctx.fillRect(cx - tw / 2 - 4, cy - 24, tw + 8, 14);
      ctx.strokeStyle = '#f59e0b';
      ctx.lineWidth = 1;
      ctx.strokeRect(cx - tw / 2 - 4, cy - 24, tw + 8, 14);
      ctx.fillStyle = '#fbbf24';
      ctx.fillText(txt, cx, cy - 13);
    }

    // 7. Spawn Points
    for (const sp of this.spawns) {
      const cx = sp.x * this.tileSize + this.tileSize / 2;
      const cy = sp.y * this.tileSize + this.tileSize / 2;

      ctx.fillStyle = '#00f0ff';
      ctx.beginPath();
      ctx.arc(cx, cy, 8, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = '#ffffff';
      ctx.lineWidth = 2;
      ctx.stroke();

      ctx.font = 'bold 9px monospace';
      ctx.textAlign = 'center';
      ctx.fillStyle = '#0f172a';
      ctx.fillText('S', cx, cy + 3);
    }

    // 8. Walk Test Avatar (if active)
    if (this.walkTestActive) {
      this.renderWalkAvatar(ctx);
    }

    // 9. Foot-test Mode Silhouette (if active and hovering)
    if (this.footTestMode && this.hoverTileX >= 0 && this.hoverTileY >= 0) {
      this.renderFootTest(ctx, this.hoverTileX, this.hoverTileY);
    } else if (this.hoverTileX >= 0 && this.hoverTileY >= 0 && !this.walkTestActive) {
      // Normal tool preview
      this.renderToolPreview(ctx);
    }
  }

  private renderFootTest(ctx: CanvasRenderingContext2D, hx: number, hy: number): void {
    if (hx < 0 || hx >= this.widthTiles || hy < 0 || hy >= this.heightTiles) return;

    const isBlocked = this.collision[hy][hx] === 1;
    const ts = this.tileSize;

    // 1. Footprint 32x32 tile highlight
    const footTileX = hx * ts;
    const footTileY = hy * ts;

    ctx.save();
    ctx.fillStyle = isBlocked ? 'rgba(239, 68, 68, 0.45)' : 'rgba(34, 197, 94, 0.45)';
    ctx.fillRect(footTileX, footTileY, ts, ts);

    ctx.strokeStyle = isBlocked ? '#ef4444' : '#22c55e';
    ctx.lineWidth = 2;
    ctx.strokeRect(footTileX + 1, footTileY + 1, ts - 2, ts - 2);

    // Foot anchor circle
    ctx.fillStyle = isBlocked ? '#f87171' : '#4ade80';
    ctx.beginPath();
    ctx.ellipse(footTileX + 16, footTileY + 30, 10, 4, 0, 0, Math.PI * 2);
    ctx.fill();

    // 2. 32x48 Player Silhouette standing with feet on this tile
    // rectLeft = hx * 32
    // rectTop = (hy + 1) * 32 - 48 = hy * 32 - 16
    const silX = hx * ts;
    const silY = (hy + 1) * ts - 48;
    const silW = 32;
    const silH = 48;

    // Drop shadow
    ctx.fillStyle = 'rgba(0, 0, 0, 0.5)';
    ctx.beginPath();
    ctx.ellipse(silX + 16, silY + 46, 12, 4, 0, 0, Math.PI * 2);
    ctx.fill();

    // Body gradient
    const grad = ctx.createLinearGradient(silX, silY, silX, silY + silH);
    if (isBlocked) {
      grad.addColorStop(0, '#f87171');
      grad.addColorStop(1, '#dc2626');
    } else {
      grad.addColorStop(0, '#4ade80');
      grad.addColorStop(1, '#16a34a');
    }
    ctx.fillStyle = grad;
    ctx.fillRect(silX, silY, silW, silH);

    // Border
    ctx.strokeStyle = '#ffffff';
    ctx.lineWidth = 1.5;
    ctx.strokeRect(silX + 0.75, silY + 0.75, silW - 1.5, silH - 1.5);

    // Visor eyes
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(silX + 8, silY + 10, 6, 3);
    ctx.fillRect(silX + 18, silY + 10, 6, 3);

    // Feet check label
    ctx.font = 'bold 9px monospace';
    ctx.textAlign = 'center';
    const tag = isBlocked ? 'FEET: BLOCKED' : 'FEET: WALKABLE';
    const tw = ctx.measureText(tag).width;

    ctx.fillStyle = 'rgba(3, 5, 8, 0.9)';
    ctx.fillRect(silX + 16 - tw / 2 - 4, silY - 14, tw + 8, 12);
    ctx.strokeStyle = isBlocked ? '#ef4444' : '#22c55e';
    ctx.lineWidth = 1;
    ctx.strokeRect(silX + 16 - tw / 2 - 4 + 0.5, silY - 14 + 0.5, tw + 7, 11);

    ctx.fillStyle = isBlocked ? '#f87171' : '#4ade80';
    ctx.fillText(tag, silX + 16, silY - 5);

    ctx.restore();
  }

  private renderWalkAvatar(ctx: CanvasRenderingContext2D): void {
    const avatar = this.walkAvatar;
    const now = performance.now();
    const elapsed = now - avatar.animStart;
    const t = Math.min(1.0, Math.max(0, elapsed / avatar.animDuration));

    const smoothX = avatar.prevTileX + (avatar.tileX - avatar.prevTileX) * t;
    const smoothY = avatar.prevTileY + (avatar.tileY - avatar.prevTileY) * t;

    const screenX = smoothX * this.tileSize;
    const screenY = (smoothY + 1) * this.tileSize - 48;
    const w = 32;
    const h = 48;

    ctx.save();

    // Drop shadow
    ctx.fillStyle = 'rgba(0, 0, 0, 0.45)';
    ctx.beginPath();
    ctx.ellipse(screenX + 16, screenY + 46, 12, 4, 0, 0, Math.PI * 2);
    ctx.fill();

    // Body
    const grad = ctx.createLinearGradient(screenX, screenY, screenX, screenY + h);
    grad.addColorStop(0, '#00f0ff');
    grad.addColorStop(1, '#0284c7');
    ctx.fillStyle = grad;
    ctx.fillRect(screenX, screenY, w, h);

    // Neon outline
    ctx.strokeStyle = '#ffffff';
    ctx.lineWidth = 1.5;
    ctx.strokeRect(screenX + 0.75, screenY + 0.75, w - 1.5, h - 1.5);

    // Direction indicators
    ctx.fillStyle = '#ffffff';
    const eyeY = screenY + 10;
    switch (avatar.dir) {
      case DIR.UP:
        ctx.fillStyle = '#0f172a';
        ctx.fillRect(screenX + 14, screenY + 8, 4, 18);
        break;
      case DIR.DOWN:
        ctx.fillRect(screenX + 8, eyeY, 6, 3);
        ctx.fillRect(screenX + 18, eyeY, 6, 3);
        break;
      case DIR.LEFT:
        ctx.fillRect(screenX + 4, eyeY, 8, 3);
        break;
      case DIR.RIGHT:
        ctx.fillRect(screenX + 20, eyeY, 8, 3);
        break;
    }

    // Label
    ctx.font = 'bold 9px monospace';
    ctx.textAlign = 'center';
    const label = '[WALK TEST AVATAR]';
    const lw = ctx.measureText(label).width;

    ctx.fillStyle = 'rgba(3, 5, 8, 0.85)';
    ctx.fillRect(screenX + 16 - lw / 2 - 4, screenY - 14, lw + 8, 12);
    ctx.strokeStyle = '#00f0ff';
    ctx.lineWidth = 1;
    ctx.strokeRect(screenX + 16 - lw / 2 - 4 + 0.5, screenY - 14 + 0.5, lw + 7, 11);

    ctx.fillStyle = '#38bdf8';
    ctx.fillText(label, screenX + 16, screenY - 5);

    ctx.restore();
  }

  private renderToolPreview(ctx: CanvasRenderingContext2D): void {
    const hx = this.hoverTileX;
    const hy = this.hoverTileY;

    if (this.currentTool === 'rect' && this.isMouseDown) {
      const minX = Math.min(this.dragStartTileX, hx);
      const maxX = Math.max(this.dragStartTileX, hx);
      const minY = Math.min(this.dragStartTileY, hy);
      const maxY = Math.max(this.dragStartTileY, hy);

      ctx.fillStyle = this.paintValue === 1 ? 'rgba(239, 68, 68, 0.4)' : 'rgba(16, 185, 129, 0.4)';
      ctx.fillRect(
        minX * this.tileSize,
        minY * this.tileSize,
        (maxX - minX + 1) * this.tileSize,
        (maxY - minY + 1) * this.tileSize
      );
      ctx.strokeStyle = '#ffffff';
      ctx.lineWidth = 1;
      ctx.strokeRect(
        minX * this.tileSize + 0.5,
        minY * this.tileSize + 0.5,
        (maxX - minX + 1) * this.tileSize - 1,
        (maxY - minY + 1) * this.tileSize - 1
      );
    } else if (this.currentTool === 'wand') {
      ctx.strokeStyle = '#00f0ff';
      ctx.lineWidth = 2;
      ctx.strokeRect(hx * this.tileSize + 1, hy * this.tileSize + 1, this.tileSize - 2, this.tileSize - 2);
    } else {
      const half = Math.floor(this.brushSize / 2);
      const bx = (hx - half) * this.tileSize;
      const by = (hy - half) * this.tileSize;
      const bw = this.brushSize * this.tileSize;
      const bh = this.brushSize * this.tileSize;

      ctx.strokeStyle = this.currentTool === 'eraser' ? '#10b981' : '#00f0ff';
      ctx.lineWidth = 2;
      ctx.strokeRect(bx + 1, by + 1, bw - 2, bh - 2);
    }
  }

  // ── Event Handlers ──────────────────────────────────────────────

  private initEventListeners(): void {
    // Mouse Down
    this.viewport.addEventListener('mousedown', (e) => {
      if (this.walkTestActive) return;

      if (e.button === 1 || e.shiftKey) {
        this.isPanning = true;
        this.panStartX = e.clientX - this.panX;
        this.panStartY = e.clientY - this.panY;
        return;
      }

      if (e.button === 0) {
        this.isMouseDown = true;
        const [tx, ty] = this.screenToTile(e.clientX, e.clientY);
        this.dragStartTileX = tx;
        this.dragStartTileY = ty;

        if (this.currentTool === 'brush') {
          this.saveState();
          this.applyBrush(tx, ty, this.paintValue);
        } else if (this.currentTool === 'eraser') {
          this.saveState();
          this.applyBrush(tx, ty, 0);
        } else if (this.currentTool === 'fill') {
          this.floodFill(tx, ty, this.paintValue);
        } else if (this.currentTool === 'wand') {
          this.runMagicWand(tx, ty);
        } else if (this.currentTool === 'hotspot') {
          const presetSelect = document.getElementById('select-hotspot-name') as HTMLSelectElement;
          const customInput = document.getElementById('input-custom-hotspot') as HTMLInputElement;
          const name = presetSelect.value === 'custom'
            ? (customInput?.value.trim() || 'custom_spot')
            : presetSelect.value;
          this.addHotspot(name, tx, ty);
        } else if (this.currentTool === 'spawn') {
          this.toggleSpawn(tx, ty);
        }
        this.render();
      }
    });

    // Mouse Move
    window.addEventListener('mousemove', (e) => {
      if (this.isPanning) {
        this.panX = e.clientX - this.panStartX;
        this.panY = e.clientY - this.panStartY;
        this.render();
        return;
      }

      const [tx, ty] = this.screenToTile(e.clientX, e.clientY);
      this.hoverTileX = tx;
      this.hoverTileY = ty;
      this.updateStatus(tx, ty);

      if (this.isMouseDown && !this.walkTestActive) {
        if (this.currentTool === 'brush') {
          this.applyBrush(tx, ty, this.paintValue);
        } else if (this.currentTool === 'eraser') {
          this.applyBrush(tx, ty, 0);
        }
      }
      this.render();
    });

    // Mouse Up
    window.addEventListener('mouseup', (e) => {
      if (this.isPanning) {
        this.isPanning = false;
      }

      if (this.isMouseDown) {
        this.isMouseDown = false;
        const [tx, ty] = this.screenToTile(e.clientX, e.clientY);
        if (this.currentTool === 'rect' && !this.walkTestActive) {
          this.applyRectFill(this.dragStartTileX, this.dragStartTileY, tx, ty, this.paintValue);
        }
        this.saveToLocalStorage();
        this.render();
      }
    });

    // Zoom on wheel
    this.viewport.addEventListener('wheel', (e) => {
      e.preventDefault();
      const zoomFactor = e.deltaY < 0 ? 1.15 : 0.85;
      const rect = this.viewport.getBoundingClientRect();
      const mouseX = e.clientX - rect.left;
      const mouseY = e.clientY - rect.top;

      const newZoom = Math.max(0.2, Math.min(5.0, this.zoom * zoomFactor));
      this.panX = mouseX - ((mouseX - this.panX) * newZoom) / this.zoom;
      this.panY = mouseY - ((mouseY - this.panY) * newZoom) / this.zoom;
      this.zoom = newZoom;

      const statZoom = document.getElementById('stat-zoom');
      if (statZoom) statZoom.textContent = `Zoom: ${Math.round(this.zoom * 100)}%`;
      this.render();
    });

    // Keyboard Shortcuts
    window.addEventListener('keydown', (e) => {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLSelectElement) return;

      // Walk test keys
      if (this.walkTestActive) {
        if (e.key === 'Escape') {
          e.preventDefault();
          this.stopWalkTest();
          return;
        }
        if (['KeyW', 'KeyA', 'KeyS', 'KeyD', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(e.code)) {
          e.preventDefault();
          this.activeWalkKeys.add(e.code);
          return;
        }
      }

      // If walk test is inactive, pressing 'W' spawns Walk Test!
      if (!this.walkTestActive && e.code === 'KeyW') {
        e.preventDefault();
        this.startWalkTest();
        return;
      }

      // Foot-test shortcut: 'F' toggles foot test mode
      if (e.code === 'KeyF') {
        this.footTestMode = !this.footTestMode;
        document.getElementById('btn-toggle-foot-test')?.classList.toggle('active', this.footTestMode);
        this.render();
        return;
      }

      // Undo/Redo
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z') {
        e.preventDefault();
        if (e.shiftKey) this.redo();
        else this.undo();
      } else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'y') {
        e.preventDefault();
        this.redo();
      } else if (e.key === '1') {
        this.setPaintMode(1);
      } else if (e.key === '0') {
        this.setPaintMode(0);
      } else if (e.key.toLowerCase() === 'b') {
        this.setTool('brush');
      } else if (e.key.toLowerCase() === 'r') {
        this.setTool('rect');
      } else if (e.key.toLowerCase() === 'g') {
        this.setTool('fill');
      } else if (e.key.toLowerCase() === 'e') {
        this.setTool('eraser');
      }
    });

    window.addEventListener('keyup', (e) => {
      if (this.walkTestActive) {
        this.activeWalkKeys.delete(e.code);
      }
    });

    // UI Buttons and Inputs
    document.getElementById('btn-undo')?.addEventListener('click', () => this.undo());
    document.getElementById('btn-redo')?.addEventListener('click', () => this.redo());
    document.getElementById('btn-reset-view')?.addEventListener('click', () => {
      this.panX = 40;
      this.panY = 40;
      this.zoom = 1.0;
      this.render();
    });

    document.getElementById('btn-export-map')?.addEventListener('click', () => {
      const data = this.exportServerMap();
      this.downloadFile('map.json', JSON.stringify(data, null, 2));
    });

    document.getElementById('btn-export-manifest')?.addEventListener('click', () => {
      const manifest = this.exportPaintedManifest();
      this.downloadFile('painted.json', JSON.stringify(manifest, null, 2));
    });

    document.getElementById('select-art')?.addEventListener('change', (e) => {
      const path = (e.target as HTMLSelectElement).value;
      this.loadImage(path);
    });

    document.getElementById('input-tiles-w')?.addEventListener('change', (e) => {
      const w = parseInt((e.target as HTMLInputElement).value);
      this.widthTiles = w;
      this.initGrid();
      this.render();
    });

    document.getElementById('input-tiles-h')?.addEventListener('change', (e) => {
      const h = parseInt((e.target as HTMLInputElement).value);
      this.heightTiles = h;
      this.initGrid();
      this.render();
    });

    document.getElementById('mode-blocked')?.addEventListener('click', () => this.setPaintMode(1));
    document.getElementById('mode-walkable')?.addEventListener('click', () => this.setPaintMode(0));

    document.getElementById('tool-brush')?.addEventListener('click', () => this.setTool('brush'));
    document.getElementById('tool-rect')?.addEventListener('click', () => this.setTool('rect'));
    document.getElementById('tool-fill')?.addEventListener('click', () => this.setTool('fill'));
    document.getElementById('tool-eraser')?.addEventListener('click', () => this.setTool('eraser'));
    document.getElementById('tool-wand')?.addEventListener('click', () => this.setTool('wand'));
    document.getElementById('tool-hotspot')?.addEventListener('click', () => this.setTool('hotspot'));
    document.getElementById('tool-spawn')?.addEventListener('click', () => this.setTool('spawn'));

    // Start from all blocked and Clear all
    document.getElementById('btn-start-all-blocked')?.addEventListener('click', () => this.setAllBlocked());
    document.getElementById('btn-clear-all')?.addEventListener('click', () => this.clearAllWalkable());

    // Foot-test and Walk-test UI buttons
    document.getElementById('btn-toggle-foot-test')?.addEventListener('click', () => {
      this.footTestMode = !this.footTestMode;
      document.getElementById('btn-toggle-foot-test')?.classList.toggle('active', this.footTestMode);
      this.render();
    });

    document.getElementById('btn-toggle-walk-test')?.addEventListener('click', () => this.toggleWalkTest());
    document.getElementById('btn-exit-walk-test')?.addEventListener('click', () => this.stopWalkTest());

    // Magic wand options
    const rngTolerance = document.getElementById('rng-wand-tolerance') as HTMLInputElement;
    rngTolerance?.addEventListener('input', () => {
      this.wandTolerance = parseInt(rngTolerance.value);
      const txt = document.getElementById('txt-wand-tolerance');
      if (txt) txt.textContent = `${rngTolerance.value}%`;
    });

    document.getElementById('btn-wand-mark-walkable')?.addEventListener('click', () => this.applyWandSelection(0));
    document.getElementById('btn-wand-mark-blocked')?.addEventListener('click', () => this.applyWandSelection(1));
    document.getElementById('btn-wand-deselect')?.addEventListener('click', () => this.clearWandSelection());

    // Hotspot preset dropdown
    const selectHotspot = document.getElementById('select-hotspot-name') as HTMLSelectElement;
    selectHotspot?.addEventListener('change', () => {
      const isCustom = selectHotspot.value === 'custom';
      const customRow = document.getElementById('row-custom-hotspot');
      if (customRow) customRow.style.display = isCustom ? 'flex' : 'none';
    });

    document.querySelectorAll('.btn-brush-size').forEach((btn) => {
      btn.addEventListener('click', (e) => {
        document.querySelectorAll('.btn-brush-size').forEach((b) => b.classList.remove('active'));
        const target = e.currentTarget as HTMLElement;
        target.classList.add('active');
        this.brushSize = parseInt(target.getAttribute('data-size')!);
      });
    });

    const chkOverlay = document.getElementById('chk-overlay') as HTMLInputElement;
    chkOverlay?.addEventListener('change', () => {
      this.showOverlay = chkOverlay.checked;
      this.render();
    });

    const rngOpacity = document.getElementById('rng-opacity') as HTMLInputElement;
    rngOpacity?.addEventListener('input', () => {
      this.overlayOpacity = parseInt(rngOpacity.value) / 100;
      const txt = document.getElementById('txt-opacity');
      if (txt) txt.textContent = `${rngOpacity.value}%`;
      this.render();
    });

    const chkGrid = document.getElementById('chk-grid') as HTMLInputElement;
    chkGrid?.addEventListener('change', () => {
      this.showGrid = chkGrid.checked;
      this.render();
    });

    const chkCover = document.getElementById('chk-cover-rects') as HTMLInputElement;
    chkCover?.addEventListener('change', () => {
      this.showCoverRects = chkCover.checked;
      this.render();
    });

    const rngDarkness = document.getElementById('rng-darkness') as HTMLInputElement;
    rngDarkness?.addEventListener('input', () => {
      const txt = document.getElementById('txt-darkness');
      if (txt) txt.textContent = `${rngDarkness.value}%`;
    });

    document.getElementById('btn-auto-suggest')?.addEventListener('click', () => {
      const thresh = parseInt((document.getElementById('rng-darkness') as HTMLInputElement).value);
      this.runAutoSuggest(thresh);
    });

    document.getElementById('btn-apply-draft')?.addEventListener('click', () => this.applyDraft());
  }

  private setPaintMode(val: number): void {
    this.paintValue = val;
    document.getElementById('mode-blocked')?.classList.toggle('active', val === 1);
    document.getElementById('mode-walkable')?.classList.toggle('active', val === 0);
  }

  private setTool(tool: 'brush' | 'rect' | 'fill' | 'eraser' | 'wand' | 'hotspot' | 'spawn'): void {
    this.currentTool = tool;
    document.querySelectorAll('.tool-grid .btn, #tool-hotspot, #tool-spawn').forEach((b) => b.classList.remove('active'));
    document.getElementById(`tool-${tool}`)?.classList.add('active');

    const wandSec = document.getElementById('section-wand-settings');
    if (wandSec) wandSec.style.display = tool === 'wand' ? 'flex' : 'none';
  }

  private screenToTile(clientX: number, clientY: number): [number, number] {
    const rect = this.viewport.getBoundingClientRect();
    const xInViewport = clientX - rect.left - this.panX;
    const yInViewport = clientY - rect.top - this.panY;

    const tileX = Math.floor(xInViewport / (this.tileSize * this.zoom));
    const tileY = Math.floor(yInViewport / (this.tileSize * this.zoom));

    return [tileX, tileY];
  }

  private updateStatus(tx: number, ty: number): void {
    const statCoords = document.getElementById('stat-coords');
    const statStatus = document.getElementById('stat-tile-status');

    if (tx >= 0 && tx < this.widthTiles && ty >= 0 && ty < this.heightTiles) {
      if (statCoords) statCoords.textContent = `Tile: (${tx}, ${ty})`;
      const isBlocked = this.collision[ty][tx] === 1;
      if (statStatus) {
        statStatus.textContent = isBlocked ? 'Type: BLOCKED (1)' : 'Type: WALKABLE (0)';
        statStatus.style.color = isBlocked ? '#f87171' : '#4ade80';
      }
    } else {
      if (statCoords) statCoords.textContent = `Tile: (Out of bounds)`;
      if (statStatus) {
        statStatus.textContent = 'Type: OUT OF BOUNDS (1)';
        statStatus.style.color = '#94a3b8';
      }
    }
  }
}

function initPainter(): void {
  if (!(window as unknown as { __PAINTER__: unknown }).__PAINTER__) {
    (window as unknown as { __PAINTER__: unknown }).__PAINTER__ = new CollisionPainter();
  }
}

if (document.readyState === 'loading') {
  window.addEventListener('DOMContentLoaded', initPainter);
} else {
  initPainter();
}
