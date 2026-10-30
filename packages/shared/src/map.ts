/**
 * @heist/shared - map.ts
 *
 * Map data types, loading, and collision queries.
 * The server loads from JSON file; the client fetches from /api/map.
 * Both use the same GameMap type and isWalkable function.
 */

export interface Hotspot {
  name: string;
  x: number;
  y: number;
  id?: string;
  action?: string;
  description?: string;
}

/** One original art panel placed on the authoritative world grid. */
export interface ArtScene {
  id: string;
  name: string;
  kind: 'district' | 'connector' | 'neighborhood';
  parentId?: string;
  x: number;
  y: number;
  width: number;
  height: number;
  image: string;
  color: string;
  previewImage?: string;
  foregroundRects?: { x:number; y:number; width:number; height:number }[];
}

/** Both the complete-map UI and authoritative exit generation use this topology. */
export interface CityRoute {
  id: string;
  from: string;
  connector?: string;
  to: string;
}

/** A physical Home site; no client-side ownership or economy is implied. */
export interface HomePlot {
  id: string;
  address: string;
  sceneId: string;
  x: number;
  y: number;
}

export interface DistrictExit {
  id: string;
  name: string;
  x: number;
  y: number;
  targetX: number;
  targetY: number;
  radius: number;
}

export interface Spawn {
  x: number;
  y: number;
}

export interface MapData {
  version: number;
  width: number;
  height: number;
  collision: string[];  // one string per row, '1' = blocked, '0' = walkable
  spawns: Spawn[];
  hotspots: Hotspot[];
  tileSize?: number;
  scenes?: ArtScene[];
  exits?: DistrictExit[];
  routes?: CityRoute[];
  homePlots?: HomePlot[];
}

/**
 * Optimised in-memory map representation.
 * collision is a flat Uint8Array: 1 = blocked, 0 = walkable.
 */
export interface GameMap {
  version: number;
  width: number;
  height: number;
  collision: Uint8Array;  // flat array, index = y * width + x
  spawns: Spawn[];
  hotspots: Hotspot[];
  tileSize?: number;
  scenes?: ArtScene[];
  exits?: DistrictExit[];
  routes?: CityRoute[];
  homePlots?: HomePlot[];
}

/**
 * Parse raw MapData (from JSON) into an optimised GameMap.
 */
export function loadMap(data: MapData): GameMap {
  const { version, width, height, collision: rows, spawns, hotspots } = data;

  if (rows.length !== height) {
    throw new Error(`Map collision has ${rows.length} rows, expected ${height}`);
  }

  const collision = new Uint8Array(width * height);

  for (let y = 0; y < height; y++) {
    const row = rows[y];
    if (row.length !== width) {
      throw new Error(`Row ${y} has ${row.length} chars, expected ${width}`);
    }
    for (let x = 0; x < width; x++) {
      collision[y * width + x] = row[x] === '1' ? 1 : 0;
    }
  }

  return { version, width, height, collision, spawns, hotspots,
    ...(data.tileSize ? { tileSize: data.tileSize } : {}),
    ...(data.scenes ? { scenes: data.scenes } : {}),
    ...(data.exits ? { exits: data.exits } : {}),
    ...(data.routes ? { routes: data.routes } : {}),
    ...(data.homePlots ? { homePlots: data.homePlots } : {}) };
}

export function sceneAt(map: GameMap, x: number, y: number): ArtScene | undefined {
  return map.scenes?.find(scene => x >= scene.x && y >= scene.y && x < scene.x + scene.width && y < scene.y + scene.height);
}

/**
 * Check if a tile is walkable.
 * Out-of-bounds tiles are always blocked.
 */
export function isWalkable(map: GameMap, x: number, y: number): boolean {
  if (x < 0 || y < 0 || x >= map.width || y >= map.height) return false;
  return map.collision[y * map.width + x] === 0;
}

/**
 * Pick a random spawn point.
 */
export function randomSpawn(map: GameMap): Spawn {
  if (map.spawns.length === 0) {
    throw new Error('Map has no spawn points');
  }
  return map.spawns[Math.floor(Math.random() * map.spawns.length)];
}
