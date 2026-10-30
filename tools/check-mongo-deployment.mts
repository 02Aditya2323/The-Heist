/** Read-only world audit plus logins to the four explicitly provisioned staff accounts. */
import {loadEnvFile} from 'node:process';
import {readFileSync, writeFileSync} from 'node:fs';
import {resolve, dirname, join} from 'node:path';
import {DatabaseSync} from 'node:sqlite';
import assert from 'node:assert/strict';
import {MongoDatabase} from '../apps/server/src/persistence/mongodb.js';
const file=process.argv.find(a=>a.startsWith('--credentials-file='))?.split('=').slice(1).join('=');
if(!file)throw new Error('Provide the private --credentials-file=PATH');
loadEnvFile(resolve('.env'));
const credentials=JSON.parse(readFileSync(file,'utf8'));
const lanHost=process.argv.find(a=>a.startsWith('--lan-host='))?.slice('--lan-host='.length) ?? 'localhost';
if(!/^[a-zA-Z0-9.-]+$/.test(lanHost))throw new Error('Invalid LAN host');
const db=new MongoDatabase(process.env.MONGODB_URI!,process.env.MONGODB_DATABASE!);
await db.initialize();
const auth=new DatabaseSync(resolve('apps/server/data/heist.db'),{readOnly:true});
const event=new DatabaseSync(resolve('apps/server/data/heist.db.event.db'),{readOnly:true});
try {
  const originals=auth.prepare('SELECT id, username, password_hash FROM players').all();
  for(const row of originals) {
    const player=await db.players.findById(String(row.id));
    assert(player); assert.equal(player.username,row.username); assert.equal(player.passwordHash,row.password_hash);
  }
  const current=await db.db.collection<any>('event_current').findOne({_id:'world'});
  assert(current);
  const old=JSON.parse(String(event.prepare('SELECT data FROM event_state WHERE id=1').get()!.data)), now=JSON.parse(current.data);
  assert.equal(now.phase,old.phase); assert.equal(now.startedAt,old.startedAt);
  const records=await db.db.collection<any>('event_records').find({epoch:current.epoch,table:'event_ledger'}).sort({id:1}).toArray();
  assert.deepEqual(records.map(({_id,epoch,table,...row})=>row),event.prepare('SELECT * FROM event_ledger ORDER BY id').all().map(r=>({...r})));
  const accounts=[];
  for(const a of credentials){
    const response=await fetch('http://localhost:8080/api/login',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({username:a.username,password:a.password})});
    assert.equal(response.status,200); const {token}=await response.json() as any;
    const headers={authorization:`Bearer ${token}`};
    const role=await fetch('http://localhost:8080/api/account',{headers}); assert.equal((await role.json() as any).role,a.role);
    const vault=await fetch('http://localhost:8080/api/staff/challenges',{headers}); assert.equal((await vault.json() as any).length,42);
    const controls=await fetch('http://localhost:8080/api/admin/event',{headers}); assert.equal(controls.status,a.role==='superadmin'?200:403);
    accounts.push({username:a.username,role:a.role,login:'PASS',challenges:42});
  }
  for(const port of [8080,5173])assert.equal((await fetch(`http://${lanHost}:${port}/`)).status,200);
  const report={status:'PASS',accounts,originalAccountsPreserved:originals.length,originalLedgerRowsPreserved:records.length,eventPhase:now.phase,lanHost,ports:[8080,5173],otherPcReachability:'Not tested; firewall unchanged'};
  writeFileSync(join(dirname(file),'deployment-report.json'),JSON.stringify(report,null,2));
  console.log(JSON.stringify(report,null,2));
}finally{auth.close();event.close();await db.close();}
