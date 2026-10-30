/**
 * Rebuild the per-scene collision masks from the authored obstacle footprints.
 *
 * Why this exists: the offline OpenCV pavement pass classified only neutral-grey
 * floor as walkable, so painted plazas, kerbs, road markings and decorative
 * texture all became blocked speckle. That left every scene 75-91% blocked with
 * loose blobs sitting inside otherwise open floor - the "random blockages".
 *
 * The authored footprints in art-world-v2.obstacles.json (overridden per scene by
 * art-world-v2.review.json, whose note states the explicit footprints always win)
 * are the real geometry. This tool rasterises those footprints, dilates them by
 * the standing-foot radius, and treats everything else inside a scene as floor.
 *
 * Two safety rails are kept:
 *  - the scene's outer ring keeps whatever the CV review decided, so a player
 *    never stands on an edge wall that no footprint describes;
 *  - the pass is monotonic. It only ever opens a tile, never closes one, so no
 *    hotspot, gate approach, home plot, spawn or existing route can regress.
 *
 * It only rewrites `scenes` in the collision file. `version`, `sourceHash` and
 * `sourceImageHashes` are derived from the layout/obstacle/image sources, so the
 * builder's staleness check still holds.
 *
 * Run: npx tsx tools/clean-world-collision.mts [--dry] [--report]
 */
import { readFileSync, writeFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const read = (p: string) => JSON.parse(readFileSync(resolve(root, p), "utf8"));

type Point = [number, number];
type Obstacle = { name: string; kind: string; points: Point[] };
type Layout = {
  version: number;
  tileSize: number;
  sceneWidth: number;
  sceneHeight: number;
  spawnPoint?: unknown;
  scenes: { id: string; name: string; kind: string; origin: Point }[];
};
type Collision = {
  version: number;
  sourceHash: string;
  sourceImageHashes: Record<string, string>;
  footRadiusPixels: number;
  scenes: Record<string, string[]>;
};

const layout: Layout = read("maps/art-world-v2.layout.json");
const collision: Collision = read("maps/art-world-v2.collision.json");
const authored: { scenes: Record<string, Obstacle[]> } = read(
  "maps/art-world-v2.obstacles.json",
);
const review: { scenes: Record<string, { obstacles?: Obstacle[] }> } = read(
  "maps/art-world-v2.review.json",
);

const TILE = layout.tileSize,
  SW = layout.sceneWidth,
  SH = layout.sceneHeight,
  FOOT = collision.footRadiusPixels,
  PW = SW * TILE,
  PH = SH * TILE;

/** A tile counts as blocked when this share of its pixels sits under a footprint. */
const BLOCK_SHARE = 0.3;

/** Even-odd point-in-polygon over the authored footprint rings. */
function inside(poly: Point[], x: number, y: number) {
  let hit = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, yi] = poly[i],
      [xj, yj] = poly[j];
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi)
      hit = !hit;
  }
  return hit;
}

/** Rasterise footprints to pixels, then grow them by the standing-foot radius. */
function footprintMask(obstacles: Obstacle[]) {
  const raw = new Uint8Array(PW * PH);
  for (const o of obstacles) {
    let minX = PW,
      maxX = 0,
      minY = PH,
      maxY = 0;
    for (const [x, y] of o.points) {
      minX = Math.min(minX, x);
      maxX = Math.max(maxX, x);
      minY = Math.min(minY, y);
      maxY = Math.max(maxY, y);
    }
    const x0 = Math.max(0, Math.floor(minX)),
      x1 = Math.min(PW - 1, Math.ceil(maxX)),
      y0 = Math.max(0, Math.floor(minY)),
      y1 = Math.min(PH - 1, Math.ceil(maxY));
    for (let y = y0; y <= y1; y++)
      for (let x = x0; x <= x1; x++)
        if (inside(o.points, x + 0.5, y + 0.5)) raw[y * PW + x] = 1;
  }
  // Separable box dilation by the foot radius: a tile the player cannot stand in
  // because their footprint would clip a wall must stay blocked.
  const pass = (src: Uint8Array, horizontal: boolean) => {
    const out = new Uint8Array(PW * PH),
      major = horizontal ? PH : PW,
      minor = horizontal ? PW : PH;
    for (let a = 0; a < major; a++) {
      for (let b = 0; b < minor; b++) {
        let on = 0;
        for (let d = -FOOT; d <= FOOT && !on; d++) {
          const n = b + d;
          if (n < 0 || n >= minor) continue;
          on = horizontal ? src[a * PW + n] : src[n * PW + a];
        }
        if (on) {
          if (horizontal) out[a * PW + b] = 1;
          else out[b * PW + a] = 1;
        }
      }
    }
    return out;
  };
  return pass(pass(raw, true), false);
}

/** Collapse the pixel footprint mask to a tile mask. */
function tileMask(pixels: Uint8Array) {
  const need = TILE * TILE * BLOCK_SHARE,
    rows: boolean[][] = [];
  for (let ty = 0; ty < SH; ty++) {
    const row: boolean[] = [];
    for (let tx = 0; tx < SW; tx++) {
      let n = 0;
      for (let y = ty * TILE; y < (ty + 1) * TILE; y++)
        for (let x = tx * TILE; x < (tx + 1) * TILE; x++) n += pixels[y * PW + x];
      row.push(n >= need);
    }
    rows.push(row);
  }
  return rows;
}

const report: Record<string, unknown>[] = [];
const rebuilt: Record<string, string[]> = {};

for (const scene of layout.scenes) {
  const previous = collision.scenes[scene.id];
  if (!previous) throw new Error(`No existing mask for scene ${scene.id}`);
  const obstacles = review.scenes[scene.id]?.obstacles ?? authored.scenes[scene.id];
  if (!obstacles)
    throw new Error(`No authored or reviewed footprints for scene ${scene.id}`);
  const mask = tileMask(footprintMask(obstacles));
  const rows: string[] = [];
  let opened = 0,
    blockedBefore = 0,
    blockedAfter = 0;
  for (let y = 0; y < SH; y++) {
    let row = "";
    for (let x = 0; x < SW; x++) {
      const wasBlocked = previous[y][x] === "1",
        onRing = x === 0 || y === 0 || x === SW - 1 || y === SH - 1;
      // Monotonic by design: a tile that already walked stays walkable, and a
      // tile the CV blocked only opens when no authored footprint covers it.
      // Nothing that worked before this pass can regress, so every marker, gate
      // approach and route the event depends on is preserved by construction.
      // The outer ring is left exactly as the CV review decided.
      const blocked = onRing ? wasBlocked : wasBlocked && mask[y][x];
      if (wasBlocked) blockedBefore++;
      if (blocked) blockedAfter++;
      else if (wasBlocked) opened++;
      row += blocked ? "1" : "0";
    }
    rows.push(row);
  }
  rebuilt[scene.id] = rows;
  report.push({
    scene: scene.id,
    kind: scene.kind,
    footprints: obstacles.length,
    source: review.scenes[scene.id]?.obstacles ? "review" : "authored",
    blockedBefore,
    blockedAfter,
    opened,
    walkableBefore: SW * SH - blockedBefore,
    walkableAfter: SW * SH - blockedAfter,
  });
}

console.table(report);
const sum = (k: string) => report.reduce((a, r) => a + (r[k] as number), 0);
console.log(
  `walkable tiles ${sum("walkableBefore")} -> ${sum("walkableAfter")} (+${sum("opened")})`,
);

if (!process.argv.includes("--dry")) {
  collision.scenes = rebuilt;
  writeFileSync(
    resolve(root, "maps/art-world-v2.collision.json"),
    JSON.stringify(collision, null, 2) + "\n",
  );
  console.log("wrote maps/art-world-v2.collision.json");
} else console.log("dry run: nothing written");
