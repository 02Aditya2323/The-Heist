/**
 * Data Harbor District Renderer.
 * High-fidelity cyberpunk deep-water data docks, marine container stacks,
 * wet boardwalk piers, fiber landing hubs, marine teal street lamps,
 * and interactive landmark kiosks (Harbor Job Board, Dock Terminal) for Region 3: Data Harbor.
 */

import { TILE_SIZE } from '../assets/atlas.js';

export interface HarborProp {
  type: 'lamp' | 'crate' | 'bollard';
  x: number; // tile X
  y: number; // tile Y
}

// Bounding box of Data Harbor in canonical grid
export const DH_MIN_X = 114;
export const DH_MAX_X = 191;
export const DH_MIN_Y = 8;
export const DH_MAX_Y = 62;

// Exact walkable prop positions inside Data Harbor
export const DATA_HARBOR_PROPS: HarborProp[] = [
  // Vertical Promenade Marine Lamps (x=142 and x=150)
  { type: 'lamp', x: 142, y: 16 },
  { type: 'lamp', x: 150, y: 16 },
  { type: 'lamp', x: 142, y: 24 },
  { type: 'lamp', x: 150, y: 24 },
  { type: 'lamp', x: 142, y: 36 },
  { type: 'lamp', x: 150, y: 36 },
  { type: 'lamp', x: 142, y: 44 },
  { type: 'lamp', x: 150, y: 44 },

  // Pier Boardwalk Marine Lamps (y=28 and y=34)
  { type: 'lamp', x: 126, y: 28 },
  { type: 'lamp', x: 134, y: 28 },
  { type: 'lamp', x: 158, y: 28 },
  { type: 'lamp', x: 168, y: 28 },
  { type: 'lamp', x: 178, y: 28 },
  { type: 'lamp', x: 126, y: 34 },
  { type: 'lamp', x: 134, y: 34 },
  { type: 'lamp', x: 158, y: 34 },
  { type: 'lamp', x: 168, y: 34 },
  { type: 'lamp', x: 178, y: 34 },

  // Cargo Crates / Fiber Storage Pallets
  { type: 'crate', x: 143, y: 20 },
  { type: 'crate', x: 149, y: 20 },
  { type: 'crate', x: 143, y: 40 },
  { type: 'crate', x: 149, y: 40 },
  { type: 'crate', x: 130, y: 30 },
  { type: 'crate', x: 162, y: 30 },
  { type: 'crate', x: 172, y: 30 },
  { type: 'crate', x: 116, y: 56 },

  // Mooring Bollards along Pier Edges
  { type: 'bollard', x: 120, y: 27 },
  { type: 'bollard', x: 140, y: 27 },
  { type: 'bollard', x: 152, y: 27 },
  { type: 'bollard', x: 175, y: 27 },
  { type: 'bollard', x: 120, y: 35 },
  { type: 'bollard', x: 140, y: 35 },
  { type: 'bollard', x: 152, y: 35 },
  { type: 'bollard', x: 175, y: 35 },
  { type: 'bollard', x: 115, y: 60 },
];

export class DataHarborRenderer {
  private boardImg: HTMLImageElement = new Image();
  private terminalImg: HTMLImageElement = new Image();
  private crateImg: HTMLImageElement = new Image();
  private lampImg: HTMLImageElement = new Image();
  private bollardImg: HTMLImageElement = new Image();
  public imagesLoaded = false;

  constructor() {
    this.boardImg.src = '/art/prop_harbor_board.png';
    this.terminalImg.src = '/art/prop_dock_terminal.png';
    this.crateImg.src = '/art/prop_dock_crate.png';
    this.lampImg.src = '/art/prop_dock_lamp.png';
    this.bollardImg.src = '/art/prop_dock_bollard.png';
  }

  /** Checks if a tile coordinate is within Data Harbor. */
  public isDataHarbor(gx: number, gy: number): boolean {
    return gx >= DH_MIN_X && gx <= DH_MAX_X && gy >= DH_MIN_Y && gy <= DH_MAX_Y;
  }

  /**
   * Renders the authentic Cyberpunk Data Harbor Backdrop Tile at screen coordinates (x, y).
   * Generates marine container stacks, wet pier planks, deep-water canal edges,
   * glowing fiber-optic landing conduits, and yellow hazard bulkheads.
   */
  public renderTile(
    ctx: CanvasRenderingContext2D,
    x: number,
    y: number,
    gx: number,
    gy: number,
    solid: boolean,
    now: number
  ): void {
    const T = TILE_SIZE;

    // ── 1. SOLID WALL / MARINE CONTAINER STACK FACADE ──
    if (solid) {
      // Container foundation
      ctx.fillStyle = '#081c26';
      ctx.fillRect(x, y, T, T);

      // Corrugated container color (alternating teal, deep blue, orange)
      const cType = (Math.floor(gx / 4) + Math.floor(gy / 4)) % 3;
      const baseColor = cType === 0 ? '#0f4c5c' : cType === 1 ? '#1e3a5f' : '#853213';
      const highlight = cType === 0 ? '#14b8a6' : cType === 1 ? '#38bdf8' : '#f97316';

      ctx.fillStyle = baseColor;
      ctx.fillRect(x + 1, y + 1, T - 2, T - 2);

      // Corrugated vertical ridges
      ctx.fillStyle = highlight;
      ctx.fillRect(x + 3, y + 2, 2, T - 4);
      ctx.fillRect(x + 7, y + 2, 2, T - 4);
      ctx.fillRect(x + 11, y + 2, 2, T - 4);

      // Container corner casting & lock
      ctx.fillStyle = '#05131a';
      ctx.fillRect(x + 1, y + 1, 3, 3);
      ctx.fillRect(x + T - 4, y + 1, 3, 3);
      ctx.fillRect(x + 1, y + T - 4, 3, 3);
      ctx.fillRect(x + T - 4, y + T - 4, 3, 3);

      // Hazard striping at the base
      ctx.fillStyle = '#0f172a';
      ctx.fillRect(x, y + T - 2, T, 2);
      if ((gx + gy) % 2 === 0) {
        ctx.fillStyle = '#f59e0b';
        ctx.fillRect(x + 2, y + T - 2, 4, 2);
        ctx.fillRect(x + 10, y + T - 2, 4, 2);
      }
      return;
    }

    // ── 2. HARBOR JOB BOARD PLAZA (Around gx=146, gy=30) ──
    const isJobBoardPlaza = Math.hypot(gx - 146, gy - 30) <= 3.8;
    if (isJobBoardPlaza) {
      // Wet reinforced dock concrete
      ctx.fillStyle = '#102e3b';
      ctx.fillRect(x, y, T, T);

      // Embedded marine teal optic ring
      ctx.fillStyle = '#164254';
      ctx.fillRect(x + 1, y + 1, T - 2, T - 2);

      if ((gx + gy) % 3 === 0) {
        ctx.fillStyle = '#14b8a6';
        ctx.fillRect(x + 5, y + 5, 6, 6);
        ctx.fillStyle = '#2dd4bf';
        ctx.fillRect(x + 7, y + 7, 2, 2);
      }
      return;
    }

    // ── 3. DOCK TERMINAL BULKHEAD (Around gx=114, gy=58) ──
    const isDockTerminalPlaza = Math.hypot(gx - 114, gy - 58) <= 3.5;
    if (isDockTerminalPlaza) {
      // Heavy pier grating
      ctx.fillStyle = '#0c2430';
      ctx.fillRect(x, y, T, T);
      ctx.fillStyle = '#173c4d';
      ctx.fillRect(x + 1, y + 1, T - 2, T - 2);

      // Cyan fiber landing conduits
      ctx.fillStyle = '#00f0ff';
      ctx.fillRect(x + 7, y, 2, T);
      return;
    }

    // ── 4. CANAL WATER BORDER (Top of Data Harbor: gy <= 10) ──
    if (gy <= 10) {
      // Deep sea water
      ctx.fillStyle = '#021824';
      ctx.fillRect(x, y, T, T);

      // Animated water ripples
      const wave = Math.sin(now / 350 + gx * 0.8 + gy * 1.2);
      if (wave > 0.2) {
        ctx.fillStyle = 'rgba(20, 184, 166, 0.4)';
        ctx.fillRect(x + 2, y + 6, 12, 2);
      }
      return;
    }

    // ── 5. MAIN DOCK PROMENADES & PIERS ──
    // Vertical Promenade: gx 142..150 | Horizontal Pier: gy 28..34
    const isVertPier = gx >= 142 && gx <= 150;
    const isHorizPier = gy >= 28 && gy <= 34;

    if (isVertPier || isHorizPier) {
      // Dark wet wood & concrete pier
      ctx.fillStyle = '#0f2733';
      ctx.fillRect(x, y, T, T);

      // Plank grooves
      ctx.fillStyle = '#081720';
      ctx.fillRect(x, y, T, 1);

      // Luminous fiber cables embedded in pier center
      if (isVertPier && (gx === 146)) {
        ctx.fillStyle = '#0d9488';
        ctx.fillRect(x + 7, y, 2, T);
      }
      if (isHorizPier && (gy === 31)) {
        ctx.fillStyle = '#0d9488';
        ctx.fillRect(x, y + 7, T, 2);
      }

      // Yellow safety rim along outer pier boundaries
      if (gx === 142 || gx === 150) {
        ctx.fillStyle = 'rgba(245, 158, 11, 0.45)';
        ctx.fillRect(x + (gx === 142 ? 0 : T - 1), y, 1, T);
      }
      if (gy === 28 || gy === 34) {
        ctx.fillStyle = 'rgba(245, 158, 11, 0.45)';
        ctx.fillRect(x, y + (gy === 28 ? 0 : T - 1), T, 1);
      }
      return;
    }

    // ── 6. STANDARD DATA HARBOR SLATE PAVING ──
    ctx.fillStyle = '#102531';
    ctx.fillRect(x, y, T, T);

    ctx.fillStyle = '#163442';
    ctx.fillRect(x, y, T, 1);
    ctx.fillRect(x, y, 1, T);
    ctx.fillStyle = '#0a1a23';
    ctx.fillRect(x, y + T - 1, T, 1);
    ctx.fillRect(x + T - 1, y, 1, T);

    // Wet glints / fiber node dots
    if ((gx * 5 + gy * 17) % 7 === 0) {
      ctx.fillStyle = '#14b8a6';
      ctx.fillRect(x + 7, y + 7, 2, 2);
    }
  }

  /**
   * Renders Data Harbor street props (marine lamps, crates, mooring bollards).
   */
  public renderProps(
    ctx: CanvasRenderingContext2D,
    camX: number,
    camY: number,
    now: number
  ): void {
    const T = TILE_SIZE;

    for (const prop of DATA_HARBOR_PROPS) {
      const px = prop.x * T - camX;
      const py = prop.y * T - camY;

      if (px < -40 || px > 520 || py < -40 || py > 310) continue;

      switch (prop.type) {
        case 'lamp':
          this.drawDockLamp(ctx, px, py, now);
          break;
        case 'crate':
          this.drawDataCrate(ctx, px, py);
          break;
        case 'bollard':
          this.drawMooringBollard(ctx, px, py);
          break;
      }
    }
  }

  /** Draws an industrial marine streetlight with soft teal ambient illumination halo. */
  private drawDockLamp(
    ctx: CanvasRenderingContext2D,
    px: number,
    py: number,
    now: number
  ): void {
    // Marine teal downward light halo
    const pulse = 0.85 + Math.sin(now / 300 + px) * 0.1;
    const haloX = px + 8;
    const haloY = py + 14;

    const grad = ctx.createRadialGradient(haloX, haloY, 2, haloX, haloY, 22);
    grad.addColorStop(0, `rgba(20, 184, 166, ${0.32 * pulse})`);
    grad.addColorStop(0.6, `rgba(6, 182, 212, ${0.12 * pulse})`);
    grad.addColorStop(1, 'rgba(0, 0, 0, 0)');
    ctx.fillStyle = grad;
    ctx.beginPath();
    ctx.arc(haloX, haloY, 22, 0, Math.PI * 2);
    ctx.fill();

    // Base shadow
    ctx.fillStyle = 'rgba(0, 0, 0, 0.45)';
    ctx.fillRect(px + 4, py + 14, 8, 3);

    // Render Lamp Sprite
    if (this.lampImg.complete && this.lampImg.naturalWidth > 0) {
      ctx.drawImage(this.lampImg, px, py - 16, 16, 32);
    } else {
      ctx.fillStyle = '#1e293b';
      ctx.fillRect(px + 7, py - 14, 2, 28);
      ctx.fillStyle = '#14b8a6';
      ctx.fillRect(px + 5, py - 16, 6, 4);
    }

    // Glowing tip
    ctx.fillStyle = '#ccfbf1';
    ctx.fillRect(px + 7, py - 15, 2, 2);
  }

  /** Draws a waterproof data cargo container box. */
  private drawDataCrate(ctx: CanvasRenderingContext2D, px: number, py: number): void {
    ctx.fillStyle = 'rgba(0, 0, 0, 0.45)';
    ctx.fillRect(px, py + 10, 18, 5);

    if (this.crateImg.complete && this.crateImg.naturalWidth > 0) {
      ctx.drawImage(this.crateImg, px - 1, py - 2, 18, 16);
    } else {
      ctx.fillStyle = '#0f4c5c';
      ctx.fillRect(px + 1, py, 14, 12);
      ctx.fillStyle = '#2dd4bf';
      ctx.strokeRect(px + 1.5, py + 0.5, 13, 11);
    }
  }

  /** Draws a heavy marine mooring bollard with tie rope. */
  private drawMooringBollard(ctx: CanvasRenderingContext2D, px: number, py: number): void {
    ctx.fillStyle = 'rgba(0, 0, 0, 0.45)';
    ctx.fillRect(px + 2, py + 12, 8, 3);

    if (this.bollardImg.complete && this.bollardImg.naturalWidth > 0) {
      ctx.drawImage(this.bollardImg, px + 2, py, 12, 16);
    } else {
      ctx.fillStyle = '#334155';
      ctx.fillRect(px + 4, py + 4, 8, 10);
      ctx.fillStyle = '#64748b';
      ctx.fillRect(px + 3, py + 2, 10, 3);
    }
  }

  /**
   * Renders the Harbor Job Board landmark at (146, 30).
   */
  public drawHarborJobBoard(
    ctx: CanvasRenderingContext2D,
    propSheet: HTMLImageElement,
    x: number,
    y: number,
    now: number
  ): void {
    ctx.fillStyle = 'rgba(0, 0, 0, 0.45)';
    ctx.fillRect(x - 16, y + 6, 32, 5);

    if (this.boardImg.complete && this.boardImg.naturalWidth > 0) {
      ctx.drawImage(this.boardImg, x - 14, y - 20, 28, 26);
    } else if (propSheet.complete) {
      ctx.drawImage(propSheet, 52, 718, 185, 270, x - 11, y - 26, 22, 28);
    }

    // Floating Holographic Badge
    const bounce = Math.round(Math.sin(now / 240) * 2);
    ctx.fillStyle = 'rgba(15, 23, 42, 0.95)';
    ctx.fillRect(x - 38, y - 35 + bounce, 76, 10);
    ctx.strokeStyle = '#14b8a6';
    ctx.strokeRect(x - 37.5, y - 34.5 + bounce, 75, 9);
    ctx.font = 'bold 6px monospace';
    ctx.textAlign = 'center';
    ctx.fillStyle = '#ccfbf1';
    ctx.fillText('HARBOR JOB BOARD [SQL/OSINT]', x, y - 28 + bounce);
  }

  /**
   * Renders the Dock Terminal landmark at (114, 58).
   */
  public drawDockTerminal(
    ctx: CanvasRenderingContext2D,
    propSheet: HTMLImageElement,
    x: number,
    y: number,
    now: number
  ): void {
    ctx.fillStyle = 'rgba(0, 0, 0, 0.45)';
    ctx.fillRect(x - 12, y + 6, 24, 5);

    if (this.terminalImg.complete && this.terminalImg.naturalWidth > 0) {
      ctx.drawImage(this.terminalImg, x - 10, y - 20, 20, 26);
    } else if (propSheet.complete) {
      ctx.drawImage(propSheet, 52, 718, 185, 270, x - 10, y - 26, 20, 28);
    }

    // Floating Terminal Badge
    const bounce = Math.round(Math.sin(now / 240 + 1) * 2);
    ctx.fillStyle = 'rgba(15, 23, 42, 0.95)';
    ctx.fillRect(x - 36, y - 35 + bounce, 72, 10);
    ctx.strokeStyle = '#06b6d4';
    ctx.strokeRect(x - 35.5, y - 34.5 + bounce, 71, 9);
    ctx.font = 'bold 6px monospace';
    ctx.textAlign = 'center';
    ctx.fillStyle = '#cffafe';
    ctx.fillText('DOCK TERMINAL [NETWORKS]', x, y - 28 + bounce);
  }
}

export const globalDataHarbor = new DataHarborRenderer();
