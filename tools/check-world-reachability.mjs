#!/usr/bin/env node
/**
 * Verify that every point the event depends on is actually standable and
 * reachable in the built world.
 *
 * The world builder already refuses a stale collision mask and rejects a
 * blocked critical marker. This adds the property those checks cannot express:
 * that each scene's walkable floor is a *single connected region*, and that
 * every hotspot, gate, gate destination, home plot and spawn sits inside it.
 *
 * A scene that splits into two pockets passes the builder's per-tile checks and
 * still strands players, so this runs in CI on every push.
 *
 * Read-only. Exits non-zero with a specific reason on failure.
 */
import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const map = JSON.parse(
  readFileSync(resolve(root, "maps/art-world.json"), "utf8"),
);

const { width: W, height: H } = map;
const grid = map.collision.map((row) => row.split(""));
const walkable = (x, y) =>
  x >= 0 && y >= 0 && x < W && y < H && grid[y][x] === "0";

// Label every connected region of walkable floor with a flood fill.
const region = new Int32Array(W * H).fill(-1);
const sizes = [];
for (let y = 0; y < H; y++)
  for (let x = 0; x < W; x++) {
    if (!walkable(x, y) || region[y * W + x] !== -1) continue;
    const id = sizes.length;
    let count = 0;
    const stack = [[x, y]];
    region[y * W + x] = id;
    while (stack.length) {
      const [cx, cy] = stack.pop();
      count++;
      for (const [dx, dy] of [
        [0, -1],
        [0, 1],
        [-1, 0],
        [1, 0],
      ]) {
        const nx = cx + dx,
          ny = cy + dy;
        if (!walkable(nx, ny) || region[ny * W + nx] !== -1) continue;
        region[ny * W + nx] = id;
        stack.push([nx, ny]);
      }
    }
    sizes.push(count);
  }

const failures = [];
const regionAt = (x, y) =>
  x >= 0 && y >= 0 && x < W && y < H ? region[y * W + x] : -1;

// 1. One walkable region per scene. Travel between scenes uses authoritative
//    gates, not walking, so the expected region count is the scene count.
if (sizes.length !== map.scenes.length)
  failures.push(
    `Expected ${map.scenes.length} walkable regions (one per scene) but found ${sizes.length}. A scene has split into disconnected pockets.`,
  );

// 2. Everything the event depends on must be standable.
const check = (label, items, getX, getY, getId) => {
  for (const item of items) {
    const x = getX(item),
      y = getY(item);
    const id = regionAt(x, y);
    if (id === -1)
      failures.push(
        `${label} "${getId(item)}" at (${x},${y}) is on a blocked tile.`,
      );
    else if (sizes[id] < 10)
      failures.push(
        `${label} "${getId(item)}" at (${x},${y}) sits in an isolated pocket of only ${sizes[id]} tiles.`,
      );
  }
};

check("Hotspot", map.hotspots ?? [], (h) => h.x, (h) => h.y, (h) => h.id);
check("Gate", map.exits ?? [], (e) => e.x, (e) => e.y, (e) => e.id);
check(
  "Gate destination",
  map.exits ?? [],
  (e) => e.targetX,
  (e) => e.targetY,
  (e) => e.id,
);
check(
  "Home plot",
  map.homePlots ?? [],
  (p) => p.x,
  (p) => p.y,
  (p) => p.address ?? p.id,
);
check("Spawn", map.spawns ?? [], (s) => s.x, (s) => s.y, () => "spawn");

// 3. Each gate must land in the same region as its destination scene's floor,
//    which a per-tile check cannot catch: a gate can be standable while its
//    exit drops the player into a sealed pocket.
for (const exit of map.exits ?? []) {
  const from = regionAt(exit.x, exit.y),
    to = regionAt(exit.targetX, exit.targetY);
  if (from !== -1 && to !== -1 && from === to)
    failures.push(
      `Gate "${exit.id}" leads from (${exit.x},${exit.y}) to (${exit.targetX},${exit.targetY}) inside the same walkable region, so it does not connect two scenes.`,
    );
}

const walkableTotal = sizes.reduce((a, b) => a + b, 0);
console.log(
  `World v${map.version}: ${W}x${H} tiles, ${map.scenes.length} scenes, ` +
    `${walkableTotal} walkable tiles in ${sizes.length} regions.`,
);
console.log(
  `Checked ${(map.hotspots ?? []).length} hotspots, ${(map.exits ?? []).length} gates ` +
    `(and their destinations), ${(map.homePlots ?? []).length} home plots, ` +
    `${(map.spawns ?? []).length} spawns.`,
);

if (failures.length) {
  console.error(`\n${failures.length} reachability failure(s):`);
  for (const f of failures) console.error(`  - ${f}`);
  process.exit(1);
}
console.log("All interaction points are reachable.");
