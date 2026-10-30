/** Real HTTP/WS city tour: no debug teleport, custom codecs or hardcoded cadence. */
import { WebSocket } from 'ws';
import { writeFileSync } from 'node:fs';
import { decodeS2CFrame, encodeC2SJson, encodeMove, encodePing, loadMap, findPath, pathToDirections, sceneAt, S2C, type Direction } from '@heist/shared';
const base='http://localhost:8080',map=loadMap(await(await fetch(`${base}/api/map`)).json());
const auth=await(await fetch(`${base}/api/register`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({username:`worldqa_${Date.now().toString(36)}`,password:'Local-QA-only-123'})})).json();
const ws=new WebSocket(`ws://localhost:8080/ws?token=${encodeURIComponent(auth.token)}`),packets:any[]=[];
ws.on('message',data=>packets.push(...decodeS2CFrame(new Uint8Array(data as Buffer))));
const sleep=(ms:number)=>new Promise(resolve=>setTimeout(resolve,ms));
async function wait(check:()=>boolean){const deadline=Date.now()+8000;while(!check()){if(Date.now()>deadline)throw new Error('Timed out waiting for server');await sleep(10);}}
const ping=setInterval(()=>{if(ws.readyState===WebSocket.OPEN)ws.send(encodePing(performance.now()|0));},2500);
let x=0,y=0,seq=0,duration=0,teleports=0;const visited=new Set<string>(),routes=new Set<string>(),inspected=new Set<string>();
async function walk(tx:number,ty:number){
  const path=findPath(map,x,y,tx,ty);if(!path)throw new Error(`No path ${x},${y} → ${tx},${ty}`);
  for(const dir of pathToDirections(x,y,path)){
    const nextSeq=++seq,before=performance.now();ws.send(encodeMove(nextSeq,dir as Direction));
    await wait(()=>packets.some(p=>(p.opcode===S2C.MOVE_ACK||p.opcode===S2C.MOVE_REJECT)&&p.seq===nextSeq));
    const ack=packets.find(p=>(p.opcode===S2C.MOVE_ACK||p.opcode===S2C.MOVE_REJECT)&&p.seq===nextSeq);
    if(ack.opcode!==S2C.MOVE_ACK)throw new Error(`Movement rejected at ${x},${y}`);
    x=ack.x;y=ack.y;await sleep(Math.max(0,duration+15-(performance.now()-before)));
  }
}
async function travel(id:string){
  const gate=map.exits!.find(e=>e.id===id)!;await walk(gate.x,gate.y);
  const start=packets.length;ws.send(encodeC2SJson(JSON.stringify({type:'interact',id})));
  await wait(()=>packets.slice(start).some(p=>p.opcode===S2C.ENTITY_TELEPORT&&p.x===gate.targetX&&p.y===gate.targetY));
  x=gate.targetX;y=gate.targetY;teleports++;visited.add(sceneAt(map,x,y)!.id);
}
async function landmarks(){
  const current=sceneAt(map,x,y)!;
  const remaining=map.hotspots.filter(h=>sceneAt(map,h.x,h.y)?.id===current.id&&!inspected.has(h.id));
  while(remaining.length){
    remaining.sort((a,b)=>Math.abs(a.x-x)+Math.abs(a.y-y)-Math.abs(b.x-x)-Math.abs(b.y-y));
    const marker=remaining.shift()!;await walk(marker.x,marker.y);const start=packets.length;
    ws.send(encodeC2SJson(JSON.stringify({type:'interact',id:marker.id})));
    await wait(()=>packets.slice(start).some(p=>p.opcode===S2C.JSON&&JSON.parse(p.payload).id===marker.id));inspected.add(marker.id);
  }
  console.log(`${current.name}: landmarks inspected ${inspected.size}, movement steps ${seq}`);
}
try{
  await wait(()=>packets.some(p=>p.opcode===S2C.WELCOME));const welcome=packets.find(p=>p.opcode===S2C.WELCOME);
  x=welcome.x;y=welcome.y;duration=welcome.stepTicks/welcome.tickRate*1000;visited.add(sceneAt(map,x,y)!.id);
  await landmarks();
  for(const [id,forward] of [['c11',true],['c11',false],['c07',true],['c12',true],['c08',false],['c09',true],['c13',false],['c10',false]] as const){
    await travel(`${id}-${forward?'from-a':'back-b'}`);await landmarks();await travel(`${id}-${forward?'to-b':'back-a'}`);routes.add(id);await landmarks();
    if(sceneAt(map,x,y)?.id==='under'&&map.homePlots?.length){
      await travel('homes-entry-from-a');await landmarks();
      for(const gate of ['homes-a-b-back-b','homes-a-d-from-a','homes-d-e-from-a','homes-e-f-from-a','homes-c-f-back-b','homes-b-c-back-b','homes-b-e-from-a','homes-b-e-back-b']){await travel(gate);await landmarks();}
      await travel('homes-entry-back-b');
    }
  }
  const report={passed:true,mapVersion:map.version,visitedScenes:[...visited],routesTested:[...routes],landmarksInspected:[...inspected],steps:seq,teleports,rejects:packets.filter(p=>p.opcode===S2C.MOVE_REJECT).length};
  if(visited.size!==map.scenes!.length||routes.size!==7||inspected.size!==map.hotspots.length)throw new Error('Incomplete city tour');
  writeFileSync('screenshots/complete-world-live-report.json',JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify(report,null,2));
}finally{clearInterval(ping);ws.close(1000,'City audit complete');}
