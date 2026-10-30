import { describe, it, expect } from 'vitest';
import { loadMap, decodeS2CFrame, DIR, S2C, type MapData } from '@heist/shared';
import { loadConfig } from '../config.js';
import { World } from '../world/world.js';
import { handleWorldAction } from '../world/interactions.js';
import { ConnectionManager, type ClientConnection } from '../net/connection.js';

function setup() {
  const raw:MapData={version:20,width:128,height:32,collision:Array(32).fill('0'.repeat(128)),spawns:[{x:5,y:5}],
    hotspots:[{id:'board',name:'Job Board',x:6,y:5,description:'CP and logic jobs',action:'jobs'}],
    scenes:[{id:'a',name:'A',x:0,y:0,width:32,height:32,kind:'district',image:'a',color:'#fff'},{id:'b',name:'B',x:64,y:0,width:32,height:32,kind:'district',image:'b',color:'#fff'}],
    exits:[{id:'gate',name:'To B',x:5,y:5,targetX:69,targetY:5,radius:2}]};
  const world=new World(loadMap(raw),raw,loadConfig()),connections=new ConnectionManager();
  const entity=world.createOrResumeEntity('one','one');
  const conn={entityId:entity.id,playerId:entity.playerId,outbox:[]} as unknown as ClientConnection;
  connections.add(conn);
  const messages=()=>conn.outbox.flatMap(packet=>decodeS2CFrame(packet));
  return {world,connections,entity,conn,messages};
}

describe('Server-validated original-art map interactions',()=>{
  it('keeps an exact-coordinate terminal and gate separately addressable',()=>{
    const {world,connections,conn,entity,messages}=setup();world.map.hotspots[0].x=entity.x;world.map.hotspots[0].y=entity.y;
    handleWorldAction(world,connections,conn,JSON.stringify({type:'interact',id:'board'}));
    expect(messages().some(m=>m?.opcode===S2C.JSON&&JSON.parse(m.payload).type==='interaction')).toBe(true);expect(entity.x).toBe(5);
    handleWorldAction(world,connections,conn,JSON.stringify({type:'interact',id:'gate'}));expect(entity.x).toBe(69);expect(messages().some(m=>m?.opcode===S2C.ENTITY_TELEPORT)).toBe(true);
  });
  it('opens a nearby terminal and does not mutate economy state',()=>{
    const {world,connections,conn,entity,messages}=setup(); const before={...entity.data};
    handleWorldAction(world,connections,conn,JSON.stringify({type:'interact',id:'board'}));
    expect(messages().some(m=>m?.opcode===S2C.JSON&&JSON.parse(m.payload).type==='interaction')).toBe(true);
    expect(entity.data).toEqual(before);
  });
  it('rejects remote interaction even when client submits forged coordinates',()=>{
    const {world,connections,conn,entity,messages}=setup();entity.x=25;
    handleWorldAction(world,connections,conn,JSON.stringify({type:'interact',id:'board',x:6,y:5}));
    expect(messages().some(m=>m?.opcode===S2C.JSON&&JSON.parse(m.payload).type==='action_error')).toBe(true);
    expect(entity.x).toBe(25);
  });
  it('teleports through an authored gate, clears movement and updates both AOI views',()=>{
    const {world,connections,conn,entity,messages}=setup();
    const old=world.createOrResumeEntity('old','old'),fresh=world.createOrResumeEntity('new','new');
    world.chunkGrid.remove(fresh);fresh.x=69;fresh.chunk={cx:4,cy:0};world.chunkGrid.add(fresh);
    const oldConn={entityId:old.id,playerId:old.playerId,outbox:[]} as unknown as ClientConnection;
    const freshConn={entityId:fresh.id,playerId:fresh.playerId,outbox:[]} as unknown as ClientConnection;
    connections.add(oldConn);connections.add(freshConn);
    world.queueMove(entity.id,1,DIR.RIGHT);
    handleWorldAction(world,connections,conn,JSON.stringify({type:'interact',id:'gate'}));
    expect(entity.x).toBe(69);expect(entity.chunk.cx).toBe(4);expect(entity.pending).toHaveLength(0);
    expect(messages().some(m=>m?.opcode===S2C.ENTITY_TELEPORT&&m.id===entity.id)).toBe(true);
    expect(oldConn.outbox.flatMap(p=>decodeS2CFrame(p)).some(m=>m?.opcode===S2C.ENTITY_LEAVE&&m.id===entity.id)).toBe(true);
    expect(freshConn.outbox.flatMap(p=>decodeS2CFrame(p)).some(m=>m?.opcode===S2C.ENTITY_ENTER&&m.id===entity.id)).toBe(true);
  });
  it('allows 12 operators to share a standing area without rigid player collision',()=>{
    const {world}=setup();for(let i=0;i<11;i++)world.createOrResumeEntity(`peer-${i}`,`peer-${i}`);
    const first=Array.from(world.getAllEntities())[0];expect(world.getVisibleEntities(first)).toHaveLength(12);
    expect(world.queueMove(first.id,1,DIR.RIGHT)).toBe(true);
  });
});
