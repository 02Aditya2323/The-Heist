/**
 * The NEXUS / NEXUS Plaza District Renderer.
 * High-fidelity cyberpunk fortified citadel, AI cores, obsidian & royal violet paving,
 * gold filigree circuit inlays, plasma pylons, violet high-mast streetlamps,
 * and interactive landmark kiosks (NEXUS Board, Golden Hour Gate) for Region 4.
 */

import { TILE_SIZE } from '../assets/atlas.js';

export interface NexusProp {
  type: 'lamp' | 'obelisk' | 'pylon' | 'planter' | 'console';
  x: number; // tile X
  y: number; // tile Y
}

// Bounding box of The NEXUS / NEXUS Plaza in canonical grid
export const NX_MIN_X = 8;
export const NX_MAX_X = 73;
export const NX_MIN_Y = 65;
export const NX_MAX_Y = 97;

// Exact walkable prop positions inside NEXUS Plaza
export const NEXUS_PLAZA_PROPS: NexusProp[] = [
  // Grand Plaza Flanking Obelisks (near NEXUS Board at x=40, y=76)
  { type: 'obelisk', x: 36, y: 72 },
  { type: 'obelisk', x: 44, y: 72 },
  { type: 'obelisk', x: 36, y: 80 },
  { type: 'obelisk', x: 44, y: 80 },

  // Golden Hour Gate Approach Obelisks (near x=56, y=83)
  { type: 'obelisk', x: 52, y: 79 },
  { type: 'obelisk', x: 60, y: 79 },
  { type: 'obelisk', x: 52, y: 87 },
  { type: 'obelisk', x: 60, y: 87 },

  // High-Mast Violet Citadel Streetlamps
  { type: 'lamp', x: 20, y: 70 },
  { type: 'lamp', x: 28, y: 70 },
  { type: 'lamp', x: 48, y: 70 },
  { type: 'lamp', x: 64, y: 70 },
  { type: 'lamp', x: 20, y: 84 },
  { type: 'lamp', x: 28, y: 84 },
  { type: 'lamp', x: 48, y: 84 },
  { type: 'lamp', x: 64, y: 84 },

  // AI Core Quantum Nodes / Pylons
  { type: 'pylon', x: 34, y: 76 },
  { type: 'pylon', x: 46, y: 76 },
  { type: 'pylon', x: 50, y: 83 },
  { type: 'pylon', x: 62, y: 83 },

  // Bioluminescent Violet Planters
  { type: 'planter', x: 38, y: 71 },
  { type: 'planter', x: 42, y: 71 },
  { type: 'planter', x: 54, y: 80 },
  { type: 'planter', x: 58, y: 80 },

  // Quantum Consoles
  { type: 'console', x: 38, y: 78 },
  { type: 'console', x: 42, y: 78 },
];

export class NexusPlazaRenderer {
  private boardImg: HTMLImageElement = new Image();
  private gateImg: HTMLImageElement = new Image();
  private obeliskImg: HTMLImageElement = new Image();
  private lampImg: HTMLImageElement = new Image();
  private pylonImg: HTMLImageElement = new Image();
  private planterImg: HTMLImageElement = new Image();
  private consoleImg: HTMLImageElement = new Image();
  public imagesLoaded = false;

  constructor() {
    this.boardImg.src = '/art/prop_nexus_board.png';
    this.gateImg.src = '/art/prop_golden_gate.png';
    this.obeliskImg.src = '/art/prop_nexus_obelisk.png';
    this.lampImg.src = '/art/prop_nexus_lamp.png';
    this.pylonImg.src = '/art/prop_nexus_pylon.png';
    this.planterImg.src = '/art/prop_nexus_planter.png';
    this.consoleImg.src = '/art/prop_nexus_console.png';
  }

  /** Checks if a tile coordinate is within The NEXUS / NEXUS Plaza. */
  public isNexusPlaza(gx: number, gy: number): boolean {
    return gx >= NX_MIN_X && gx <= NX_MAX_X && gy >= NX_MIN_Y && gy <= NX_MAX_Y;
  }

  /**
   * Renders the authentic Cyberpunk NEXUS Citadel Backdrop Tile at screen coordinates (x, y).
   * Generates obsidian bastion facades with gold filigree and violet sensor slits,
   * royal violet plaza pavers, and glowing floor energy conduits.
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

    // ── 1. SOLID WALL / CITADEL BASTION FACADE ──
    if (solid) {
      // Obsidian foundation
      ctx.fillStyle = '#0f0e1f';
      ctx.fillRect(x, y, T, T);

      // Citadel fortified plating
      ctx.fillStyle = '#1e1a38';
      ctx.fillRect(x + 1, y + 1, T - 2, T - 2);

      // Gold filigree edge trim
      ctx.fillStyle = '#b4943a';
      ctx.fillRect(x + 2, y + 2, T - 4, 1);
      ctx.fillRect(x + 2, y + 2, 1, T - 4);

      // Slanted architectural bevel
      ctx.fillStyle = '#2c264f';
      ctx.fillRect(x + 3, y + 3, T - 6, T - 6);

      // Glowing violet sensor slit / AI cooling intake
      const pulse = 0.6 + 0.4 * Math.sin(now / 450 + (gx * 3 + gy * 7));
      ctx.fillStyle = `rgba(192, 132, 252, ${pulse.toFixed(2)})`;
      ctx.fillRect(x + 5, y + 7, 6, 2);

      // Golden security rune node on every 3rd block
      if ((gx + gy) % 3 === 0) {
        ctx.fillStyle = '#facc15';
        ctx.fillRect(x + 7, y + 11, 2, 2);
      }
      return;
    }

    // ── 2. WALKABLE GROUND / NEXUS GRAND PLAZA & ARTERIES ──
    const isMainAxis = gx === 40 || gy === 76 || gx === 56 || gy === 83;
    const isCeremonialAvenue = gx >= 36 && gx <= 44 && gy >= 70 && gy <= 82;
    const isGateApproach = gx >= 52 && gx <= 60 && gy >= 78 && gy <= 88;

    // Base obsidian-indigo plaza stone
    ctx.fillStyle = '#1c1b3b';
    ctx.fillRect(x, y, T, T);

    // Inner tile bevel
    ctx.fillStyle = isCeremonialAvenue || isGateApproach ? '#26244e' : '#222143';
    ctx.fillRect(x + 1, y + 1, T - 2, T - 2);

    // Subtle dark mortar grooves
    ctx.fillStyle = '#121124';
    ctx.fillRect(x, y, T, 1);
    ctx.fillRect(x, y, 1, T);

    // Geometric diamond inlay on every 2nd tile
    if ((gx + gy) % 2 === 0) {
      ctx.fillStyle = '#322f5c';
      ctx.fillRect(x + 5, y + 5, 6, 6);
      ctx.fillStyle = '#1c1b3b';
      ctx.fillRect(x + 7, y + 7, 2, 2);
    }

    // Glowing Gold & Cyan floor conduits along ceremonial avenues
    if (isMainAxis) {
      const conduitPulse = 0.5 + 0.5 * Math.sin(now / 350 + (gx + gy) * 0.4);
      if (gx === 40 || gx === 56) {
        // Vertical conduit
        ctx.fillStyle = `rgba(234, 179, 8, ${conduitPulse.toFixed(2)})`;
        ctx.fillRect(x + 7, y, 2, T);
      }
      if (gy === 76 || gy === 83) {
        // Horizontal conduit
        ctx.fillStyle = `rgba(0, 240, 255, ${conduitPulse.toFixed(2)})`;
        ctx.fillRect(x, y + 7, T, 2);
      }
    }

    // Gold corner inlay markers for ceremonial avenue
    if ((isCeremonialAvenue || isGateApproach) && (gx % 2 === 0 && gy % 2 === 0)) {
      ctx.fillStyle = '#eab308';
      ctx.fillRect(x + 2, y + 2, 2, 2);
      ctx.fillRect(x + 12, y + 12, 2, 2);
    }
  }

  /**
   * Renders static and animated props within NEXUS Plaza.
   */
  public renderProps(ctx: CanvasRenderingContext2D, camX: number, camY: number, now: number): void {
    const T = TILE_SIZE;

    for (const prop of NEXUS_PLAZA_PROPS) {
      const px = prop.x * T - camX;
      const py = prop.y * T - camY;

      // Frustum culling
      if (px < -40 || px > 520 || py < -40 || py > 310) continue;

      if (prop.type === 'lamp') {
        if (this.lampImg.complete && this.lampImg.naturalWidth > 0) {
          ctx.drawImage(this.lampImg, px, py - 18, 16, 32);
        } else {
          ctx.fillStyle = '#5b21b6';
          ctx.fillRect(px + 7, py - 14, 2, 28);
          ctx.fillStyle = '#c084fc';
          ctx.fillRect(px + 5, py - 16, 6, 4);
        }
        // Animated violet & magenta glow halo
        const lampPulse = 0.3 + 0.15 * Math.sin(now / 500 + prop.x * 2);
        ctx.fillStyle = `rgba(192, 132, 252, ${lampPulse.toFixed(2)})`;
        ctx.beginPath();
        ctx.arc(px + 8, py - 14, 10, 0, Math.PI * 2);
        ctx.fill();
      } else if (prop.type === 'obelisk') {
        if (this.obeliskImg.complete && this.obeliskImg.naturalWidth > 0) {
          ctx.drawImage(this.obeliskImg, px - 4, py - 18, 24, 34);
        } else {
          ctx.fillStyle = '#2e1065';
          ctx.fillRect(px + 2, py - 16, 12, 30);
          ctx.fillStyle = '#fbbf24';
          ctx.fillRect(px + 6, py - 12, 4, 22);
        }
        // Gold energy pulse at the apex
        const obPulse = 0.4 + 0.3 * Math.sin(now / 400 + prop.x);
        ctx.fillStyle = `rgba(250, 204, 21, ${obPulse.toFixed(2)})`;
        ctx.fillRect(px + 6, py - 16, 4, 3);
      } else if (prop.type === 'pylon') {
        if (this.pylonImg.complete && this.pylonImg.naturalWidth > 0) {
          ctx.drawImage(this.pylonImg, px + 1, py - 2, 14, 18);
        } else {
          ctx.fillStyle = '#4c1d95';
          ctx.fillRect(px + 4, py + 2, 8, 12);
        }
        // Cyan-purple quantum flare
        const pylonPulse = 0.4 + 0.3 * Math.sin(now / 300 + prop.y);
        ctx.fillStyle = `rgba(6, 182, 212, ${pylonPulse.toFixed(2)})`;
        ctx.fillRect(px + 6, py + 4, 4, 4);
      } else if (prop.type === 'planter') {
        if (this.planterImg.complete && this.planterImg.naturalWidth > 0) {
          ctx.drawImage(this.planterImg, px - 2, py - 4, 20, 20);
        } else {
          ctx.fillStyle = '#312e81';
          ctx.fillRect(px + 2, py + 6, 12, 8);
          ctx.fillStyle = '#a855f7';
          ctx.fillRect(px + 4, py, 8, 8);
        }
      } else if (prop.type === 'console') {
        if (this.consoleImg.complete && this.consoleImg.naturalWidth > 0) {
          ctx.drawImage(this.consoleImg, px - 2, py - 8, 20, 24);
        } else {
          ctx.fillStyle = '#1e1b4b';
          ctx.fillRect(px + 3, py + 2, 10, 12);
          ctx.fillStyle = '#06b6d4';
          ctx.fillRect(px + 4, py + 4, 8, 5);
        }
      }
    }
  }

  /**
   * Draws the authoritative NEXUS Job Board at (40, 76).
   * Features a royal violet/gold holographic AI terminal with floating glyphs.
   */
  public drawNexusBoard(
    ctx: CanvasRenderingContext2D,
    _fallbackSheet: HTMLImageElement,
    x: number,
    y: number,
    now: number
  ): void {
    const bob = Math.round(Math.sin(now / 300) * 2);

    // 1. Pedestal platform with glowing perimeter
    ctx.fillStyle = 'rgba(76, 29, 149, 0.4)';
    ctx.fillRect(x - 22, y - 4, 44, 20);
    ctx.strokeStyle = '#c084fc';
    ctx.lineWidth = 1;
    ctx.strokeRect(x - 21.5, y - 3.5, 43, 19);

    // 2. High-res extracted sprite or clean fallback
    if (this.boardImg.complete && this.boardImg.naturalWidth > 0) {
      ctx.drawImage(this.boardImg, x - 14, y - 18 + bob, 28, 26);
    } else {
      ctx.fillStyle = '#2e1065';
      ctx.fillRect(x - 12, y - 16 + bob, 24, 22);
      ctx.fillStyle = '#7c3aed';
      ctx.fillRect(x - 10, y - 14 + bob, 20, 14);
    }

    // 3. Floating Holographic Signboard
    const label = 'NEXUS BOARD [AI/CITADEL]';
    ctx.font = 'bold 6px monospace';
    ctx.textAlign = 'center';
    const w = ctx.measureText(label).width + 8;

    ctx.fillStyle = 'rgba(26, 17, 48, 0.95)';
    ctx.fillRect(x - w / 2, y - 30 + bob, w, 10);
    ctx.strokeStyle = '#eab308';
    ctx.strokeRect(x - w / 2 + 0.5, y - 29.5 + bob, w - 1, 9);

    // Animated gold & cyan text
    ctx.fillStyle = (now % 600 < 300) ? '#fde047' : '#67e8f9';
    ctx.fillText(label, x, y - 23 + bob);

    // 4. Holographic core emission beam
    const beamAlpha = 0.25 + 0.15 * Math.sin(now / 200);
    ctx.fillStyle = `rgba(168, 85, 247, ${beamAlpha.toFixed(2)})`;
    ctx.beginPath();
    ctx.moveTo(x - 12, y - 18 + bob);
    ctx.lineTo(x + 12, y - 18 + bob);
    ctx.lineTo(x + 16, y - 30 + bob);
    ctx.lineTo(x - 16, y - 30 + bob);
    ctx.closePath();
    ctx.fill();
  }

  /**
   * Draws the authoritative Golden Hour Gate at (56, 83).
   * Features massive fortified quantum gate pylons and an animated amber plasma energy field.
   */
  public drawGoldenHourGate(
    ctx: CanvasRenderingContext2D,
    _fallbackSheet: HTMLImageElement,
    x: number,
    y: number,
    now: number
  ): void {
    const bob = Math.round(Math.sin(now / 280) * 1.5);

    // 1. Foundation Energy Ring
    ctx.fillStyle = 'rgba(234, 179, 8, 0.25)';
    ctx.beginPath();
    ctx.ellipse(x, y + 4, 26, 12, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = '#eab308';
    ctx.lineWidth = 1;
    ctx.stroke();

    // 2. High-res extracted sprite or clean fallback
    if (this.gateImg.complete && this.gateImg.naturalWidth > 0) {
      ctx.drawImage(this.gateImg, x - 16, y - 22 + bob, 32, 32);
    } else {
      // Left and right fortified gold pylons
      ctx.fillStyle = '#78350f';
      ctx.fillRect(x - 16, y - 24 + bob, 8, 30);
      ctx.fillRect(x + 8, y - 24 + bob, 8, 30);

      ctx.fillStyle = '#f59e0b';
      ctx.fillRect(x - 14, y - 26 + bob, 4, 32);
      ctx.fillRect(x + 10, y - 26 + bob, 4, 32);

      // Top arch beam
      ctx.fillStyle = '#b45309';
      ctx.fillRect(x - 16, y - 26 + bob, 32, 6);
    }

    // 3. Shimmering Golden Plasma Arch Field
    const plasmaAlpha = 0.35 + 0.25 * Math.sin(now / 180);
    ctx.fillStyle = `rgba(251, 191, 36, ${plasmaAlpha.toFixed(2)})`;
    ctx.fillRect(x - 8, y - 20 + bob, 16, 22);

    // Plasma energy core rings
    ctx.strokeStyle = `rgba(254, 240, 138, ${(plasmaAlpha + 0.3).toFixed(2)})`;
    ctx.beginPath();
    ctx.arc(x, y - 9 + bob, 5 + Math.sin(now / 150) * 2, 0, Math.PI * 2);
    ctx.stroke();

    // 4. Floating Signboard
    const label = 'GOLDEN HOUR GATE';
    ctx.font = 'bold 6px monospace';
    ctx.textAlign = 'center';
    const w = ctx.measureText(label).width + 8;

    ctx.fillStyle = 'rgba(30, 20, 10, 0.95)';
    ctx.fillRect(x - w / 2, y - 36 + bob, w, 10);
    ctx.strokeStyle = '#f59e0b';
    ctx.strokeRect(x - w / 2 + 0.5, y - 35.5 + bob, w - 1, 9);

    ctx.fillStyle = '#fde68a';
    ctx.fillText(label, x, y - 29 + bob);
  }
}

// Global Singleton for immediate consumption by PixelRenderer
export const globalNexusPlaza = new NexusPlazaRenderer();
