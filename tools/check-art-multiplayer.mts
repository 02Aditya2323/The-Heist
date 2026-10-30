/** Live local smoke test: real HTTP accounts, WebSockets, codecs and authoritative movement. */
import { WebSocket } from 'ws';
import { decodeS2CFrame, encodePing, encodeMove, encodeC2SJson, findPath, pathToDirections, loadMap, isWalkable, S2C, type WelcomeMsg, type Direction } from '@heist/shared';
import { writeFileSync } from 'node:fs';
const base=process.env.HEIST_QA_URL||'http://localhost:8080';
const raw=await (await fetch(`${base}/api/map`)).json(), map=loadMap(raw);
if(!map.scenes?.length)throw new Error('Running server does not have the original-art map');
const run='city', peers:{ws:WebSocket;welcome:WelcomeMsg;packets:any[];seq:number;ping:ReturnType<typeof setInterval>}[]=[];
const sleep=(ms:number)=>new Promise(resolve=>setTimeout(resolve,ms));
async function waitUntil(check:()=>boolean,ms=6000){const end=Date.now()+ms;while(!check()){if(Date.now()>end)throw new Error('Timed out awaiting server packet');await sleep(20);}}
try {
  for(let i=0;i<12;i++){
    const credentials={username:`mapqa_${run}_${i}`,password:'Local-QA-only-123'};
    let response=await fetch(`${base}/api/register`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(credentials)});
    if(response.status===409)response=await fetch(`${base}/api/login`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(credentials)});
    if(!response.ok)throw new Error(`Local registration failed ${response.status}`);
    const {token}=await response.json();
    const ws=new WebSocket(`${base.replace('http','ws')}/ws?token=${encodeURIComponent(token)}`),packets:any[]=[];
    ws.on('message',data=>packets.push(...decodeS2CFrame(new Uint8Array(data as Buffer))));
    await waitUntil(()=>packets.some(m=>m.opcode===S2C.WELCOME));
    const welcome=packets.find(m=>m.opcode===S2C.WELCOME) as WelcomeMsg;
    const ping=setInterval(()=>{if(ws.readyState===WebSocket.OPEN)ws.send(encodePing(performance.now()|0));},2500);
    peers.push({ws,welcome,packets,seq:0,ping});
  }
  const center=map.spawns[0];
  const raid=map.hotspots.find(h=>h.id==='raid')!;
  const targets=[];
  for(let dy=-3;dy<=3;dy++)for(let dx=-3;dx<=3;dx++)if(Math.abs(dx)+Math.abs(dy)<=3&&isWalkable(map,raid.x+dx,raid.y+dy)&&findPath(map,center.x,center.y,raid.x+dx,raid.y+dy))targets.push({x:raid.x+dx,y:raid.y+dy});
  if(targets.length<6)throw new Error('Raid plaza lacks six valid standing cells');
  // Distribute around the raid plaza via collision-checked paths, without debug teleports.
  await Promise.all(peers.map(async(peer,i)=>{
    const target=targets[i%targets.length];
    const path=findPath(map,peer.welcome.x,peer.welcome.y,target.x,target.y);
    if(!path)throw new Error('Standing zone is not reachable');
    for(const dir of pathToDirections(peer.welcome.x,peer.welcome.y,path)){
      const seq=++peer.seq;peer.ws.send(encodeMove(seq,dir as Direction));
      await waitUntil(()=>peer.packets.some(m=>m.opcode===S2C.MOVE_ACK&&m.seq===seq));
      await sleep(peer.welcome.stepTicks/peer.welcome.tickRate*1000+25);
    }
  }));
  await waitUntil(()=>peers.every(p=>peers.filter(other=>other!==p).every(other=>p.packets.some(m=>m.opcode===S2C.ENTITY_ENTER&&m.id===other.welcome.selfId))));
  const peer=peers[0]; peer.ws.send(encodeC2SJson(JSON.stringify({type:'interact',id:'raid'})));
  await waitUntil(()=>peer.packets.some(m=>m.opcode===S2C.JSON));
  const response=peer.packets.filter(m=>m.opcode===S2C.JSON).map(m=>JSON.parse(m.payload)).find(m=>m.type==='interaction');
  if(!response)throw new Error('Raid terminal proximity validation failed');
  const report={mapVersion:map.version,panels:map.scenes.length,connectedPeers:12,minimumPeersVisible:Math.min(...peers.map(p=>new Set(p.packets.filter(m=>m.opcode===S2C.ENTITY_ENTER).map(m=>m.id)).size)),movementRejects:peers.reduce((n,p)=>n+p.packets.filter(m=>m.opcode===S2C.MOVE_REJECT).length,0),terminalVerified:response.id,metrics:await(await fetch(`${base}/metrics`)).json()};
  writeFileSync(new URL('../screenshots/art-multiplayer-report.json',import.meta.url),JSON.stringify(report,null,2)+'\n');
  console.log(JSON.stringify(report,null,2));
  const holdMs=Number(process.env.HEIST_QA_HOLD_MS)||120000;
  console.log(`Keeping the 12 test operators online for ${holdMs/1000} seconds for a live visual check.`);
  await sleep(holdMs);
} finally { for(const p of peers){clearInterval(p.ping);p.ws.close(1000,'QA complete');} }
