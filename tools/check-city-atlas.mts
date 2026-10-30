import { strict as assert } from "node:assert";
import { readFileSync } from "node:fs";
import { loadMap, sceneAt, type MapData } from "@heist/shared";
import {
  atlasRegionAt,
  createAtlasLayout,
  projectAtlasPoint,
} from "../apps/client/src/ui/atlas-layout.js";

const raw = JSON.parse(readFileSync("maps/art-world.json", "utf8")) as MapData;
const before = JSON.stringify(raw),
  map = loadMap(raw),
  layout = createAtlasLayout(map);
assert.equal(layout.regions.length, 19);
assert.equal(layout.joins.length, 22);
assert.equal(layout.width, 260);
assert.equal(layout.height, 203);
assert.equal(
  JSON.stringify(raw),
  before,
  "Projection must not mutate server data",
);
for (const region of layout.regions) {
  assert.equal(region.width, region.scene.width);
  assert.equal(region.height, region.scene.height);
  assert.equal(
    atlasRegionAt(layout, region.x + 0.5, region.y + 0.5)?.scene.id,
    region.scene.id,
  );
  for (let y = 0; y < region.height; y++)
    for (let x = 0; x < region.width; x++) {
      const projected = projectAtlasPoint(
        layout,
        map,
        region.scene.x + x + 0.5,
        region.scene.y + y + 0.5,
      )!;
      assert.equal(projected.x - region.x, x + 0.5);
      assert.equal(projected.y - region.y, y + 0.5);
      assert.equal(
        atlasRegionAt(layout, projected.x, projected.y)?.scene.id,
        region.scene.id,
      );
    }
}
for (let i = 0; i < layout.regions.length; i++)
  for (const b of layout.regions.slice(i + 1)) {
    const a = layout.regions[i];
    assert.ok(
      a.x + a.width <= b.x ||
        b.x + b.width <= a.x ||
        a.y + a.height <= b.y ||
        b.y + b.height <= a.y,
      "Artwork panels must not overlap",
    );
  }
for (const point of [
  ...map.hotspots,
  ...(map.homePlots || []),
  ...(map.exits || []),
  ...map.spawns,
]) {
  const p = projectAtlasPoint(layout, map, point.x + 0.5, point.y + 0.5)!;
  assert.ok(p);
  assert.equal(
    atlasRegionAt(layout, p.x, p.y)?.scene.id,
    sceneAt(map, point.x, point.y)?.id,
  );
}
const edge = (a: string, b: string) => [a, b].sort().join("|");
const expected = new Set(
  (map.routes || []).flatMap((r) =>
    r.connector
      ? [edge(r.from, r.connector), edge(r.connector, r.to)]
      : [edge(r.from, r.to)],
  ),
);
const observed = new Set(layout.joins.map((j) => edge(j.from, j.to)));
assert.deepEqual(
  observed,
  expected,
  "Atlas joins must match gameplay topology exactly",
);
for (const join of layout.joins) {
  assert.equal(
    atlasRegionAt(layout, join.start.x, join.start.y)?.scene.id,
    join.from,
  );
  assert.equal(
    atlasRegionAt(layout, join.end.x, join.end.y)?.scene.id,
    join.to,
  );
}
assert.equal(projectAtlasPoint(layout, map, -1, -1), null);
assert.equal(atlasRegionAt(layout, layout.width, layout.height), undefined);
assert.deepEqual(
  createAtlasLayout(
    loadMap({
      version: 1,
      width: 1,
      height: 1,
      collision: ["0"],
      spawns: [],
      hotspots: [],
    }),
  ),
  { regions: [], joins: [], width: 0, height: 0 },
);
const synthetic = loadMap({
  version: 1,
  width: 31,
  height: 21,
  collision: Array(21).fill("0".repeat(31)),
  spawns: [],
  hotspots: [],
  scenes: [
    {
      id: "a",
      name: "A",
      kind: "district",
      x: 10,
      y: 10,
      width: 5,
      height: 5,
      image: "a",
      color: "#fff",
    },
    {
      id: "b",
      name: "B",
      kind: "district",
      x: 25,
      y: 10,
      width: 6,
      height: 5,
      image: "b",
      color: "#fff",
    },
  ],
});
const compact = createAtlasLayout(synthetic);
assert.equal(compact.width, 11);
assert.equal(compact.height, 5);
assert.deepEqual(projectAtlasPoint(compact, synthetic, 27.5, 12.5), {
  x: 7.5,
  y: 2.5,
});
console.log(
  "Atlas passed: 19 unchanged panels; 22 exact travel joins; 28,652 tile centres; 124 POIs; 90 Homes; 44 gates; no overlaps or server mutations.",
);
