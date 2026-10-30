/** Place planned entrance standing points onto nearby CV-reviewed floor, never open walls. */
import { readFileSync, writeFileSync } from 'node:fs';
import { loadMap, isWalkable } from '@heist/shared';
const file='maps/art-world-v2.layout.json';
const layout=JSON.parse(readFileSync(file,'utf8')),masks=JSON.parse(readFileSync('maps/art-world-v2.collision.json','utf8'));
const audit:unknown[]=[];
function resolvePoint(id:string,sceneId:string,p:number[]):number[]{
  const rows=masks.scenes[sceneId];if(!rows)throw new Error(`Missing CV scene ${sceneId}`);
  const map=loadMap({version:layout.version,width:layout.sceneWidth,height:layout.sceneHeight,collision:rows,hotspots:[],spawns:[]});
  const x=Math.floor(p[0]/32),y=Math.floor(p[1]/32);
  if(isWalkable(map,x,y))return p;
  const choices=[];
  for(let dy=-4;dy<=4;dy++)for(let dx=-4;dx<=4;dx++)if(Math.hypot(dx,dy)<=4&&isWalkable(map,x+dx,y+dy))choices.push({x:x+dx,y:y+dy,dist:Math.hypot(dx,dy)});
  choices.sort((a,b)=>a.dist-b.dist||a.y-b.y||a.x-b.x);
  if(!choices.length)throw new Error(`No safe nearby entrance floor: ${id}`);
  const target=choices[0],point=[target.x*32+16,target.y*32+16];
  audit.push({id,scene:sceneId,planned:p,reviewedFloorPoint:point,offsetTiles:target.dist});return point;
}
for(const link of layout.links){
  link.pointA=resolvePoint(`${link.connector}-from-a`,link.a,link.pointA);
  link.start=resolvePoint(`${link.connector}-back-a`,link.connector,link.start);
  link.end=resolvePoint(`${link.connector}-to-b`,link.connector,link.end);
  link.pointB=resolvePoint(`${link.connector}-back-b`,link.b,link.pointB);
}
for(const street of layout.streets){
  street.pointA=resolvePoint(`${street.id}-from-a`,street.a,street.pointA);
  street.pointB=resolvePoint(`${street.id}-back-b`,street.b,street.pointB);
}
writeFileSync(file,JSON.stringify(layout,null,2)+'\n');
writeFileSync('maps/art-world-v2.entrance-adjustments.json',JSON.stringify({version:layout.version,note:'Standing markers moved only onto already approved nearby floor; collision unchanged.',adjustments:audit},null,2)+'\n');
console.log(JSON.stringify(audit,null,2));
