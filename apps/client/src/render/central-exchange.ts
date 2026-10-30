/**
 * Central Exchange District Renderer.
 * High-fidelity cyberpunk corporate plaza backdrop, arterial avenues,
 * road markings, crosswalks, street props (lamp posts, cyber trees, benches, bollards),
 * and interactive landmark kiosks for Region 1: Central Exchange.
 */

import { TILE_SIZE } from '../assets/atlas.js';

export interface DistrictProp {
  type: 'lamp' | 'tree' | 'planter' | 'bench' | 'bollard' | 'kiosk';
  x: number; // tile X
  y: number; // tile Y
  facing?: 'N' | 'S' | 'E' | 'W';
}

// Bounding box of Central Exchange in canonical grid
export const CE_MIN_X = 74;
export const CE_MAX_X = 127;
export const CE_MIN_Y = 48;
export const CE_MAX_Y = 101;

// Exact walkable prop positions inside Central Exchange
export const CENTRAL_EXCHANGE_PROPS: DistrictProp[] = [
  // Avenue Lamp Posts (along North-South Avenue sidewalks: x=93 and x=108)
  { type: 'lamp', x: 93, y: 56 },
  { type: 'lamp', x: 108, y: 56 },
  { type: 'lamp', x: 93, y: 62 },
  { type: 'lamp', x: 108, y: 62 },
  { type: 'lamp', x: 93, y: 76 },
  { type: 'lamp', x: 108, y: 76 },
  { type: 'lamp', x: 93, y: 82 },
  { type: 'lamp', x: 108, y: 82 },
  { type: 'lamp', x: 93, y: 90 },
  { type: 'lamp', x: 108, y: 90 },
  { type: 'lamp', x: 93, y: 98 },
  { type: 'lamp', x: 108, y: 98 },

  // Avenue Lamp Posts (along East-West Avenue sidewalks: y=63 and y=76)
  { type: 'lamp', x: 78, y: 63 },
  { type: 'lamp', x: 86, y: 63 },
  { type: 'lamp', x: 115, y: 63 },
  { type: 'lamp', x: 123, y: 63 },
  { type: 'lamp', x: 78, y: 76 },
  { type: 'lamp', x: 86, y: 76 },
  { type: 'lamp', x: 115, y: 76 },
  { type: 'lamp', x: 123, y: 76 },

  // Bank Entrance Flanking Trees (Emerald-cyber style in metallic planters)
  { type: 'tree', x: 96, y: 62 },
  { type: 'tree', x: 104, y: 62 },

  // Plaza Promenade Trees
  { type: 'tree', x: 80, y: 56 },
  { type: 'tree', x: 88, y: 56 },
  { type: 'tree', x: 113, y: 56 },
  { type: 'tree', x: 121, y: 56 },
  { type: 'tree', x: 80, y: 84 },
  { type: 'tree', x: 88, y: 84 },
  { type: 'tree', x: 113, y: 84 },
  { type: 'tree', x: 121, y: 84 },
  { type: 'tree', x: 80, y: 96 },
  { type: 'tree', x: 88, y: 96 },
  { type: 'tree', x: 113, y: 96 },
  { type: 'tree', x: 121, y: 96 },

  // Planter Shrubs
  { type: 'planter', x: 98, y: 59 },
  { type: 'planter', x: 102, y: 59 },
  { type: 'planter', x: 84, y: 63 },
  { type: 'planter', x: 117, y: 63 },

  // Smart Benches with Cyan Neon Underside
  { type: 'bench', x: 93, y: 66 }, // Exact location in user screenshot!
  { type: 'bench', x: 108, y: 66 },
  { type: 'bench', x: 86, y: 70 },
  { type: 'bench', x: 115, y: 70 },
  { type: 'bench', x: 86, y: 80 },
  { type: 'bench', x: 115, y: 80 },

  // Security Bollards (guarding pedestrian avenue intersections)
  { type: 'bollard', x: 93, y: 64 },
  { type: 'bollard', x: 108, y: 64 },
  { type: 'bollard', x: 93, y: 75 },
  { type: 'bollard', x: 108, y: 75 },
  { type: 'bollard', x: 97, y: 64 },
  { type: 'bollard', x: 104, y: 64 },
];

export class CentralExchangeRenderer {
  private lampImg: HTMLImageElement = new Image();
  private treeImg: HTMLImageElement = new Image();
  private planterImg: HTMLImageElement = new Image();
  private benchImg: HTMLImageElement = new Image();
  private terminalImg: HTMLImageElement = new Image();
  private kioskImg: HTMLImageElement = new Image();
  private bollardImg: HTMLImageElement = new Image();
  public imagesLoaded = false;

  constructor() {
    this.lampImg.src = '/art/lamp_post_16.png';
    this.treeImg.src = '/art/tree_cyber_24.png';
    this.planterImg.src = '/art/tree_planter_20.png';
    this.benchImg.src = '/art/bench_cyber_24.png';
    this.terminalImg.src = '/art/terminal_cyber_16.png';
    this.kioskImg.src = '/art/kiosk_cyber_16.png';
    this.bollardImg.src = '/art/bollard_cyber_8.png';
  }

  /** Checks if a tile coordinate is within Central Exchange. */
  public isCentralExchange(gx: number, gy: number): boolean {
    return gx >= CE_MIN_X && gx <= CE_MAX_X && gy >= CE_MIN_Y && gy <= CE_MAX_Y;
  }

  /**
   * Renders the authentic Cyberpunk Backdrop Tile for Central Exchange at screen coordinates (x, y).
   * Generates grand corporate plaza paving, arterial tarmac, dashed lane dividers,
   * zebra crosswalks, sidewalk curbs with cyan trims, and Bank entrance marble.
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

    // ── 1. SOLID WALL / CORPORATE SKYSCRAPER FACADE ──
    if (solid) {
      // Deep obsidian corporate foundation
      ctx.fillStyle = '#111923';
      ctx.fillRect(x, y, T, T);

      // Glass facade with metallic mullions
      ctx.fillStyle = '#1e2c3d';
      ctx.fillRect(x + 1, y + 1, T - 2, T - 2);

      // Corporate tinted glass pane
      ctx.fillStyle = '#131e2b';
      ctx.fillRect(x + 2, y + 3, T - 4, T - 6);

      // Cyberpunk illuminated window grids
      const winHash = (gx * 13 + gy * 37) % 7;
      if (winHash === 0) {
        // Cyan tech core window
        ctx.fillStyle = '#00f0ff';
        ctx.fillRect(x + 3, y + 5, 4, 3);
      } else if (winHash === 2) {
        // Warm executive amber window
        ctx.fillStyle = '#f59e0b';
        ctx.fillRect(x + 9, y + 5, 4, 3);
      } else if (winHash === 4) {
        // Magenta trading desk window
        ctx.fillStyle = '#ec4899';
        ctx.fillRect(x + 3, y + 5, 4, 3);
        ctx.fillRect(x + 9, y + 5, 4, 3);
      } else {
        // Sleek unlit reflection
        ctx.fillStyle = '#1c293a';
        ctx.fillRect(x + 3, y + 5, 10, 3);
      }

      // Base stone sill
      ctx.fillStyle = '#0a1017';
      ctx.fillRect(x, y + T - 2, T, 2);
      return;
    }

    // ── 2. ARTERIAL AVENUES (Roadways crossing Central Exchange) ──
    // Horizontal Avenue: gy 64..75 | Vertical Avenue: gx 94..107
    const isHorizRoad = gy >= 65 && gy <= 74;
    const isVertRoad = gx >= 95 && gx <= 106;
    const isRoad = isHorizRoad || isVertRoad;

    if (isRoad) {
      // Dark smooth tarmac
      ctx.fillStyle = '#111620';
      ctx.fillRect(x, y, T, T);

      // Subtle asphalt texture grain
      if ((gx * 3 + gy * 7) % 5 === 0) {
        ctx.fillStyle = '#18212e';
        ctx.fillRect(x + 3, y + 3, 2, 2);
      }

      // ── ZEBRA CROSSWALKS ──
      // Crossing near Bank entry (gy=65, gy=74 at central avenue)
      const isBankCrosswalk = (gy === 65 || gy === 74) && gx >= 96 && gx <= 105;
      const isEastWestCrosswalk = (gx === 95 || gx === 106) && gy >= 66 && gy <= 73;

      if (isBankCrosswalk) {
        // Striped zebra bars
        if (gx % 2 === 0) {
          ctx.fillStyle = '#cbd5e1';
          ctx.fillRect(x, y + 2, T, T - 4);
        }
        return;
      }
      if (isEastWestCrosswalk) {
        if (gy % 2 === 0) {
          ctx.fillStyle = '#cbd5e1';
          ctx.fillRect(x + 2, y, T - 4, T);
        }
        return;
      }

      // ── ROAD HIGHWAY MARKINGS ──
      // Center solid golden highway divider
      if (isHorizRoad && (gy === 69 || gy === 70)) {
        ctx.fillStyle = '#f59e0b';
        ctx.fillRect(x, y + (gy === 69 ? T - 1 : 0), T, 1);
      }
      if (isVertRoad && (gx === 100 || gx === 101)) {
        ctx.fillStyle = '#f59e0b';
        ctx.fillRect(x + (gx === 100 ? T - 1 : 0), y, 1, T);
      }

      // White lane dividing dashes
      if (isHorizRoad && (gy === 67 || gy === 72)) {
        if (gx % 4 < 2) {
          ctx.fillStyle = 'rgba(203, 213, 225, 0.75)';
          ctx.fillRect(x, y + 7, T, 2);
        }
      }
      if (isVertRoad && (gx === 98 || gx === 103)) {
        if (gy % 4 < 2) {
          ctx.fillStyle = 'rgba(203, 213, 225, 0.75)';
          ctx.fillRect(x + 7, y, 2, T);
        }
      }

      // Curb transition trim on road outer edges
      if (gy === 65) {
        ctx.fillStyle = 'rgba(0, 240, 255, 0.4)';
        ctx.fillRect(x, y, T, 1);
      } else if (gy === 74) {
        ctx.fillStyle = 'rgba(0, 240, 255, 0.4)';
        ctx.fillRect(x, y + T - 1, T, 1);
      }
      if (gx === 95) {
        ctx.fillStyle = 'rgba(0, 240, 255, 0.4)';
        ctx.fillRect(x, y, 1, T);
      } else if (gx === 106) {
        ctx.fillStyle = 'rgba(0, 240, 255, 0.4)';
        ctx.fillRect(x + T - 1, y, 1, T);
      }

      return;
    }

    // ── 3. BANK FORECOURT & MARBLE ENTRY STAIRS ──
    const isBankForecourt = gx >= 96 && gx <= 104 && gy >= 59 && gy <= 63;
    if (isBankForecourt) {
      // Grand polished corporate marble
      ctx.fillStyle = '#223044';
      ctx.fillRect(x, y, T, T);

      // Gold inlay borders
      ctx.fillStyle = '#d4a34b';
      ctx.fillRect(x, y, T, 1);
      ctx.fillRect(x, y, 1, T);

      // Center red welcome carpet runner leading to Bank entrance
      if (gx >= 99 && gx <= 101) {
        ctx.fillStyle = '#881337';
        ctx.fillRect(x, y, T, T);
        // Gold edge trim on carpet
        if (gx === 99) {
          ctx.fillStyle = '#ffd166';
          ctx.fillRect(x, y, 2, T);
        } else if (gx === 101) {
          ctx.fillStyle = '#ffd166';
          ctx.fillRect(x + T - 2, y, 2, T);
        }
      } else {
        // Marble cross tile accents
        ctx.fillStyle = '#2a3c54';
        ctx.fillRect(x + 4, y + 4, 8, 8);
      }
      return;
    }

    // ── 4. RAID CIRCLE ARENA TILING (Centered at x=100, y=84) ──
    const dxRaid = gx - 100;
    const dyRaid = gy - 84;
    const distRaid = Math.hypot(dxRaid, dyRaid);

    if (distRaid <= 5.5) {
      // Dark arena flooring
      ctx.fillStyle = '#0f172a';
      ctx.fillRect(x, y, T, T);

      // Concentric cyan/red holographic glyph grooves
      ctx.fillStyle = '#1e293b';
      ctx.fillRect(x + 1, y + 1, T - 2, T - 2);

      if (distRaid >= 3.8 && distRaid <= 4.6) {
        // Outer warning boundary
        ctx.fillStyle = 'rgba(239, 68, 68, 0.6)';
        ctx.fillRect(x, y, T, T);
      } else if (distRaid >= 1.8 && distRaid <= 2.4) {
        // Inner security groove
        ctx.fillStyle = 'rgba(244, 63, 94, 0.4)';
        ctx.fillRect(x + 2, y + 2, T - 4, T - 4);
      }
      return;
    }

    // ── 5. GRAND CORPORATE PLAZA PAVING (Rest of Central Exchange) ──
    // Base: Polished granite slate paver
    ctx.fillStyle = '#1b2434';
    ctx.fillRect(x, y, T, T);

    // Subtle 16x16 tile bevel
    ctx.fillStyle = '#243247';
    ctx.fillRect(x, y, T, 1);
    ctx.fillRect(x, y, 1, T);
    ctx.fillStyle = '#131b26';
    ctx.fillRect(x, y + T - 1, T, 1);
    ctx.fillRect(x + T - 1, y, 1, T);

    // Decorative geometric inlays
    const pat = (gx + gy) % 4;
    if (pat === 0) {
      // Inlaid bronze corporate square
      ctx.fillStyle = '#2a281e';
      ctx.fillRect(x + 4, y + 4, 8, 8);
      ctx.fillStyle = '#c99a45';
      ctx.fillRect(x + 6, y + 6, 4, 4);
    } else if (pat === 2) {
      // Fiber optic floor indicator dot
      ctx.fillStyle = '#0284c7';
      ctx.fillRect(x + 7, y + 7, 2, 2);
    }
  }

  /**
   * Renders street props (lamp posts with lighting halos, cyber trees, benches, bollards).
   * Y-sorted and rendered at exact pixel-scale.
   */
  public renderProps(
    ctx: CanvasRenderingContext2D,
    camX: number,
    camY: number,
    now: number
  ): void {
    const T = TILE_SIZE;

    // Draw all Central Exchange street props
    for (const prop of CENTRAL_EXCHANGE_PROPS) {
      const px = prop.x * T - camX;
      const py = prop.y * T - camY;

      // Frustum culling (-40 to 520 px)
      if (px < -40 || px > 520 || py < -40 || py > 310) continue;

      switch (prop.type) {
        case 'lamp':
          this.drawLampPost(ctx, px, py, now);
          break;
        case 'tree':
          this.drawCyberTree(ctx, px, py);
          break;
        case 'planter':
          this.drawPlanter(ctx, px, py);
          break;
        case 'bench':
          this.drawBench(ctx, px, py);
          break;
        case 'bollard':
          this.drawBollard(ctx, px, py, now);
          break;
      }
    }
  }

  /** Draws a Cyberpunk Street Lamp with downward lighting halo. */
  private drawLampPost(
    ctx: CanvasRenderingContext2D,
    px: number,
    py: number,
    now: number
  ): void {
    // 1. Soft downward lighting halo on the ground
    const flicker = 0.85 + Math.sin(now / 320 + px) * 0.08;
    const haloX = px + 8;
    const haloY = py + 14;

    const grad = ctx.createRadialGradient(haloX, haloY, 2, haloX, haloY, 22);
    grad.addColorStop(0, `rgba(255, 230, 150, ${0.28 * flicker})`);
    grad.addColorStop(0.5, `rgba(0, 240, 255, ${0.12 * flicker})`);
    grad.addColorStop(1, 'rgba(0, 0, 0, 0)');
    ctx.fillStyle = grad;
    ctx.beginPath();
    ctx.arc(haloX, haloY, 22, 0, Math.PI * 2);
    ctx.fill();

    // 2. Base shadow
    ctx.fillStyle = 'rgba(0, 0, 0, 0.45)';
    ctx.fillRect(px + 4, py + 14, 8, 3);

    // 3. Render Lamp Sprite
    if (this.lampImg.complete && this.lampImg.naturalWidth > 0) {
      ctx.drawImage(this.lampImg, px, py - 16, 16, 32);
    } else {
      // Procedural fallback lamp post
      ctx.fillStyle = '#334155';
      ctx.fillRect(px + 7, py - 14, 2, 28);
      ctx.fillStyle = '#64748b';
      ctx.fillRect(px + 5, py - 16, 6, 3);
      ctx.fillStyle = '#fef08a';
      ctx.fillRect(px + 6, py - 15, 4, 3);
    }

    // 4. Subtle glowing lantern tip
    ctx.fillStyle = '#fffbeb';
    ctx.fillRect(px + 7, py - 14, 2, 2);
  }

  /** Draws a Pokémon Emerald-style Cyber Tree in a metallic street planter. */
  private drawCyberTree(ctx: CanvasRenderingContext2D, px: number, py: number): void {
    // 1. Ground shadow
    ctx.fillStyle = 'rgba(0, 0, 0, 0.45)';
    ctx.beginPath();
    ctx.ellipse(px + 12, py + 14, 11, 4, 0, 0, Math.PI * 2);
    ctx.fill();

    // 2. Render Tree Sprite
    if (this.treeImg.complete && this.treeImg.naturalWidth > 0) {
      ctx.drawImage(this.treeImg, px - 4, py - 16, 24, 32);
    } else {
      // Procedural fallback cyber tree
      ctx.fillStyle = '#1e293b';
      ctx.fillRect(px + 4, py + 8, 8, 8); // planter
      ctx.fillStyle = '#059669';
      ctx.beginPath();
      ctx.arc(px + 8, py, 10, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = '#34d399';
      ctx.beginPath();
      ctx.arc(px + 7, py - 2, 7, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  /** Draws a metallic street planter shrub. */
  private drawPlanter(ctx: CanvasRenderingContext2D, px: number, py: number): void {
    ctx.fillStyle = 'rgba(0, 0, 0, 0.4)';
    ctx.fillRect(px + 2, py + 12, 12, 4);

    if (this.planterImg.complete && this.planterImg.naturalWidth > 0) {
      ctx.drawImage(this.planterImg, px - 2, py - 8, 20, 24);
    } else {
      ctx.fillStyle = '#334155';
      ctx.fillRect(px + 2, py + 6, 12, 8);
      ctx.fillStyle = '#10b981';
      ctx.fillRect(px + 3, py + 2, 10, 6);
      ctx.fillStyle = '#6ee7b7';
      ctx.fillRect(px + 5, py, 6, 4);
    }
  }

  /** Draws a Cyberpunk Public Smart Bench with cyan underside glow. */
  private drawBench(ctx: CanvasRenderingContext2D, px: number, py: number): void {
    ctx.fillStyle = 'rgba(0, 0, 0, 0.4)';
    ctx.fillRect(px - 1, py + 8, 18, 4);

    if (this.benchImg.complete && this.benchImg.naturalWidth > 0) {
      ctx.drawImage(this.benchImg, px - 4, py, 24, 14);
    } else {
      // Procedural smart bench
      ctx.fillStyle = '#1e293b';
      ctx.fillRect(px, py + 2, 16, 8);
      ctx.fillStyle = '#475569';
      ctx.fillRect(px + 1, py + 3, 14, 4);
      // Cyan under-glow strip
      ctx.fillStyle = '#00f0ff';
      ctx.fillRect(px + 2, py + 9, 12, 1);
    }
  }

  /** Draws a Security Bollard with pulsing cyan hazard light. */
  private drawBollard(
    ctx: CanvasRenderingContext2D,
    px: number,
    py: number,
    now: number
  ): void {
    ctx.fillStyle = 'rgba(0, 0, 0, 0.4)';
    ctx.fillRect(px + 4, py + 12, 8, 3);

    if (this.bollardImg.complete && this.bollardImg.naturalWidth > 0) {
      ctx.drawImage(this.bollardImg, px + 4, py + 2, 8, 14);
    } else {
      ctx.fillStyle = '#334155';
      ctx.fillRect(px + 6, py + 4, 4, 10);
      ctx.fillStyle = '#64748b';
      ctx.fillRect(px + 5, py + 3, 6, 2);
    }

    // Pulsing LED indicator
    const pulse = Math.floor(now / 240) % 2 === 0;
    ctx.fillStyle = pulse ? '#00f0ff' : '#0369a1';
    ctx.fillRect(px + 7, py + 5, 2, 2);
  }

  /**
   * Renders the Central Bank landmark with glowing sign and steps.
   */
  public drawCentralBank(
    ctx: CanvasRenderingContext2D,
    propSheet: HTMLImageElement,
    x: number,
    y: number,
    now: number
  ): void {
    // 1. Entrance stairs ground shadow
    ctx.fillStyle = 'rgba(0, 0, 0, 0.45)';
    ctx.fillRect(x - 38, y + 12, 76, 6);

    // 2. Draw Central Bank Building from sheet
    if (propSheet.complete) {
      ctx.drawImage(propSheet, 40, 28, 900, 615, x - 36, y - 33, 72, 49);
    } else {
      ctx.fillStyle = '#38536c';
      ctx.fillRect(x - 22, y - 18, 44, 31);
    }

    // 3. Illuminated "CENTRAL BANK" neon signage glow
    const signGlow = 0.8 + Math.sin(now / 350) * 0.2;
    ctx.font = 'bold 6px monospace';
    ctx.textAlign = 'center';
    ctx.fillStyle = `rgba(255, 241, 181, ${signGlow})`;
    ctx.fillText('CENTRAL BANK', x, y - 24);

    // 4. Pulsing door terminal access indicator
    const doorPulse = Math.floor(now / 200) % 2 === 0;
    ctx.fillStyle = doorPulse ? '#00f0ff' : '#0284c7';
    ctx.fillRect(x - 2, y + 8, 4, 3);
  }

  /**
   * Renders the Raid Circle interactive arena with holographic runes.
   */
  public drawRaidCircle(
    ctx: CanvasRenderingContext2D,
    propSheet: HTMLImageElement,
    x: number,
    y: number,
    now: number
  ): void {
    // 1. Pulsing holographic containment ring
    const radius = 30 + Math.sin(now / 250) * 1.5;
    ctx.strokeStyle = '#ef4444';
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.arc(x, y, radius, 0, Math.PI * 2);
    ctx.stroke();

    // 2. Inner dashed rotating ring
    ctx.strokeStyle = 'rgba(251, 113, 133, 0.7)';
    ctx.lineWidth = 1;
    ctx.setLineDash([4, 4]);
    ctx.lineDashOffset = (now / 40) % 8;
    ctx.beginPath();
    ctx.arc(x, y, 20, 0, Math.PI * 2);
    ctx.stroke();
    ctx.setLineDash([]); // Reset dash

    // 3. Central raid hologram emblem
    if (propSheet.complete) {
      ctx.drawImage(propSheet, 940, 28, 570, 620, x - 26, y - 26, 52, 52);
    }

    // 4. Floating glowing label
    ctx.font = 'bold 6px monospace';
    ctx.textAlign = 'center';
    ctx.fillStyle = '#fecdd3';
    ctx.fillText('RAID CIRCLE [10 PLAYERS]', x, y - 34);
  }

  /**
   * Renders the Race Terminal with chequered neon banner.
   */
  public drawRaceTerminal(
    ctx: CanvasRenderingContext2D,
    propSheet: HTMLImageElement,
    x: number,
    y: number,
    now: number
  ): void {
    // Ground shadow
    ctx.fillStyle = 'rgba(0, 0, 0, 0.4)';
    ctx.fillRect(x - 8, y + 4, 16, 4);

    // Terminal console
    if (this.terminalImg.complete && this.terminalImg.naturalWidth > 0) {
      ctx.drawImage(this.terminalImg, x - 8, y - 20, 16, 24);
    } else if (propSheet.complete) {
      ctx.drawImage(propSheet, 52, 718, 185, 270, x - 9, y - 26, 18, 27);
    }

    // Floating Race Badge
    const bounce = Math.round(Math.sin(now / 220) * 2);
    ctx.fillStyle = '#0f172a';
    ctx.fillRect(x - 22, y - 32 + bounce, 44, 9);
    ctx.strokeStyle = '#f59e0b';
    ctx.strokeRect(x - 21.5, y - 31.5 + bounce, 43, 8);
    ctx.font = 'bold 6px monospace';
    ctx.textAlign = 'center';
    ctx.fillStyle = '#fde68a';
    ctx.fillText('RACE TERMINAL', x, y - 25 + bounce);
  }

  /**
   * Renders the Checkout Terminal with green exit banner.
   */
  public drawCheckoutTerminal(
    ctx: CanvasRenderingContext2D,
    propSheet: HTMLImageElement,
    x: number,
    y: number,
    now: number
  ): void {
    // Ground shadow
    ctx.fillStyle = 'rgba(0, 0, 0, 0.4)';
    ctx.fillRect(x - 8, y + 4, 16, 4);

    // Terminal console
    if (this.terminalImg.complete && this.terminalImg.naturalWidth > 0) {
      ctx.drawImage(this.terminalImg, x - 8, y - 20, 16, 24);
    } else if (propSheet.complete) {
      ctx.drawImage(propSheet, 52, 718, 185, 270, x - 9, y - 26, 18, 27);
    }

    // Floating Checkout Badge
    const bounce = Math.round(Math.sin(now / 220 + 1) * 2);
    ctx.fillStyle = '#0f172a';
    ctx.fillRect(x - 20, y - 32 + bounce, 40, 9);
    ctx.strokeStyle = '#10b981';
    ctx.strokeRect(x - 19.5, y - 31.5 + bounce, 39, 8);
    ctx.font = 'bold 6px monospace';
    ctx.textAlign = 'center';
    ctx.fillStyle = '#a7f3d0';
    ctx.fillText('CHECKOUT', x, y - 25 + bounce);
  }
}

export const globalCentralExchange = new CentralExchangeRenderer();
