/**
 * Black Grid District Renderer.
 * High-fidelity cyberpunk off-grid rogue server enclaves, cipher dens,
 * grimy industrial tarmac, blood-red neon and hazard amber lighting,
 * and interactive landmark kiosks (Black Grid Board, Cipher Market, City Gate) for Region 5.
 */

import { TILE_SIZE } from '../assets/atlas.js';

export interface BlackGridProp {
  type: 'lamp' | 'barrier' | 'terminal';
  x: number; // tile X
  y: number; // tile Y
}

// Bounding box of Black Grid in canonical grid
export const BG_MIN_X = 138;
export const BG_MAX_X = 195;
export const BG_MIN_Y = 65;
export const BG_MAX_Y = 97;

// Exact walkable prop positions inside Black Grid
export const BLACK_GRID_PROPS: BlackGridProp[] = [
  // Red Industrial Streetlamps along primary avenues
  { type: 'lamp', x: 144, y: 70 },
  { type: 'lamp', x: 154, y: 70 },
  { type: 'lamp', x: 168, y: 70 },
  { type: 'lamp', x: 182, y: 70 },
  { type: 'lamp', x: 144, y: 82 },
  { type: 'lamp', x: 154, y: 82 },
  { type: 'lamp', x: 168, y: 82 },
  { type: 'lamp', x: 188, y: 82 },

  // Flanking Security Barriers around Cipher Market and City Gate
  { type: 'barrier', x: 174, y: 82 },
  { type: 'barrier', x: 184, y: 82 },
  { type: 'barrier', x: 174, y: 86 },
  { type: 'barrier', x: 184, y: 86 },
  { type: 'barrier', x: 192, y: 68 },
  { type: 'barrier', x: 192, y: 72 },

  // Rogue Siphon Terminals
  { type: 'terminal', x: 152, y: 76 },
  { type: 'terminal', x: 164, y: 76 },
  { type: 'terminal', x: 176, y: 84 },
  { type: 'terminal', x: 190, y: 72 },
];

export class BlackGridRenderer {
  private boardImg: HTMLImageElement = new Image();
  private marketImg: HTMLImageElement = new Image();
  private gateImg: HTMLImageElement = new Image();
  private lampImg: HTMLImageElement = new Image();
  private barrierImg: HTMLImageElement = new Image();
  private terminalImg: HTMLImageElement = new Image();
  public imagesLoaded = false;

  constructor() {
    this.boardImg.src = '/art/prop_blackgrid_board.png';
    this.marketImg.src = '/art/prop_cipher_market.png';
    this.gateImg.src = '/art/prop_city_gate.png';
    this.lampImg.src = '/art/prop_blackgrid_lamp.png';
    this.barrierImg.src = '/art/prop_blackgrid_barrier.png';
    this.terminalImg.src = '/art/prop_blackgrid_terminal.png';
  }

  /** Checks if a tile coordinate is within Black Grid. */
  public isBlackGrid(gx: number, gy: number): boolean {
    return gx >= BG_MIN_X && gx <= BG_MAX_X && gy >= BG_MIN_Y && gy <= BG_MAX_Y;
  }

  /**
   * Renders the authentic Cyberpunk Black Grid Backdrop Tile at screen coordinates (x, y).
   * Generates reinforced steel bunker facades with hazard stripes, blood-red indicator lamps,
   * distressed asphalt with drainage grates, and rogue red siphon conduits.
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

    // ── 1. SOLID WALL / REINFORCED BUNKER FACADE ──
    if (solid) {
      // Dark iron foundation
      ctx.fillStyle = '#0f0a14';
      ctx.fillRect(x, y, T, T);

      // Heavy armor plating
      ctx.fillStyle = '#211528';
      ctx.fillRect(x + 1, y + 1, T - 2, T - 2);

      // Hazard edge trim (rust and dark crimson)
      ctx.fillStyle = '#7f1d1d';
      ctx.fillRect(x + 2, y + 2, T - 4, 1);
      ctx.fillRect(x + 2, y + 2, 1, T - 4);

      // Inner plate with rivets
      ctx.fillStyle = '#2e1c38';
      ctx.fillRect(x + 3, y + 3, T - 6, T - 6);

      // Blood-red security slit / server exhaust
      const flicker = (now + (gx * 31 + gy * 17)) % 800 < 650 ? 1 : 0.2;
      ctx.fillStyle = `rgba(239, 68, 68, ${flicker})`;
      ctx.fillRect(x + 5, y + 7, 6, 2);

      // Corner rivets
      ctx.fillStyle = '#450a0a';
      ctx.fillRect(x + 3, y + 3, 1, 1);
      ctx.fillRect(x + 12, y + 3, 1, 1);
      ctx.fillRect(x + 3, y + 12, 1, 1);
      ctx.fillRect(x + 12, y + 12, 1, 1);
      return;
    }

    // ── 2. WALKABLE GROUND / GRUNGY BLACK GRID STREETS & ALLEYS ──
    const isMainArtery = gx === 158 || gy === 76 || gx === 179 || gy === 84 || gx === 194 || gy === 70;

    // Dark distressed asphalt
    ctx.fillStyle = '#16111d';
    ctx.fillRect(x, y, T, T);

    // Subtle asphalt texture variation
    if ((gx * 7 + gy * 13) % 4 === 0) {
      ctx.fillStyle = '#22192b';
      ctx.fillRect(x + 2, y + 2, T - 4, T - 4);
    }

    // Drainage grates and manhole vents
    if ((gx * 11 + gy * 19) % 23 === 0) {
      ctx.fillStyle = '#0a070d';
      ctx.fillRect(x + 4, y + 4, 8, 8);
      ctx.fillStyle = '#ef4444';
      ctx.fillRect(x + 5, y + 6, 6, 1);
      ctx.fillRect(x + 5, y + 8, 6, 1);
    }

    // Yellow/Amber hazard cross-hatch marking on key intersections
    if ((gx === 178 || gx === 179 || gx === 180) && (gy >= 82 && gy <= 86)) {
      ctx.fillStyle = '#b45309';
      if ((gx + gy) % 2 === 0) {
        ctx.fillRect(x + 2, y + 2, 4, 4);
        ctx.fillRect(x + 10, y + 10, 4, 4);
      }
    }

    // Glowing Rogue Siphon Floor Conduits (pulsing blood red & amber)
    if (isMainArtery) {
      const redPulse = 0.4 + 0.4 * Math.sin(now / 320 + (gx + gy) * 0.5);
      if (gx === 158 || gx === 179 || gx === 194) {
        ctx.fillStyle = `rgba(239, 68, 68, ${redPulse.toFixed(2)})`;
        ctx.fillRect(x + 7, y, 2, T);
      }
      if (gy === 76 || gy === 84 || gy === 70) {
        ctx.fillStyle = `rgba(249, 115, 22, ${redPulse.toFixed(2)})`;
        ctx.fillRect(x, y + 7, T, 2);
      }
    }
  }

  /**
   * Renders static and animated props within Black Grid.
   */
  public renderProps(ctx: CanvasRenderingContext2D, camX: number, camY: number, now: number): void {
    const T = TILE_SIZE;

    for (const prop of BLACK_GRID_PROPS) {
      const px = prop.x * T - camX;
      const py = prop.y * T - camY;

      // Frustum culling
      if (px < -40 || px > 520 || py < -40 || py > 310) continue;

      if (prop.type === 'lamp') {
        if (this.lampImg.complete && this.lampImg.naturalWidth > 0) {
          ctx.drawImage(this.lampImg, px, py - 18, 16, 32);
        } else {
          ctx.fillStyle = '#450a0a';
          ctx.fillRect(px + 7, py - 14, 2, 28);
          ctx.fillStyle = '#ef4444';
          ctx.fillRect(px + 5, py - 16, 6, 4);
        }
        // Animated Crimson Hazard Glow Halo
        const glowPulse = 0.35 + 0.2 * Math.sin(now / 400 + prop.x * 3);
        ctx.fillStyle = `rgba(239, 68, 68, ${glowPulse.toFixed(2)})`;
        ctx.beginPath();
        ctx.arc(px + 8, py - 14, 11, 0, Math.PI * 2);
        ctx.fill();
      } else if (prop.type === 'barrier') {
        if (this.barrierImg.complete && this.barrierImg.naturalWidth > 0) {
          ctx.drawImage(this.barrierImg, px - 1, py, 18, 16);
        } else {
          ctx.fillStyle = '#374151';
          ctx.fillRect(px + 1, py + 4, 14, 10);
          ctx.fillStyle = '#f59e0b';
          ctx.fillRect(px + 3, py + 6, 3, 6);
          ctx.fillRect(px + 9, py + 6, 3, 6);
        }
      } else if (prop.type === 'terminal') {
        if (this.terminalImg.complete && this.terminalImg.naturalWidth > 0) {
          ctx.drawImage(this.terminalImg, px, py - 6, 16, 22);
        } else {
          ctx.fillStyle = '#1c1917';
          ctx.fillRect(px + 2, py + 2, 12, 14);
          ctx.fillStyle = '#dc2626';
          ctx.fillRect(px + 4, py + 4, 8, 6);
        }
        // Blinking red data siphon LED
        if ((now + prop.x * 200) % 600 < 300) {
          ctx.fillStyle = '#ef4444';
          ctx.fillRect(px + 7, py, 2, 2);
        }
      }
    }
  }

  /**
   * Draws the authoritative Black Grid Job Board at (158, 76).
   * Features a rogue encrypted cyber-board with crimson HUD and hazard styling.
   */
  public drawBlackGridBoard(
    ctx: CanvasRenderingContext2D,
    _fallbackSheet: HTMLImageElement,
    x: number,
    y: number,
    now: number
  ): void {
    const bob = Math.round(Math.sin(now / 260) * 2);

    // 1. Concrete Base with hazard glow
    ctx.fillStyle = 'rgba(127, 29, 29, 0.45)';
    ctx.fillRect(x - 20, y - 4, 40, 20);
    ctx.strokeStyle = '#ef4444';
    ctx.lineWidth = 1;
    ctx.strokeRect(x - 19.5, y - 3.5, 39, 19);

    // 2. Extracted sprite or crisp procedural kiosk
    if (this.boardImg.complete && this.boardImg.naturalWidth > 0) {
      ctx.drawImage(this.boardImg, x - 14, y - 18 + bob, 28, 26);
    } else {
      ctx.fillStyle = '#1f1315';
      ctx.fillRect(x - 12, y - 16 + bob, 24, 22);
      ctx.fillStyle = '#7f1d1d';
      ctx.fillRect(x - 10, y - 14 + bob, 20, 14);
    }

    // 3. Floating Rogue Signboard
    const label = 'BLACK GRID [CIPHER/ROGUE]';
    ctx.font = 'bold 6px monospace';
    ctx.textAlign = 'center';
    const w = ctx.measureText(label).width + 8;

    ctx.fillStyle = 'rgba(20, 10, 12, 0.95)';
    ctx.fillRect(x - w / 2, y - 30 + bob, w, 10);
    ctx.strokeStyle = '#ef4444';
    ctx.strokeRect(x - w / 2 + 0.5, y - 29.5 + bob, w - 1, 9);

    // Flickering Blood-Red text
    ctx.fillStyle = (now % 500 < 350) ? '#f87171' : '#f97316';
    ctx.fillText(label, x, y - 23 + bob);
  }

  /**
   * Draws the authoritative Cipher Market at (179, 84).
   * Features an underground crypto dealer stall with encrypted data crates.
   */
  public drawCipherMarket(
    ctx: CanvasRenderingContext2D,
    _fallbackSheet: HTMLImageElement,
    x: number,
    y: number,
    now: number
  ): void {
    const bob = Math.round(Math.sin(now / 320) * 1.5);

    // 1. Market Stall Canopy / Vault Base
    ctx.fillStyle = 'rgba(69, 10, 10, 0.5)';
    ctx.fillRect(x - 22, y - 4, 44, 22);
    ctx.strokeStyle = '#f97316';
    ctx.lineWidth = 1;
    ctx.strokeRect(x - 21.5, y - 3.5, 43, 21);

    // 2. Extracted sprite or clean stall geometry
    if (this.marketImg.complete && this.marketImg.naturalWidth > 0) {
      ctx.drawImage(this.marketImg, x - 15, y - 20 + bob, 30, 28);
    } else {
      // Iron stall poles and awning
      ctx.fillStyle = '#450a0a';
      ctx.fillRect(x - 14, y - 18 + bob, 28, 24);
      ctx.fillStyle = '#b91c1c';
      ctx.fillRect(x - 16, y - 22 + bob, 32, 6);
    }

    // 3. Shimmering neon cipher ticker
    const tickerGlow = 0.4 + 0.3 * Math.sin(now / 200);
    ctx.fillStyle = `rgba(239, 68, 68, ${tickerGlow.toFixed(2)})`;
    ctx.fillRect(x - 10, y - 10 + bob, 20, 4);

    // 4. Floating Signboard
    const label = 'CIPHER MARKET';
    ctx.font = 'bold 6px monospace';
    ctx.textAlign = 'center';
    const w = ctx.measureText(label).width + 8;

    ctx.fillStyle = 'rgba(25, 10, 15, 0.95)';
    ctx.fillRect(x - w / 2, y - 32 + bob, w, 10);
    ctx.strokeStyle = '#f97316';
    ctx.strokeRect(x - w / 2 + 0.5, y - 31.5 + bob, w - 1, 9);

    ctx.fillStyle = '#fed7aa';
    ctx.fillText(label, x, y - 25 + bob);
  }

  /**
   * Draws the authoritative City Gate at (194, 70).
   * Features heavy security hydraulic barriers and hazard alert lighting.
   */
  public drawCityGate(
    ctx: CanvasRenderingContext2D,
    _fallbackSheet: HTMLImageElement,
    x: number,
    y: number,
    now: number
  ): void {
    const bob = Math.round(Math.sin(now / 250) * 1);

    // 1. Heavy Gate Foundation
    ctx.fillStyle = 'rgba(30, 20, 25, 0.6)';
    ctx.fillRect(x - 20, y - 4, 40, 20);

    // 2. Extracted sprite or heavy gate barrier
    if (this.gateImg.complete && this.gateImg.naturalWidth > 0) {
      ctx.drawImage(this.gateImg, x - 16, y - 20 + bob, 32, 28);
    } else {
      ctx.fillStyle = '#374151';
      ctx.fillRect(x - 16, y - 20 + bob, 32, 26);
      ctx.fillStyle = '#f59e0b';
      ctx.fillRect(x - 14, y - 16 + bob, 28, 4);
    }

    // 3. Flashing Siren Beacon
    const siren = (now % 400 < 200);
    ctx.fillStyle = siren ? '#ef4444' : '#7f1d1d';
    ctx.beginPath();
    ctx.arc(x, y - 24 + bob, 4, 0, Math.PI * 2);
    ctx.fill();

    // 4. Floating Signboard
    const label = 'CITY GATE [PERIMETER]';
    ctx.font = 'bold 6px monospace';
    ctx.textAlign = 'center';
    const w = ctx.measureText(label).width + 8;

    ctx.fillStyle = 'rgba(15, 10, 15, 0.95)';
    ctx.fillRect(x - w / 2, y - 34 + bob, w, 10);
    ctx.strokeStyle = '#ef4444';
    ctx.strokeRect(x - w / 2 + 0.5, y - 33.5 + bob, w - 1, 9);

    ctx.fillStyle = '#fca5a5';
    ctx.fillText(label, x, y - 27 + bob);
  }
}

// Global Singleton for immediate consumption by PixelRenderer
export const globalBlackGrid = new BlackGridRenderer();
