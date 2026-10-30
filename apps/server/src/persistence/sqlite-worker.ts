import { parentPort, workerData } from 'node:worker_threads';
import { randomBytes } from 'node:crypto';
import { LocalSqliteDatabase } from './sqlite-local.js';
import { EventEngine } from '../game/event-engine.js';
import { EVENT_METHODS, type EventSnapshot, type WorldContext } from '../game/runtime-port.js';
import { loadMap, isStaff } from '@heist/shared';

if (!parentPort) throw new Error('SQLite worker requires a parent');
const database = new LocalSqliteDatabase(workerData.path);
let engine: EventEngine | undefined;
let context: WorldContext = { positions: [], connected: [] };
let positions = new Map<string, {x: number; y: number}>();
let connected = new Set<string>();
const owner = randomBytes(24).toString('hex');
let renewal: NodeJS.Timeout | undefined;
function setContext(next: WorldContext) {
  context = next;
  positions = new Map(context.positions.map(p => [p.id, p]));
  connected = new Set(context.connected);
}
function snapshot(): EventSnapshot {
  const e = engine!;
  return { status: e.status(), key: e.eventKey(), permissions: Object.fromEntries(e.roster().map(p =>
    [p.id, { move: e.canMove(p.id), travel: e.canTravel(p.id) }])) };
}
const repositories: Record<string, (...args: any[]) => unknown> = {};
for (const [group, methods] of Object.entries({
  players: ['createPlayer', 'findById', 'findByUsername', 'listPlayers'],
  sessions: ['createSession', 'findByToken', 'updateLastSeen', 'deleteByPlayerId'],
  state: ['save', 'saveBatch', 'findByPlayerId'],
})) for (const method of methods) {
  const repository = (database as any)[group];
  repositories[`${group}.${method}`] = (...args) => repository[method](...args);
}
async function dispatch(operation: string, args: any[]) {
  // Old position snapshots can already be queued when a reset commits. Fence
  // them by round so they cannot resurrect a previous round's coordinates.
  if (engine && (operation === 'state.save' || operation === 'state.saveBatch')) {
    const current = (row: {data:string}) => {
      try { const generation=JSON.parse(row.data).eventGeneration; return !generation || generation===engine!.eventKey(); }
      catch { return true; }
    };
    if (operation === 'state.save' && !current(args[0])) return;
    if (operation === 'state.saveBatch') args=[args[0].filter(current)];
  }
  if (repositories[operation]) return repositories[operation](...args);
  if (operation === 'staff.resetPassword') return database.resetStaffPassword(args[0], args[1]);
  if (operation === 'initialize') return database.initialize();
  if (operation === 'close') {
    if (renewal) clearInterval(renewal);
    engine?.close();
    if (engine) database.connection.prepare('DELETE FROM runtime_lease WHERE id=1 AND owner=?').run(owner);
    await database.close();
    return;
  }
  if (operation === 'event.initialize') {
    if (engine) throw new Error('Event already initialized');
    const sql = database.connection;
    sql.exec('CREATE TABLE IF NOT EXISTS runtime_lease(id INTEGER PRIMARY KEY CHECK(id=1),owner TEXT NOT NULL,expires_at INTEGER NOT NULL)');
    const acquired = sql.prepare('INSERT INTO runtime_lease VALUES(1,?,?) ON CONFLICT(id) DO UPDATE SET owner=excluded.owner,expires_at=excluded.expires_at WHERE runtime_lease.expires_at<?').run(owner, Date.now()+30000, Date.now());
    if (!acquired.changes) throw new Error('Another game server owns this SQLite world');
    try {
      engine = new EventEngine(workerData.path, loadMap(args[0]), Date.now, args[1], sql);
      engine.authorityOwner = owner;
      engine.positionOf = id => positions.get(id);
      engine.connected = id => connected.has(id);
      engine.runDurable(() => engine!.markAllOffline());
      renewal = setInterval(() => {
        try {
          const updated = sql.prepare('UPDATE runtime_lease SET expires_at=? WHERE id=1 AND owner=?').run(Date.now()+30000, owner);
          if (!updated.changes) throw new Error('SQLite world lease lost');
        } catch (error) { throw error; } // Exit worker; parent fails closed.
      }, 10000);
      return { value: undefined, snapshot: snapshot() };
    } catch (error) {
      sql.prepare('DELETE FROM runtime_lease WHERE id=1 AND owner=?').run(owner);
      throw error;
    }
  }
  if (!engine) throw new Error('Event is not initialized');
  const [payload, nextContext] = args;
  setContext(nextContext);
  let value: unknown;
  if (operation === 'event.call') {
    if (!EVENT_METHODS.includes(payload.method)) throw new Error('Unsupported event operation');
    value = engine.runDurable(() => {
      try { return (engine![payload.method as typeof EVENT_METHODS[number]] as Function).apply(engine, payload.args); }
      catch (error) {
        // A storage failure must roll back the entire command, including an
        // action whose state changed before its request-history insert failed.
        if (String((error as {code?: string})?.code).startsWith('ERR_SQLITE')) throw error;
        // Rejected player actions still leave their denial record in the event history.
        if (payload.method === 'action') return {type:'game_result',error:true,message:error instanceof Error?error.message:'Action failed'};
        throw error;
      }
    }, payload.audit);
  } else if (operation === 'event.admit') {
    engine.runDurable(() => {
      if (isStaff(payload.role)) engine!.addObserver(payload.id, payload.name);
      else { engine!.ensurePlayer(payload.id, payload.name); engine!.setOnline(payload.id, true); }
    });
  } else if (operation === 'event.offline') {
    engine.runDurable(() => { if (!connected.has(payload.id)) engine!.setOnline(payload.id, false, payload.at); });
  } else if (operation === 'event.reset') {
    engine.runDurable(() => engine!.resetRound(payload.expected, engine!.roster(), engine!.map.spawns[0]), payload.audit);
  } else throw new Error('Unknown database operation');
  return { value, snapshot: snapshot() };
}
// Serialize commands even when a repository returns a Promise. No overlapping transactions.
let tail = Promise.resolve();
parentPort.on('message', ({ id, operation, args }) => {
  tail = tail.then(async () => {
    try { parentPort!.postMessage({ id, value: await dispatch(operation, args) }); }
    catch (error) {
      const e = error as Error & {code?: string};
      parentPort!.postMessage({ id, error: { message: e.message, code: e.code } });
    }
  });
});
