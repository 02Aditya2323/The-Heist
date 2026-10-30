/**
 * @heist/shared - pathfinding.ts
 *
 * A* pathfinding on the collision grid.
 * Used by bots (Roamer, Hotspot-goer) to navigate to destinations.
 * Not used by the server or client — purely a bot utility, but lives in shared
 * so it can use the same GameMap and isWalkable functions.
 */

import { isWalkable, type GameMap } from './map.js';

interface PathNode {
  x: number;
  y: number;
  g: number;  // cost from start
  f: number;  // g + heuristic
  parent: PathNode | null;
}

/**
 * Find a path from (sx, sy) to (gx, gy) using A* on the collision grid.
 * Returns an array of {x, y} waypoints (excluding the start, including the goal),
 * or null if no path exists.
 *
 * maxIterations caps the search to prevent runaway computation on huge maps.
 */
export function findPath(
  map: GameMap,
  sx: number, sy: number,
  gx: number, gy: number,
  maxIterations: number = 50000,
): Array<{ x: number; y: number }> | null {
  if (sx === gx && sy === gy) return [];
  if (!isWalkable(map, gx, gy)) return null;

  // Manhattan distance heuristic
  const h = (x: number, y: number) => Math.abs(x - gx) + Math.abs(y - gy);

  const open: PathNode[] = [{ x: sx, y: sy, g: 0, f: h(sx, sy), parent: null }];
  const closed = new Set<number>();

  const key = (x: number, y: number) => y * map.width + x;

  // Track best g-score per tile for open set efficiency
  const gScores = new Map<number, number>();
  gScores.set(key(sx, sy), 0);

  const dirs = [[0, -1], [0, 1], [-1, 0], [1, 0]] as const;
  let iterations = 0;

  while (open.length > 0 && iterations < maxIterations) {
    iterations++;

    // Find node with lowest f (simple linear scan — fine for game bot use)
    let bestIdx = 0;
    for (let i = 1; i < open.length; i++) {
      if (open[i].f < open[bestIdx].f) bestIdx = i;
    }

    const current = open[bestIdx];
    open[bestIdx] = open[open.length - 1];
    open.pop();

    if (current.x === gx && current.y === gy) {
      // Reconstruct path
      const path: Array<{ x: number; y: number }> = [];
      let node: PathNode | null = current;
      while (node !== null && !(node.x === sx && node.y === sy)) {
        path.push({ x: node.x, y: node.y });
        node = node.parent;
      }
      path.reverse();
      return path;
    }

    const ck = key(current.x, current.y);
    if (closed.has(ck)) continue;
    closed.add(ck);

    for (const [dx, dy] of dirs) {
      const nx = current.x + dx;
      const ny = current.y + dy;

      if (!isWalkable(map, nx, ny)) continue;

      const nk = key(nx, ny);
      if (closed.has(nk)) continue;

      const ng = current.g + 1;
      const existing = gScores.get(nk);
      if (existing !== undefined && ng >= existing) continue;

      gScores.set(nk, ng);
      open.push({ x: nx, y: ny, g: ng, f: ng + h(nx, ny), parent: current });
    }
  }

  return null; // No path found
}

/**
 * Convert a path of waypoints into a sequence of directions (0=UP, 1=DOWN, 2=LEFT, 3=RIGHT).
 * Used by bots to convert A* output into MOVE commands.
 */
export function pathToDirections(
  startX: number, startY: number,
  path: Array<{ x: number; y: number }>,
): number[] {
  const dirs: number[] = [];
  let cx = startX;
  let cy = startY;

  for (const step of path) {
    const dx = step.x - cx;
    const dy = step.y - cy;

    if (dy === -1) dirs.push(0);      // UP
    else if (dy === 1) dirs.push(1);  // DOWN
    else if (dx === -1) dirs.push(2); // LEFT
    else if (dx === 1) dirs.push(3);  // RIGHT

    cx = step.x;
    cy = step.y;
  }

  return dirs;
}
