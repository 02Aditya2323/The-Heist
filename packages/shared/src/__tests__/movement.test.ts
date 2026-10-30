/**
 * Tests for movement and collision.
 * Spec requirement: unit tests for collision edge cases.
 */
import { describe, it, expect } from 'vitest';
import { tryStep, DIR, type Direction, loadMap, isWalkable, type MapData, type GameMap } from '../index.js';

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
    spawns: [{ x: 1, y: 1 }],
    hotspots: [],
  });
}

describe('tryStep', () => {
  const map = makeTestMap(10, 10, [
    [5, 5], [5, 6], [5, 7], // vertical wall at x=5
    [3, 3], // single block
  ]);

  it('moves up into a walkable tile', () => {
    const r = tryStep(map, 2, 5, DIR.UP);
    expect(r).toEqual({ ok: true, x: 2, y: 4 });
  });

  it('moves down into a walkable tile', () => {
    const r = tryStep(map, 2, 5, DIR.DOWN);
    expect(r).toEqual({ ok: true, x: 2, y: 6 });
  });

  it('moves left into a walkable tile', () => {
    const r = tryStep(map, 2, 5, DIR.LEFT);
    expect(r).toEqual({ ok: true, x: 1, y: 5 });
  });

  it('moves right into a walkable tile', () => {
    const r = tryStep(map, 2, 5, DIR.RIGHT);
    expect(r).toEqual({ ok: true, x: 3, y: 5 });
  });

  it('blocks movement into a wall tile', () => {
    // Try to walk right into (5, 5) which is blocked
    const r = tryStep(map, 4, 5, DIR.RIGHT);
    expect(r).toEqual({ ok: false, x: 4, y: 5 });
  });

  it('blocks movement into a single-block obstacle', () => {
    const r = tryStep(map, 2, 3, DIR.RIGHT);
    expect(r).toEqual({ ok: false, x: 2, y: 3 });
  });

  it('blocks movement out of bounds (top edge)', () => {
    const r = tryStep(map, 5, 0, DIR.UP);
    expect(r).toEqual({ ok: false, x: 5, y: 0 });
  });

  it('blocks movement out of bounds (bottom edge)', () => {
    const r = tryStep(map, 5, 9, DIR.DOWN);
    expect(r).toEqual({ ok: false, x: 5, y: 9 });
  });

  it('blocks movement out of bounds (left edge)', () => {
    const r = tryStep(map, 0, 5, DIR.LEFT);
    expect(r).toEqual({ ok: false, x: 0, y: 5 });
  });

  it('blocks movement out of bounds (right edge)', () => {
    const r = tryStep(map, 9, 5, DIR.RIGHT);
    expect(r).toEqual({ ok: false, x: 9, y: 5 });
  });

  it('allows movement along a wall (parallel)', () => {
    // Wall at x=5, moving up from (4, 7) — should be fine
    const r = tryStep(map, 4, 7, DIR.UP);
    expect(r).toEqual({ ok: true, x: 4, y: 6 });
  });

  it('blocks movement at corner (0,0)', () => {
    const r = tryStep(map, 0, 0, DIR.UP);
    expect(r).toEqual({ ok: false, x: 0, y: 0 });
    const r2 = tryStep(map, 0, 0, DIR.LEFT);
    expect(r2).toEqual({ ok: false, x: 0, y: 0 });
  });

  it('all four directions tested from center', () => {
    const results: Record<string, boolean> = {};
    for (const dir of [DIR.UP, DIR.DOWN, DIR.LEFT, DIR.RIGHT] as Direction[]) {
      const r = tryStep(map, 5, 3, dir);
      results[String(dir)] = r.ok;
    }
    // UP from (5,3) → (5,2) walkable ✓
    expect(results[String(DIR.UP)]).toBe(true);
    // DOWN from (5,3) → (5,4) walkable ✓
    expect(results[String(DIR.DOWN)]).toBe(true);
    // LEFT from (5,3) → (4,3) walkable ✓
    expect(results[String(DIR.LEFT)]).toBe(true);
    // RIGHT from (5,3) → (6,3) walkable ✓
    expect(results[String(DIR.RIGHT)]).toBe(true);
  });
});

describe('isWalkable', () => {
  const map = makeTestMap(5, 5, [[2, 2]]);

  it('returns true for walkable tile', () => {
    expect(isWalkable(map, 0, 0)).toBe(true);
  });

  it('returns false for blocked tile', () => {
    expect(isWalkable(map, 2, 2)).toBe(false);
  });

  it('returns false for negative x', () => {
    expect(isWalkable(map, -1, 0)).toBe(false);
  });

  it('returns false for negative y', () => {
    expect(isWalkable(map, 0, -1)).toBe(false);
  });

  it('returns false for x >= width', () => {
    expect(isWalkable(map, 5, 0)).toBe(false);
  });

  it('returns false for y >= height', () => {
    expect(isWalkable(map, 0, 5)).toBe(false);
  });
});

describe('loadMap', () => {
  it('loads a valid map', () => {
    const data: MapData = {
      version: 1,
      width: 3,
      height: 3,
      collision: ['000', '010', '000'],
      spawns: [{ x: 0, y: 0 }],
      hotspots: [{ name: 'test', x: 2, y: 2 }],
    };
    const map = loadMap(data);
    expect(map.version).toBe(1);
    expect(map.width).toBe(3);
    expect(map.height).toBe(3);
    expect(map.collision[4]).toBe(1); // center tile blocked
    expect(map.collision[0]).toBe(0); // corner walkable
    expect(map.spawns).toHaveLength(1);
    expect(map.hotspots).toHaveLength(1);
  });

  it('throws on row count mismatch', () => {
    expect(() =>
      loadMap({ version: 1, width: 3, height: 3, collision: ['000', '000'], spawns: [], hotspots: [] })
    ).toThrow('2 rows, expected 3');
  });

  it('throws on column count mismatch', () => {
    expect(() =>
      loadMap({ version: 1, width: 3, height: 2, collision: ['00', '000'], spawns: [], hotspots: [] })
    ).toThrow('2 chars, expected 3');
  });
});
