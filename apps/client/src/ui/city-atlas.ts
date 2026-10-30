import { sceneAt, type ArtScene } from "@heist/shared";
import type { GameStore } from "../game/store.js";
import {
  createAtlasLayout,
  projectAtlasPoint,
  type AtlasLayout,
  type AtlasPoint,
} from "./atlas-layout.js";

/** Continuous art mosaic. The compact projection never changes gameplay coordinates. */
export class CityAtlas {
  private canvas: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D;
  private images = new Map<string, HTMLImageElement>();
  private originals = new Map<string, HTMLImageElement>();
  private failed = new Set<string>();
  private layout: AtlasLayout = { regions: [], joins: [], width: 0, height: 0 };
  private fitScale = 1;
  private labels = true;
  private paintPending = false;
  private infill: HTMLImageElement | null = null;
  private scale = 1;
  private factor = 1;
  private pan = { x: 0, y: 0 };
  private drag: {
    x: number;
    y: number;
    startX: number;
    startY: number;
    moved: boolean;
  } | null = null;
  private boxes: {
    scene: ArtScene;
    x: number;
    y: number;
    w: number;
    h: number;
  }[] = [];
  private selected: ArtScene | null = null;
  private open = false;
  private lastDraw = 0;
  private overviewOrigin = { x: 0, y: 0 };
  private unfinishedOnly = false;
  private layers = { terminals: true, homes: true, gates: true, raids: true };

  constructor(
    private store: GameStore,
    private onInspect: (
      scene: ArtScene,
      focus?: { x: number; y: number },
    ) => void,
  ) {
    this.canvas = document.getElementById(
      "city-atlas-canvas",
    ) as HTMLCanvasElement;
    const filter = document.createElement("button");
    filter.type = "button";
    filter.id = "atlas-unfinished";
    filter.textContent = "Unfinished contracts";
    filter.setAttribute("aria-pressed", "false");
    document.getElementById("atlas-fit")!.parentElement!.append(filter);
    filter.addEventListener("click", () => {
      this.unfinishedOnly = !this.unfinishedOnly;
      filter.setAttribute("aria-pressed", String(this.unfinishedOnly));
      if (this.selected) this.select(this.selected);
      this.draw();
    });
    const ctx = this.canvas.getContext("2d");
    if (!ctx) throw new Error("Atlas canvas unavailable");
    this.ctx = ctx;
    this.canvas.tabIndex = 0;
    const controls = document.getElementById("atlas-fit")!.parentElement!;
    const add = (id: string, label: string, action: () => void) => {
      const b = document.createElement("button");
      b.type = "button";
      b.id = id;
      b.textContent = label;
      b.addEventListener("click", action);
      controls.append(b);
      return b;
    };
    add("atlas-native", "1:1 artwork", () => {
      this.factor = Math.min(
        40,
        (this.store.map?.tileSize || 32) / this.fitScale,
      );
      this.focus(this.selected);
    });
    add("atlas-player", "Find me", () => {
      const map = this.store.map,
        self = this.store.selfEntity;
      if (!map || !self) return;
      const scene = sceneAt(map, self.tileX, self.tileY),
        point = projectAtlasPoint(
          this.layout,
          map,
          self.tileX + 0.5,
          self.tileY + 0.5,
        );
      if (scene && point) {
        this.select(scene);
        this.factor = Math.max(2.5, this.factor);
        this.focus(scene, point);
      }
    });
    for (const [key, label] of Object.entries({terminals:'Terminals',homes:'Homes',gates:'Travel gates',raids:'Raids'})) {
      const layer = key as keyof typeof this.layers;
      const control = add(`atlas-layer-${key}`, label, () => {
        this.layers[layer] = !this.layers[layer];
        control.setAttribute('aria-pressed', String(this.layers[layer])); this.draw();
      });
      control.setAttribute('aria-pressed', 'true');
    }
    const rail = add('atlas-rail', 'Region details', () => {
      const atlas = document.getElementById('city-atlas')!;
      const collapsed = atlas.classList.toggle('rail-collapsed');
      rail.setAttribute('aria-expanded', String(!collapsed));
    });
    rail.setAttribute('aria-expanded', 'true');
    const labels = add("atlas-labels", "Labels", () => {
      this.labels = !this.labels;
      labels.setAttribute("aria-pressed", String(this.labels));
      this.draw();
    });
    labels.setAttribute("aria-pressed", "true");
    document.getElementById("atlas-fit")!.addEventListener("click", () => {
      this.factor = 1;
      this.pan = { x: 0, y: 0 };
      this.draw();
    });
    document
      .getElementById("atlas-zoom-in")!
      .addEventListener("click", () => this.zoom(1.25));
    document
      .getElementById("atlas-zoom-out")!
      .addEventListener("click", () => this.zoom(0.8));
    document.getElementById("atlas-inspect")!.addEventListener("click", () => {
      if (this.selected) this.onInspect(this.selected);
    });
    this.canvas.addEventListener(
      "wheel",
      (e) => {
        e.preventDefault();
        const r = this.canvas.getBoundingClientRect();
        this.zoom(e.deltaY < 0 ? 1.18 : 1 / 1.18, {
          x: e.clientX - r.left,
          y: e.clientY - r.top,
        });
      },
      { passive: false },
    );
    this.canvas.addEventListener("pointerdown", (e) => {
      if (e.button !== 0) return;
      this.drag = {
        x: e.clientX,
        y: e.clientY,
        startX: e.clientX,
        startY: e.clientY,
        moved: false,
      };
      this.canvas.setPointerCapture(e.pointerId);
    });
    this.canvas.addEventListener("pointermove", (e) => {
      if (!this.drag) return;
      this.drag.moved ||=
        Math.hypot(e.clientX - this.drag.startX, e.clientY - this.drag.startY) >
        5;
      this.pan.x += e.clientX - this.drag.x;
      this.pan.y += e.clientY - this.drag.y;
      this.drag.x = e.clientX;
      this.drag.y = e.clientY;
      this.draw();
    });
    this.canvas.addEventListener("pointerup", (e) => {
      const drag = this.drag;
      this.drag = null;
      if (drag?.moved) return;
      const rect = this.canvas.getBoundingClientRect(),
        x = e.clientX - rect.left,
        y = e.clientY - rect.top;
      const box = this.boxes.find(
        (b) => x >= b.x && x <= b.x + b.w && y >= b.y && y <= b.y + b.h,
      );
      if (box) {
        this.select(box.scene);
        this.draw();
      }
    });
    this.canvas.addEventListener("pointercancel", () => {
      this.drag = null;
    });
    this.canvas.addEventListener("lostpointercapture", () => {
      this.drag = null;
    });
    this.canvas.addEventListener("dblclick", (e) => {
      const r = this.canvas.getBoundingClientRect();
      this.zoom(1.8, { x: e.clientX - r.left, y: e.clientY - r.top });
    });
    this.canvas.addEventListener("keydown", (e) => {
      if (e.key === "+" || e.key === "=") {
        e.preventDefault();
        this.zoom(1.3);
      }
      if (e.key === "-") {
        e.preventDefault();
        this.zoom(1 / 1.3);
      }
      const delta: Record<string, AtlasPoint> = {
        ArrowUp: { x: 0, y: 60 },
        ArrowDown: { x: 0, y: -60 },
        ArrowLeft: { x: 60, y: 0 },
        ArrowRight: { x: -60, y: 0 },
      };
      if (delta[e.key]) {
        e.preventDefault();
        this.pan.x += delta[e.key].x;
        this.pan.y += delta[e.key].y;
        this.draw();
      }
    });
    window.addEventListener("resize", () => {
      if (this.open) this.draw();
    });
    document.getElementById("atlas-regions")!.addEventListener("click", (e) => {
      const button = (e.target as HTMLElement).closest<HTMLButtonElement>(
        "button[data-scene]",
      );
      const scene = this.store.map?.scenes?.find(
        (s) => s.id === button?.dataset.scene,
      );
      if (scene) {
        this.select(scene);
        this.factor = Math.max(this.factor, 2.2);
        this.focus(scene);
      }
    });
    document
      .getElementById("atlas-landmarks")!
      .addEventListener("click", (e) => {
        const button = (e.target as HTMLElement).closest<HTMLButtonElement>(
          "button[data-spot]",
        );
        const spot = this.store.map?.hotspots.find(
          (h) => h.id === button?.dataset.spot,
        );
        const scene =
          spot && this.store.map
            ? sceneAt(this.store.map, spot.x, spot.y)
            : null;
        if (spot && scene) this.onInspect(scene, spot);
      });
  }

  setMap(): void {
    this.images.clear();
    this.originals.clear();
    this.failed.clear();
    this.layout = this.store.map
      ? createAtlasLayout(this.store.map)
      : { regions: [], joins: [], width: 0, height: 0 };
    document.getElementById("atlas-piece-count")!.textContent =
      `${this.layout.regions.length} joined artwork regions · ${this.layout.joins.length} travel joins`;
    const list = document.getElementById("atlas-regions")!;
    list.replaceChildren();
    for (const scene of this.store.map?.scenes || []) {
      const button = document.createElement("button");
      button.type = "button";
      button.dataset.scene = scene.id;
      button.textContent =
        scene.kind === "connector"
          ? `${scene.id.slice(1)} · ${scene.name}`
          : scene.name;
      list.append(button);
    }
  }
  show(): void {
    this.open = true;
    this.factor = 1;
    this.pan = { x: 0, y: 0 };
    document.getElementById("city-atlas")!.hidden = false;
    const self = this.store.selfEntity,
      map = this.store.map;
    const current =
      map && self
        ? sceneAt(map, self.tileX, self.tileY)
        : map?.scenes?.find((s) => s.id === "central");
    if (current) this.select(current);
    this.draw();
  }
  hide(): void {
    this.open = false;
    document.getElementById("city-atlas")!.hidden = true;
  }
  get visible(): boolean {
    return this.open;
  }
  update(now: number): void {
    if (this.open && now - this.lastDraw > 500) {
      this.lastDraw = now;
      this.refreshHomeNames();
      this.draw();
    }
  }
  private refreshHomeNames(): void {
    document
      .querySelectorAll<HTMLButtonElement>("#atlas-landmarks button[data-spot]")
      .forEach((button) => {
        const spot = this.store.map?.hotspots.find(
          (h) => h.id === button.dataset.spot,
        );
        if (!spot) return;
        const owner = this.store.event?.homes.find((h) => h.id === spot.id);
        button.textContent = owner
          ? `${spot.name} · ${owner.owner}${owner.id === this.store.event?.player.homeId ? " / yours" : ""}`
          : spot.name;
      });
  }
  private zoom(amount: number, anchor?: AtlasPoint): void {
    const r = this.canvas.getBoundingClientRect(),
      p = anchor || { x: r.width / 2, y: r.height / 2 };
    const point = {
      x: (p.x - this.overviewOrigin.x) / this.scale,
      y: (p.y - this.overviewOrigin.y) / this.scale,
    };
    this.factor = Math.max(1, Math.min(40, this.factor * amount));
    const next = this.fitScale * this.factor;
    const bottomSpace =
      document
        .querySelector<HTMLElement>(".atlas-zoom")!
        .getBoundingClientRect().height + 28;
    this.pan = {
      x: p.x - r.width / 2 + (this.layout.width / 2 - point.x) * next,
      y:
        p.y -
        (r.height - bottomSpace) / 2 +
        (this.layout.height / 2 - point.y) * next,
    };
    if (this.factor === 1) this.pan = { x: 0, y: 0 };
    this.draw();
  }
  private focus(scene: ArtScene | null, point?: AtlasPoint): void {
    const r = this.layout.regions.find((r) => r.scene.id === scene?.id);
    if (!r) return;
    const scale = this.fitScale * this.factor;
    this.pan = {
      x: (this.layout.width / 2 - (point?.x ?? r.x + r.width / 2)) * scale,
      y: (this.layout.height / 2 - (point?.y ?? r.y + r.height / 2)) * scale,
    };
    this.draw();
  }

  private select(scene: ArtScene): void {
    this.selected = scene;
    document.getElementById("atlas-selected-title")!.textContent = scene.name;
    const map = this.store.map;
    const adjacent =
      map?.routes?.filter(
        (r) =>
          r.from === scene.id || r.to === scene.id || r.connector === scene.id,
      ) || [];
    document.getElementById("atlas-selected-links")!.textContent = adjacent
      .map((r) => {
        const a = map?.scenes?.find((s) => s.id === r.from),
          b = map?.scenes?.find((s) => s.id === r.to);
        return `${r.connector ? r.id.slice(1) : "Street"}: ${a?.name} ↔ ${b?.name}`;
      })
      .join("\n");
    document
      .querySelectorAll<HTMLButtonElement>("#atlas-regions button")
      .forEach((button) =>
        button.setAttribute(
          "aria-pressed",
          String(button.dataset.scene === scene.id),
        ),
      );
    const list = document.getElementById("atlas-landmarks")!;
    list.replaceChildren();
    for (const spot of map?.hotspots.filter(
      (h) => sceneAt(map, h.x, h.y)?.id === scene.id,
    ) || []) {
      if (
        this.unfinishedOnly &&
        (spot.action !== "jobs" ||
          this.store.event?.stationStates?.find((s) => s.id === spot.id)
            ?.state === "cleared")
      )
        continue;
      const button = document.createElement("button");
      button.type = "button";
      button.dataset.spot = spot.id;
      button.textContent = spot.name;
      list.append(button);
    }
    this.refreshHomeNames();
  }

  private scheduleDraw(): void {
    if (this.paintPending || !this.open) return;
    this.paintPending = true;
    requestAnimationFrame(() => {
      this.paintPending = false;
      this.draw();
    });
  }
  private image(scene: ArtScene, native = false): HTMLImageElement {
    const url =
        native || !scene.previewImage ? scene.image : scene.previewImage,
      cache = native ? this.originals : this.images;
    let img = cache.get(url);
    if (img) {
      if (native) {
        cache.delete(url);
        cache.set(url, img);
      }
      return img;
    }
    img = new Image();
    img.decoding = "async";
    img.onload = () => this.scheduleDraw();
    img.onerror = () => {
      this.failed.add(url);
      this.scheduleDraw();
    };
    cache.set(url, img);
    img.src = url;
    if (native) while (cache.size > 4) cache.delete(cache.keys().next().value!);
    return img;
  }
  draw(): void {
    if (!this.open || !this.store.map?.scenes || !this.layout.width) return;
    const map = this.store.map,
      tile = map.tileSize || 32,
      rect = this.canvas.getBoundingClientRect(),
      w = rect.width,
      h = rect.height,
      dpr = Math.min(2, window.devicePixelRatio || 1);
    if (w <= 0 || h <= 0) return;
    if (
      this.canvas.width !== Math.round(w * dpr) ||
      this.canvas.height !== Math.round(h * dpr)
    ) {
      this.canvas.width = Math.round(w * dpr);
      this.canvas.height = Math.round(h * dpr);
    }
    const toolbar = document.querySelector<HTMLElement>(".atlas-zoom")!;
    const bottomSpace = toolbar.getBoundingClientRect().height + 28;
    this.fitScale = Math.min(
      (w - 36) / this.layout.width,
      (h - bottomSpace - 20) / this.layout.height,
    );
    this.scale = this.fitScale * this.factor;
    const ox = (w - this.layout.width * this.scale) / 2 + this.pan.x,
      oy = (h - bottomSpace - this.layout.height * this.scale) / 2 + this.pan.y;
    this.overviewOrigin = { x: ox, y: oy };
    this.boxes = this.layout.regions.map((r) => ({
      scene: r.scene,
      x: ox + r.x * this.scale,
      y: oy + r.y * this.scale,
      w: r.width * this.scale,
      h: r.height * this.scale,
    }));
    const c = this.ctx;
    c.setTransform(dpr, 0, 0, dpr, 0, 0);
    c.clearRect(0, 0, w, h);
    c.fillStyle = "#07131a";
    c.fillRect(0, 0, w, h);
    c.save();
    c.translate(ox, oy);
    c.scale(this.scale / tile, this.scale / tile);
    const sea = c.createLinearGradient(
      0,
      0,
      this.layout.width * tile,
      this.layout.height * tile,
    );
    sea.addColorStop(0, "#0b242c");
    sea.addColorStop(0.5, "#081b24");
    sea.addColorStop(1, "#06151d");
    c.fillStyle = sea;
    c.fillRect(0, 0, this.layout.width * tile, this.layout.height * tile);
    // Decorative connective scenery only. Every authoritative artwork panel is
    // drawn ABOVE this backplate; no generated pixels replace a playable panel.
    if (!this.infill) {
      this.infill = new Image();
      this.infill.decoding = "async";
      this.infill.onload = () => this.scheduleDraw();
      this.infill.onerror = () => this.scheduleDraw();
      this.infill.src = "/art/atlas/veyra-infill-v1.png";
    }
    if (this.infill.complete && this.infill.naturalWidth) {
      c.drawImage(
        this.infill,
        0,
        0,
        this.layout.width * tile,
        this.layout.height * tile,
      );
      c.fillStyle = "rgba(4,13,21,.32)";
      c.fillRect(0, 0, this.layout.width * tile, this.layout.height * tile);
    }
    // Temporary textured fallback while the connective scenery loads. The finished
    // atlas shows streets and artwork, not abstract route strokes or graph edges.
    for (const join of this.infill?.naturalWidth ? [] : this.layout.joins) {
      const a = join.start,
        b = join.end;
      c.lineCap = "square";
      c.lineJoin = "round";
      c.beginPath();
      c.moveTo(a.x * tile, a.y * tile);
      c.lineTo(((a.x + b.x) / 2) * tile, a.y * tile);
      c.lineTo(((a.x + b.x) / 2) * tile, b.y * tile);
      c.lineTo(b.x * tile, b.y * tile);
      c.strokeStyle = "#10202b";
      c.lineWidth = tile * 5.4;
      c.stroke();
      c.strokeStyle = "#66717a";
      c.lineWidth = tile * 4.6;
      c.stroke();
      c.strokeStyle = "#34404a";
      c.lineWidth = tile * 4;
      c.stroke();
    }
    c.restore();
    const visible = this.boxes.filter(
      (b) => b.x + b.w >= 0 && b.y + b.h >= 0 && b.x <= w && b.y <= h,
    );
    // Limit native-resolution requests to four most-visible unique images. Otherwise
    // a zoomed viewport spanning >4 panels would continuously evict/reload its cache.
    const detailUrls = new Set<string>();
    for (const b of [...visible].sort((a, b) => {
      const area = (r: typeof a) =>
        Math.max(0, Math.min(w, r.x + r.w) - Math.max(0, r.x)) *
        Math.max(0, Math.min(h, r.y + r.h) - Math.max(0, r.y));
      return area(b) - area(a);
    })) {
      if (b.w * dpr > 430 && detailUrls.size < 4) detailUrls.add(b.scene.image);
    }
    let loaded = 0,
      nativeLoaded = 0;
    for (const b of visible) {
      const preview = this.image(b.scene),
        full =
          detailUrls.has(b.scene.image) ||
          this.failed.has(b.scene.previewImage || b.scene.image)
            ? this.image(b.scene, true)
            : null;
      const native = full?.complete && full.naturalWidth ? full : null,
        img =
          native || (preview.complete && preview.naturalWidth ? preview : null);
      c.fillStyle = "#18262b";
      c.fillRect(b.x, b.y, b.w, b.h);
      if (img) {
        loaded++;
        if (native) nativeLoaded++;
        c.imageSmoothingEnabled = true;
        c.imageSmoothingQuality = "high";
        c.drawImage(
          img,
          0,
          0,
          native ? b.scene.width * tile : img.naturalWidth,
          native ? b.scene.height * tile : img.naturalHeight,
          b.x,
          b.y,
          b.w + 0.35,
          b.h + 0.35,
        );
      } else if (this.failed.has(b.scene.image)) {
        c.fillStyle = "#ffb19b";
        c.font = "11px sans-serif";
        c.textAlign = "center";
        c.fillText(
          "Artwork unavailable",
          b.x + b.w / 2,
          b.y + b.h / 2,
          b.w - 8,
        );
      }
    }
    const selected = visible.find((b) => b.scene.id === this.selected?.id);
    if (selected) {
      c.strokeStyle = "rgba(255,229,172,.8)";
      c.lineWidth = 1.5;
      c.strokeRect(
        selected.x + 1,
        selected.y + 1,
        selected.w - 2,
        selected.h - 2,
      );
    }
    if (this.labels)
      for (const b of visible) {
        const label =
            b.scene.kind === "connector"
              ? "LINK " + b.scene.id.slice(1)
              : b.scene.kind === "neighborhood"
                ? "WARD " + b.scene.id.slice(-1).toUpperCase()
                : b.scene.name.toUpperCase(),
          small = b.scene.kind !== "district";
        c.font = (small ? "9" : "11") + "px Segoe UI,sans-serif";
        c.textAlign = "center";
        c.textBaseline = "middle";
        const lw = Math.min(b.w - 10, c.measureText(label).width + 18),
          lh = small ? 18 : 23;
        c.fillStyle = "rgba(5,15,23,.9)";
        c.fillRect(b.x + (b.w - lw) / 2, b.y + 6, lw, lh);
        c.fillStyle = b.scene.color;
        c.fillRect(b.x + (b.w - lw) / 2, b.y + 6, 2, lh);
        c.fillStyle = "#ecf3f1";
        c.fillText(label, b.x + b.w / 2, b.y + 6 + lh / 2, lw - 9);
      }
    const marker = (x: number, y: number, color: string, size: number) => {
      const p = projectAtlasPoint(this.layout, map, x + 0.5, y + 0.5);
      if (!p) return;
      c.fillStyle = color;
      c.strokeStyle = "#07131a";
      c.lineWidth = 1.5;
      c.beginPath();
      c.arc(ox + p.x * this.scale, oy + p.y * this.scale, size, 0, Math.PI * 2);
      c.fill();
      c.stroke();
    };
    if (this.factor >= 1.8 || this.unfinishedOnly)
      for (const spot of map.hotspots) {
        if (spot.action === "home") continue;
        if (spot.action === "raid" ? !this.layers.raids : !this.layers.terminals) continue;
        if (
          this.unfinishedOnly &&
          (spot.action !== "jobs" ||
            this.store.event?.stationStates?.find((s) => s.id === spot.id)
              ?.state === "cleared")
        )
          continue;
        marker(spot.x, spot.y, "#ffe4a1", 3.5);
      }
    for (const home of this.layers.homes ? map.homePlots || [] : []) {
      const owner = this.store.event?.homes.find((h) => h.id === home.id);
      const ownHome = !!owner && owner.id === this.store.event?.player.homeId;
      if (this.factor < 2.2 && !ownHome) continue;
      marker(
        home.x,
        home.y,
        ownHome
          ? "#9ff1ff"
          : owner?.capped
            ? "#ffa98e"
            : owner
              ? "#ffd88d"
              : "#a1a8a3",
        2.5,
      );
    }
    if (this.factor >= 3 && this.layers.gates)
      for (const gate of map.exits || []) marker(gate.x, gate.y, "#d4d3fa", 2);
    const self = this.store.selfEntity;
    if (self) {
      marker(self.tileX, self.tileY, "#9ff1ff", 5);
      const p = projectAtlasPoint(
        this.layout,
        map,
        self.tileX + 0.5,
        self.tileY + 0.5,
      );
      if (p) {
        c.strokeStyle = "#9ff1ff88";
        c.lineWidth = 2;
        c.beginPath();
        c.arc(ox + p.x * this.scale, oy + p.y * this.scale, 10, 0, Math.PI * 2);
        c.stroke();
      }
    }
    document.getElementById("atlas-scale")!.textContent =
      Math.round(this.factor * 100) + "%";
    document.getElementById("atlas-load-state")!.textContent =
      loaded < visible.length
        ? "Loading artwork " + loaded + "/" + visible.length
        : Math.round((this.scale / tile) * 100) + "% native art scale";
    (document.getElementById("atlas-player") as HTMLButtonElement).disabled =
      !self;
    this.canvas.dataset.atlasMode = "stitched-artwork";
    this.canvas.dataset.loadedPieces = String(loaded);
    this.canvas.dataset.visiblePieces = String(visible.length);
    this.canvas.dataset.nativePieces = String(nativeLoaded);
    this.canvas.dataset.sceneryLoaded = String(!!this.infill?.naturalWidth);
  }
}
