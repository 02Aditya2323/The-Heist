/**
 * Deterministic integer and float hashing based on coordinates and map version.
 * Absolutely no Math.random() is permitted for world generation.
 */

export function hash2D(x: number, y: number, seed = 0): number {
  let h = (seed ^ (Math.imul(x, 374761393) ^ Math.imul(y, 668265263))) >>> 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return (h ^ (h >>> 16)) >>> 0;
}

export function hashFloat(x: number, y: number, seed = 0): number {
  return (hash2D(x, y, seed) >>> 0) / 4294967296;
}

export function hashInt(x: number, y: number, min: number, max: number, seed = 0): number {
  const f = hashFloat(x, y, seed);
  return min + Math.floor(f * (max - min + 1));
}

export function hashChoice<T>(x: number, y: number, options: readonly T[], seed = 0): T {
  const idx = hashInt(x, y, 0, options.length - 1, seed);
  return options[idx];
}
