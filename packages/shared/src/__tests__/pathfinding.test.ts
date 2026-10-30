/**
 * Tests for A* pathfinding.
 */
import { describe, it, expect } from 'vitest';
import { findPath, pathToDirections, loadMap, type GameMap, DIR } from '../index.js';

function makeTestMap(width: number, height: number, blocked: [number, number][] = []): GameMap {
  const collision: string[] = [];
  for (let y = 0; y < height; y++) {
    let row = '';
    for (let x = 0; x < width; x++) {
      const isBlocked = blocked.some(([bx, by]) => bx === x && by === y);
      row += isBlocked ? '1' : '0';
    }
    collision.push(row);
  }
  return loadMap({
    version: 1,
    width,
    height,
    collision,
    spawns: [{ x: 0, y: 0 }],
    hotspots: [],
  });
}

describe('findPath', () => {
  it('returns empty array when start equals goal', () => {
    const map = makeTestMap(5, 5);
    expect(findPath(map, 2, 2, 2, 2)).toEqual([]);
  });

  it('finds a straight path', () => {
    const map = makeTestMap(10, 10);
    const path = findPath(map, 0, 0, 5, 0);
    expect(path).not.toBeNull();
    expect(path!.length).toBe(5);
    expect(path![path!.length - 1]).toEqual({ x: 5, y: 0 });
  });

  it('navigates around an obstacle', () => {
    // Wall from (3,0) to (3,3), gap at (3,4)
    const blocked: [number, number][] = [
      [3, 0], [3, 1], [3, 2], [3, 3],
    ];
    const map = makeTestMap(7, 7, blocked);
    const path = findPath(map, 0, 0, 5, 0);
    expect(path).not.toBeNull();
    // Path must go around the wall
    expect(path!.length).toBeGreaterThan(5);
    // All waypoints must be walkable
    for (const p of path!) {
      expect(p.x).toBeGreaterThanOrEqual(0);
      expect(p.y).toBeGreaterThanOrEqual(0);
      expect(p.x).toBeLessThan(7);
      expect(p.y).toBeLessThan(7);
    }
    // Last waypoint is the goal
    expect(path![path!.length - 1]).toEqual({ x: 5, y: 0 });
  });

  it('returns null when goal is blocked', () => {
    const map = makeTestMap(5, 5, [[3, 3]]);
    expect(findPath(map, 0, 0, 3, 3)).toBeNull();
  });

  it('returns null when no path exists (enclosed area)', () => {
    // Surround (2,2) with walls
    const blocked: [number, number][] = [
      [1, 1], [2, 1], [3, 1],
      [1, 2],         [3, 2],
      [1, 3], [2, 3], [3, 3],
    ];
    const map = makeTestMap(5, 5, blocked);
    expect(findPath(map, 0, 0, 2, 2)).toBeNull();
  });

  it('finds path in a corridor', () => {
    // Corridor: only row y=2 is walkable between (0,2) and (9,2)
    const blocked: [number, number][] = [];
    for (let y = 0; y < 5; y++) {
      if (y === 2) continue;
      for (let x = 0; x < 10; x++) {
        blocked.push([x, y]);
      }
    }
    const map = makeTestMap(10, 5, blocked);
    const path = findPath(map, 0, 2, 9, 2);
    expect(path).not.toBeNull();
    expect(path!.length).toBe(9);
  });
});

describe('pathToDirections', () => {
  it('converts a simple right-moving path', () => {
    const path = [{ x: 1, y: 0 }, { x: 2, y: 0 }, { x: 3, y: 0 }];
    const dirs = pathToDirections(0, 0, path);
    expect(dirs).toEqual([DIR.RIGHT, DIR.RIGHT, DIR.RIGHT]);
  });

  it('converts a path going down then right', () => {
    const path = [{ x: 0, y: 1 }, { x: 0, y: 2 }, { x: 1, y: 2 }];
    const dirs = pathToDirections(0, 0, path);
    expect(dirs).toEqual([DIR.DOWN, DIR.DOWN, DIR.RIGHT]);
  });

  it('empty path returns empty directions', () => {
    expect(pathToDirections(5, 5, [])).toEqual([]);
  });

  it('handles all four directions', () => {
    const path = [
      { x: 5, y: 4 }, // UP
      { x: 4, y: 4 }, // LEFT
      { x: 4, y: 5 }, // DOWN
      { x: 5, y: 5 }, // RIGHT
    ];
    const dirs = pathToDirections(5, 5, path);
    expect(dirs).toEqual([DIR.UP, DIR.LEFT, DIR.DOWN, DIR.RIGHT]);
  });
});
