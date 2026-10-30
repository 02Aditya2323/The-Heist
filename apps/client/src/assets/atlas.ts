/**
 * Procedural Pixel Art Tile Atlas generator.
 * Generates all 16x16 pixel tiles via procedural fillRect commands at boot.
 * Placed behind the TileAtlas interface so PNG spritesheets can replace it later.
 */

export interface TileAtlas {
  readonly tileSize: number;
  drawTile(
    ctx: CanvasRenderingContext2D,
    tileId: number,
    dx: number,
    dy: number
  ): void;
  getCanvas(): HTMLCanvasElement;
}

export const TILE_SIZE = 16;
export const ATLAS_COLS = 16;
export const ATLAS_ROWS = 16;

export enum TileId {
  // Ground: Asphalt Variants
  ASPHALT_PLAIN = 0,
  ASPHALT_CRACKED_1 = 1,
  ASPHALT_CRACKED_2 = 2,
  ASPHALT_DRAIN_GRATE = 3,
  ASPHALT_PUDDLE_CYAN = 4,
  ASPHALT_PUDDLE_DARK = 5,
  ASPHALT_PATCH = 6,

  // Road Markings
  ROAD_LINE_WHITE_H = 7,
  ROAD_LINE_WHITE_V = 8,
  ROAD_LINE_YELLOW_H = 9,
  ROAD_LINE_YELLOW_V = 10,
  ROAD_CROSSWALK_H = 11,
  ROAD_CROSSWALK_V = 12,

  // Sidewalk & Curb (Walkable tiles adjacent to walls)
  SIDEWALK_PLAIN = 13,
  SIDEWALK_CURB_TOP = 14,
  SIDEWALK_CURB_BOTTOM = 15,
  SIDEWALK_CURB_LEFT = 16,
  SIDEWALK_CURB_RIGHT = 17,
  SIDEWALK_CORNER_TL = 18,
  SIDEWALK_CORNER_TR = 19,
  SIDEWALK_CORNER_BL = 20,
  SIDEWALK_CORNER_BR = 21,

  // Plazas & Pavement
  PLAZA_TILES_1 = 22,
  PLAZA_TILES_2 = 23,

  // Wall Roof: Rooftops (Autotiled solid walls)
  ROOF_FLAT_BASE = 24,
  ROOF_AC_UNIT = 25,
  ROOF_VENT = 26,
  ROOF_SKYLIGHT = 27,
  ROOF_ANTENNA = 28,
  ROOF_EDGE_N = 29,
  ROOF_EDGE_S = 30,
  ROOF_EDGE_W = 31,
  ROOF_EDGE_E = 32,
  ROOF_CORNER_NW = 33,
  ROOF_CORNER_NE = 34,
  ROOF_CORNER_SW = 35,
  ROOF_CORNER_SE = 36,

  // Wall Facade: Southern-facing wall tiles (Facing street)
  FACADE_PLAIN = 37,
  FACADE_WINDOW_UNLIT = 38,
  FACADE_WINDOW_LIT_CYAN = 39,
  FACADE_WINDOW_LIT_AMBER = 40,
  FACADE_WINDOW_LIT_MAGENTA = 41,
  FACADE_DOOR = 42,
  FACADE_VENT_PIPES = 43,

  // Overhang Layer: Tiles rendered above entities
  OVERHANG_ROOF_LIP = 44,
  OVERHANG_AWNING_CYAN = 45,
  OVERHANG_AWNING_MAGENTA = 46,

  // Outer Skyline: Dense boundary wall
  SKYLINE_BORDER_TOP = 47,
  SKYLINE_BORDER_MID = 48,

  // Landmark Hotspot Facades & Props
  HOTSPOT_BANK = 49,
  HOTSPOT_JOBBOARD = 50,
  HOTSPOT_MARKET = 51,
  HOTSPOT_HIDEOUT = 52,
  HOTSPOT_POLICE = 53,
  HOTSPOT_DOCKS = 54,
  HOTSPOT_PLAZA_BANK = 55,
}

export class ProceduralTileAtlas implements TileAtlas {
  public readonly tileSize = TILE_SIZE;
  private canvas: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D;

  constructor() {
    this.canvas = document.createElement('canvas');
    this.canvas.width = ATLAS_COLS * TILE_SIZE;
    this.canvas.height = ATLAS_ROWS * TILE_SIZE;
    const context = this.canvas.getContext('2d', { willReadFrequently: false });
    if (!context) throw new Error('Could not create atlas 2D context');
    this.ctx = context;
    this.ctx.imageSmoothingEnabled = false;

    this.bakeAtlas();
  }

  getCanvas(): HTMLCanvasElement {
    return this.canvas;
  }

  drawTile(
    ctx: CanvasRenderingContext2D,
    tileId: number,
    dx: number,
    dy: number
  ): void {
    const col = tileId % ATLAS_COLS;
    const row = Math.floor(tileId / ATLAS_COLS);
    const sx = col * TILE_SIZE;
    const sy = row * TILE_SIZE;

    ctx.drawImage(
      this.canvas,
      sx,
      sy,
      TILE_SIZE,
      TILE_SIZE,
      dx,
      dy,
      TILE_SIZE,
      TILE_SIZE
    );
  }

  private getCoords(tileId: TileId): [number, number] {
    const col = tileId % ATLAS_COLS;
    const row = Math.floor(tileId / ATLAS_COLS);
    return [col * TILE_SIZE, row * TILE_SIZE];
  }

  private bakeAtlas(): void {
    const c = this.ctx;

    // ─────────────────────────────────────────────────────────────
    // 1. ASPHALT & ROAD TILES
    // ─────────────────────────────────────────────────────────────
    // Plain Asphalt
    let [x, y] = this.getCoords(TileId.ASPHALT_PLAIN);
    c.fillStyle = '#1a233a';
    c.fillRect(x, y, 16, 16);
    c.fillStyle = '#232f4c';
    c.fillRect(x + 2, y + 3, 2, 2);
    c.fillRect(x + 10, y + 11, 2, 2);
    c.fillRect(x + 13, y + 4, 1, 1);
    c.fillStyle = '#121828';
    c.fillRect(x + 6, y + 8, 2, 2);
    c.fillRect(x + 3, y + 13, 2, 1);

    // Cracked Asphalt 1
    [x, y] = this.getCoords(TileId.ASPHALT_CRACKED_1);
    c.fillStyle = '#1a233a';
    c.fillRect(x, y, 16, 16);
    c.fillStyle = '#0c101c';
    c.fillRect(x + 4, y + 2, 1, 5);
    c.fillRect(x + 5, y + 7, 3, 1);
    c.fillRect(x + 8, y + 8, 1, 4);
    c.fillRect(x + 9, y + 12, 3, 1);
    c.fillStyle = '#2b3959';
    c.fillRect(x + 5, y + 2, 1, 4);
    c.fillRect(x + 9, y + 8, 1, 3);

    // Cracked Asphalt 2
    [x, y] = this.getCoords(TileId.ASPHALT_CRACKED_2);
    c.fillStyle = '#1a233a';
    c.fillRect(x, y, 16, 16);
    c.fillStyle = '#0c101c';
    c.fillRect(x + 12, y + 2, 1, 4);
    c.fillRect(x + 10, y + 6, 2, 1);
    c.fillRect(x + 9, y + 7, 1, 5);
    c.fillRect(x + 6, y + 12, 3, 1);
    c.fillStyle = '#2b3959';
    c.fillRect(x + 13, y + 2, 1, 3);

    // Drain Grate
    [x, y] = this.getCoords(TileId.ASPHALT_DRAIN_GRATE);
    c.fillStyle = '#1a233a';
    c.fillRect(x, y, 16, 16);
    c.fillStyle = '#0b0f19';
    c.fillRect(x + 3, y + 3, 10, 10);
    c.fillStyle = '#475569';
    c.strokeRect(x + 3.5, y + 3.5, 9, 9);
    c.fillStyle = '#64748b';
    for (let i = 0; i < 4; i++) {
      c.fillRect(x + 5, y + 5 + i * 2, 6, 1);
    }
    c.fillStyle = '#94a3b8';
    c.fillRect(x + 4, y + 4, 1, 8);

    // Puddle Cyan (Wet reflection)
    [x, y] = this.getCoords(TileId.ASPHALT_PUDDLE_CYAN);
    c.fillStyle = '#1a233a';
    c.fillRect(x, y, 16, 16);
    c.fillStyle = '#0e3654';
    c.fillRect(x + 2, y + 4, 12, 8);
    c.fillStyle = '#164e73';
    c.fillRect(x + 4, y + 5, 8, 6);
    c.fillStyle = '#00f0ff';
    c.fillRect(x + 6, y + 6, 4, 2);
    c.fillRect(x + 8, y + 9, 3, 1);

    // Puddle Dark
    [x, y] = this.getCoords(TileId.ASPHALT_PUDDLE_DARK);
    c.fillStyle = '#1a233a';
    c.fillRect(x, y, 16, 16);
    c.fillStyle = '#121e33';
    c.fillRect(x + 2, y + 4, 12, 8);
    c.fillStyle = '#1c2d4a';
    c.fillRect(x + 4, y + 6, 8, 4);

    // Asphalt Patch
    [x, y] = this.getCoords(TileId.ASPHALT_PATCH);
    c.fillStyle = '#1a233a';
    c.fillRect(x, y, 16, 16);
    c.fillStyle = '#121828';
    c.fillRect(x + 3, y + 3, 10, 10);
    c.fillStyle = '#090d17';
    c.strokeRect(x + 2.5, y + 2.5, 11, 11);
    c.fillStyle = '#2a3854';
    c.fillRect(x + 5, y + 5, 2, 2);
    c.fillRect(x + 9, y + 9, 2, 2);

    // ─────────────────────────────────────────────────────────────
    // 2. ROAD PAINT MARKINGS
    // ─────────────────────────────────────────────────────────────
    // White Horizontal Dash
    [x, y] = this.getCoords(TileId.ROAD_LINE_WHITE_H);
    c.fillStyle = '#1a233a';
    c.fillRect(x, y, 16, 16);
    c.fillStyle = '#f1f5f9';
    c.fillRect(x, y + 7, 16, 2);
    c.fillStyle = '#94a3b8';
    c.fillRect(x, y + 9, 16, 1);

    // White Vertical Dash
    [x, y] = this.getCoords(TileId.ROAD_LINE_WHITE_V);
    c.fillStyle = '#1a233a';
    c.fillRect(x, y, 16, 16);
    c.fillStyle = '#f1f5f9';
    c.fillRect(x + 7, y, 2, 16);
    c.fillStyle = '#94a3b8';
    c.fillRect(x + 9, y, 1, 16);

    // Yellow Horizontal Dash (Dual lines)
    [x, y] = this.getCoords(TileId.ROAD_LINE_YELLOW_H);
    c.fillStyle = '#1a233a';
    c.fillRect(x, y, 16, 16);
    c.fillStyle = '#fbbf24';
    c.fillRect(x, y + 6, 16, 1);
    c.fillRect(x, y + 9, 16, 1);
    c.fillStyle = '#b45309';
    c.fillRect(x, y + 7, 16, 1);
    c.fillRect(x, y + 10, 16, 1);

    // Yellow Vertical Dash
    [x, y] = this.getCoords(TileId.ROAD_LINE_YELLOW_V);
    c.fillStyle = '#1a233a';
    c.fillRect(x, y, 16, 16);
    c.fillStyle = '#fbbf24';
    c.fillRect(x + 6, y, 1, 16);
    c.fillRect(x + 9, y, 1, 16);
    c.fillStyle = '#b45309';
    c.fillRect(x + 7, y, 1, 16);
    c.fillRect(x + 10, y, 1, 16);

    // Crosswalk Horizontal
    [x, y] = this.getCoords(TileId.ROAD_CROSSWALK_H);
    c.fillStyle = '#1a233a';
    c.fillRect(x, y, 16, 16);
    c.fillStyle = '#f8fafc';
    c.fillRect(x + 2, y, 4, 16);
    c.fillRect(x + 10, y, 4, 16);

    // Crosswalk Vertical
    [x, y] = this.getCoords(TileId.ROAD_CROSSWALK_V);
    c.fillStyle = '#1a233a';
    c.fillRect(x, y, 16, 16);
    c.fillStyle = '#f8fafc';
    c.fillRect(x, y + 2, 16, 4);
    c.fillRect(x, y + 10, 16, 4);

    // ─────────────────────────────────────────────────────────────
    // 3. SIDEWALK & CURB (Walkable tiles adjacent to walls)
    // ─────────────────────────────────────────────────────────────
    // Plain Sidewalk Paving
    [x, y] = this.getCoords(TileId.SIDEWALK_PLAIN);
    c.fillStyle = '#364566';
    c.fillRect(x, y, 16, 16);
    c.fillStyle = '#28344f';
    c.strokeRect(x + 0.5, y + 0.5, 15, 15);
    c.fillRect(x + 8, y, 1, 16);
    c.fillRect(x, y + 8, 16, 1);

    // Curb Top
    [x, y] = this.getCoords(TileId.SIDEWALK_CURB_TOP);
    c.fillStyle = '#1a233a';
    c.fillRect(x, y, 16, 16);
    c.fillStyle = '#364566';
    c.fillRect(x, y + 3, 16, 13);
    c.fillStyle = '#6b84bf';
    c.fillRect(x, y + 1, 16, 2);
    c.fillStyle = '#121828';
    c.fillRect(x, y, 16, 1);

    // Curb Bottom
    [x, y] = this.getCoords(TileId.SIDEWALK_CURB_BOTTOM);
    c.fillStyle = '#364566';
    c.fillRect(x, y, 16, 13);
    c.fillStyle = '#506594';
    c.fillRect(x, y + 13, 16, 2);
    c.fillStyle = '#121828';
    c.fillRect(x, y + 15, 16, 1);

    // Curb Left
    [x, y] = this.getCoords(TileId.SIDEWALK_CURB_LEFT);
    c.fillStyle = '#1a233a';
    c.fillRect(x, y, 16, 16);
    c.fillStyle = '#364566';
    c.fillRect(x + 3, y, 13, 16);
    c.fillStyle = '#6b84bf';
    c.fillRect(x + 1, y, 2, 16);
    c.fillStyle = '#121828';
    c.fillRect(x, y, 1, 16);

    // Curb Right
    [x, y] = this.getCoords(TileId.SIDEWALK_CURB_RIGHT);
    c.fillStyle = '#364566';
    c.fillRect(x, y, 13, 16);
    c.fillStyle = '#506594';
    c.fillRect(x + 13, y, 2, 16);
    c.fillStyle = '#121828';
    c.fillRect(x + 15, y, 1, 16);

    // Corners
    [x, y] = this.getCoords(TileId.SIDEWALK_CORNER_TL);
    c.fillStyle = '#1a233a';
    c.fillRect(x, y, 16, 16);
    c.fillStyle = '#364566';
    c.fillRect(x + 3, y + 3, 13, 13);
    c.fillStyle = '#6b84bf';
    c.fillRect(x + 1, y + 3, 2, 13);
    c.fillRect(x + 3, y + 1, 13, 2);
    c.fillStyle = '#121828';
    c.fillRect(x, y, 16, 1);
    c.fillRect(x, y, 1, 16);

    [x, y] = this.getCoords(TileId.SIDEWALK_CORNER_TR);
    c.fillStyle = '#1a233a';
    c.fillRect(x, y, 16, 16);
    c.fillStyle = '#364566';
    c.fillRect(x, y + 3, 13, 13);
    c.fillStyle = '#6b84bf';
    c.fillRect(x, y + 1, 13, 2);
    c.fillStyle = '#506594';
    c.fillRect(x + 13, y + 1, 2, 15);

    [x, y] = this.getCoords(TileId.SIDEWALK_CORNER_BL);
    c.fillStyle = '#1a233a';
    c.fillRect(x, y, 16, 16);
    c.fillStyle = '#364566';
    c.fillRect(x + 3, y, 13, 13);
    c.fillStyle = '#6b84bf';
    c.fillRect(x + 1, y, 2, 13);
    c.fillStyle = '#506594';
    c.fillRect(x + 1, y + 13, 15, 2);

    [x, y] = this.getCoords(TileId.SIDEWALK_CORNER_BR);
    c.fillStyle = '#1a233a';
    c.fillRect(x, y, 16, 16);
    c.fillStyle = '#364566';
    c.fillRect(x, y, 13, 13);
    c.fillStyle = '#506594';
    c.fillRect(x + 13, y, 2, 13);
    c.fillRect(x, y + 13, 13, 2);

    // Plaza Tiles
    [x, y] = this.getCoords(TileId.PLAZA_TILES_1);
    c.fillStyle = '#243352';
    c.fillRect(x, y, 16, 16);
    c.fillStyle = '#334770';
    c.fillRect(x + 1, y + 1, 6, 6);
    c.fillRect(x + 9, y + 9, 6, 6);
    c.fillStyle = '#162033';
    c.strokeRect(x + 0.5, y + 0.5, 15, 15);

    [x, y] = this.getCoords(TileId.PLAZA_TILES_2);
    c.fillStyle = '#28385a';
    c.fillRect(x, y, 16, 16);
    c.fillStyle = '#3d5482';
    c.fillRect(x + 2, y + 2, 12, 12);
    c.fillStyle = '#00f0ff';
    c.fillRect(x + 7, y + 7, 2, 2);

    // ─────────────────────────────────────────────────────────────
    // 4. WALL ROOF TILES (Rooftop equipment, vents, edges)
    // ─────────────────────────────────────────────────────────────
    // Flat Rooftop Base
    [x, y] = this.getCoords(TileId.ROOF_FLAT_BASE);
    c.fillStyle = '#1c2742';
    c.fillRect(x, y, 16, 16);
    c.fillStyle = '#263457';
    c.fillRect(x + 2, y + 2, 5, 5);
    c.fillRect(x + 9, y + 9, 5, 5);
    c.fillStyle = '#101726';
    c.strokeRect(x + 0.5, y + 0.5, 15, 15);

    // Roof AC Unit
    [x, y] = this.getCoords(TileId.ROOF_AC_UNIT);
    c.fillStyle = '#1c2742';
    c.fillRect(x, y, 16, 16);
    c.fillStyle = '#3b4b6b';
    c.fillRect(x + 3, y + 3, 10, 10);
    c.fillStyle = '#192133';
    c.fillRect(x + 5, y + 5, 6, 6);
    c.fillStyle = '#4f638c';
    c.fillRect(x + 7, y + 7, 2, 2);

    // Roof Vent
    [x, y] = this.getCoords(TileId.ROOF_VENT);
    c.fillStyle = '#1c2742';
    c.fillRect(x, y, 16, 16);
    c.fillStyle = '#475569';
    c.fillRect(x + 5, y + 4, 6, 8);
    c.fillStyle = '#1e293b';
    c.fillRect(x + 6, y + 6, 4, 4);

    // Roof Skylight
    [x, y] = this.getCoords(TileId.ROOF_SKYLIGHT);
    c.fillStyle = '#1c2742';
    c.fillRect(x, y, 16, 16);
    c.fillStyle = '#0284c7';
    c.fillRect(x + 2, y + 2, 12, 12);
    c.fillStyle = '#38bdf8';
    c.fillRect(x + 4, y + 4, 8, 8);
    c.fillStyle = '#1e293b';
    c.fillRect(x + 7, y + 2, 2, 12);
    c.fillRect(x + 2, y + 7, 12, 2);

    // Roof Antenna
    [x, y] = this.getCoords(TileId.ROOF_ANTENNA);
    c.fillStyle = '#1c2742';
    c.fillRect(x, y, 16, 16);
    c.fillStyle = '#94a3b8';
    c.fillRect(x + 7, y + 3, 2, 11);
    c.fillRect(x + 5, y + 12, 6, 2);
    c.fillRect(x + 5, y + 6, 6, 1);
    c.fillStyle = '#ef4444';
    c.fillRect(x + 7, y + 1, 2, 2); // Blinking beacon

    // Roof Edges
    [x, y] = this.getCoords(TileId.ROOF_EDGE_N);
    c.fillStyle = '#1c2742';
    c.fillRect(x, y, 16, 16);
    c.fillStyle = '#3b4f7a';
    c.fillRect(x, y, 16, 3);
    c.fillStyle = '#0f1726';
    c.fillRect(x, y + 3, 16, 1);

    [x, y] = this.getCoords(TileId.ROOF_EDGE_S);
    c.fillStyle = '#1c2742';
    c.fillRect(x, y, 16, 16);
    c.fillStyle = '#3b4f7a';
    c.fillRect(x, y + 13, 16, 3);
    c.fillStyle = '#0f1726';
    c.fillRect(x, y + 12, 16, 1);

    [x, y] = this.getCoords(TileId.ROOF_EDGE_W);
    c.fillStyle = '#1c2742';
    c.fillRect(x, y, 16, 16);
    c.fillStyle = '#3b4f7a';
    c.fillRect(x, y, 3, 16);
    c.fillStyle = '#0f1726';
    c.fillRect(x + 3, y, 1, 16);

    [x, y] = this.getCoords(TileId.ROOF_EDGE_E);
    c.fillStyle = '#1c2742';
    c.fillRect(x, y, 16, 16);
    c.fillStyle = '#3b4f7a';
    c.fillRect(x + 13, y, 3, 16);
    c.fillStyle = '#0f1726';
    c.fillRect(x + 12, y, 1, 16);

    // Roof Corners
    [x, y] = this.getCoords(TileId.ROOF_CORNER_NW);
    c.fillStyle = '#1c2742';
    c.fillRect(x, y, 16, 16);
    c.fillStyle = '#3b4f7a';
    c.fillRect(x, y, 16, 3);
    c.fillRect(x, y, 3, 16);
    c.fillStyle = '#0f1726';
    c.fillRect(x + 3, y + 3, 13, 1);
    c.fillRect(x + 3, y + 3, 1, 13);

    [x, y] = this.getCoords(TileId.ROOF_CORNER_NE);
    c.fillStyle = '#1c2742';
    c.fillRect(x, y, 16, 16);
    c.fillStyle = '#3b4f7a';
    c.fillRect(x, y, 16, 3);
    c.fillRect(x + 13, y, 3, 16);
    c.fillStyle = '#0f1726';
    c.fillRect(x, y + 3, 13, 1);
    c.fillRect(x + 12, y + 3, 1, 13);

    [x, y] = this.getCoords(TileId.ROOF_CORNER_SW);
    c.fillStyle = '#1c2742';
    c.fillRect(x, y, 16, 16);
    c.fillStyle = '#3b4f7a';
    c.fillRect(x, y + 13, 16, 3);
    c.fillRect(x, y, 3, 16);
    c.fillStyle = '#0f1726';
    c.fillRect(x + 3, y + 12, 13, 1);
    c.fillRect(x + 3, y, 1, 12);

    [x, y] = this.getCoords(TileId.ROOF_CORNER_SE);
    c.fillStyle = '#1c2742';
    c.fillRect(x, y, 16, 16);
    c.fillStyle = '#3b4f7a';
    c.fillRect(x, y + 13, 16, 3);
    c.fillRect(x + 13, y, 3, 16);
    c.fillStyle = '#0f1726';
    c.fillRect(x, y + 12, 13, 1);
    c.fillRect(x + 12, y, 1, 12);

    // ─────────────────────────────────────────────────────────────
    // 5. WALL FACADE TILES (Facing Street South)
    // ─────────────────────────────────────────────────────────────
    // Plain Facade Wall
    [x, y] = this.getCoords(TileId.FACADE_PLAIN);
    c.fillStyle = '#182238';
    c.fillRect(x, y, 16, 16);
    c.fillStyle = '#222f4d';
    c.fillRect(x, y, 16, 2);
    c.fillRect(x, y + 14, 16, 2);
    c.fillStyle = '#0e1424';
    c.fillRect(x + 7, y + 2, 2, 12);

    // Unlit Window Facade
    [x, y] = this.getCoords(TileId.FACADE_WINDOW_UNLIT);
    c.fillStyle = '#182238';
    c.fillRect(x, y, 16, 16);
    c.fillStyle = '#222f4d';
    c.fillRect(x, y, 16, 2);
    c.fillRect(x, y + 14, 16, 2);
    c.fillStyle = '#0e1424';
    c.fillRect(x + 3, y + 4, 10, 8);
    c.fillStyle = '#25324d';
    c.strokeRect(x + 3.5, y + 4.5, 9, 7);

    // Lit Window Cyan
    [x, y] = this.getCoords(TileId.FACADE_WINDOW_LIT_CYAN);
    c.fillStyle = '#182238';
    c.fillRect(x, y, 16, 16);
    c.fillStyle = '#222f4d';
    c.fillRect(x, y, 16, 2);
    c.fillRect(x, y + 14, 16, 2);
    c.fillStyle = '#00f0ff';
    c.fillRect(x + 3, y + 4, 10, 8);
    c.fillStyle = '#ffffff';
    c.fillRect(x + 5, y + 6, 2, 3);
    c.fillStyle = '#182238';
    c.fillRect(x + 7, y + 4, 2, 8);
    c.fillRect(x + 3, y + 8, 10, 1);

    // Lit Window Amber
    [x, y] = this.getCoords(TileId.FACADE_WINDOW_LIT_AMBER);
    c.fillStyle = '#182238';
    c.fillRect(x, y, 16, 16);
    c.fillStyle = '#222f4d';
    c.fillRect(x, y, 16, 2);
    c.fillRect(x, y + 14, 16, 2);
    c.fillStyle = '#fbbf24';
    c.fillRect(x + 3, y + 4, 10, 8);
    c.fillStyle = '#fef08a';
    c.fillRect(x + 5, y + 6, 2, 3);
    c.fillStyle = '#182238';
    c.fillRect(x + 7, y + 4, 2, 8);
    c.fillRect(x + 3, y + 8, 10, 1);

    // Lit Window Magenta
    [x, y] = this.getCoords(TileId.FACADE_WINDOW_LIT_MAGENTA);
    c.fillStyle = '#182238';
    c.fillRect(x, y, 16, 16);
    c.fillStyle = '#222f4d';
    c.fillRect(x, y, 16, 2);
    c.fillRect(x, y + 14, 16, 2);
    c.fillStyle = '#f43f5e';
    c.fillRect(x + 3, y + 4, 10, 8);
    c.fillStyle = '#ffe4e6';
    c.fillRect(x + 5, y + 6, 2, 3);
    c.fillStyle = '#182238';
    c.fillRect(x + 7, y + 4, 2, 8);
    c.fillRect(x + 3, y + 8, 10, 1);

    // Facade Entrance Door
    [x, y] = this.getCoords(TileId.FACADE_DOOR);
    c.fillStyle = '#182238';
    c.fillRect(x, y, 16, 16);
    c.fillStyle = '#2a3b5c';
    c.fillRect(x + 3, y + 2, 10, 14);
    c.fillStyle = '#00f0ff';
    c.fillRect(x + 4, y + 3, 8, 2); // Transom light
    c.fillStyle = '#131b2e';
    c.fillRect(x + 4, y + 6, 8, 10);
    c.fillStyle = '#fbbf24';
    c.fillRect(x + 10, y + 10, 1, 2); // Brass handle

    // Facade Vent Pipes
    [x, y] = this.getCoords(TileId.FACADE_VENT_PIPES);
    c.fillStyle = '#182238';
    c.fillRect(x, y, 16, 16);
    c.fillStyle = '#64748b';
    c.fillRect(x + 3, y, 2, 16);
    c.fillRect(x + 8, y, 2, 16);
    c.fillStyle = '#94a3b8';
    c.fillRect(x + 3, y, 1, 16);
    c.fillRect(x + 8, y, 1, 16);

    // ─────────────────────────────────────────────────────────────
    // 6. OVERHANG LAYER (Roof lips & awnings)
    // ─────────────────────────────────────────────────────────────
    [x, y] = this.getCoords(TileId.OVERHANG_ROOF_LIP);
    c.fillStyle = '#00f0ff';
    c.fillRect(x, y, 16, 2);
    c.fillStyle = '#082f49';
    c.fillRect(x, y + 2, 16, 2);

    [x, y] = this.getCoords(TileId.OVERHANG_AWNING_CYAN);
    c.fillStyle = '#0284c7';
    c.fillRect(x, y + 8, 16, 8);
    c.fillStyle = '#00f0ff';
    c.fillRect(x + 2, y + 8, 3, 8);
    c.fillRect(x + 8, y + 8, 3, 8);
    c.fillRect(x + 14, y + 8, 2, 8);

    [x, y] = this.getCoords(TileId.OVERHANG_AWNING_MAGENTA);
    c.fillStyle = '#be123c';
    c.fillRect(x, y + 8, 16, 8);
    c.fillStyle = '#f43f5e';
    c.fillRect(x + 2, y + 8, 3, 8);
    c.fillRect(x + 8, y + 8, 3, 8);
    c.fillRect(x + 14, y + 8, 2, 8);

    // ─────────────────────────────────────────────────────────────
    // 7. OUTER BORDER SKYLINE
    // ─────────────────────────────────────────────────────────────
    [x, y] = this.getCoords(TileId.SKYLINE_BORDER_TOP);
    c.fillStyle = '#0f172a';
    c.fillRect(x, y, 16, 16);
    c.fillStyle = '#1e293b';
    c.fillRect(x + 1, y + 2, 6, 14);
    c.fillRect(x + 9, y + 4, 6, 12);
    c.fillStyle = '#38bdf8';
    c.fillRect(x + 3, y + 4, 2, 2);
    c.fillRect(x + 11, y + 7, 2, 2);
    c.fillStyle = '#f43f5e';
    c.fillRect(x + 3, y + 10, 2, 2);
    c.fillStyle = '#fbbf24';
    c.fillRect(x + 11, y + 12, 2, 2);

    [x, y] = this.getCoords(TileId.SKYLINE_BORDER_MID);
    c.fillStyle = '#0f172a';
    c.fillRect(x, y, 16, 16);
    c.fillStyle = '#1e293b';
    c.fillRect(x + 2, y, 12, 16);

    // ─────────────────────────────────────────────────────────────
    // 8. HOTSPOT LANDMARK PROPS
    // ─────────────────────────────────────────────────────────────
    // Bank Facade (Golden arch, vault pillars, BANK crest)
    [x, y] = this.getCoords(TileId.HOTSPOT_BANK);
    c.fillStyle = '#182238';
    c.fillRect(x, y, 16, 16);
    c.fillStyle = '#f59e0b';
    c.fillRect(x + 1, y + 1, 14, 3); // Gold pediment
    c.fillStyle = '#fbbf24';
    c.fillRect(x + 2, y + 4, 2, 12); // Left pillar
    c.fillRect(x + 12, y + 4, 2, 12); // Right pillar
    c.fillStyle = '#0e1726';
    c.fillRect(x + 5, y + 5, 6, 11); // Central vault opening
    c.fillStyle = '#00f0ff';
    c.fillRect(x + 7, y + 8, 2, 2); // Cyber vault dial

    // Bank Plaza Decal (for walkable hotspot tile)
    [x, y] = this.getCoords(TileId.HOTSPOT_PLAZA_BANK);
    c.fillStyle = '#28385a';
    c.fillRect(x, y, 16, 16);
    c.fillStyle = '#f59e0b';
    c.strokeRect(x + 2.5, y + 2.5, 11, 11);
    c.fillStyle = '#fbbf24';
    c.fillRect(x + 6, y + 6, 4, 4);
    c.fillStyle = '#00f0ff';
    c.fillRect(x + 7, y + 7, 2, 2);

    // Police Station
    [x, y] = this.getCoords(TileId.HOTSPOT_POLICE);
    c.fillStyle = '#182238';
    c.fillRect(x, y, 16, 16);
    c.fillStyle = '#3b82f6';
    c.fillRect(x + 3, y + 2, 4, 3);
    c.fillStyle = '#ef4444';
    c.fillRect(x + 9, y + 2, 4, 3);
    c.fillStyle = '#222f4d';
    c.fillRect(x + 2, y + 6, 12, 10);

    // Job Board
    [x, y] = this.getCoords(TileId.HOTSPOT_JOBBOARD);
    c.fillStyle = '#182238';
    c.fillRect(x, y, 16, 16);
    c.fillStyle = '#0284c7';
    c.fillRect(x + 2, y + 2, 12, 12);
    c.fillStyle = '#00f0ff';
    c.fillRect(x + 4, y + 4, 8, 8);
    c.fillStyle = '#ffffff';
    c.fillRect(x + 5, y + 6, 6, 1);
    c.fillRect(x + 5, y + 8, 4, 1);

    // Market
    [x, y] = this.getCoords(TileId.HOTSPOT_MARKET);
    c.fillStyle = '#182238';
    c.fillRect(x, y, 16, 16);
    c.fillStyle = '#10b981';
    c.fillRect(x + 1, y + 2, 14, 4);
    c.fillStyle = '#f59e0b';
    c.fillRect(x + 2, y + 7, 12, 8);

    // Hideout
    [x, y] = this.getCoords(TileId.HOTSPOT_HIDEOUT);
    c.fillStyle = '#182238';
    c.fillRect(x, y, 16, 16);
    c.fillStyle = '#334155';
    c.fillRect(x + 2, y + 3, 12, 13);
    c.fillStyle = '#f59e0b';
    c.fillRect(x + 11, y + 8, 2, 2);

    // Docks
    [x, y] = this.getCoords(TileId.HOTSPOT_DOCKS);
    c.fillStyle = '#182238';
    c.fillRect(x, y, 16, 16);
    c.fillStyle = '#0284c7';
    c.fillRect(x + 2, y + 2, 12, 4);
    c.fillStyle = '#475569';
    c.fillRect(x + 4, y + 6, 8, 10);
  }
}
