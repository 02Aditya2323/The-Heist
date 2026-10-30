import { readFileSync, writeFileSync, mkdirSync, copyFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { createHash } from 'node:crypto';
import { loadMap, isWalkable, type MapData, type ArtScene, type DistrictExit, type CityRoute } from '@heist/shared';
import { labelGameplayCentres } from '../apps/server/src/game/world-labels.js';

interface SceneSource { id:string; name:string; kind:ArtScene['kind']; parentId?:string; asset?:string; foregroundRects?:ArtScene['foregroundRects']; origin:[number,number]; color:string; source:string; focus:[number,number]; routes:{points:[number,number][];radius:number}[];objects:{id:string;name:string;point:[number,number];action:string;description:string;homeAddress?:string}[] }
interface Layout { version:number;tileSize:number;sceneWidth:number;sceneHeight:number;sourceRoot?:string;assetPrefix?:string;spawnPoint?:[number,number];scenes:SceneSource[];links:{a:string;pointA:[number,number];connector:string;start:[number,number];end:[number,number];b:string;pointB:[number,number]}[];streets?:{id:string;a:string;pointA:[number,number];b:string;pointB:[number,number]}[] }
const root=resolve(import.meta.dirname,'..');
const prefix=process.argv.includes('--v2')?'art-world-v2':'art-world';
const layout=JSON.parse(readFileSync(resolve(root,`maps/${prefix}.layout.json`),'utf8')) as Layout;
const tile=layout.tileSize;
const width=Math.max(...layout.scenes.map(s=>s.origin[0]+layout.sceneWidth))+1;
const height=Math.max(...layout.scenes.map(s=>s.origin[1]+layout.sceneHeight))+1;
const grid=Array.from({length:height},()=>Array<number>(width).fill(1));
const assets=resolve(root,'apps/client/public/art/scenes');mkdirSync(assets,{recursive:true});
const assetName=(s:SceneSource)=>`${layout.assetPrefix||''}${s.asset||s.id}`;
const sourcePath=(s:SceneSource)=>resolve(root,layout.sourceRoot||'THE_HEIST_ZERO_HOUR_Visual_Reference_Pack',s.source);
const sha=(path:string)=>createHash('sha256').update(readFileSync(path)).digest('hex');
const transportPath=resolve(root,prefix==='art-world-v2'?'maps/art-transport-report-v2.json':'maps/art-transport-report.json');
const transport=existsSync(transportPath)?JSON.parse(readFileSync(transportPath,'utf8')):[];
function verifiedWebp(s:SceneSource):boolean{
  const name=assetName(s),path=resolve(assets,`${name}.webp`),record=transport.find((r:any)=>r.asset===name);
  return existsSync(path)&&!!record?.identicalDecodedPixels&&record.sourceSha256===sha(sourcePath(s))&&record.webpSha256===sha(path);
}
const scenes:ArtScene[]=layout.scenes.map(s=>({id:s.id,name:s.name,kind:s.kind,...(s.parentId?{parentId:s.parentId}:{}),...(s.foregroundRects?{foregroundRects:s.foregroundRects}:{}),x:s.origin[0],y:s.origin[1],width:layout.sceneWidth,height:layout.sceneHeight,image:`/art/scenes/${assetName(s)}.${verifiedWebp(s)?'webp':'png'}?rev=${sha(sourcePath(s)).slice(0,16)}`,previewImage:`/art/scenes/${assetName(s)}-preview.webp?rev=${sha(sourcePath(s)).slice(0,16)}`,color:s.color}));
// Collision is authored against native artwork by the offline OpenCV review pipeline.
// Refuse stale masks; never silently return to the old unreviewed corridor rasterizer.
const collision=JSON.parse(readFileSync(resolve(root,`maps/${prefix}.collision.json`),'utf8')) as {version:number;sourceHash:string;scenes:Record<string,string[]>};
const sourceImageHashes=Object.fromEntries([...layout.scenes].sort((a,b)=>a.id<b.id?-1:1).map(s=>[s.id,sha(sourcePath(s))]));
const sourceHash=createHash('sha256').update(readFileSync(resolve(root,`maps/${prefix}.layout.json`))).update(readFileSync(resolve(root,`maps/${prefix}.obstacles.json`))).update(JSON.stringify(sourceImageHashes)).digest('hex');
if(collision.version!==layout.version||collision.sourceHash!==sourceHash)throw new Error('Stale collision review: run tools/analyze-world-collision.py before building the world.');
for(const s of layout.scenes){
  const source=resolve(root,layout.sourceRoot||'THE_HEIST_ZERO_HOUR_Visual_Reference_Pack',s.source),destination=resolve(assets,`${assetName(s)}.png`);
  if(!existsSync(destination)||!readFileSync(source).equals(readFileSync(destination)))copyFileSync(source,destination);
  const rows=collision.scenes[s.id];
  if(rows?.length!==layout.sceneHeight||rows.some(r=>r.length!==layout.sceneWidth||/[^01]/.test(r)))throw new Error(`Invalid collision mask: ${s.id}`);
  rows.forEach((row,y)=>[...row].forEach((v,x)=>grid[s.origin[1]+y][s.origin[0]+x]=Number(v)));
}
const byId=(id:string)=>{const s=layout.scenes.find(s=>s.id===id);if(!s)throw new Error(`Unknown scene ${id}`);return s;};
const point=(id:string,p:[number,number])=>{const s=byId(id);return {x:s.origin[0]+Math.floor(p[0]/tile),y:s.origin[1]+Math.floor(p[1]/tile)};};
const exits:DistrictExit[]=[];
for(const l of layout.links){const a=point(l.a,l.pointA),start=point(l.connector,l.start),end=point(l.connector,l.end),b=point(l.b,l.pointB);
  for(const [id,name,from,to] of [[`${l.connector}-from-a`,`To ${byId(l.connector).name}`,a,start],[`${l.connector}-back-a`,`To ${byId(l.a).name}`,start,a],[`${l.connector}-to-b`,`To ${byId(l.b).name}`,end,b],[`${l.connector}-back-b`,`To ${byId(l.connector).name}`,b,end]] as const)exits.push({id,name,...from,targetX:to.x,targetY:to.y,radius:2});
}
for(const l of layout.streets||[]){
  const a=point(l.a,l.pointA),b=point(l.b,l.pointB);
  exits.push({id:`${l.id}-from-a`,name:`To ${byId(l.b).name}`,...a,targetX:b.x,targetY:b.y,radius:2},
    {id:`${l.id}-back-b`,name:`To ${byId(l.a).name}`,...b,targetX:a.x,targetY:a.y,radius:2});
}
const hotspots=labelGameplayCentres(layout.scenes.flatMap(s=>s.objects.map(o=>({...point(s.id,o.point),id:o.id,name:o.name,action:o.action,description:o.description}))));
const spawn=point('central',layout.spawnPoint||[832,616]);
const routes:CityRoute[]=[...layout.links.map(l=>({id:l.connector,from:l.a,connector:l.connector,to:l.b})),...(layout.streets||[]).map(l=>({id:l.id,from:l.a,to:l.b}))];
const homePlots=layout.scenes.flatMap(s=>s.objects.filter(o=>o.homeAddress).map(o=>({...point(s.id,o.point),id:o.id,address:o.homeAddress!,sceneId:s.id})));
const data:MapData={version:layout.version,width,height,tileSize:tile,scenes,exits,routes,...(homePlots.length?{homePlots}:{}),collision:grid.map(row=>row.join('')),spawns:[spawn,{x:spawn.x-1,y:spawn.y},{x:spawn.x+1,y:spawn.y}],hotspots};
const parsed=loadMap(data);
const blocked=[...hotspots,...data.spawns,...exits,...exits.map(e=>({id:`${e.id} destination`,x:e.targetX,y:e.targetY}))].filter(p=>!isWalkable(parsed,p.x,p.y));
if(blocked.length)throw new Error(`Blocked markers: ${JSON.stringify(blocked)}`);
writeFileSync(resolve(root,'maps/art-world.json'),JSON.stringify(data,null,2)+'\n');
writeFileSync(resolve(root,'apps/client/public/art/world.json'),JSON.stringify(data)+'\n');
console.log(`City world v${layout.version}: ${scenes.length} panels, ${exits.length} directed gates, ${hotspots.length} interaction points. ${width}×${height} tiles.`);
