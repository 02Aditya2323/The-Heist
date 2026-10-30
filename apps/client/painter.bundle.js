// ../../packages/shared/dist/constants.js
var DIR = {
  UP: 0,
  DOWN: 1,
  LEFT: 2,
  RIGHT: 3
};
var C2S = {
  MOVE: 1,
  PING: 2,
  JSON: 3
};
var S2C = {
  WELCOME: 129,
  ENTITY_ENTER: 130,
  ENTITY_LEAVE: 131,
  ENTITY_MOVE: 132,
  MOVE_ACK: 133,
  MOVE_REJECT: 134,
  PONG: 135,
  JSON: 136,
  KICK: 137,
  ENTITY_TELEPORT: 138
};
var DEFAULTS = {
  PORT: 8080,
  TICK_RATE: 20,
  // ticks per second
  STEP_TICKS: 5,
  // ticks per tile step (250 ms at 20 Hz)
  CHUNK_SIZE: 16,
  // tiles per chunk side (power of two)
  MAX_PLAYERS: 200,
  MAX_PENDING_MOVES: 2,
  MSG_RATE_PER_SEC: 30,
  MSG_BURST: 60,
  HEARTBEAT_TIMEOUT_MS: 15e3,
  GHOST_GRACE_MS: 3e4,
  SNAPSHOT_INTERVAL_MS: 3e4,
  BACKPRESSURE_BYTES: 256 * 1024,
  DB_URL: "sqlite:./data/heist.db",
  ALLOW_REGISTER: true,
  DEBUG_ENDPOINTS: true
};

// ../../packages/shared/dist/protocol.js
var C2S_SIZES = {
  [C2S.MOVE]: 3,
  // seq u16 + dir u8
  [C2S.PING]: 4,
  // clientTime u32
  [C2S.JSON]: "variable"
};
var S2C_SIZES = {
  [S2C.WELCOME]: 14,
  // selfId u16 + x u16 + y u16 + dir u8 + tickRate u8 + stepTicks u8 + mapVersion u16 + serverTick u32 = 14
  [S2C.ENTITY_ENTER]: "variable",
  // id u16 + x u16 + y u16 + dir u8 + nameLen u8 + name[nameLen]
  [S2C.ENTITY_LEAVE]: 2,
  // id u16
  [S2C.ENTITY_MOVE]: 7,
  // id u16 + x u16 + y u16 + dir u8
  [S2C.MOVE_ACK]: 6,
  // seq u16 + x u16 + y u16
  [S2C.MOVE_REJECT]: 7,
  // seq u16 + x u16 + y u16 + dir u8
  [S2C.PONG]: 8,
  // clientTime u32 + serverTick u32
  [S2C.JSON]: "variable",
  [S2C.KICK]: 1,
  // reason u8
  [S2C.ENTITY_TELEPORT]: 7
  // id u16 + x u16 + y u16 + dir u8
};

// ../../packages/shared/dist/chunks.js
function chunkKey(cx, cy) {
  return cy + 32768 << 16 | cx + 32768;
}
var CACHE_SIZE = 32;
var NEIGHBOURS_CACHE = new Array(CACHE_SIZE * CACHE_SIZE);
for (let cy = 0; cy < CACHE_SIZE; cy++) {
  for (let cx = 0; cx < CACHE_SIZE; cx++) {
    const keys = [];
    for (let dy = -1; dy <= 1; dy++) {
      for (let dx = -1; dx <= 1; dx++) {
        keys.push(chunkKey(cx + dx, cy + dy));
      }
    }
    NEIGHBOURS_CACHE[cy * CACHE_SIZE + cx] = keys;
  }
}

// src/painter/index.ts
var CollisionPainter = class {
  canvas;
  ctx;
  viewport;
  // Map settings
  widthTiles = 52;
  heightTiles = 29;
  tileSize = 32;
  imagePath = "/art/tech_quarter.png";
  bgImage = null;
  imageLoaded = false;
  // Collision Grid: 0 = walkable, 1 = blocked (default: fully blocked)
  collision = [];
  draftCollision = null;
  // Markers: default to single center spawn, empty hotspots, no coverRects
  hotspots = [];
  spawns = [{ x: 26, y: 14 }];
  coverRects = [];
  // Tool states: 'brush' | 'rect' | 'fill' | 'eraser' | 'wand' | 'hotspot' | 'spawn'
  currentTool = "brush";
  paintValue = 1;
  // 1 = blocked, 0 = walkable
  brushSize = 1;
  showOverlay = true;
  overlayOpacity = 0.5;
  showGrid = true;
  showCoverRects = true;
  // Magic Wand Tool State
  wandTolerance = 22;
  // 0 - 100%
  wandSelectedTiles = /* @__PURE__ */ new Set();
  tileColorCache = [];
  // Foot-test Mode
  footTestMode = false;
  // Walk-test Avatar State (250ms real step rate)
  walkTestActive = false;
  walkAvatar = {
    tileX: 26,
    tileY: 14,
    prevTileX: 26,
    prevTileY: 14,
    dir: DIR.DOWN,
    animStart: 0,
    animDuration: 250,
    isMoving: false
  };
  activeWalkKeys = /* @__PURE__ */ new Set();
  walkLoopId = null;
  // Pan & Zoom
  zoom = 1;
  panX = 40;
  panY = 40;
  isPanning = false;
  panStartX = 0;
  panStartY = 0;
  // Interaction
  isMouseDown = false;
  dragStartTileX = 0;
  dragStartTileY = 0;
  hoverTileX = -1;
  hoverTileY = -1;
  // History stack (Undo/Redo)
  undoStack = [];
  redoStack = [];
  constructor() {
    this.canvas = document.getElementById("editor-canvas");
    this.ctx = this.canvas.getContext("2d");
    this.viewport = document.getElementById("viewport");
    this.initGrid();
    this.loadFromLocalStorage();
    this.syncUI();
    this.initEventListeners();
    this.loadImage(this.imagePath);
    this.updateMarkerLists();
    this.render();
  }
  syncUI() {
    const inputW = document.getElementById("input-tiles-w");
    const inputH = document.getElementById("input-tiles-h");
    const selectArt = document.getElementById("select-art");
    if (inputW) inputW.value = String(this.widthTiles);
    if (inputH) inputH.value = String(this.heightTiles);
    if (selectArt && this.imagePath) {
      selectArt.value = this.imagePath;
    }
  }
  resolveImagePath(path) {
    if (!path) return "";
    if (path.startsWith("data:") || path.startsWith("blob:") || path.startsWith("http")) return path;
    const clean = path.replace(/^\/?(apps\/client\/public\/|public\/)?/, "");
    const pathname = window.location.pathname;
    const isFileProto = window.location.protocol === "file:";
    const isSubpath = pathname.includes("/apps/client/");
    if (isFileProto || isSubpath) {
      return "./public/" + clean;
    }
    return "/" + clean;
  }
  /**
   * Initializes the grid to fully BLOCKED (all 1s), per Prompt 5 spec.
   */
  initGrid() {
    this.collision = [];
    for (let y = 0; y < this.heightTiles; y++) {
      const row = [];
      for (let x = 0; x < this.widthTiles; x++) {
        row.push(1);
      }
      this.collision.push(row);
    }
  }
  setAllBlocked() {
    this.saveState();
    for (let y = 0; y < this.heightTiles; y++) {
      for (let x = 0; x < this.widthTiles; x++) {
        this.collision[y][x] = 1;
      }
    }
    this.saveToLocalStorage();
    this.render();
  }
  clearAllWalkable() {
    this.saveState();
    for (let y = 0; y < this.heightTiles; y++) {
      for (let x = 0; x < this.widthTiles; x++) {
        this.collision[y][x] = 0;
      }
    }
    this.saveToLocalStorage();
    this.render();
  }
  saveState() {
    const serialized = JSON.stringify({
      collision: this.collision,
      hotspots: this.hotspots,
      spawns: this.spawns,
      widthTiles: this.widthTiles,
      heightTiles: this.heightTiles
    });
    this.undoStack.push(serialized);
    if (this.undoStack.length > 50) this.undoStack.shift();
    this.redoStack = [];
    this.saveToLocalStorage();
  }
  undo() {
    if (this.undoStack.length === 0) return;
    const currentState = JSON.stringify({
      collision: this.collision,
      hotspots: this.hotspots,
      spawns: this.spawns,
      widthTiles: this.widthTiles,
      heightTiles: this.heightTiles
    });
    this.redoStack.push(currentState);
    const prev = JSON.parse(this.undoStack.pop());
    this.collision = prev.collision;
    this.hotspots = prev.hotspots;
    this.spawns = prev.spawns;
    this.updateMarkerLists();
    this.render();
  }
  redo() {
    if (this.redoStack.length === 0) return;
    const currentState = JSON.stringify({
      collision: this.collision,
      hotspots: this.hotspots,
      spawns: this.spawns,
      widthTiles: this.widthTiles,
      heightTiles: this.heightTiles
    });
    this.undoStack.push(currentState);
    const next = JSON.parse(this.redoStack.pop());
    this.collision = next.collision;
    this.hotspots = next.hotspots;
    this.spawns = next.spawns;
    this.updateMarkerLists();
    this.render();
  }
  saveToLocalStorage() {
    try {
      const data = {
        widthTiles: this.widthTiles,
        heightTiles: this.heightTiles,
        imagePath: this.imagePath,
        collision: this.collision,
        hotspots: this.hotspots,
        spawns: this.spawns
      };
      localStorage.setItem("heist_painter_state", JSON.stringify(data));
    } catch {
    }
  }
  loadFromLocalStorage() {
    try {
      const raw = localStorage.getItem("heist_painter_state");
      if (!raw) return;
      const data = JSON.parse(raw);
      if (typeof data.widthTiles === "number") this.widthTiles = data.widthTiles;
      if (typeof data.heightTiles === "number") this.heightTiles = data.heightTiles;
      if (typeof data.imagePath === "string") this.imagePath = data.imagePath;
      if (Array.isArray(data.collision) && data.collision.length === this.heightTiles && Array.isArray(data.collision[0]) && data.collision[0].length === this.widthTiles) {
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
  loadImage(path) {
    this.imagePath = path;
    const resolved = this.resolveImagePath(path);
    const img = new Image();
    img.crossOrigin = "anonymous";
    img.src = resolved;
    img.onload = () => {
      this.bgImage = img;
      this.imageLoaded = true;
      this.computeTileColorCache();
      this.render();
    };
    img.onerror = () => {
      console.warn(`[Painter] Failed to load image at "${resolved}". Attempting fallback...`);
      const fallback = resolved.startsWith("./public/") ? "/" + resolved.replace("./public/", "") : "./public/" + resolved.replace(/^\//, "");
      if (fallback !== resolved) {
        const retry = new Image();
        retry.crossOrigin = "anonymous";
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
  computeTileColorCache() {
    if (!this.bgImage || !this.imageLoaded) return;
    try {
      const sampleCanvas = document.createElement("canvas");
      sampleCanvas.width = this.widthTiles * this.tileSize;
      sampleCanvas.height = this.heightTiles * this.tileSize;
      const sctx = sampleCanvas.getContext("2d", { willReadFrequently: true });
      if (!sctx) return;
      sctx.drawImage(this.bgImage, 0, 0, sampleCanvas.width, sampleCanvas.height);
      const imgData = sctx.getImageData(0, 0, sampleCanvas.width, sampleCanvas.height).data;
      this.tileColorCache = [];
      for (let ty = 0; ty < this.heightTiles; ty++) {
        const row = [];
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
            b: sumB / count
          });
        }
        this.tileColorCache.push(row);
      }
    } catch (e) {
      console.warn("[Painter] Could not compute tile color cache:", e);
    }
  }
  // ── Magic Wand Implementation ────────────────────────────────────
  runMagicWand(startX, startY) {
    if (startX < 0 || startX >= this.widthTiles || startY < 0 || startY >= this.heightTiles || !this.tileColorCache[startY]) {
      return;
    }
    const baseColor = this.tileColorCache[startY][startX];
    if (!baseColor) return;
    const selected = /* @__PURE__ */ new Set();
    const queue = [[startX, startY]];
    selected.add(`${startX},${startY}`);
    const maxDistance = this.wandTolerance / 100 * 441.67;
    while (queue.length > 0) {
      const [cx, cy] = queue.shift();
      const neighbors = [
        [cx + 1, cy],
        [cx - 1, cy],
        [cx, cy + 1],
        [cx, cy - 1]
      ];
      for (const [nx, ny] of neighbors) {
        if (nx < 0 || nx >= this.widthTiles || ny < 0 || ny >= this.heightTiles) continue;
        const key = `${nx},${ny}`;
        if (selected.has(key)) continue;
        const neighborColor = this.tileColorCache[ny]?.[nx];
        if (!neighborColor) continue;
        const dist = Math.sqrt(
          (neighborColor.r - baseColor.r) ** 2 + (neighborColor.g - baseColor.g) ** 2 + (neighborColor.b - baseColor.b) ** 2
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
  applyWandSelection(value) {
    if (this.wandSelectedTiles.size === 0) return;
    this.saveState();
    for (const key of this.wandSelectedTiles) {
      const [xStr, yStr] = key.split(",");
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
  clearWandSelection() {
    this.wandSelectedTiles.clear();
    this.updateWandUI();
    this.render();
  }
  updateWandUI() {
    const status = document.getElementById("wand-selection-status");
    const rowActions = document.getElementById("row-wand-actions");
    const btnDeselect = document.getElementById("btn-wand-deselect");
    if (this.wandSelectedTiles.size > 0) {
      if (status) status.innerHTML = `<strong>${this.wandSelectedTiles.size} tiles selected</strong>`;
      if (rowActions) rowActions.style.display = "flex";
      if (btnDeselect) btnDeselect.style.display = "flex";
    } else {
      if (status) status.textContent = "Click any tile to select connected similar colors.";
      if (rowActions) rowActions.style.display = "none";
      if (btnDeselect) btnDeselect.style.display = "none";
    }
  }
  // ── Walk Test Implementation ────────────────────────────────────
  toggleWalkTest() {
    if (this.walkTestActive) {
      this.stopWalkTest();
    } else {
      this.startWalkTest();
    }
  }
  startWalkTest() {
    this.walkTestActive = true;
    let sx = this.hoverTileX >= 0 ? this.hoverTileX : this.spawns[0]?.x ?? 26;
    let sy = this.hoverTileY >= 0 ? this.hoverTileY : this.spawns[0]?.y ?? 14;
    this.walkAvatar = {
      tileX: sx,
      tileY: sy,
      prevTileX: sx,
      prevTileY: sy,
      dir: DIR.DOWN,
      animStart: performance.now(),
      animDuration: 250,
      // 250ms cadence
      isMoving: false
    };
    const banner = document.getElementById("walk-banner");
    if (banner) banner.style.display = "flex";
    document.getElementById("btn-toggle-walk-test")?.classList.add("active");
    this.activeWalkKeys.clear();
    this.startWalkLoop();
    this.render();
  }
  stopWalkTest() {
    this.walkTestActive = false;
    if (this.walkLoopId !== null) {
      cancelAnimationFrame(this.walkLoopId);
      this.walkLoopId = null;
    }
    const banner = document.getElementById("walk-banner");
    if (banner) banner.style.display = "none";
    document.getElementById("btn-toggle-walk-test")?.classList.remove("active");
    this.render();
  }
  startWalkLoop() {
    const loop = (now) => {
      if (!this.walkTestActive) return;
      const avatar = this.walkAvatar;
      if (avatar.isMoving) {
        const elapsed = now - avatar.animStart;
        if (elapsed >= avatar.animDuration) {
          avatar.prevTileX = avatar.tileX;
          avatar.prevTileY = avatar.tileY;
          avatar.isMoving = false;
        }
      }
      if (!avatar.isMoving) {
        let dir = null;
        let dx = 0;
        let dy = 0;
        if (this.activeWalkKeys.has("KeyW") || this.activeWalkKeys.has("ArrowUp")) {
          dir = DIR.UP;
          dy = -1;
        } else if (this.activeWalkKeys.has("KeyS") || this.activeWalkKeys.has("ArrowDown")) {
          dir = DIR.DOWN;
          dy = 1;
        } else if (this.activeWalkKeys.has("KeyA") || this.activeWalkKeys.has("ArrowLeft")) {
          dir = DIR.LEFT;
          dx = -1;
        } else if (this.activeWalkKeys.has("KeyD") || this.activeWalkKeys.has("ArrowRight")) {
          dir = DIR.RIGHT;
          dx = 1;
        }
        if (dir !== null) {
          avatar.dir = dir;
          const nx = avatar.tileX + dx;
          const ny = avatar.tileY + dy;
          if (nx >= 0 && nx < this.widthTiles && ny >= 0 && ny < this.heightTiles && this.collision[ny][nx] === 0) {
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
  setTile(x, y, value) {
    if (x < 0 || x >= this.widthTiles || y < 0 || y >= this.heightTiles) return;
    this.collision[y][x] = value;
  }
  applyBrush(centerX, centerY, value) {
    const half = Math.floor(this.brushSize / 2);
    for (let dy = -half; dy <= half; dy++) {
      for (let dx = -half; dx <= half; dx++) {
        this.setTile(centerX + dx, centerY + dy, value);
      }
    }
  }
  floodFill(startX, startY, targetVal) {
    if (startX < 0 || startX >= this.widthTiles || startY < 0 || startY >= this.heightTiles) return;
    const sourceVal = this.collision[startY][startX];
    if (sourceVal === targetVal) return;
    this.saveState();
    const queue = [[startX, startY]];
    const visited = /* @__PURE__ */ new Set();
    while (queue.length > 0) {
      const [x, y] = queue.pop();
      const key = `${x},${y}`;
      if (visited.has(key)) continue;
      visited.add(key);
      if (x < 0 || x >= this.widthTiles || y < 0 || y >= this.heightTiles) continue;
      if (this.collision[y][x] !== sourceVal) continue;
      this.collision[y][x] = targetVal;
      queue.push([x + 1, y], [x - 1, y], [x, y + 1], [x, y - 1]);
    }
  }
  applyRectFill(x1, y1, x2, y2, value) {
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
  addHotspot(name, x, y) {
    this.saveState();
    this.hotspots = this.hotspots.filter((h) => !(h.x === x && h.y === y));
    this.hotspots.push({ name, x, y });
    this.updateMarkerLists();
    this.render();
  }
  removeHotspot(idx) {
    this.saveState();
    this.hotspots.splice(idx, 1);
    this.updateMarkerLists();
    this.render();
  }
  toggleSpawn(x, y) {
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
  removeSpawn(idx) {
    this.saveState();
    this.spawns.splice(idx, 1);
    this.updateMarkerLists();
    this.render();
  }
  updateMarkerLists() {
    const hsList = document.getElementById("hotspot-list");
    if (hsList) {
      hsList.innerHTML = this.hotspots.map(
        (h, i) => `
        <div class="list-item">
          <span>\u{1F4CD} <strong>${h.name}</strong> (${h.x}, ${h.y})</span>
          <button data-idx="${i}" class="btn-del-hs">\u2715</button>
        </div>`
      ).join("");
      hsList.querySelectorAll(".btn-del-hs").forEach((b) => {
        b.addEventListener("click", (e) => {
          const idx = parseInt(e.target.getAttribute("data-idx"));
          this.removeHotspot(idx);
        });
      });
    }
    const spList = document.getElementById("spawn-list");
    if (spList) {
      spList.innerHTML = this.spawns.map(
        (s, i) => `
        <div class="list-item">
          <span>\u{1F6A9} Spawn #${i + 1} (${s.x}, ${s.y})</span>
          <button data-idx="${i}" class="btn-del-sp">\u2715</button>
        </div>`
      ).join("");
      spList.querySelectorAll(".btn-del-sp").forEach((b) => {
        b.addEventListener("click", (e) => {
          const idx = parseInt(e.target.getAttribute("data-idx"));
          this.removeSpawn(idx);
        });
      });
    }
  }
  exportServerMap() {
    const collisionRows = [];
    for (let y = 0; y < this.heightTiles; y++) {
      let row = "";
      for (let x = 0; x < this.widthTiles; x++) {
        row += this.collision[y][x] === 1 ? "1" : "0";
      }
      collisionRows.push(row);
    }
    const defaultSpawns = [{ x: Math.floor(this.widthTiles / 2), y: Math.floor(this.heightTiles / 2) }];
    return {
      version: 1,
      width: this.widthTiles,
      height: this.heightTiles,
      collision: collisionRows,
      spawns: this.spawns.length > 0 ? this.spawns : defaultSpawns,
      hotspots: this.hotspots
      // Strict: no auto-placement
    };
  }
  exportPaintedManifest() {
    return {
      image: this.imagePath,
      tileSize: this.tileSize,
      widthTiles: this.widthTiles,
      heightTiles: this.heightTiles,
      coverRects: this.coverRects
      // Default empty (no cover)
    };
  }
  downloadFile(filename, content) {
    const blob = new Blob([content], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }
  // ── Auto-Suggest (Heuristic under Advanced) ─────────────────────
  runAutoSuggest(thresholdPercent) {
    if (!this.bgImage || !this.imageLoaded) return;
    const sampleCanvas = document.createElement("canvas");
    sampleCanvas.width = this.widthTiles * this.tileSize;
    sampleCanvas.height = this.heightTiles * this.tileSize;
    const sctx = sampleCanvas.getContext("2d");
    sctx.drawImage(this.bgImage, 0, 0, sampleCanvas.width, sampleCanvas.height);
    const imgData = sctx.getImageData(0, 0, sampleCanvas.width, sampleCanvas.height).data;
    const draft = [];
    const threshold = thresholdPercent / 100 * 255;
    for (let ty = 0; ty < this.heightTiles; ty++) {
      const row = [];
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
    const btnApply = document.getElementById("btn-apply-draft");
    if (btnApply) btnApply.style.display = "flex";
    this.render();
  }
  applyDraft() {
    if (!this.draftCollision) return;
    this.saveState();
    this.collision = this.draftCollision;
    this.draftCollision = null;
    const btnApply = document.getElementById("btn-apply-draft");
    if (btnApply) btnApply.style.display = "none";
    this.render();
  }
  // ── Rendering Pipeline ──────────────────────────────────────────
  render() {
    const mapPixelW = this.widthTiles * this.tileSize;
    const mapPixelH = this.heightTiles * this.tileSize;
    this.canvas.width = mapPixelW;
    this.canvas.height = mapPixelH;
    this.canvas.style.transformOrigin = "0 0";
    this.canvas.style.transform = `translate(${this.panX}px, ${this.panY}px) scale(${this.zoom})`;
    const ctx = this.ctx;
    ctx.imageSmoothingEnabled = false;
    ctx.clearRect(0, 0, mapPixelW, mapPixelH);
    if (this.bgImage && this.imageLoaded) {
      ctx.drawImage(this.bgImage, 0, 0, mapPixelW, mapPixelH);
    } else {
      ctx.fillStyle = "#0f172a";
      ctx.fillRect(0, 0, mapPixelW, mapPixelH);
    }
    if (this.showCoverRects) {
      for (const rect of this.coverRects) {
        if (rect.mode === "clone" && this.bgImage && this.imageLoaded) {
          const srcX = rect.srcX ?? (rect.x + rect.w <= mapPixelW ? rect.x + rect.w : Math.max(0, rect.x - rect.w));
          const srcY = rect.srcY ?? rect.y;
          const imgX = srcX / mapPixelW * this.bgImage.width;
          const imgY = srcY / mapPixelH * this.bgImage.height;
          const imgW = rect.w / mapPixelW * this.bgImage.width;
          const imgH = rect.h / mapPixelH * this.bgImage.height;
          ctx.drawImage(this.bgImage, imgX, imgY, imgW, imgH, rect.x, rect.y, rect.w, rect.h);
        } else {
          ctx.fillStyle = rect.color || "#030508";
          ctx.fillRect(rect.x, rect.y, rect.w, rect.h);
        }
      }
    }
    if (this.showOverlay) {
      ctx.fillStyle = `rgba(239, 68, 68, ${this.overlayOpacity})`;
      for (let y = 0; y < this.heightTiles; y++) {
        for (let x = 0; x < this.widthTiles; x++) {
          if (this.collision[y][x] === 1) {
            ctx.fillRect(x * this.tileSize, y * this.tileSize, this.tileSize, this.tileSize);
          }
        }
      }
      if (this.draftCollision) {
        ctx.fillStyle = "rgba(251, 191, 36, 0.4)";
        for (let y = 0; y < this.heightTiles; y++) {
          for (let x = 0; x < this.widthTiles; x++) {
            if (this.draftCollision[y][x] === 1 && this.collision[y][x] === 0) {
              ctx.fillRect(x * this.tileSize, y * this.tileSize, this.tileSize, this.tileSize);
            }
          }
        }
      }
    }
    if (this.wandSelectedTiles.size > 0) {
      ctx.fillStyle = "rgba(6, 182, 212, 0.45)";
      ctx.strokeStyle = "#00f0ff";
      ctx.lineWidth = 1;
      for (const key of this.wandSelectedTiles) {
        const [xStr, yStr] = key.split(",");
        const x = parseInt(xStr);
        const y = parseInt(yStr);
        ctx.fillRect(x * this.tileSize, y * this.tileSize, this.tileSize, this.tileSize);
        ctx.strokeRect(x * this.tileSize + 0.5, y * this.tileSize + 0.5, this.tileSize - 1, this.tileSize - 1);
      }
    }
    if (this.showGrid) {
      ctx.strokeStyle = "rgba(255, 255, 255, 0.12)";
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
    for (const hs of this.hotspots) {
      const cx = hs.x * this.tileSize + this.tileSize / 2;
      const cy = hs.y * this.tileSize + this.tileSize / 2;
      ctx.fillStyle = "#f59e0b";
      ctx.beginPath();
      ctx.arc(cx, cy, 10, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = "#ffffff";
      ctx.lineWidth = 2;
      ctx.stroke();
      ctx.font = "bold 11px monospace";
      ctx.textAlign = "center";
      ctx.fillStyle = "#0f172a";
      ctx.fillText("H", cx, cy + 4);
      ctx.fillStyle = "rgba(15, 23, 42, 0.85)";
      const txt = hs.name.toUpperCase();
      const tw = ctx.measureText(txt).width;
      ctx.fillRect(cx - tw / 2 - 4, cy - 24, tw + 8, 14);
      ctx.strokeStyle = "#f59e0b";
      ctx.lineWidth = 1;
      ctx.strokeRect(cx - tw / 2 - 4, cy - 24, tw + 8, 14);
      ctx.fillStyle = "#fbbf24";
      ctx.fillText(txt, cx, cy - 13);
    }
    for (const sp of this.spawns) {
      const cx = sp.x * this.tileSize + this.tileSize / 2;
      const cy = sp.y * this.tileSize + this.tileSize / 2;
      ctx.fillStyle = "#00f0ff";
      ctx.beginPath();
      ctx.arc(cx, cy, 8, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = "#ffffff";
      ctx.lineWidth = 2;
      ctx.stroke();
      ctx.font = "bold 9px monospace";
      ctx.textAlign = "center";
      ctx.fillStyle = "#0f172a";
      ctx.fillText("S", cx, cy + 3);
    }
    if (this.walkTestActive) {
      this.renderWalkAvatar(ctx);
    }
    if (this.footTestMode && this.hoverTileX >= 0 && this.hoverTileY >= 0) {
      this.renderFootTest(ctx, this.hoverTileX, this.hoverTileY);
    } else if (this.hoverTileX >= 0 && this.hoverTileY >= 0 && !this.walkTestActive) {
      this.renderToolPreview(ctx);
    }
  }
  renderFootTest(ctx, hx, hy) {
    if (hx < 0 || hx >= this.widthTiles || hy < 0 || hy >= this.heightTiles) return;
    const isBlocked = this.collision[hy][hx] === 1;
    const ts = this.tileSize;
    const footTileX = hx * ts;
    const footTileY = hy * ts;
    ctx.save();
    ctx.fillStyle = isBlocked ? "rgba(239, 68, 68, 0.45)" : "rgba(34, 197, 94, 0.45)";
    ctx.fillRect(footTileX, footTileY, ts, ts);
    ctx.strokeStyle = isBlocked ? "#ef4444" : "#22c55e";
    ctx.lineWidth = 2;
    ctx.strokeRect(footTileX + 1, footTileY + 1, ts - 2, ts - 2);
    ctx.fillStyle = isBlocked ? "#f87171" : "#4ade80";
    ctx.beginPath();
    ctx.ellipse(footTileX + 16, footTileY + 30, 10, 4, 0, 0, Math.PI * 2);
    ctx.fill();
    const silX = hx * ts;
    const silY = (hy + 1) * ts - 48;
    const silW = 32;
    const silH = 48;
    ctx.fillStyle = "rgba(0, 0, 0, 0.5)";
    ctx.beginPath();
    ctx.ellipse(silX + 16, silY + 46, 12, 4, 0, 0, Math.PI * 2);
    ctx.fill();
    const grad = ctx.createLinearGradient(silX, silY, silX, silY + silH);
    if (isBlocked) {
      grad.addColorStop(0, "#f87171");
      grad.addColorStop(1, "#dc2626");
    } else {
      grad.addColorStop(0, "#4ade80");
      grad.addColorStop(1, "#16a34a");
    }
    ctx.fillStyle = grad;
    ctx.fillRect(silX, silY, silW, silH);
    ctx.strokeStyle = "#ffffff";
    ctx.lineWidth = 1.5;
    ctx.strokeRect(silX + 0.75, silY + 0.75, silW - 1.5, silH - 1.5);
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(silX + 8, silY + 10, 6, 3);
    ctx.fillRect(silX + 18, silY + 10, 6, 3);
    ctx.font = "bold 9px monospace";
    ctx.textAlign = "center";
    const tag = isBlocked ? "FEET: BLOCKED" : "FEET: WALKABLE";
    const tw = ctx.measureText(tag).width;
    ctx.fillStyle = "rgba(3, 5, 8, 0.9)";
    ctx.fillRect(silX + 16 - tw / 2 - 4, silY - 14, tw + 8, 12);
    ctx.strokeStyle = isBlocked ? "#ef4444" : "#22c55e";
    ctx.lineWidth = 1;
    ctx.strokeRect(silX + 16 - tw / 2 - 4 + 0.5, silY - 14 + 0.5, tw + 7, 11);
    ctx.fillStyle = isBlocked ? "#f87171" : "#4ade80";
    ctx.fillText(tag, silX + 16, silY - 5);
    ctx.restore();
  }
  renderWalkAvatar(ctx) {
    const avatar = this.walkAvatar;
    const now = performance.now();
    const elapsed = now - avatar.animStart;
    const t = Math.min(1, Math.max(0, elapsed / avatar.animDuration));
    const smoothX = avatar.prevTileX + (avatar.tileX - avatar.prevTileX) * t;
    const smoothY = avatar.prevTileY + (avatar.tileY - avatar.prevTileY) * t;
    const screenX = smoothX * this.tileSize;
    const screenY = (smoothY + 1) * this.tileSize - 48;
    const w = 32;
    const h = 48;
    ctx.save();
    ctx.fillStyle = "rgba(0, 0, 0, 0.45)";
    ctx.beginPath();
    ctx.ellipse(screenX + 16, screenY + 46, 12, 4, 0, 0, Math.PI * 2);
    ctx.fill();
    const grad = ctx.createLinearGradient(screenX, screenY, screenX, screenY + h);
    grad.addColorStop(0, "#00f0ff");
    grad.addColorStop(1, "#0284c7");
    ctx.fillStyle = grad;
    ctx.fillRect(screenX, screenY, w, h);
    ctx.strokeStyle = "#ffffff";
    ctx.lineWidth = 1.5;
    ctx.strokeRect(screenX + 0.75, screenY + 0.75, w - 1.5, h - 1.5);
    ctx.fillStyle = "#ffffff";
    const eyeY = screenY + 10;
    switch (avatar.dir) {
      case DIR.UP:
        ctx.fillStyle = "#0f172a";
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
    ctx.font = "bold 9px monospace";
    ctx.textAlign = "center";
    const label = "[WALK TEST AVATAR]";
    const lw = ctx.measureText(label).width;
    ctx.fillStyle = "rgba(3, 5, 8, 0.85)";
    ctx.fillRect(screenX + 16 - lw / 2 - 4, screenY - 14, lw + 8, 12);
    ctx.strokeStyle = "#00f0ff";
    ctx.lineWidth = 1;
    ctx.strokeRect(screenX + 16 - lw / 2 - 4 + 0.5, screenY - 14 + 0.5, lw + 7, 11);
    ctx.fillStyle = "#38bdf8";
    ctx.fillText(label, screenX + 16, screenY - 5);
    ctx.restore();
  }
  renderToolPreview(ctx) {
    const hx = this.hoverTileX;
    const hy = this.hoverTileY;
    if (this.currentTool === "rect" && this.isMouseDown) {
      const minX = Math.min(this.dragStartTileX, hx);
      const maxX = Math.max(this.dragStartTileX, hx);
      const minY = Math.min(this.dragStartTileY, hy);
      const maxY = Math.max(this.dragStartTileY, hy);
      ctx.fillStyle = this.paintValue === 1 ? "rgba(239, 68, 68, 0.4)" : "rgba(16, 185, 129, 0.4)";
      ctx.fillRect(
        minX * this.tileSize,
        minY * this.tileSize,
        (maxX - minX + 1) * this.tileSize,
        (maxY - minY + 1) * this.tileSize
      );
      ctx.strokeStyle = "#ffffff";
      ctx.lineWidth = 1;
      ctx.strokeRect(
        minX * this.tileSize + 0.5,
        minY * this.tileSize + 0.5,
        (maxX - minX + 1) * this.tileSize - 1,
        (maxY - minY + 1) * this.tileSize - 1
      );
    } else if (this.currentTool === "wand") {
      ctx.strokeStyle = "#00f0ff";
      ctx.lineWidth = 2;
      ctx.strokeRect(hx * this.tileSize + 1, hy * this.tileSize + 1, this.tileSize - 2, this.tileSize - 2);
    } else {
      const half = Math.floor(this.brushSize / 2);
      const bx = (hx - half) * this.tileSize;
      const by = (hy - half) * this.tileSize;
      const bw = this.brushSize * this.tileSize;
      const bh = this.brushSize * this.tileSize;
      ctx.strokeStyle = this.currentTool === "eraser" ? "#10b981" : "#00f0ff";
      ctx.lineWidth = 2;
      ctx.strokeRect(bx + 1, by + 1, bw - 2, bh - 2);
    }
  }
  // ── Event Handlers ──────────────────────────────────────────────
  initEventListeners() {
    this.viewport.addEventListener("mousedown", (e) => {
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
        if (this.currentTool === "brush") {
          this.saveState();
          this.applyBrush(tx, ty, this.paintValue);
        } else if (this.currentTool === "eraser") {
          this.saveState();
          this.applyBrush(tx, ty, 0);
        } else if (this.currentTool === "fill") {
          this.floodFill(tx, ty, this.paintValue);
        } else if (this.currentTool === "wand") {
          this.runMagicWand(tx, ty);
        } else if (this.currentTool === "hotspot") {
          const presetSelect = document.getElementById("select-hotspot-name");
          const customInput = document.getElementById("input-custom-hotspot");
          const name = presetSelect.value === "custom" ? customInput?.value.trim() || "custom_spot" : presetSelect.value;
          this.addHotspot(name, tx, ty);
        } else if (this.currentTool === "spawn") {
          this.toggleSpawn(tx, ty);
        }
        this.render();
      }
    });
    window.addEventListener("mousemove", (e) => {
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
        if (this.currentTool === "brush") {
          this.applyBrush(tx, ty, this.paintValue);
        } else if (this.currentTool === "eraser") {
          this.applyBrush(tx, ty, 0);
        }
      }
      this.render();
    });
    window.addEventListener("mouseup", (e) => {
      if (this.isPanning) {
        this.isPanning = false;
      }
      if (this.isMouseDown) {
        this.isMouseDown = false;
        const [tx, ty] = this.screenToTile(e.clientX, e.clientY);
        if (this.currentTool === "rect" && !this.walkTestActive) {
          this.applyRectFill(this.dragStartTileX, this.dragStartTileY, tx, ty, this.paintValue);
        }
        this.saveToLocalStorage();
        this.render();
      }
    });
    this.viewport.addEventListener("wheel", (e) => {
      e.preventDefault();
      const zoomFactor = e.deltaY < 0 ? 1.15 : 0.85;
      const rect = this.viewport.getBoundingClientRect();
      const mouseX = e.clientX - rect.left;
      const mouseY = e.clientY - rect.top;
      const newZoom = Math.max(0.2, Math.min(5, this.zoom * zoomFactor));
      this.panX = mouseX - (mouseX - this.panX) * newZoom / this.zoom;
      this.panY = mouseY - (mouseY - this.panY) * newZoom / this.zoom;
      this.zoom = newZoom;
      const statZoom = document.getElementById("stat-zoom");
      if (statZoom) statZoom.textContent = `Zoom: ${Math.round(this.zoom * 100)}%`;
      this.render();
    });
    window.addEventListener("keydown", (e) => {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLSelectElement) return;
      if (this.walkTestActive) {
        if (e.key === "Escape") {
          e.preventDefault();
          this.stopWalkTest();
          return;
        }
        if (["KeyW", "KeyA", "KeyS", "KeyD", "ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight"].includes(e.code)) {
          e.preventDefault();
          this.activeWalkKeys.add(e.code);
          return;
        }
      }
      if (!this.walkTestActive && e.code === "KeyW") {
        e.preventDefault();
        this.startWalkTest();
        return;
      }
      if (e.code === "KeyF") {
        this.footTestMode = !this.footTestMode;
        document.getElementById("btn-toggle-foot-test")?.classList.toggle("active", this.footTestMode);
        this.render();
        return;
      }
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "z") {
        e.preventDefault();
        if (e.shiftKey) this.redo();
        else this.undo();
      } else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "y") {
        e.preventDefault();
        this.redo();
      } else if (e.key === "1") {
        this.setPaintMode(1);
      } else if (e.key === "0") {
        this.setPaintMode(0);
      } else if (e.key.toLowerCase() === "b") {
        this.setTool("brush");
      } else if (e.key.toLowerCase() === "r") {
        this.setTool("rect");
      } else if (e.key.toLowerCase() === "g") {
        this.setTool("fill");
      } else if (e.key.toLowerCase() === "e") {
        this.setTool("eraser");
      }
    });
    window.addEventListener("keyup", (e) => {
      if (this.walkTestActive) {
        this.activeWalkKeys.delete(e.code);
      }
    });
    document.getElementById("btn-undo")?.addEventListener("click", () => this.undo());
    document.getElementById("btn-redo")?.addEventListener("click", () => this.redo());
    document.getElementById("btn-reset-view")?.addEventListener("click", () => {
      this.panX = 40;
      this.panY = 40;
      this.zoom = 1;
      this.render();
    });
    document.getElementById("btn-export-map")?.addEventListener("click", () => {
      const data = this.exportServerMap();
      this.downloadFile("map.json", JSON.stringify(data, null, 2));
    });
    document.getElementById("btn-export-manifest")?.addEventListener("click", () => {
      const manifest = this.exportPaintedManifest();
      this.downloadFile("painted.json", JSON.stringify(manifest, null, 2));
    });
    document.getElementById("select-art")?.addEventListener("change", (e) => {
      const path = e.target.value;
      this.loadImage(path);
    });
    document.getElementById("input-tiles-w")?.addEventListener("change", (e) => {
      const w = parseInt(e.target.value);
      this.widthTiles = w;
      this.initGrid();
      this.render();
    });
    document.getElementById("input-tiles-h")?.addEventListener("change", (e) => {
      const h = parseInt(e.target.value);
      this.heightTiles = h;
      this.initGrid();
      this.render();
    });
    document.getElementById("mode-blocked")?.addEventListener("click", () => this.setPaintMode(1));
    document.getElementById("mode-walkable")?.addEventListener("click", () => this.setPaintMode(0));
    document.getElementById("tool-brush")?.addEventListener("click", () => this.setTool("brush"));
    document.getElementById("tool-rect")?.addEventListener("click", () => this.setTool("rect"));
    document.getElementById("tool-fill")?.addEventListener("click", () => this.setTool("fill"));
    document.getElementById("tool-eraser")?.addEventListener("click", () => this.setTool("eraser"));
    document.getElementById("tool-wand")?.addEventListener("click", () => this.setTool("wand"));
    document.getElementById("tool-hotspot")?.addEventListener("click", () => this.setTool("hotspot"));
    document.getElementById("tool-spawn")?.addEventListener("click", () => this.setTool("spawn"));
    document.getElementById("btn-start-all-blocked")?.addEventListener("click", () => this.setAllBlocked());
    document.getElementById("btn-clear-all")?.addEventListener("click", () => this.clearAllWalkable());
    document.getElementById("btn-toggle-foot-test")?.addEventListener("click", () => {
      this.footTestMode = !this.footTestMode;
      document.getElementById("btn-toggle-foot-test")?.classList.toggle("active", this.footTestMode);
      this.render();
    });
    document.getElementById("btn-toggle-walk-test")?.addEventListener("click", () => this.toggleWalkTest());
    document.getElementById("btn-exit-walk-test")?.addEventListener("click", () => this.stopWalkTest());
    const rngTolerance = document.getElementById("rng-wand-tolerance");
    rngTolerance?.addEventListener("input", () => {
      this.wandTolerance = parseInt(rngTolerance.value);
      const txt = document.getElementById("txt-wand-tolerance");
      if (txt) txt.textContent = `${rngTolerance.value}%`;
    });
    document.getElementById("btn-wand-mark-walkable")?.addEventListener("click", () => this.applyWandSelection(0));
    document.getElementById("btn-wand-mark-blocked")?.addEventListener("click", () => this.applyWandSelection(1));
    document.getElementById("btn-wand-deselect")?.addEventListener("click", () => this.clearWandSelection());
    const selectHotspot = document.getElementById("select-hotspot-name");
    selectHotspot?.addEventListener("change", () => {
      const isCustom = selectHotspot.value === "custom";
      const customRow = document.getElementById("row-custom-hotspot");
      if (customRow) customRow.style.display = isCustom ? "flex" : "none";
    });
    document.querySelectorAll(".btn-brush-size").forEach((btn) => {
      btn.addEventListener("click", (e) => {
        document.querySelectorAll(".btn-brush-size").forEach((b) => b.classList.remove("active"));
        const target = e.currentTarget;
        target.classList.add("active");
        this.brushSize = parseInt(target.getAttribute("data-size"));
      });
    });
    const chkOverlay = document.getElementById("chk-overlay");
    chkOverlay?.addEventListener("change", () => {
      this.showOverlay = chkOverlay.checked;
      this.render();
    });
    const rngOpacity = document.getElementById("rng-opacity");
    rngOpacity?.addEventListener("input", () => {
      this.overlayOpacity = parseInt(rngOpacity.value) / 100;
      const txt = document.getElementById("txt-opacity");
      if (txt) txt.textContent = `${rngOpacity.value}%`;
      this.render();
    });
    const chkGrid = document.getElementById("chk-grid");
    chkGrid?.addEventListener("change", () => {
      this.showGrid = chkGrid.checked;
      this.render();
    });
    const chkCover = document.getElementById("chk-cover-rects");
    chkCover?.addEventListener("change", () => {
      this.showCoverRects = chkCover.checked;
      this.render();
    });
    const rngDarkness = document.getElementById("rng-darkness");
    rngDarkness?.addEventListener("input", () => {
      const txt = document.getElementById("txt-darkness");
      if (txt) txt.textContent = `${rngDarkness.value}%`;
    });
    document.getElementById("btn-auto-suggest")?.addEventListener("click", () => {
      const thresh = parseInt(document.getElementById("rng-darkness").value);
      this.runAutoSuggest(thresh);
    });
    document.getElementById("btn-apply-draft")?.addEventListener("click", () => this.applyDraft());
  }
  setPaintMode(val) {
    this.paintValue = val;
    document.getElementById("mode-blocked")?.classList.toggle("active", val === 1);
    document.getElementById("mode-walkable")?.classList.toggle("active", val === 0);
  }
  setTool(tool) {
    this.currentTool = tool;
    document.querySelectorAll(".tool-grid .btn, #tool-hotspot, #tool-spawn").forEach((b) => b.classList.remove("active"));
    document.getElementById(`tool-${tool}`)?.classList.add("active");
    const wandSec = document.getElementById("section-wand-settings");
    if (wandSec) wandSec.style.display = tool === "wand" ? "flex" : "none";
  }
  screenToTile(clientX, clientY) {
    const rect = this.viewport.getBoundingClientRect();
    const xInViewport = clientX - rect.left - this.panX;
    const yInViewport = clientY - rect.top - this.panY;
    const tileX = Math.floor(xInViewport / (this.tileSize * this.zoom));
    const tileY = Math.floor(yInViewport / (this.tileSize * this.zoom));
    return [tileX, tileY];
  }
  updateStatus(tx, ty) {
    const statCoords = document.getElementById("stat-coords");
    const statStatus = document.getElementById("stat-tile-status");
    if (tx >= 0 && tx < this.widthTiles && ty >= 0 && ty < this.heightTiles) {
      if (statCoords) statCoords.textContent = `Tile: (${tx}, ${ty})`;
      const isBlocked = this.collision[ty][tx] === 1;
      if (statStatus) {
        statStatus.textContent = isBlocked ? "Type: BLOCKED (1)" : "Type: WALKABLE (0)";
        statStatus.style.color = isBlocked ? "#f87171" : "#4ade80";
      }
    } else {
      if (statCoords) statCoords.textContent = `Tile: (Out of bounds)`;
      if (statStatus) {
        statStatus.textContent = "Type: OUT OF BOUNDS (1)";
        statStatus.style.color = "#94a3b8";
      }
    }
  }
};
function initPainter() {
  if (!window.__PAINTER__) {
    window.__PAINTER__ = new CollisionPainter();
  }
}
if (document.readyState === "loading") {
  window.addEventListener("DOMContentLoaded", initPainter);
} else {
  initPainter();
}
export {
  CollisionPainter
};
