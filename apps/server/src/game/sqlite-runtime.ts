import { DIR, chunkOf, encodeS2CJson, type AccountRole, type EventRequest, type MapData } from '@heist/shared';
import type { EventEngine } from './event-engine.js';
import type { RuntimePort, EventMethod, EventSnapshot, WorldContext } from './runtime-port.js';
import type { StaffAudit } from './persistence-contract.js';
import type { SqliteDatabase } from '../persistence/sqlite.js';
import type { World } from '../world/world.js';
import type { ConnectionManager, ClientConnection } from '../net/connection.js';

/** The movement thread sees committed permissions only. All event SQL executes in the DB worker. */
export class SqliteEventRuntime implements RuntimePort {
  private snapshot?: EventSnapshot;
  private snapshotAt = 0;
  private failed = false;
  private stopped = false;
  private timer?: NodeJS.Timeout;
  private reading = new Set<ClientConnection>();
  private admissions = new Map<string, Promise<void>>();
  private inFlight = new Set<Promise<unknown>>();
  constructor(private database: SqliteDatabase, private world: World, private connections: ConnectionManager) {
    world.eventRuntime = this;
    database.worker.onFailure = () => { this.failed = true; };
  }
  async initialize(map: MapData, duration = 180) {
    await this.request('event.initialize', [map, duration]);
  }
  private context(): WorldContext {
    return { positions: [...this.world.getAllEntities()].map(e => ({id:e.playerId,x:e.x,y:e.y})),
      connected: [...this.connections.getAll()].map(c => c.playerId) };
  }
  private request<T>(operation: string, args: unknown[]): Promise<T> {
    if (this.stopped) return Promise.reject(new Error('Event runtime is stopped'));
    const pending = this.database.worker.request<{value:T;snapshot:EventSnapshot}>(operation, args).then(result => {
      this.snapshot = result.snapshot;
      this.snapshotAt = performance.now();
      return result.value;
    });
    this.inFlight.add(pending);
    void pending.then(() => this.inFlight.delete(pending), () => this.inFlight.delete(pending));
    return pending;
  }
  invoke<K extends EventMethod>(method: K, args: Parameters<EventEngine[K]>, audit?: StaffAudit): Promise<ReturnType<EventEngine[K]>> {
    return this.request('event.call', [{method,args,audit},this.context()]);
  }
  async admit(id: string, name: string, role?: AccountRole) {
    const admission=this.request<void>('event.admit', [{id,name,role},this.context()]);
    this.admissions.set(id,admission);
    try { await admission; }
    finally { if(this.admissions.get(id)===admission)this.admissions.delete(id); }
  }
  async offline(id: string, at = Date.now()) {
    const admission=this.admissions.get(id);
    if(admission) {
      await admission.catch(()=>{});
      // Let the admission continuation install its connection before deciding
      // whether the old socket really left this account offline.
      await new Promise<void>(resolve=>setImmediate(resolve));
    }
    if (this.connections.getByPlayerId(id) || this.stopped) return;
    await this.request('event.offline', [{id,at},this.context()]);
  }
  private healthy() { return !this.failed && !this.stopped && !!this.snapshot && performance.now()-this.snapshotAt < 5000; }
  canMove(id: string) { return this.healthy() && (this.snapshot!.permissions[id]?.move ?? true); }
  canTravel(id: string) { return this.healthy() && (this.snapshot!.permissions[id]?.travel ?? true); }
  status() { return this.healthy() ? this.snapshot?.status : undefined; }
  eventKey() { return this.snapshot?.key; }
  sendState(conn: ClientConnection) {
    if (this.stopped || this.reading.has(conn)) return;
    this.reading.add(conn);
    void this.invoke('view', [conn.playerId]).then(view => {
      if (!this.stopped && this.connections.getByPlayerId(conn.playerId) === conn)
        conn.outbox.push(encodeS2CJson(JSON.stringify({...view,role:conn.role??'player'})));
    }).catch(() => { /* Commands report their errors; the next scheduler pass retries this view. */ })
      .finally(() => this.reading.delete(conn));
  }
  async handle(conn: ClientConnection, request: EventRequest) {
    if (this.stopped) return;
    try {
      if (typeof request.action !== 'string' || request.action.length > 40 ||
          (request.answer !== undefined && (typeof request.answer !== 'string' || request.answer.length > 600)) ||
          (request.input !== undefined && (typeof request.input !== 'string' || request.input.length > 600))) throw new Error('Invalid action');
      const result = await this.invoke('action', [conn.playerId,request]);
      if (this.connections.getByPlayerId(conn.playerId) !== conn) return;
      conn.outbox.push(encodeS2CJson(JSON.stringify(result)));
      this.sendState(conn);
    } catch (error) {
      if (!this.stopped && this.connections.getByPlayerId(conn.playerId) === conn)
        conn.outbox.push(encodeS2CJson(JSON.stringify({type:'game_result',error:true,message:error instanceof Error?error.message:'Action failed'})));
    }
  }
  async reset(expected: string, audit?: StaffAudit) {
    await this.request('event.reset', [{expected,audit},this.context()]);
    const spawn = this.world.map.spawns[0];
    for (const entity of this.world.getAllEntities()) {
      entity.pending.length = 0;
      entity.data.eventGeneration=this.eventKey();
      entity.x=spawn.x; entity.y=spawn.y; entity.dir=DIR.DOWN; entity.dirty=true;
      this.world.chunkGrid.update(entity,chunkOf(entity.x,entity.y,this.world.config.chunkSize));
    }
    for (const conn of this.connections.getAll()) conn.close(1001,'Event reset. Reconnecting to the new lobby.');
  }
  start() {
    if (this.timer || this.stopped) return;
    let pending = false;
    this.timer = setInterval(() => {
      if (pending || this.stopped) return;
      pending = true;
      void this.invoke('tick', []).then(() => {
        for (const conn of this.connections.getAll()) this.sendState(conn);
      }).catch(() => console.error('[Event scheduler] SQLite authority unavailable'))
        .finally(() => { pending=false; });
    },1000);
  }
  async stop() {
    if (this.stopped) return;
    this.stopped=true;
    if (this.timer) clearInterval(this.timer);
    await Promise.allSettled(this.inFlight);
    // The shared database worker closes only after the final position flush.
  }
}
