import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { DIR } from '@heist/shared';
import { operatorFrame, operatorRow } from '../apps/client/src/render/operator-sprite.js';
assert.deepEqual([DIR.DOWN,DIR.UP,DIR.RIGHT,DIR.LEFT].map(operatorRow),[0,1,2,3]);
assert.deepEqual([0,1].flatMap(parity=>[0,.25,.5,.75].map(p=>operatorFrame(p,true,parity))),[2,3,4,5,6,7,8,9]);
assert.equal(operatorFrame(.5,false,1),0);
// A tile boundary advances into the next foot's poses, rather than replaying it.
assert.equal(operatorFrame(.999,true,0)+1,operatorFrame(0,true,1));
for(const parity of [0,1])for(const phase of [-1,0,.25,.5,.99,1,2])assert.ok([2,3,4,5,6,7,8,9].includes(operatorFrame(phase,true,parity)));
const sheet=readFileSync(new URL('../apps/client/public/art/operators/operator-sheet.svg',import.meta.url),'utf8');
assert.ok(sheet.includes('width="480" height="256"'));assert.equal((sheet.match(/data-frame=/g)||[]).length,40);
console.log('PASS: all four shared facings, alternating eight-frame gait, continuous tile-boundary phase, idle, frame bounds and 40-cell atlas.');
