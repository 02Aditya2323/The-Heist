import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { loadMap, isWalkable, sceneAt, type MapData } from '../map.js';
import { DIR } from '../constants.js';
import { tryStep } from '../movement.js';

const raw = JSON.parse(readFileSync(new URL('../../../../maps/art-world.json',import.meta.url),'utf8')) as MapData;
const map = loadMap(raw);

describe('Regenerated Veyra world', () => {
  it('contains six districts, seven connectors and reciprocal valid entrances', () => {
    expect(map.scenes?.filter(s=>s.kind==='district')).toHaveLength(6);
    expect(map.scenes?.filter(s=>s.kind==='connector')).toHaveLength(7);
    expect(map.exits).toHaveLength(44);
    for (const exit of map.exits!) {
      expect(isWalkable(map,exit.x,exit.y)).toBe(true);
      expect(isWalkable(map,exit.targetX,exit.targetY)).toBe(true);
      expect(map.exits!.some(other=>other.x===exit.targetX&&other.y===exit.targetY&&other.targetX===exit.x&&other.targetY===exit.y)).toBe(true);
    }
  });

  it('makes every authored terminal and gate reachable in its scene', () => {
    for (const scene of map.scenes!) {
      const markers=[...map.hotspots,...map.exits!].filter(p=>sceneAt(map,p.x,p.y)?.id===scene.id);
      const reached=new Set<string>(),queue=[{x:markers[0].x,y:markers[0].y}];
      for(let i=0;i<queue.length;i++) {
        const p=queue[i],key=`${p.x},${p.y}`;
        if(reached.has(key))continue;reached.add(key);
        for(const dir of [DIR.UP,DIR.DOWN,DIR.LEFT,DIR.RIGHT]) {
          const step=tryStep(map,p.x,p.y,dir);
          if(step.ok&&!reached.has(`${step.x},${step.y}`))queue.push({x:step.x,y:step.y});
        }
      }
      for(const marker of markers) expect(reached.has(`${marker.x},${marker.y}`),`${scene.id}: ${marker.name}`).toBe(true);
    }
  });

  it('retains blocked borders, water and the central bank footprint', () => {
    expect(isWalkable(map,0,0)).toBe(false);
    const central=map.scenes!.find(s=>s.id==='central')!,harbor=map.scenes!.find(s=>s.id==='harbor')!;
    expect(isWalkable(map,central.x+25,central.y+6)).toBe(false); // Bank roof
    expect(isWalkable(map,harbor.x+45,harbor.y+22)).toBe(false); // Harbor water
    for(const spawn of map.spawns)expect(isWalkable(map,spawn.x,spawn.y)).toBe(true);
  });

  it('uses the exact seven master-layout routes for both the atlas and gameplay exits',()=>{
    expect(map.routes?.filter(r=>r.connector).map(r=>`${r.id}:${r.from}:${r.to}`).sort()).toEqual([
      'c07:central:tech','c08:central:harbor','c09:central:black','c10:central:under',
      'c11:central:nexus','c12:tech:harbor','c13:under:black',
    ].sort());
    for(const route of map.routes!.filter(r=>r.connector)){
      const gates=map.exits!.filter(e=>e.id.startsWith(route.id+'-'));
      expect(gates).toHaveLength(4);
      const pairs=new Set(gates.map(e=>[sceneAt(map,e.x,e.y)!.id,sceneAt(map,e.targetX,e.targetY)!.id].sort().join(':')));
      expect([...pairs].sort()).toEqual([[route.from,route.connector].sort().join(':'),[route.connector,route.to].sort().join(':')].sort());
    }
    for(const a of map.scenes!)for(const b of map.scenes!){
      if(a===b)continue;
      expect(a.x+a.width<=b.x||b.x+b.width<=a.x||a.y+a.height<=b.y||b.y+b.height<=a.y).toBe(true);
    }
    const scene=(id:string)=>map.scenes!.find(s=>s.id===id)!;
    expect(scene('tech').y).toBeLessThan(scene('central').y);
    expect(scene('harbor').x).toBeGreaterThan(scene('central').x);
    expect(scene('nexus').x).toBeLessThan(scene('central').x);
    expect(scene('under').y).toBeGreaterThan(scene('central').y);
  });

  it('has no four-direction islands anywhere on approved ground',()=>{
    for(const scene of map.scenes!){
      const floor=[];
      for(let y=scene.y;y<scene.y+scene.height;y++)for(let x=scene.x;x<scene.x+scene.width;x++)if(isWalkable(map,x,y))floor.push({x,y});
      const seen=new Set<string>(),queue=[floor[0]];
      for(let i=0;i<queue.length;i++){
        const p=queue[i],key=`${p.x},${p.y}`;if(seen.has(key))continue;seen.add(key);
        for(const dir of [DIR.UP,DIR.DOWN,DIR.LEFT,DIR.RIGHT]){const next=tryStep(map,p.x,p.y,dir);if(next.ok&&!seen.has(`${next.x},${next.y}`))queue.push(next);}
      }
      expect(seen.size,scene.id).toBe(floor.length);
    }
  });

  it('blocks every reviewed footprint and agrees exactly with the offline collision masks',()=>{
    const masks=JSON.parse(readFileSync(new URL('../../../../maps/art-world-v2.collision.json',import.meta.url),'utf8'));
    const obstacles=JSON.parse(readFileSync(new URL('../../../../maps/art-world-v2.obstacles.json',import.meta.url),'utf8')).scenes as Record<string,{points:number[][]}[]>;
    const inside=(px:number,py:number,polygon:number[][])=>{
      let hit=false;
      for(let i=0,j=polygon.length-1;i<polygon.length;j=i++){
        const [ax,ay]=polygon[i],[bx,by]=polygon[j];
        if((ay>py)!==(by>py)&&px<(bx-ax)*(py-ay)/(by-ay)+ax)hit=!hit;
      }return hit;
    };
    for(const scene of map.scenes!)for(let y=0;y<scene.height;y++)for(let x=0;x<scene.width;x++){
      const open=isWalkable(map,scene.x+x,scene.y+y);
      expect(open).toBe(masks.scenes[scene.id][y][x]==='0');
      if((obstacles[scene.id]||[]).some(o=>inside((x+.5)*32,(y+.5)*32,o.points)))expect(open,`${scene.id} footprint ${x},${y}`).toBe(false);
    }
  });

  it('provides 90 distinct reachable Home sites across six linked Undercity wards',()=>{
    expect(map.scenes?.filter(s=>s.kind==='neighborhood')).toHaveLength(6);
    expect(map.homePlots).toHaveLength(90);
    expect(new Set(map.homePlots!.map(h=>h.id)).size).toBe(90);
    expect(new Set(map.homePlots!.map(h=>`${h.x},${h.y}`)).size).toBe(90);
    expect(map.hotspots).toHaveLength(124);
    for(const h of map.homePlots!){expect(sceneAt(map,h.x,h.y)?.parentId).toBe('under');expect(map.hotspots.some(s=>s.id===h.id&&s.x===h.x&&s.y===h.y)).toBe(true);}
    const reached=new Set(['under']);
    for(let i=0;i<7;i++)for(const route of map.routes!.filter(r=>!r.connector))if(reached.has(route.from)||reached.has(route.to)){reached.add(route.from);reached.add(route.to);}
    for(const s of map.scenes!.filter(s=>s.kind==='neighborhood'))expect(reached.has(s.id)).toBe(true);
    for(const route of map.routes!.filter(r=>!r.connector))expect(map.exits!.filter(e=>e.id.startsWith(route.id+'-'))).toHaveLength(2);
  });
});
