/**
 * tools/gen-map.ts
 *
 * Generates a 256x256 dev map with:
 * - Outer wall border
 * - Scattered rectangular buildings (blocked interiors with doorways)
 * - Roads (guaranteed walkable corridors)
 * - Plazas (open areas)
 * - Hotspots (bank, jobboard, etc.) placed in open areas
 * - Multiple spawn points in open areas
 *
 * Run: npx tsx tools/gen-map.ts
 * Output: maps/dev-map.json
 */

import { writeFileSync, mkdirSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const WIDTH = 256;
const HEIGHT = 256;

// Seed-able PRNG (simple LCG) for reproducible maps
class Rng {
  private state: number;
  constructor(seed: number) {
    this.state = seed;
  }
  next(): number {
    this.state = (this.state * 1664525 + 1013904223) & 0x7fffffff;
    return this.state / 0x7fffffff;
  }
  int(min: number, max: number): number {
    return min + Math.floor(this.next() * (max - min + 1));
  }
}

function generateMap() {
  const rng = new Rng(42);
  // 0 = walkable, 1 = blocked
  const grid: number[][] = Array.from({ length: HEIGHT }, () =>
    Array.from({ length: WIDTH }, () => 0)
  );

  // ── Outer walls ─────────────────────────────────────────────────
  for (let x = 0; x < WIDTH; x++) {
    grid[0][x] = 1;
    grid[HEIGHT - 1][x] = 1;
  }
  for (let y = 0; y < HEIGHT; y++) {
    grid[y][0] = 1;
    grid[y][WIDTH - 1] = 1;
  }

  // ── Roads: major horizontal and vertical corridors ─────────────
  // Create a grid of roads every ~32 tiles, 3 tiles wide
  const roadPositions: number[] = [];
  for (let i = 32; i < WIDTH - 10; i += 32) {
    roadPositions.push(i);
  }

  // We'll carve roads AFTER placing buildings to ensure they stay clear

  // ── Buildings ───────────────────────────────────────────────────
  // Place ~40 buildings of varying sizes
  interface Building {
    x: number; y: number; w: number; h: number;
  }
  const buildings: Building[] = [];

  for (let attempt = 0; attempt < 200 && buildings.length < 45; attempt++) {
    const bw = rng.int(4, 12);
    const bh = rng.int(4, 10);
    const bx = rng.int(4, WIDTH - bw - 4);
    const by = rng.int(4, HEIGHT - bh - 4);

    // Check it doesn't overlap roads
    let onRoad = false;
    for (const rp of roadPositions) {
      if (bx <= rp + 2 && bx + bw >= rp && by <= rp + 2 && by + bh >= rp) {
        // Too close to a road intersection — skip
      }
      if ((bx <= rp + 2 && bx + bw >= rp) || (by <= rp + 2 && by + bh >= rp)) {
        onRoad = true;
        break;
      }
    }
    if (onRoad) continue;

    // Check no overlap with existing buildings (with 2-tile margin)
    let overlap = false;
    for (const b of buildings) {
      if (bx - 2 < b.x + b.w && bx + bw + 2 > b.x &&
          by - 2 < b.y + b.h && by + bh + 2 > b.y) {
        overlap = true;
        break;
      }
    }
    if (overlap) continue;

    buildings.push({ x: bx, y: by, w: bw, h: bh });

    // Fill building walls (border of the rectangle)
    for (let y = by; y < by + bh; y++) {
      for (let x = bx; x < bx + bw; x++) {
        if (y === by || y === by + bh - 1 || x === bx || x === bx + bw - 1) {
          grid[y][x] = 1;
        } else {
          // Interior is also blocked (it's a building)
          grid[y][x] = 1;
        }
      }
    }

    // Add 1-2 doorways (gaps in walls)
    const doorCount = rng.int(1, 2);
    for (let d = 0; d < doorCount; d++) {
      const side = rng.int(0, 3); // 0=top, 1=bottom, 2=left, 3=right
      switch (side) {
        case 0: { // top
          const dx = rng.int(bx + 1, bx + bw - 2);
          grid[by][dx] = 0;
          break;
        }
        case 1: { // bottom
          const dx = rng.int(bx + 1, bx + bw - 2);
          grid[by + bh - 1][dx] = 0;
          break;
        }
        case 2: { // left
          const dy = rng.int(by + 1, by + bh - 2);
          grid[dy][bx] = 0;
          break;
        }
        case 3: { // right
          const dy = rng.int(by + 1, by + bh - 2);
          grid[dy][bx + bw - 1] = 0;
          break;
        }
      }
    }
  }

  // ── Ensure road corridors are walkable ──────────────────────────
  for (const rp of roadPositions) {
    // Horizontal road at y = rp, 3 tiles wide
    for (let x = 1; x < WIDTH - 1; x++) {
      for (let offset = 0; offset < 3; offset++) {
        const ry = rp + offset;
        if (ry > 0 && ry < HEIGHT - 1) {
          grid[ry][x] = 0;
        }
      }
    }
    // Vertical road at x = rp, 3 tiles wide
    for (let y = 1; y < HEIGHT - 1; y++) {
      for (let offset = 0; offset < 3; offset++) {
        const rx = rp + offset;
        if (rx > 0 && rx < WIDTH - 1) {
          grid[y][rx] = 0;
        }
      }
    }
  }

  // ── Plazas (open areas near hotspot locations) ──────────────────
  const plazaLocations = [
    { x: 64, y: 64 },
    { x: 128, y: 64 },
    { x: 64, y: 128 },
    { x: 128, y: 128 },
    { x: 192, y: 96 },
    { x: 96, y: 192 },
  ];

  for (const p of plazaLocations) {
    const size = rng.int(5, 8);
    for (let dy = -size; dy <= size; dy++) {
      for (let dx = -size; dx <= size; dx++) {
        const px = p.x + dx;
        const py = p.y + dy;
        if (px > 0 && px < WIDTH - 1 && py > 0 && py < HEIGHT - 1) {
          grid[py][px] = 0;
        }
      }
    }
  }

  // ── Scatter some individual wall tiles (debris/obstacles) ───────
  for (let i = 0; i < 80; i++) {
    const x = rng.int(2, WIDTH - 3);
    const y = rng.int(2, HEIGHT - 3);
    // Only place if in an open area (not on a road or plaza)
    let nearRoad = false;
    for (const rp of roadPositions) {
      if (Math.abs(x - rp) <= 3 || Math.abs(y - rp) <= 3) {
        nearRoad = true;
        break;
      }
    }
    if (!nearRoad && grid[y][x] === 0) {
      grid[y][x] = 1;
    }
  }

  // ── Hotspots ────────────────────────────────────────────────────
  const hotspots = [
    { name: 'bank', x: 64, y: 64 },
    { name: 'jobboard', x: 128, y: 64 },
    { name: 'market', x: 64, y: 128 },
    { name: 'hideout', x: 128, y: 128 },
    { name: 'police_station', x: 192, y: 96 },
    { name: 'docks', x: 96, y: 192 },
  ];

  // Ensure hotspot tiles are walkable
  for (const h of hotspots) {
    grid[h.y][h.x] = 0;
    // Clear a small area around each hotspot
    for (let dy = -1; dy <= 1; dy++) {
      for (let dx = -1; dx <= 1; dx++) {
        const hx = h.x + dx;
        const hy = h.y + dy;
        if (hx > 0 && hx < WIDTH - 1 && hy > 0 && hy < HEIGHT - 1) {
          grid[hy][hx] = 0;
        }
      }
    }
  }

  // ── Spawn points ────────────────────────────────────────────────
  const spawns = [
    { x: 10, y: 10 },
    { x: 32, y: 32 },
    { x: 64, y: 32 },
    { x: 32, y: 64 },
    { x: 96, y: 32 },
    { x: 128, y: 96 },
    { x: 160, y: 64 },
    { x: 200, y: 100 },
  ];

  // Ensure all spawn tiles are walkable
  for (const s of spawns) {
    grid[s.y][s.x] = 0;
    // Clear surroundings
    for (let dy = -1; dy <= 1; dy++) {
      for (let dx = -1; dx <= 1; dx++) {
        const sx = s.x + dx;
        const sy = s.y + dy;
        if (sx > 0 && sx < WIDTH - 1 && sy > 0 && sy < HEIGHT - 1) {
          grid[sy][sx] = 0;
        }
      }
    }
  }

  // ── Convert to string format ────────────────────────────────────
  const collision = grid.map(row => row.join(''));

  const mapData = {
    version: 1,
    width: WIDTH,
    height: HEIGHT,
    collision,
    spawns,
    hotspots,
  };

  // ── Write output ────────────────────────────────────────────────
  const outDir = join(__dirname, '..', 'maps');
  mkdirSync(outDir, { recursive: true });
  const outPath = join(outDir, 'dev-map.json');
  writeFileSync(outPath, JSON.stringify(mapData, null, 2));

  // Stats
  let blocked = 0;
  let walkable = 0;
  for (let y = 0; y < HEIGHT; y++) {
    for (let x = 0; x < WIDTH; x++) {
      if (grid[y][x] === 1) blocked++;
      else walkable++;
    }
  }

  console.log(`Map generated: ${outPath}`);
  console.log(`  Size: ${WIDTH}x${HEIGHT} (${WIDTH * HEIGHT} tiles)`);
  console.log(`  Walkable: ${walkable} (${((walkable / (WIDTH * HEIGHT)) * 100).toFixed(1)}%)`);
  console.log(`  Blocked: ${blocked} (${((blocked / (WIDTH * HEIGHT)) * 100).toFixed(1)}%)`);
  console.log(`  Buildings: ${buildings.length}`);
  console.log(`  Hotspots: ${hotspots.length}`);
  console.log(`  Spawns: ${spawns.length}`);
}

generateMap();
