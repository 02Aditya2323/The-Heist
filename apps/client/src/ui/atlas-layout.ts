import { sceneAt, type ArtScene, type GameMap } from "@heist/shared";

export interface AtlasPoint {
  x: number;
  y: number;
}
export interface AtlasRegion extends AtlasPoint {
  scene: ArtScene;
  width: number;
  height: number;
}
export interface AtlasJoin {
  id: string;
  from: string;
  to: string;
  start: AtlasPoint;
  end: AtlasPoint;
}
export interface AtlasLayout {
  regions: AtlasRegion[];
  joins: AtlasJoin[];
  width: number;
  height: number;
}

/** Presentation only: remove unused server address-space, not artwork pixels.
 * Never use this projection for simulation, movement or collision.
 */
function compactAxis(
  scenes: ArtScene[],
  axis: "x" | "y",
): (value: number) => number {
  const size = axis === "x" ? "width" : "height";
  const spans = scenes
    .map((s) => [s[axis], s[axis] + s[size]])
    .sort((a, b) => a[0] - b[0]);
  const merged: number[][] = [];
  for (const span of spans) {
    const last = merged.at(-1);
    if (last && span[0] <= last[1]) last[1] = Math.max(last[1], span[1]);
    else merged.push([...span]);
  }
  return (value) => {
    let occupied = 0;
    for (const [start, end] of merged) {
      if (value < start) return occupied;
      if (value <= end) return occupied + value - start;
      occupied += end - start;
    }
    return occupied;
  };
}

export function projectAtlasPoint(
  layout: AtlasLayout,
  map: GameMap,
  x: number,
  y: number,
): AtlasPoint | null {
  const scene = sceneAt(map, x, y),
    region = layout.regions.find((r) => r.scene.id === scene?.id);
  return region
    ? { x: region.x + x - region.scene.x, y: region.y + y - region.scene.y }
    : null;
}

export function atlasRegionAt(
  layout: AtlasLayout,
  x: number,
  y: number,
): AtlasRegion | undefined {
  return layout.regions.find(
    (r) => x >= r.x && y >= r.y && x < r.x + r.width && y < r.y + r.height,
  );
}

export function createAtlasLayout(map: GameMap): AtlasLayout {
  const scenes = map.scenes || [],
    x = compactAxis(scenes, "x"),
    y = compactAxis(scenes, "y");
  const regions = scenes.map((scene) => ({
    scene,
    x: x(scene.x),
    y: y(scene.y),
    width: scene.width,
    height: scene.height,
  }));
  const layout: AtlasLayout = {
    regions,
    joins: [],
    width: Math.max(0, ...regions.map((r) => r.x + r.width)),
    height: Math.max(0, ...regions.map((r) => r.y + r.height)),
  };
  const seen = new Set<string>();
  // One join per reciprocal gate pair. No invented centre-to-centre graph links.
  for (const exit of map.exits || []) {
    const from = sceneAt(map, exit.x, exit.y),
      to = sceneAt(map, exit.targetX, exit.targetY);
    if (!from || !to || from.id === to.id) continue;
    const key = [String([exit.x, exit.y]), String([exit.targetX, exit.targetY])]
      .sort()
      .join("|");
    if (seen.has(key)) continue;
    seen.add(key);
    const start = projectAtlasPoint(layout, map, exit.x + 0.5, exit.y + 0.5),
      end = projectAtlasPoint(
        layout,
        map,
        exit.targetX + 0.5,
        exit.targetY + 0.5,
      );
    if (start && end)
      layout.joins.push({ id: exit.id, from: from.id, to: to.id, start, end });
  }
  return layout;
}
