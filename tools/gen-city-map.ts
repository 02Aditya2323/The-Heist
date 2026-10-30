/** Builds the canonical Veyra City blockout from the master-layout composition. */
import { writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

const width = 200, height = 140;
const grid = Array.from({ length: height }, (_, y) => Array.from({ length: width }, (_, x) => x === 0 || y === 0 || x === width - 1 || y === height - 1 ? 1 : 0));
const clear = (x: number, y: number, w: number, h: number) => { for (let yy = y; yy < y + h; yy++) for (let xx = x; xx < x + w; xx++) if (xx > 0 && yy > 0 && xx < width - 1 && yy < height - 1) grid[yy][xx] = 0; };
const block = (x: number, y: number, w: number, h: number) => { for (let yy = y; yy < y + h; yy++) for (let xx = x; xx < x + w; xx++) if (xx > 0 && yy > 0 && xx < width - 1 && yy < height - 1) grid[yy][xx] = 1; };

// Broad arterial routes and the central Exchange plaza.
clear(8, 64, 184, 12); clear(94, 8, 14, 124); clear(74, 48, 54, 54);
clear(62, 24, 42, 8); clear(104, 24, 42, 8); clear(45, 76, 54, 8); clear(106, 76, 52, 8); clear(118, 96, 8, 35); clear(57, 100, 8, 31);

// District blocks: positioned from the master layout, each separated by player lanes.
for (const [x, y, w, h] of [[10,10,20,16],[37,10,20,16],[10,35,20,18],[38,36,22,17],[118,10,22,17],[150,10,33,17],[118,36,24,17],[151,36,32,17],[12,88,18,17],[37,88,20,17],[12,112,18,17],[37,113,20,16],[140,88,18,17],[166,88,23,17],[140,113,18,16],[166,113,23,16],[68,110,20,17],[91,110,20,17]] as const) block(x,y,w,h);

// Landmark forecourts and every named interaction standing zone remain explicitly walkable.
const hotspots = [
  ['Tech Job Board', 34, 30], ['Logic Lab', 62, 30], ['Harbor Job Board', 146, 30], ['Dock Terminal', 114, 58],
  ['Central Bank', 100, 61], ['Raid Circle', 100, 84], ['Race Terminal', 116, 74], ['Checkout', 83, 74],
  ['NEXUS Board', 40, 76], ['Golden Hour Gate', 56, 83], ['Black Grid Board', 158, 76], ['Cipher Market', 179, 84],
  ['Home Lane', 65, 108], ['Safehouse Row', 112, 108], ['Undercity Jobs', 91, 101], ['City Gate', 194, 70]
] as const;
for (const [, x, y] of hotspots) clear(x - 2, y - 2, 5, 5);

const data = { version: 6, width, height, collision: grid.map(row => row.join('')), spawns: [{ x: 100, y: 80 }, { x: 94, y: 80 }, { x: 106, y: 80 }], hotspots: hotspots.map(([name, x, y]) => ({ name, x, y })) };
for (const target of ['map.json', 'maps/dev-map.json']) writeFileSync(resolve(process.cwd(), target), JSON.stringify(data, null, 2) + '\n');
console.log(`Generated Veyra City ${width}x${height}: ${hotspots.length} interactive landmarks.`);
