/**
 * Tests for chunk math and AoI diffing.
 * Spec requirement: unit tests for chunk neighbours.
 */
import { describe, it, expect } from 'vitest';
import {
  chunkOf, chunkKey, chunkFromKey,
  neighbours3x3, neighbours3x3Coords,
  chunkSetDiff, aoiDiff, sameChunk,
} from '../index.js';

describe('chunkOf', () => {
  it('maps tile (0,0) to chunk (0,0)', () => {
    expect(chunkOf(0, 0)).toEqual({ cx: 0, cy: 0 });
  });

  it('maps tile (15,15) to chunk (0,0) with chunk size 16', () => {
    expect(chunkOf(15, 15, 16)).toEqual({ cx: 0, cy: 0 });
  });

  it('maps tile (16,0) to chunk (1,0)', () => {
    expect(chunkOf(16, 0, 16)).toEqual({ cx: 1, cy: 0 });
  });

  it('maps tile (16,16) to chunk (1,1)', () => {
    expect(chunkOf(16, 16, 16)).toEqual({ cx: 1, cy: 1 });
  });

  it('maps tile (255,255) to chunk (15,15) for a 256x256 map', () => {
    expect(chunkOf(255, 255, 16)).toEqual({ cx: 15, cy: 15 });
  });

  it('maps tile (31,47) correctly', () => {
    // 31 >> 4 = 1, 47 >> 4 = 2
    expect(chunkOf(31, 47, 16)).toEqual({ cx: 1, cy: 2 });
  });

  it('maps tile (32,48) correctly', () => {
    // 32 >> 4 = 2, 48 >> 4 = 3
    expect(chunkOf(32, 48, 16)).toEqual({ cx: 2, cy: 3 });
  });
});

describe('chunkKey / chunkFromKey', () => {
  it('round-trips (0,0)', () => {
    const key = chunkKey(0, 0);
    expect(chunkFromKey(key)).toEqual({ cx: 0, cy: 0 });
  });

  it('round-trips (15,15)', () => {
    const key = chunkKey(15, 15);
    expect(chunkFromKey(key)).toEqual({ cx: 15, cy: 15 });
  });

  it('round-trips (0,15)', () => {
    const key = chunkKey(0, 15);
    expect(chunkFromKey(key)).toEqual({ cx: 0, cy: 15 });
  });

  it('different chunks produce different keys', () => {
    const k1 = chunkKey(0, 0);
    const k2 = chunkKey(1, 0);
    const k3 = chunkKey(0, 1);
    expect(k1).not.toBe(k2);
    expect(k1).not.toBe(k3);
    expect(k2).not.toBe(k3);
  });

  it('round-trips negative chunk coords (theoretical)', () => {
    const key = chunkKey(-1, -1);
    expect(chunkFromKey(key)).toEqual({ cx: -1, cy: -1 });
  });
});

describe('neighbours3x3', () => {
  it('returns 9 chunk keys', () => {
    const keys = neighbours3x3(5, 5);
    expect(keys).toHaveLength(9);
  });

  it('includes the center chunk', () => {
    const keys = neighbours3x3(5, 5);
    expect(keys).toContain(chunkKey(5, 5));
  });

  it('includes all 8 surrounding chunks', () => {
    const keys = neighbours3x3(5, 5);
    for (let dy = -1; dy <= 1; dy++) {
      for (let dx = -1; dx <= 1; dx++) {
        expect(keys).toContain(chunkKey(5 + dx, 5 + dy));
      }
    }
  });

  it('returns unique keys', () => {
    const keys = neighbours3x3(5, 5);
    expect(new Set(keys).size).toBe(9);
  });
});

describe('neighbours3x3Coords', () => {
  it('returns 9 ChunkCoord objects', () => {
    const coords = neighbours3x3Coords(3, 3);
    expect(coords).toHaveLength(9);
  });

  it('includes the center', () => {
    const coords = neighbours3x3Coords(3, 3);
    expect(coords).toContainEqual({ cx: 3, cy: 3 });
  });
});

describe('chunkSetDiff', () => {
  it('returns elements in a but not b', () => {
    const a = [1, 2, 3, 4, 5];
    const b = [3, 4, 5, 6, 7];
    expect(chunkSetDiff(a, b)).toEqual([1, 2]);
  });

  it('returns empty when a is subset of b', () => {
    expect(chunkSetDiff([1, 2], [1, 2, 3])).toEqual([]);
  });

  it('returns all of a when b is empty', () => {
    expect(chunkSetDiff([1, 2, 3], [])).toEqual([1, 2, 3]);
  });
});

describe('aoiDiff', () => {
  it('returns empty diffs when chunk does not change', () => {
    const diff = aoiDiff(5, 5, 5, 5);
    expect(diff.left).toHaveLength(0);
    expect(diff.entered).toHaveLength(0);
    expect(diff.stayed).toHaveLength(9);
  });

  it('moving one chunk right produces correct diff', () => {
    const diff = aoiDiff(5, 5, 6, 5);
    // Moving right: old watch includes x=4..6, new watch includes x=5..7
    // Left: chunks at x=4 (that aren't in new watch)
    // Entered: chunks at x=7 (that weren't in old watch)
    // Stayed: chunks at x=5..6

    // Verify counts
    expect(diff.left.length).toBeGreaterThan(0);
    expect(diff.entered.length).toBeGreaterThan(0);
    expect(diff.stayed.length).toBeGreaterThan(0);

    // left + stayed = old watch (9)
    expect(diff.left.length + diff.stayed.length).toBe(9);
    // entered + stayed = new watch (9)
    expect(diff.entered.length + diff.stayed.length).toBe(9);

    // For a 1-chunk move, should be 3 left, 3 entered, 6 stayed
    expect(diff.left).toHaveLength(3);
    expect(diff.entered).toHaveLength(3);
    expect(diff.stayed).toHaveLength(6);
  });

  it('moving diagonally produces correct diff', () => {
    const diff = aoiDiff(5, 5, 6, 6);
    // Diagonal move: more chunks change
    // left + stayed = 9, entered + stayed = 9
    expect(diff.left.length + diff.stayed.length).toBe(9);
    expect(diff.entered.length + diff.stayed.length).toBe(9);

    // For a diagonal 1-chunk move: 5 left, 5 entered, 4 stayed
    expect(diff.left).toHaveLength(5);
    expect(diff.entered).toHaveLength(5);
    expect(diff.stayed).toHaveLength(4);
  });

  it('moving two chunks away replaces all watched chunks', () => {
    const diff = aoiDiff(0, 0, 3, 0);
    // 3 chunks apart — no overlap in 3x3 neighbourhoods
    expect(diff.left).toHaveLength(9);
    expect(diff.entered).toHaveLength(9);
    expect(diff.stayed).toHaveLength(0);
  });

  it('left and entered sets are disjoint', () => {
    const diff = aoiDiff(5, 5, 6, 5);
    const leftSet = new Set(diff.left);
    const enteredSet = new Set(diff.entered);
    for (const k of diff.left) {
      expect(enteredSet.has(k)).toBe(false);
    }
    for (const k of diff.entered) {
      expect(leftSet.has(k)).toBe(false);
    }
  });

  it('stayed set does not overlap with left or entered', () => {
    const diff = aoiDiff(5, 5, 6, 6);
    const stayedSet = new Set(diff.stayed);
    for (const k of diff.left) {
      expect(stayedSet.has(k)).toBe(false);
    }
    for (const k of diff.entered) {
      expect(stayedSet.has(k)).toBe(false);
    }
  });
});

describe('sameChunk', () => {
  it('returns true for same coords', () => {
    expect(sameChunk({ cx: 3, cy: 5 }, { cx: 3, cy: 5 })).toBe(true);
  });

  it('returns false for different coords', () => {
    expect(sameChunk({ cx: 3, cy: 5 }, { cx: 3, cy: 6 })).toBe(false);
  });
});
