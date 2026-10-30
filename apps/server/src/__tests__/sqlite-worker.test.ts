import { describe, it, expect } from 'vitest';
import { DatabaseSync } from 'node:sqlite';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { loadMap, DIR, type MapData } from '@heist/shared';
import { SqliteDatabase } from '../persistence/sqlite.js';
import { SqliteEventRuntime } from '../game/sqlite-runtime.js';
import { World } from '../world/world.js';
import { ConnectionManager } from '../net/connection.js';
import { loadConfig } from '../config.js';
import { Snapshotter } from '../persistence/snapshotter.js';
import { pino } from 'pino';
import { bootstrapStaff } from '../persistence/bootstrap-staff.js';
import { createHttpServer } from '../http/server.js';
import { MetricsTracker } from '../metrics/metrics.js';

const raw = JSON.parse(readFileSync(new URL('../../../../maps/art-world.json',import.meta.url),'utf8')) as MapData;
const sleep = (ms:number) => new Promise(r=>setTimeout(r,ms));
function fixture(path:string) {
  const db = new SqliteDatabase(path), world = new World(loadMap(raw),raw,loadConfig());
  const connections=new ConnectionManager();
  const runtime = new SqliteEventRuntime(db,world,connections);
  return {db,world,runtime,connections};
}

describe('SQLite worker authority', () => {
  it('persists accounts, profiles, sessions, positions, event settings and money in one file across restart', async () => {
    const dir=mkdtempSync(join(tmpdir(),'heist-worker-')), path=join(dir,'world.db');
    let f=fixture(path);
    try {
      await f.db.initialize(); await f.runtime.initialize(raw);
      await f.db.players.createPlayer('p','worker_player','hash','player',{team:'portfolio'});
      await f.db.sessions.createSession('token','p');
      await f.db.state.save({playerId:'p',x:10,y:11,dir:DIR.LEFT,data:'{}',updatedAt:new Date()});
      await f.runtime.admit('p','worker_player');
      await f.runtime.invoke('updateSettings',[{claimCooldown:30000}]);
      await f.runtime.invoke('start',[]);
      await f.runtime.invoke('adminAdjustMoney',['p',1000,'test transfer'],{actor:'staff',username:'staff',action:'adjust'});
      const before=await f.runtime.invoke('adminView',[]), key=f.runtime.eventKey();
      expect((await f.runtime.invoke('audit',[])).ok).toBe(true);
      await f.runtime.stop(); await f.db.close();
      f=fixture(path); await f.db.initialize(); await f.runtime.initialize(raw);
      expect(f.runtime.eventKey()).toBe(key);
      expect((await f.db.players.findById('p'))?.profile).toEqual({team:'portfolio'});
      expect((await f.db.sessions.findByToken('token'))?.playerId).toBe('p');
      expect((await f.db.state.findByPlayerId('p'))?.x).toBe(10);
      expect((await f.runtime.invoke('adminView',[])).accounts).toEqual(before.accounts);
      expect(await f.runtime.invoke('total',[])).toBe(400000);
      const sql=new DatabaseSync(path,{readOnly:true});
      expect(sql.prepare('SELECT count(*) AS n FROM staff_audit').get()!.n).toBe(1);
      expect(sql.prepare('SELECT sum(paise) AS total FROM event_accounts').get()!.total).toBe(400000);
      expect(sql.prepare("SELECT data FROM event_state").get()!.data).toContain('30000');
      sql.close();
    } finally { await f.runtime.stop(); await f.db.close(); rmSync(dir,{recursive:true,force:true}); }
  });

  it('rolls back a money change when its audit cannot commit, and archives/reset atomically without deleting logins', async () => {
    const dir=mkdtempSync(join(tmpdir(),'heist-reset-')), path=join(dir,'world.db'), f=fixture(path);
    try {
      await f.db.initialize(); await f.runtime.initialize(raw);
      await f.db.players.createPlayer('p','reset_player','hash'); await f.db.sessions.createSession('token','p');
      await f.db.state.save({playerId:'p',x:10,y:11,dir:DIR.UP,data:'{}',updatedAt:new Date()});
      await f.runtime.admit('p','reset_player'); await f.runtime.invoke('start',[]);
      const before=await f.runtime.invoke('adminView',[]);
      await expect(f.runtime.invoke('adminAdjustMoney',['p',1000,'rollback'],{actor:undefined as any,username:'staff',action:'adjust'})).rejects.toThrow();
      expect((await f.runtime.invoke('adminView',[])).accounts).toEqual(before.accounts);
      expect((await f.runtime.invoke('ledger',[]))).toHaveLength(0);
      const oldKey=f.runtime.eventKey()!;
      await expect(f.runtime.reset('stale')).rejects.toThrow('stale');
      await f.runtime.reset(oldKey,{actor:'staff',username:'staff',action:'reset'});
      expect(f.runtime.status()?.phase).toBe('lobby'); expect(f.runtime.eventKey()).not.toBe(oldKey);
      expect((await f.db.sessions.findByToken('token'))?.playerId).toBe('p');
      expect((await f.db.state.findByPlayerId('p'))?.x).toBe(raw.spawns[0].x);
      await f.db.state.saveBatch([{playerId:'p',x:99,y:99,dir:DIR.UP,data:JSON.stringify({eventGeneration:oldKey}),updatedAt:new Date()}]);
      expect((await f.db.state.findByPlayerId('p'))?.x).toBe(raw.spawns[0].x);
      expect((await f.runtime.invoke('audit',[])).ok).toBe(true);
      const sql=new DatabaseSync(path);
      expect(sql.prepare('SELECT generation FROM event_archives').get()!.generation).toBe(oldKey);
      expect(()=>sql.exec('DELETE FROM event_archives')).toThrow('immutable');
      sql.close();
    } finally { await f.runtime.stop(); await f.db.close(); rmSync(dir,{recursive:true,force:true}); }
  });

  it('rolls back a successful player action when its request history cannot be written', async () => {
    const dir=mkdtempSync(join(tmpdir(),'heist-history-')),path=join(dir,'world.db'),f=fixture(path);
    let sql:DatabaseSync|undefined;
    try {
      await f.db.initialize();await f.runtime.initialize(raw);
      await f.db.players.createPlayer('p','history_player','hash');await f.runtime.admit('p','history_player');
      const view=await f.runtime.invoke('view',['p']);
      const home=raw.homePlots!.find(h=>h.id===view.player.homeId)!;
      const entity=f.world.createOrResumeEntity('p','history_player');entity.x=home.x;entity.y=home.y;
      await f.runtime.invoke('action',['p',{type:'game_action',action:'enter_home'}]);
      expect((await f.runtime.invoke('view',['p'])).player.insideHome).toBe(true);
      sql=new DatabaseSync(path);
      sql.exec("CREATE TRIGGER fail_request_history BEFORE INSERT ON event_requests BEGIN SELECT RAISE(ABORT,'injected history failure'); END");
      await expect(f.runtime.invoke('action',['p',{type:'game_action',action:'leave_home'}])).rejects.toThrow('injected history failure');
      expect((await f.runtime.invoke('view',['p'])).player.insideHome).toBe(true);
      sql.exec('DROP TRIGGER fail_request_history');
      await f.runtime.invoke('action',['p',{type:'game_action',action:'leave_home'}]);
      expect((await f.runtime.invoke('view',['p'])).player.insideHome).toBe(false);
    } finally {sql?.close();await f.runtime.stop();await f.db.close();rmSync(dir,{recursive:true,force:true});}
  });

  it('keeps the main event loop responsive while SQLite waits for a writer lock', async () => {
    const dir=mkdtempSync(join(tmpdir(),'heist-lock-')),path=join(dir,'world.db'),f=fixture(path);
    let sql:DatabaseSync|undefined, timer:NodeJS.Timeout|undefined;
    try {
      await f.db.initialize(); await f.runtime.initialize(raw);
      sql=new DatabaseSync(path); sql.exec('BEGIN IMMEDIATE');
      let done=false,ticks=0;
      timer=setInterval(()=>ticks++,5);
      const pending=f.db.players.createPlayer('p','locked_player','hash').then(()=>{done=true;});
      await sleep(160);
      expect(done).toBe(false); expect(ticks).toBeGreaterThan(5);
      expect(f.db.metrics().pending).toBe(1);
      sql.exec('COMMIT'); await pending;
      expect((await f.db.players.findById('p'))?.username).toBe('locked_player');
    } finally { if(timer)clearInterval(timer);sql?.close();await f.runtime.stop();await f.db.close();rmSync(dir,{recursive:true,force:true}); }
  });

  it('rejects a second world writer and keeps the first writer usable', async () => {
    const dir=mkdtempSync(join(tmpdir(),'heist-owner-')),path=join(dir,'world.db'),a=fixture(path),b=fixture(path);
    try {
      await a.db.initialize(); await a.runtime.initialize(raw);
      await b.db.initialize(); await expect(b.runtime.initialize(raw)).rejects.toThrow('Another game server');
      expect((await a.runtime.invoke('audit',[])).ok).toBe(true);
    } finally {await a.runtime.stop();await b.runtime.stop();await b.db.close();await a.db.close();rmSync(dir,{recursive:true,force:true});}
  });

  it('rolls back an entire position batch on a foreign-key failure and keeps the queue usable', async () => {
    const db=new SqliteDatabase(':memory:');
    try {
      await db.initialize();await db.players.createPlayer('p','batch_player','hash');
      const row={playerId:'p',x:1,y:1,dir:DIR.DOWN,data:'{}',updatedAt:new Date()};
      await expect(db.state.saveBatch([row,{...row,playerId:'missing'}])).rejects.toThrow();
      expect(await db.state.findByPlayerId('p')).toBeNull();
      await db.state.save(row);expect((await db.state.findByPlayerId('p'))?.x).toBe(1);
    } finally { await db.close(); }
  });

  it('fails movement closed and rejects commands after worker loss', async () => {
    const f=fixture(':memory:'), metrics=new MetricsTracker(20);
    const app=createHttpServer(f.world,f.db,metrics,loadConfig());
    try {
      await f.db.initialize();await f.runtime.initialize(raw);
      expect(f.runtime.canMove('p')).toBe(true);
      await (f.db.worker as any).worker.terminate();
      expect(f.runtime.canMove('p')).toBe(false);
      expect((await app.inject({method:'GET',url:'/health'})).statusCode).toBe(503);
      await expect(f.runtime.invoke('start',[])).rejects.toThrow('worker exited');
    } finally {await app.close();metrics.stop();await f.runtime.stop();await f.db.close().catch(()=>{});}
  });

  it('bootstraps a Render owner once without password replacement or player promotion', async () => {
    const db=new SqliteDatabase(':memory:');
    try {
      await db.initialize();
      const env={HEIST_ADMIN_USERNAME:'demo_owner',HEIST_ADMIN_PASSWORD:'test-only-long-password'};
      await bootstrapStaff(db,env);
      const first=await db.players.findByUsername('demo_owner');
      expect(first?.role).toBe('superadmin');
      await bootstrapStaff(db,{...env,HEIST_ADMIN_PASSWORD:'different-test-password'});
      expect((await db.players.findByUsername('demo_owner'))?.passwordHash).toBe(first?.passwordHash);
      await db.players.createPlayer('p','ordinary_player','hash');
      await expect(bootstrapStaff(db,{...env,HEIST_ADMIN_USERNAME:'ordinary_player'})).rejects.toThrow('refusing promotion');
    } finally {await db.close();}
  });

  it('does not let an old socket close mark an in-progress reconnect offline', async () => {
    const f=fixture(':memory:');
    try {
      await f.db.initialize();await f.runtime.initialize(raw);
      await f.db.players.createPlayer('p','rejoining_player','hash');
      const admission=f.runtime.admit('p','rejoining_player');
      const reconnect=admission.then(()=>f.connections.add({playerId:'p',entityId:1} as any));
      const oldClose=f.runtime.offline('p');
      await Promise.all([reconnect,oldClose]);
      const view=await f.runtime.invoke('adminView',[]);
      expect(view.players[0].offline).toBe(false);
    } finally {await f.runtime.stop();await f.db.close();}
  });

  it('revokes staff sessions atomically and refuses player password resets', async () => {
    const db=new SqliteDatabase(':memory:');
    try {
      await db.initialize();
      await db.players.createPlayer('s','staff_account','old','superadmin');
      await db.players.createPlayer('p','player_account','old');
      await db.sessions.createSession('token','s');
      await expect(db.resetStaffPassword('player_account','new')).rejects.toThrow('staff');
      expect(await db.resetStaffPassword('staff_account','new')).toEqual({role:'superadmin',revoked:1});
      expect(await db.sessions.findByToken('token')).toBeNull();
      expect((await db.players.findById('s'))?.passwordHash).toBe('new');
    } finally {await db.close();}
  });
});

it('shutdown waits for an in-flight snapshot and then saves newer queued positions', async () => {
  let release!:()=>void;
  const calls:number[]=[];
  const snapshot=new Snapshotter({saveBatch:async rows=>{calls.push(rows[0].x);if(calls.length===1)await new Promise<void>(r=>release=r);},save:async()=>{},findByPlayerId:async()=>null},1000,{getDirtyEntities:()=>[]},pino({level:'silent'}));
  const row={playerId:'p',x:1,y:1,dir:DIR.DOWN,data:'{}',updatedAt:new Date()};
  snapshot.enqueue(row);const writing=snapshot.flushQueue();snapshot.enqueue({...row,x:2});
  let closed=false;const closing=snapshot.flushAll().then(()=>{closed=true;});
  await sleep(10);expect(closed).toBe(false);release();await writing;await closing;
  expect(calls).toEqual([1,2]);
});
