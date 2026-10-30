import { readFileSync, existsSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
const read=(p:string)=>JSON.parse(readFileSync(p,'utf8'));
const map=read('maps/art-world.json'),preview=read('apps/client/public/art/world.json'),live=await(await fetch('http://localhost:8080/api/map')).json();
if(JSON.stringify(map)!==JSON.stringify(preview)||JSON.stringify(map)!==JSON.stringify(live))throw new Error('Client, server and authoring output disagree');
const layout=read('maps/art-world-v2.layout.json'),encoding=read('maps/art-transport-report-v2.json');
const assets=[...new Set(layout.scenes.map((s:any)=>s.source))] as string[];
for(const s of map.scenes){if(!existsSync('apps/client/public'+s.image.split('?')[0])||!existsSync('apps/client/public'+s.previewImage.split('?')[0]))throw new Error(`Missing art ${s.id}`);}
const sourceAssets=assets.map(path=>({path,bytes:readFileSync(path).length,sha256:createHash('sha256').update(readFileSync(path)).digest('hex')}));
const report={mapVersion:map.version,serverClientMapIdentical:true,mainDistricts:6,connectors:7,residentialWards:6,homeSites:map.homePlots.length,interactionLocations:map.hotspots.length,travelDirections:map.exits.length,
  sourceAssets,encoding,collisionReport:'maps/art-world-v2.collision-report.json',entranceReview:'maps/art-world-v2.entrance-adjustments.json',prompts:'docs/generated-world-v2/generation-prompts.json',housingPrompt:'docs/generated-world-v2/housing-prompt.txt',generationMode:'Built-in image generation; original references used for style, separate geometry guides used for layout.'};
writeFileSync('docs/world-building-audit.json',JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify({version:map.version,assets:sourceAssets.length,serverClientMapIdentical:true,poiCount:map.hotspots.length,homes:map.homePlots.length}));
