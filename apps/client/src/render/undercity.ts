/**
 * Undercity District Renderer.
 * High-fidelity cyberpunk sub-street maintenance catacombs, toxic runoff canals,
 * runner safehouses, damp mossy cobblestone pavers, toxic green & magenta lighting,
 * and interactive landmark kiosks (Undercity Jobs, Home Lane, Safehouse Row) for Region 6.
 */

import { TILE_SIZE } from '../assets/atlas.js';

export interface UndercityProp {
  type: 'lamp' | 'pipe' | 'crate';
  x: number; // tile X
  y: number; // tile Y
}

// Bounding box of Undercity in canonical grid
export const UC_MIN_X = 48;
export const UC_MAX_X = 138;
export const UC_MIN_Y = 98;
export const UC_MAX_Y = 138;

// Exact walkable prop positions inside Undercity
export const UNDERCITY_PROPS: UndercityProp[] = [
  // Maintenance Lanterns along avenues and alleys
  { type: 'lamp', x: 56, y: 104 },
  { type: 'lamp', x: 74, y: 104 },
  { type: 'lamp', x: 86, y: 104 },
  { type: 'lamp', x: 102, y: 104 },
  { type: 'lamp', x: 120, y: 104 },

  { type: 'lamp', x: 60, y: 114 },
  { type: 'lamp', x: 70, y: 114 },
  { type: 'lamp', x: 106, y: 114 },
  { type: 'lamp', x: 118, y: 114 },

  { type: 'lamp', x: 56, y: 128 },
  { type: 'lamp', x: 74, y: 128 },
  { type: 'lamp', x: 92, y: 128 },
  { type: 'lamp', x: 110, y: 128 },
  { type: 'lamp', x: 128, y: 128 },

  // Toxic Runoff Pipes and Vents
  { type: 'pipe', x: 62, y: 108 },
  { type: 'pipe', x: 68, y: 108 },
  { type: 'pipe', x: 108, y: 108 },
  { type: 'pipe', x: 116, y: 108 },
  { type: 'pipe', x: 88, y: 100 },
  { type: 'pipe', x: 94, y: 100 },

  // Contraband Runner Crates
  { type: 'crate', x: 64, y: 106 },
  { type: 'crate', x: 66, y: 106 },
  { type: 'crate', x: 110, y: 106 },
  { type: 'crate', x: 114, y: 106 },
  { type: 'crate', x: 89, y: 102 },
  { type: 'crate', x: 93, y: 102 },
];

export class UndercityRenderer {
  private boardImg: HTMLImageElement = new Image();
  private homeImg: HTMLImageElement = new Image();
  private safehouseImg: HTMLImageElement = new Image();
  private lampImg: HTMLImageElement = new Image();
  private pipeImg: HTMLImageElement = new Image();
  private crateImg: HTMLImageElement = new Image();
  public imagesLoaded = false;

  constructor() {
    this.boardImg.src = '/art/prop_undercity_board.png';
    this.homeImg.src = '/art/prop_home_entry.png';
    this.safehouseImg.src = '/art/prop_safehouse_entry.png';
    this.lampImg.src = '/art/prop_undercity_lamp.png';
    this.pipeImg.src = '/art/prop_toxic_pipe.png';
    this.crateImg.src = '/art/prop_undercity_crate.png';
  }

  /** Checks if a tile coordinate is within Undercity. */
  public isUndercity(gx: number, gy: number): boolean {
    return gx >= UC_MIN_X && gx <= UC_MAX_X && gy >= UC_MIN_Y && gy <= UC_MAX_Y;
  }

  /**
   * Renders the authentic Cyberpunk Undercity Backdrop Tile at screen coordinates (x, y).
   * Generates damp subterranean stone masonry with toxic runoff seepage,
   * cobblestone catacomb pavers with luminescent green drainage canals.
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

    // ── 1. SOLID WALL / DAMP CATACOMB BRICKWORK FACADE ──
    if (solid) {
      // Dark subterranean foundation
      ctx.fillStyle = '#0f0b1a';
      ctx.fillRect(x, y, T, T);

      // Damp stone block
      ctx.fillStyle = '#1e162c';
      ctx.fillRect(x + 1, y + 1, T - 2, T - 2);

      // Iron support girder trim
      ctx.fillStyle = '#36244f';
      ctx.fillRect(x + 2, y + 2, T - 4, 1);
      ctx.fillRect(x + 2, y + 2, 1, T - 4);

      // Toxic moss seepage / moisture streak
      if ((gx * 5 + gy * 7) % 3 === 0) {
        ctx.fillStyle = '#14532d';
        ctx.fillRect(x + 4, y + 6, 8, 4);
        ctx.fillStyle = '#22c55e';
        ctx.fillRect(x + 6, y + 8, 4, 2);
      }

      // Bioluminescent slime droplet
      if ((gx + gy) % 5 === 0) {
        const slimePulse = 0.5 + 0.5 * Math.sin(now / 500 + (gx * 3 + gy));
        ctx.fillStyle = `rgba(74, 222, 128, ${slimePulse.toFixed(2)})`;
        ctx.fillRect(x + 8, y + 12, 2, 3);
      }
      return;
    }

    // ── 2. WALKABLE GROUND / CATACOMB COBBLESTONE & RUNOFF CHANNELS ──
    const isMainRunoffChannel = gy === 104 || gy === 114 || gy === 128 || gx === 91;

    // Damp catacomb stone base
    ctx.fillStyle = '#1c1729';
    ctx.fillRect(x, y, T, T);

    // Cobblestone paver variation
    if ((gx + gy) % 2 === 0) {
      ctx.fillStyle = '#251e36';
      ctx.fillRect(x + 2, y + 2, 6, 6);
      ctx.fillRect(x + 9, y + 9, 5, 5);
    } else {
      ctx.fillStyle = '#221b31';
      ctx.fillRect(x + 3, y + 8, 6, 5);
      ctx.fillRect(x + 8, y + 2, 6, 5);
    }

    // Mortar groove lines
    ctx.fillStyle = '#120e1c';
    ctx.fillRect(x, y, T, 1);
    ctx.fillRect(x, y, 1, T);

    // Glowing Toxic Runoff Canal / Slime Gutter along key conduits
    if (isMainRunoffChannel) {
      const toxicPulse = 0.45 + 0.35 * Math.sin(now / 400 + (gx + gy) * 0.4);
      if (gy === 104 || gy === 114 || gy === 128) {
        // Horizontal drainage gutter
        ctx.fillStyle = '#052e16';
        ctx.fillRect(x, y + 6, T, 4);
        ctx.fillStyle = `rgba(34, 197, 94, ${toxicPulse.toFixed(2)})`;
        ctx.fillRect(x, y + 7, T, 2);
      }
      if (gx === 91) {
        // Vertical central canal
        ctx.fillStyle = '#052e16';
        ctx.fillRect(x + 6, y, 4, T);
        ctx.fillStyle = `rgba(34, 197, 94, ${toxicPulse.toFixed(2)})`;
        ctx.fillRect(x + 7, y, 2, T);
      }
    }
  }

  /**
   * Renders static and animated props within Undercity.
   */
  public renderProps(ctx: CanvasRenderingContext2D, camX: number, camY: number, now: number): void {
    const T = TILE_SIZE;

    for (const prop of UNDERCITY_PROPS) {
      const px = prop.x * T - camX;
      const py = prop.y * T - camY;

      // Frustum culling
      if (px < -40 || px > 520 || py < -40 || py > 310) continue;

      if (prop.type === 'lamp') {
        if (this.lampImg.complete && this.lampImg.naturalWidth > 0) {
          ctx.drawImage(this.lampImg, px, py - 18, 16, 32);
        } else {
          ctx.fillStyle = '#14532d';
          ctx.fillRect(px + 7, py - 14, 2, 28);
          ctx.fillStyle = '#22c55e';
          ctx.fillRect(px + 5, py - 16, 6, 4);
        }
        // Animated Toxic Green / Emerald Lantern Glow
        const glowPulse = 0.35 + 0.2 * Math.sin(now / 380 + prop.x * 2);
        ctx.fillStyle = `rgba(34, 197, 94, ${glowPulse.toFixed(2)})`;
        ctx.beginPath();
        ctx.arc(px + 8, py - 14, 10, 0, Math.PI * 2);
        ctx.fill();
      } else if (prop.type === 'pipe') {
        if (this.pipeImg.complete && this.pipeImg.naturalWidth > 0) {
          ctx.drawImage(this.pipeImg, px, py - 10, 16, 26);
        } else {
          ctx.fillStyle = '#374151';
          ctx.fillRect(px + 4, py - 4, 8, 18);
          ctx.fillStyle = '#15803d';
          ctx.fillRect(px + 3, py + 8, 10, 4);
        }
        // Animated toxic steam vapor puff
        const steamPhase = (now + prop.x * 300) % 1200;
        if (steamPhase < 600) {
          const steamY = py - 6 - (steamPhase / 600) * 8;
          const alpha = 0.4 * (1 - steamPhase / 600);
          ctx.fillStyle = `rgba(134, 239, 172, ${alpha.toFixed(2)})`;
          ctx.beginPath();
          ctx.arc(px + 8, steamY, 4, 0, Math.PI * 2);
          ctx.fill();
        }
      } else if (prop.type === 'crate') {
        if (this.crateImg.complete && this.crateImg.naturalWidth > 0) {
          ctx.drawImage(this.crateImg, px - 1, py, 18, 16);
        } else {
          ctx.fillStyle = '#27272a';
          ctx.fillRect(px + 1, py + 2, 14, 12);
          ctx.fillStyle = '#a855f7';
          ctx.fillRect(px + 3, py + 4, 10, 2);
        }
      }
    }
  }

  /**
   * Draws the authoritative Undercity Jobs Board at (91, 101).
   * Features a scavengers/runners underworld contract kiosk with toxic green & pink HUD.
   */
  public drawUndercityJobs(
    ctx: CanvasRenderingContext2D,
    _fallbackSheet: HTMLImageElement,
    x: number,
    y: number,
    now: number
  ): void {
    const bob = Math.round(Math.sin(now / 270) * 2);

    // 1. Catacomb Stone Base with glowing toxic pool
    ctx.fillStyle = 'rgba(20, 83, 45, 0.45)';
    ctx.fillRect(x - 20, y - 4, 40, 20);
    ctx.strokeStyle = '#22c55e';
    ctx.lineWidth = 1;
    ctx.strokeRect(x - 19.5, y - 3.5, 39, 19);

    // 2. Extracted sprite or crisp procedural kiosk
    if (this.boardImg.complete && this.boardImg.naturalWidth > 0) {
      ctx.drawImage(this.boardImg, x - 14, y - 18 + bob, 28, 26);
    } else {
      ctx.fillStyle = '#140f1f';
      ctx.fillRect(x - 12, y - 16 + bob, 24, 22);
      ctx.fillStyle = '#15803d';
      ctx.fillRect(x - 10, y - 14 + bob, 20, 14);
    }

    // 3. Floating Underworld Signboard
    const label = 'UNDERCITY JOBS [RUNNER/SCAVENGER]';
    ctx.font = 'bold 6px monospace';
    ctx.textAlign = 'center';
    const w = ctx.measureText(label).width + 8;

    ctx.fillStyle = 'rgba(15, 23, 18, 0.95)';
    ctx.fillRect(x - w / 2, y - 30 + bob, w, 10);
    ctx.strokeStyle = '#22c55e';
    ctx.strokeRect(x - w / 2 + 0.5, y - 29.5 + bob, w - 1, 9);

    // Fluorescent Lime & Magenta text
    ctx.fillStyle = (now % 600 < 300) ? '#4ade80' : '#f472b6';
    ctx.fillText(label, x, y - 23 + bob);
  }

  /**
   * Draws the authoritative Home Lane runner flats at (65, 108).
   * Features a residential runner portal with warm amber porchlight and safehouse runes.
   */
  public drawHomeLane(
    ctx: CanvasRenderingContext2D,
    _fallbackSheet: HTMLImageElement,
    x: number,
    y: number,
    now: number
  ): void {
    const bob = Math.round(Math.sin(now / 310) * 1.5);

    // 1. Doorway Foundation
    ctx.fillStyle = 'rgba(217, 119, 6, 0.35)';
    ctx.fillRect(x - 18, y - 4, 36, 20);

    // 2. Extracted sprite or clean doorway geometry
    if (this.homeImg.complete && this.homeImg.naturalWidth > 0) {
      ctx.drawImage(this.homeImg, x - 13, y - 20 + bob, 26, 28);
    } else {
      ctx.fillStyle = '#291e3b';
      ctx.fillRect(x - 12, y - 18 + bob, 24, 24);
      ctx.fillStyle = '#f59e0b';
      ctx.fillRect(x - 6, y - 12 + bob, 12, 16);
    }

    // 3. Porchlight glow
    const porchGlow = 0.4 + 0.2 * Math.sin(now / 350);
    ctx.fillStyle = `rgba(251, 191, 36, ${porchGlow.toFixed(2)})`;
    ctx.beginPath();
    ctx.arc(x, y - 14 + bob, 8, 0, Math.PI * 2);
    ctx.fill();

    // 4. Floating Signboard
    const label = 'HOME LANE [RUNNER FLATS]';
    ctx.font = 'bold 6px monospace';
    ctx.textAlign = 'center';
    const w = ctx.measureText(label).width + 8;

    ctx.fillStyle = 'rgba(25, 20, 30, 0.95)';
    ctx.fillRect(x - w / 2, y - 32 + bob, w, 10);
    ctx.strokeStyle = '#f59e0b';
    ctx.strokeRect(x - w / 2 + 0.5, y - 31.5 + bob, w - 1, 9);

    ctx.fillStyle = '#fde68a';
    ctx.fillText(label, x, y - 25 + bob);
  }

  /**
   * Draws the authoritative Safehouse Row at (112, 108).
   * Features a fortified syndicate hideout with heavy vault door and biometric scanner.
   */
  public drawSafehouseRow(
    ctx: CanvasRenderingContext2D,
    _fallbackSheet: HTMLImageElement,
    x: number,
    y: number,
    now: number
  ): void {
    const bob = Math.round(Math.sin(now / 290) * 1.5);

    // 1. Armored Foundation
    ctx.fillStyle = 'rgba(76, 29, 149, 0.4)';
    ctx.fillRect(x - 18, y - 4, 36, 20);

    // 2. Extracted sprite or heavy safehouse vault door
    if (this.safehouseImg.complete && this.safehouseImg.naturalWidth > 0) {
      ctx.drawImage(this.safehouseImg, x - 13, y - 20 + bob, 26, 28);
    } else {
      ctx.fillStyle = '#1e1b4b';
      ctx.fillRect(x - 12, y - 18 + bob, 24, 24);
      ctx.fillStyle = '#6366f1';
      ctx.fillRect(x - 8, y - 14 + bob, 16, 18);
    }

    // 3. Biometric Scanner Beam (sweeping horizontal laser)
    const scanPhase = (now % 1000) / 1000;
    const scanY = y - 14 + bob + scanPhase * 16;
    ctx.fillStyle = 'rgba(236, 72, 153, 0.85)';
    ctx.fillRect(x - 8, scanY, 16, 1.5);

    // 4. Floating Signboard
    const label = 'SAFEHOUSE ROW [HEIST HIDEOUT]';
    ctx.font = 'bold 6px monospace';
    ctx.textAlign = 'center';
    const w = ctx.measureText(label).width + 8;

    ctx.fillStyle = 'rgba(20, 15, 30, 0.95)';
    ctx.fillRect(x - w / 2, y - 32 + bob, w, 10);
    ctx.strokeStyle = '#c084fc';
    ctx.strokeRect(x - w / 2 + 0.5, y - 31.5 + bob, w - 1, 9);

    ctx.fillStyle = '#fbcfe8';
    ctx.fillText(label, x, y - 25 + bob);
  }
}

// Global Singleton for immediate consumption by PixelRenderer
export const globalUndercity = new UndercityRenderer();
