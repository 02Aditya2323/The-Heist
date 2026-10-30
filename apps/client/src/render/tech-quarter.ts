/**
 * Tech Quarter District Renderer.
 * High-fidelity cyberpunk silicon corridor backdrop, server warehouses,
 * circuit-etched pavements, holo-billboards, cyan neon street lamps,
 * and interactive landmark kiosks (Tech Job Board, Logic Lab) for Region 2: Tech Quarter.
 */

import { TILE_SIZE } from '../assets/atlas.js';

export interface TechProp {
  type: 'lamp' | 'tree' | 'server' | 'holo' | 'vent';
  x: number; // tile X
  y: number; // tile Y
}

// Bounding box of Tech Quarter in canonical grid
export const TQ_MIN_X = 8;
export const TQ_MAX_X = 73;
export const TQ_MIN_Y = 8;
export const TQ_MAX_Y = 47;

// Exact walkable prop positions inside Tech Quarter
export const TECH_QUARTER_PROPS: TechProp[] = [
  // Vertical Corridor Street Lamps (x=30 and x=36)
  { type: 'lamp', x: 30, y: 16 },
  { type: 'lamp', x: 36, y: 16 },
  { type: 'lamp', x: 30, y: 24 },
  { type: 'lamp', x: 36, y: 24 },
  { type: 'lamp', x: 30, y: 36 },
  { type: 'lamp', x: 36, y: 36 },
  { type: 'lamp', x: 30, y: 44 },
  { type: 'lamp', x: 36, y: 44 },

  // Horizontal Corridor Street Lamps (y=27 and y=33)
  { type: 'lamp', x: 18, y: 27 },
  { type: 'lamp', x: 24, y: 27 },
  { type: 'lamp', x: 44, y: 27 },
  { type: 'lamp', x: 52, y: 27 },
  { type: 'lamp', x: 60, y: 26 },
  { type: 'lamp', x: 66, y: 26 },
  { type: 'lamp', x: 18, y: 33 },
  { type: 'lamp', x: 24, y: 33 },
  { type: 'lamp', x: 44, y: 33 },
  { type: 'lamp', x: 52, y: 33 },

  // Bioluminescent Silicon Trees / Metallic Planters
  { type: 'tree', x: 31, y: 31 },
  { type: 'tree', x: 37, y: 31 },
  { type: 'tree', x: 59, y: 31 },
  { type: 'tree', x: 65, y: 31 },
  { type: 'tree', x: 20, y: 26 },
  { type: 'tree', x: 46, y: 26 },
  { type: 'tree', x: 54, y: 26 },

  // External Datacenter Server Racks & Terminals
  { type: 'server', x: 31, y: 18 },
  { type: 'server', x: 36, y: 18 },
  { type: 'server', x: 31, y: 40 },
  { type: 'server', x: 36, y: 40 },
  { type: 'server', x: 48, y: 29 },
  { type: 'server', x: 56, y: 29 },

  // Cooling Vents / Floor Grates
  { type: 'vent', x: 26, y: 30 },
  { type: 'vent', x: 42, y: 30 },
  { type: 'vent', x: 33, y: 22 },
  { type: 'vent', x: 33, y: 38 },
];

export class TechQuarterRenderer {
  private boardImg: HTMLImageElement = new Image();
  private consoleImg: HTMLImageElement = new Image();
  private lampImg: HTMLImageElement = new Image();
  private treeImg: HTMLImageElement = new Image();
  private serverImg: HTMLImageElement = new Image();
  private holoImg: HTMLImageElement = new Image();
  public imagesLoaded = false;

  constructor() {
    this.boardImg.src = '/art/prop_tech_board.png';
    this.consoleImg.src = '/art/prop_logic_console.png';
    this.lampImg.src = '/art/prop_tech_lamp.png';
    this.treeImg.src = '/art/prop_tech_planter.png';
    this.serverImg.src = '/art/prop_server_node.png';
    this.holoImg.src = '/art/prop_holo_stand.png';
  }

  /** Checks if a tile coordinate is within Tech Quarter. */
  public isTechQuarter(gx: number, gy: number): boolean {
    return gx >= TQ_MIN_X && gx <= TQ_MAX_X && gy >= TQ_MIN_Y && gy <= TQ_MAX_Y;
  }

  /**
   * Renders the authentic Cyberpunk Silicon Backdrop Tile for Tech Quarter at screen coordinates (x, y).
   * Generates server warehouse facades with blinking blade LEDs, circuit-etched midnight slate pavements,
   * metallic cleanroom grids around Logic Lab, and fiber-optic highway corridors.
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

    // ── 1. SOLID WALL / SERVER WAREHOUSE FACADE ──
    if (solid) {
      // Dark server casing foundation
      ctx.fillStyle = '#0b111e';
      ctx.fillRect(x, y, T, T);

      // Server rack frame
      ctx.fillStyle = '#172235';
      ctx.fillRect(x + 1, y + 1, T - 2, T - 2);

      // Server blade slots (horizontal drive bays)
      ctx.fillStyle = '#0d1522';
      ctx.fillRect(x + 2, y + 2, T - 4, 3);
      ctx.fillRect(x + 2, y + 6, T - 4, 3);
      ctx.fillRect(x + 2, y + 10, T - 4, 3);

      // Blinking activity LEDs
      const tick = Math.floor(now / 180);
      const ledSeed = (gx * 17 + gy * 31) % 5;

      if ((ledSeed + tick) % 3 === 0) {
        // Cyan activity light
        ctx.fillStyle = '#00f0ff';
        ctx.fillRect(x + 3, y + 3, 2, 1);
        ctx.fillRect(x + 7, y + 7, 2, 1);
      } else if ((ledSeed + tick) % 4 === 0) {
        // Emerald logic light
        ctx.fillStyle = '#10b981';
        ctx.fillRect(x + 11, y + 3, 2, 1);
        ctx.fillRect(x + 3, y + 11, 2, 1);
      } else {
        // Violet bus light
        ctx.fillStyle = '#a855f7';
        ctx.fillRect(x + 7, y + 3, 2, 1);
        ctx.fillRect(x + 11, y + 11, 2, 1);
      }

      // Yellow/black warning hazard striping on ground footing
      ctx.fillStyle = '#0f172a';
      ctx.fillRect(x, y + T - 2, T, 2);
      if ((gx + gy) % 2 === 0) {
        ctx.fillStyle = 'rgba(234, 179, 8, 0.6)';
        ctx.fillRect(x + 2, y + T - 2, 4, 2);
        ctx.fillRect(x + 10, y + T - 2, 4, 2);
      }
      return;
    }

    // ── 2. LOGIC LAB CLEANROOM PAVING (Around gx=62, gy=30) ──
    const isLogicLabPlaza = Math.hypot(gx - 62, gy - 30) <= 4.2;
    if (isLogicLabPlaza) {
      // Anti-static metallic raised floor
      ctx.fillStyle = '#141d30';
      ctx.fillRect(x, y, T, T);

      // Hexagonal / grid perforation
      ctx.fillStyle = '#1e2c45';
      ctx.fillRect(x + 1, y + 1, T - 2, T - 2);

      // Luminous cyan logic circuit traces
      ctx.fillStyle = '#00f0ff';
      if ((gx + gy) % 2 === 0) {
        ctx.fillRect(x + 3, y + 7, 10, 2);
        ctx.fillRect(x + 7, y + 3, 2, 10);
      } else {
        ctx.fillRect(x + 7, y + 7, 2, 2);
      }
      return;
    }

    // ── 3. TECH JOB BOARD PLAZA (Around gx=34, gy=30) ──
    const isJobBoardPlaza = Math.hypot(gx - 34, gy - 30) <= 3.8;
    if (isJobBoardPlaza) {
      // Midnight obsidian paver
      ctx.fillStyle = '#0f172a';
      ctx.fillRect(x, y, T, T);

      // Concentric circuit ring floor markings
      ctx.fillStyle = '#1a2740';
      ctx.fillRect(x + 1, y + 1, T - 2, T - 2);

      // Violet & Cyan circuit junction
      if ((gx + gy) % 3 === 0) {
        ctx.fillStyle = 'rgba(168, 85, 247, 0.6)';
        ctx.fillRect(x + 4, y + 4, 8, 8);
        ctx.fillStyle = '#00f0ff';
        ctx.fillRect(x + 6, y + 6, 4, 4);
      }
      return;
    }

    // ── 4. MAIN SILICON ARTERIAL CORRIDORS ──
    // Vertical Main Street: gx 30..36 | Horizontal Main Street: gy 27..33
    const isVertCorridor = gx >= 30 && gx <= 36;
    const isHorizCorridor = gy >= 27 && gy <= 33;

    if (isVertCorridor || isHorizCorridor) {
      // Smooth dark cyber-asphalt
      ctx.fillStyle = '#0e1626';
      ctx.fillRect(x, y, T, T);

      // Fiber-optic channel lines along road center
      if (isVertCorridor && (gx === 33)) {
        ctx.fillStyle = '#00f0ff';
        ctx.fillRect(x + 7, y, 2, T);
      }
      if (isHorizCorridor && (gy === 30)) {
        ctx.fillStyle = '#00f0ff';
        ctx.fillRect(x, y + 7, T, 2);
      }

      // Cyan boundary guidance rims
      if (gx === 30 || gx === 36) {
        ctx.fillStyle = 'rgba(0, 240, 255, 0.35)';
        ctx.fillRect(x + (gx === 30 ? 0 : T - 1), y, 1, T);
      }
      if (gy === 27 || gy === 33) {
        ctx.fillStyle = 'rgba(0, 240, 255, 0.35)';
        ctx.fillRect(x, y + (gy === 27 ? 0 : T - 1), T, 1);
      }

      // Micro circuit nodes on pavement
      if ((gx * 7 + gy * 13) % 9 === 0) {
        ctx.fillStyle = '#38bdf8';
        ctx.fillRect(x + 4, y + 4, 2, 2);
      }
      return;
    }

    // ── 5. STANDARD TECH QUARTER PAVING (Rest of district) ──
    // Deep midnight slate paver
    ctx.fillStyle = '#10192b';
    ctx.fillRect(x, y, T, T);

    // Subtle 16x16 tile grid lines
    ctx.fillStyle = '#17233c';
    ctx.fillRect(x, y, T, 1);
    ctx.fillRect(x, y, 1, T);
    ctx.fillStyle = '#0a101d';
    ctx.fillRect(x, y + T - 1, T, 1);
    ctx.fillRect(x + T - 1, y, 1, T);

    // Embedded glowing circuit traces
    const cHash = (gx * 11 + gy * 19) % 8;
    if (cHash === 0) {
      // Cyan circuit trace
      ctx.fillStyle = '#00f0ff';
      ctx.fillRect(x + 4, y + 7, 8, 2);
    } else if (cHash === 3) {
      // Violet circuit node
      ctx.fillStyle = '#a855f7';
      ctx.fillRect(x + 7, y + 4, 2, 8);
    } else if (cHash === 6) {
      // Golden data bus pin
      ctx.fillStyle = '#f59e0b';
      ctx.fillRect(x + 7, y + 7, 2, 2);
    }
  }

  /**
   * Renders Tech Quarter street props (cyan light pylons, silicon trees, server racks, vents).
   */
  public renderProps(
    ctx: CanvasRenderingContext2D,
    camX: number,
    camY: number,
    now: number
  ): void {
    const T = TILE_SIZE;

    for (const prop of TECH_QUARTER_PROPS) {
      const px = prop.x * T - camX;
      const py = prop.y * T - camY;

      // Frustum culling
      if (px < -40 || px > 520 || py < -40 || py > 310) continue;

      switch (prop.type) {
        case 'lamp':
          this.drawTechLamp(ctx, px, py, now);
          break;
        case 'tree':
          this.drawSiliconTree(ctx, px, py);
          break;
        case 'server':
          this.drawServerRack(ctx, px, py, now);
          break;
        case 'vent':
          this.drawCoolingVent(ctx, px, py, now);
          break;
      }
    }
  }

  /** Draws a Cyan Neon Street Light Pylon with downward ambient halo. */
  private drawTechLamp(
    ctx: CanvasRenderingContext2D,
    px: number,
    py: number,
    now: number
  ): void {
    // 1. Vivid cyan downward light cone
    const pulse = 0.85 + Math.sin(now / 280 + px) * 0.1;
    const haloX = px + 8;
    const haloY = py + 14;

    const grad = ctx.createRadialGradient(haloX, haloY, 2, haloX, haloY, 20);
    grad.addColorStop(0, `rgba(0, 240, 255, ${0.32 * pulse})`);
    grad.addColorStop(0.6, `rgba(56, 189, 248, ${0.12 * pulse})`);
    grad.addColorStop(1, 'rgba(0, 0, 0, 0)');
    ctx.fillStyle = grad;
    ctx.beginPath();
    ctx.arc(haloX, haloY, 20, 0, Math.PI * 2);
    ctx.fill();

    // 2. Base shadow
    ctx.fillStyle = 'rgba(0, 0, 0, 0.45)';
    ctx.fillRect(px + 4, py + 14, 8, 3);

    // 3. Render Lamp Sprite
    if (this.lampImg.complete && this.lampImg.naturalWidth > 0) {
      ctx.drawImage(this.lampImg, px, py - 16, 16, 32);
    } else {
      ctx.fillStyle = '#1e293b';
      ctx.fillRect(px + 7, py - 14, 2, 28);
      ctx.fillStyle = '#00f0ff';
      ctx.fillRect(px + 5, py - 16, 6, 4);
    }

    // Glowing cyan tip
    ctx.fillStyle = '#e0f2fe';
    ctx.fillRect(px + 7, py - 15, 2, 2);
  }

  /** Draws a Silicon Tree in a metallic hexagonal planter box. */
  private drawSiliconTree(ctx: CanvasRenderingContext2D, px: number, py: number): void {
    ctx.fillStyle = 'rgba(0, 0, 0, 0.4)';
    ctx.beginPath();
    ctx.ellipse(px + 11, py + 14, 10, 4, 0, 0, Math.PI * 2);
    ctx.fill();

    if (this.treeImg.complete && this.treeImg.naturalWidth > 0) {
      ctx.drawImage(this.treeImg, px - 2, py - 12, 22, 26);
    } else {
      ctx.fillStyle = '#1e293b';
      ctx.fillRect(px + 3, py + 6, 10, 8);
      ctx.fillStyle = '#06b6d4';
      ctx.beginPath();
      ctx.arc(px + 8, py, 9, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = '#38bdf8';
      ctx.beginPath();
      ctx.arc(px + 7, py - 2, 6, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  /** Draws an external server rack with blinking data LEDs. */
  private drawServerRack(
    ctx: CanvasRenderingContext2D,
    px: number,
    py: number,
    now: number
  ): void {
    ctx.fillStyle = 'rgba(0, 0, 0, 0.4)';
    ctx.fillRect(px + 2, py + 10, 14, 4);

    if (this.serverImg.complete && this.serverImg.naturalWidth > 0) {
      ctx.drawImage(this.serverImg, px, py - 10, 18, 24);
    } else {
      ctx.fillStyle = '#0f172a';
      ctx.fillRect(px + 2, py - 8, 14, 20);
      ctx.fillStyle = '#1e293b';
      ctx.fillRect(px + 3, py - 7, 12, 18);
    }

    // Blinking activity LEDs
    const blink = Math.floor(now / 150) % 2 === 0;
    ctx.fillStyle = blink ? '#00f0ff' : '#047857';
    ctx.fillRect(px + 5, py + 2, 2, 2);
    ctx.fillStyle = !blink ? '#a855f7' : '#0369a1';
    ctx.fillRect(px + 10, py + 2, 2, 2);
  }

  /** Draws a cooling vent with soft steam exhaust. */
  private drawCoolingVent(
    ctx: CanvasRenderingContext2D,
    px: number,
    py: number,
    now: number
  ): void {
    // Metal grate on ground
    ctx.fillStyle = '#0f172a';
    ctx.fillRect(px + 2, py + 2, 12, 12);
    ctx.fillStyle = '#1e293b';
    ctx.fillRect(px + 3, py + 3, 10, 10);
    ctx.fillStyle = '#00f0ff';
    ctx.fillRect(px + 4, py + 5, 8, 1);
    ctx.fillRect(px + 4, py + 7, 8, 1);
    ctx.fillRect(px + 4, py + 9, 8, 1);

    // Rising vapor puff
    const vaporOffset = (now / 200) % 8;
    const vaporAlpha = Math.max(0, 0.35 - vaporOffset * 0.04);
    ctx.fillStyle = `rgba(200, 240, 255, ${vaporAlpha})`;
    ctx.beginPath();
    ctx.arc(px + 8, py + 4 - vaporOffset, 4 + vaporOffset * 0.5, 0, Math.PI * 2);
    ctx.fill();
  }

  /**
   * Renders the Tech Job Board landmark at (34, 30).
   */
  public drawTechJobBoard(
    ctx: CanvasRenderingContext2D,
    propSheet: HTMLImageElement,
    x: number,
    y: number,
    now: number
  ): void {
    // Ground shadow
    ctx.fillStyle = 'rgba(0, 0, 0, 0.45)';
    ctx.fillRect(x - 14, y + 6, 28, 5);

    // Job board console
    if (this.boardImg.complete && this.boardImg.naturalWidth > 0) {
      ctx.drawImage(this.boardImg, x - 12, y - 22, 24, 28);
    } else if (propSheet.complete) {
      ctx.drawImage(propSheet, 52, 718, 185, 270, x - 10, y - 24, 20, 28);
    }

    // Floating Holographic Job Badge
    const bounce = Math.round(Math.sin(now / 240) * 2);
    ctx.fillStyle = 'rgba(15, 23, 42, 0.95)';
    ctx.fillRect(x - 36, y - 35 + bounce, 72, 10);
    ctx.strokeStyle = '#00f0ff';
    ctx.strokeRect(x - 35.5, y - 34.5 + bounce, 71, 9);
    ctx.font = 'bold 6px monospace';
    ctx.textAlign = 'center';
    ctx.fillStyle = '#e0f2fe';
    ctx.fillText('TECH JOB BOARD [CP/LOGIC]', x, y - 28 + bounce);
  }

  /**
   * Renders the Logic Lab landmark at (62, 30).
   */
  public drawLogicLab(
    ctx: CanvasRenderingContext2D,
    propSheet: HTMLImageElement,
    x: number,
    y: number,
    now: number
  ): void {
    // Ground shadow
    ctx.fillStyle = 'rgba(0, 0, 0, 0.45)';
    ctx.fillRect(x - 16, y + 6, 32, 5);

    // Logic console
    if (this.consoleImg.complete && this.consoleImg.naturalWidth > 0) {
      ctx.drawImage(this.consoleImg, x - 13, y - 24, 26, 30);
    } else if (propSheet.complete) {
      ctx.drawImage(propSheet, 52, 718, 185, 270, x - 11, y - 26, 22, 28);
    }

    // Floating Logic Lab Holographic Badge
    const bounce = Math.round(Math.sin(now / 240 + 1) * 2);
    ctx.fillStyle = 'rgba(15, 23, 42, 0.95)';
    ctx.fillRect(x - 34, y - 36 + bounce, 68, 10);
    ctx.strokeStyle = '#a855f7';
    ctx.strokeRect(x - 33.5, y - 35.5 + bounce, 67, 9);
    ctx.font = 'bold 6px monospace';
    ctx.textAlign = 'center';
    ctx.fillStyle = '#f3e8ff';
    ctx.fillText('LOGIC LAB [DEBUGGING]', x, y - 29 + bounce);
  }
}

export const globalTechQuarter = new TechQuarterRenderer();
