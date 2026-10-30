import { expect, it } from 'vitest';
import { EventEngine } from '../game/event-engine.js';
import { loadMap } from '@heist/shared';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
const engine=()=>new EventEngine(':memory:',loadMap(JSON.parse(readFileSync(resolve('../../maps/art-world.json'),'utf8'))));
it('never publishes uncommitted Mongo changes to readers and rolls back on failure',async()=>{
  const game=engine();let resolveCommit!:(v?:unknown)=>void;const pending=new Promise(resolve=>{resolveCommit=resolve;});
  try{const action=game.stage(()=>game.ensurePlayer('player','TestPlayer'),async()=>{await pending;throw new Error('Mongo unavailable');});expect(game.roster()).toHaveLength(0);resolveCommit();await expect(action).rejects.toThrow('Mongo unavailable');expect(game.roster()).toHaveLength(0);expect(game.audit().ok).toBe(true);}finally{game.close();}
});
it('commits ledger and state together and can hydrate a new scratch engine',async()=>{
  const game=engine(),restarted=engine();let saved:any;
  try{await game.stage(()=>{game.ensurePlayer('player','TestPlayer');game.start();},async data=>{saved=data;expect(game.adminView().phase).toBe('lobby');});expect(game.adminView().phase).toBe('live');restarted.importPersistence(saved);expect(restarted.roster()).toHaveLength(1);expect(restarted.audit().ok).toBe(true);expect(restarted.eventKey()).toBe(game.eventKey());}finally{game.close();restarted.close();}
});
