import { beforeEach, afterEach, expect, it } from 'vitest';
import { randomBytes } from 'node:crypto';
import { SqliteDatabase } from '../persistence/sqlite.js';
import { createHttpServer } from '../http/server.js';
import { loadConfig } from '../config.js';
import { World } from '../world/world.js';
import { loadMap } from '@heist/shared';
import { EventEngine } from '../game/event-engine.js';
import { EventRuntime } from '../game/runtime.js';
import { ConnectionManager } from '../net/connection.js';
import { MetricsTracker } from '../metrics/metrics.js';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
let db:SqliteDatabase,app:ReturnType<typeof createHttpServer>,rt:EventRuntime,metrics:MetricsTracker;
const tokens:Record<string,string>={};
beforeEach(async()=>{db=new SqliteDatabase(':memory:');const raw=JSON.parse(readFileSync(resolve('../../maps/art-world.json'),'utf8')),world=new World(loadMap(raw),raw,loadConfig());rt=new EventRuntime(new EventEngine(':memory:',world.map),world,new ConnectionManager());metrics=new MetricsTracker(20);app=createHttpServer(world,db,metrics,loadConfig());for(const role of ['player','admin','superadmin']as const){const token=randomBytes(32).toString('hex');tokens[role]=token;await db.players.createPlayer(role,`account_${role}`,'test-unused-hash',role);await db.sessions.createSession(token,role);}await app.ready();});
afterEach(async()=>{rt.stop();metrics.stop();await app.close();await db.close();});
const headers=(role:string)=>({authorization:`Bearer ${tokens[role]}`});
it('enforces role checks on every protected endpoint',async()=>{
  expect((await app.inject({url:'/api/staff/challenges'})).statusCode).toBe(401);
  expect((await app.inject({url:'/api/staff/challenges',headers:headers('player')})).statusCode).toBe(403);
  expect((await app.inject({url:'/api/admin/event',headers:headers('admin')})).statusCode).toBe(403);
  expect((await app.inject({url:'/api/admin/event',headers:headers('superadmin')})).statusCode).toBe(200);
  expect((await app.inject({url:'/api/staff/challenges',headers:headers('admin')})).json()).toHaveLength(42);
});
it('does not accept a public role escalation',async()=>{const result=await app.inject({method:'POST',url:'/api/register',payload:{username:'new_player',password:'safe-test-password',role:'superadmin'}});expect(result.statusCode).toBe(201);expect((await db.players.findByUsername('new_player'))?.role).toBe('player');});
it('keeps staff previews unpaid and private to their owner',async()=>{
  const before=rt.engine.adminView().audit.total;const opened=await app.inject({method:'POST',url:'/api/staff/challenges/open',headers:headers('admin'),payload:{template:'ST-01'}});expect(opened.statusCode).toBe(200);const {challenge:c}=opened.json();expect(c.reward).toBe(0);expect(c.answer).toBeUndefined();
  expect((await app.inject({method:'POST',url:'/api/staff/challenges/action',headers:headers('superadmin'),payload:{action:'answer',id:c.id,answer:'0'}})).statusCode).toBe(404);
  const values=c.workbench.code.match(/\{([-\d,\s]+)\}/)[1].split(',').map(Number),answer=String(values.filter((n:number)=>n>0).reduce((a:number,b:number)=>a+b,0));const solved=await app.inject({method:'POST',url:'/api/staff/challenges/action',headers:headers('admin'),payload:{action:'answer',id:c.id,answer}});expect(solved.json().correct).toBe(true);expect(rt.engine.adminView().audit.total).toBe(before);expect(rt.engine.roster()).toHaveLength(0);
});
it('requires super-admin and explicit current-event confirmation for Reset',async()=>{
  expect((await app.inject({method:'POST',url:'/api/admin/event',headers:headers('admin'),payload:{action:'reset',confirm:'RESET',eventKey:rt.engine.eventKey()}})).statusCode).toBe(403);
  expect((await app.inject({method:'POST',url:'/api/admin/event',headers:headers('superadmin'),payload:{action:'reset'}})).statusCode).toBe(400);
});
it('staff observers do not take a Home or a prize slot',()=>{rt.engine.addObserver('admin','account_admin');expect(rt.engine.roster()).toHaveLength(0);expect(rt.engine.view('admin').player.homeId).toBe('STAFF');expect(rt.engine.canMove('admin')).toBe(true);expect(()=>rt.engine.action('admin',{type:'game_action',action:'job',id:'ST-01'})).toThrow('Operator not enrolled');});
it('limits machine probes exactly as the real workbench does',async()=>{
  const opened=await app.inject({method:'POST',url:'/api/staff/challenges/open',headers:headers('admin'),payload:{template:'EX-04'}}),id=opened.json().challenge.id;
  expect((await app.inject({method:'POST',url:'/api/staff/challenges/action',headers:headers('admin'),payload:{action:'probe',id,input:''}})).statusCode).toBe(400);
  for(let i=1;i<=5;i++){const run=await app.inject({method:'POST',url:'/api/staff/challenges/action',headers:headers('admin'),payload:{action:'probe',id,input:'7'}});expect(run.statusCode).toBe(200);expect(run.json().challenge.testRuns).toBe(i);}
  expect((await app.inject({method:'POST',url:'/api/staff/challenges/action',headers:headers('admin'),payload:{action:'probe',id,input:'7'}})).statusCode).toBe(400);
});
it('reopening a preview retires its predecessor instead of leaking personal copies',async()=>{
  const first=await app.inject({method:'POST',url:'/api/staff/challenges/open',headers:headers('admin'),payload:{template:'ST-01'}});
  await app.inject({method:'POST',url:'/api/staff/challenges/open',headers:headers('admin'),payload:{template:'ST-02'}});
  expect((await app.inject({method:'POST',url:'/api/staff/challenges/action',headers:headers('admin'),payload:{action:'abandon',id:first.json().challenge.id}})).statusCode).toBe(404);
});
