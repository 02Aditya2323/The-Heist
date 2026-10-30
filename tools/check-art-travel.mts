import { WebSocket } from 'ws';
import { decodeS2CFrame, encodeC2SJson, encodeMove, encodePing, loadMap, findPath, pathToDirections, S2C, type Direction } from '@heist/shared';
const base='http://localhost:8080',raw=await(await fetch(`${base}/api/map`)).json(),map=loadMap(raw);
const auth=await(await fetch(`${base}/api/register`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({username:`gateqa_${Date.now().toString(36)}`,password:'Local-QA-only-123'})})).json();
const ws=new WebSocket(`ws://localhost:8080/ws?token=${encodeURIComponent(auth.token)}`),packets:any[]=[];
ws.on('message',data=>packets.push(...decodeS2CFrame(new Uint8Array(data as Buffer))));
const sleep=(ms:number)=>new Promise(resolve=>setTimeout(resolve,ms));
async function wait(check:()=>boolean){const deadline=Date.now()+6000;while(!check()){if(Date.now()>deadline)throw new Error('Timed out');await sleep(20);}}
const ping=setInterval(()=>{if(ws.readyState===WebSocket.OPEN)ws.send(encodePing(performance.now()|0));},2500);
try{
  await wait(()=>packets.some(p=>p.opcode===S2C.WELCOME));const welcome=packets.find(p=>p.opcode===S2C.WELCOME);
  const exit=map.exits!.find(e=>e.id==='c10-from-a')!;
  const path=findPath(map,welcome.x,welcome.y,exit.x,exit.y);if(!path)throw new Error('Gate unreachable');
  let seq=0;
  for(const dir of pathToDirections(welcome.x,welcome.y,path)){
    const nextSeq=++seq;ws.send(encodeMove(nextSeq,dir as Direction));
    await wait(()=>packets.some(p=>p.opcode===S2C.MOVE_ACK&&p.seq===nextSeq));await sleep(welcome.stepTicks/welcome.tickRate*1000+30);
  }
  ws.send(encodeC2SJson(JSON.stringify({type:'interact',id:exit.id})));
  await wait(()=>packets.some(p=>p.opcode===S2C.ENTITY_TELEPORT&&p.x===exit.targetX&&p.y===exit.targetY));
  const back=map.exits!.find(e=>e.id==='c10-back-a')!;
  ws.send(encodeC2SJson(JSON.stringify({type:'interact',id:back.id})));
  await wait(()=>packets.some(p=>p.opcode===S2C.ENTITY_TELEPORT&&p.x===exit.x&&p.y===exit.y));
  console.log(JSON.stringify({passed:true,stepsToGate:seq,route:'Central Exchange → Undercity connector → Central Exchange',movementRejects:packets.filter(p=>p.opcode===S2C.MOVE_REJECT).length,teleports:packets.filter(p=>p.opcode===S2C.ENTITY_TELEPORT).length}));
}finally{clearInterval(ping);ws.close(1000,'QA complete');}
