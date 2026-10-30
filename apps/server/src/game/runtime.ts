import type { RuntimePort, EventMethod } from './runtime-port.js';
import type { AccountRole } from '@heist/shared';
import { encodeS2CJson, type EventRequest } from "@heist/shared";
import type { World } from "../world/world.js";
import type { ConnectionManager, ClientConnection } from "../net/connection.js";
import { EventEngine } from "./event-engine.js";
import type { EventPersistence, StaffAudit } from "./persistence-contract.js";
import { isStaff, chunkOf, DIR } from "@heist/shared";

/** Event persistence and scheduling run outside the movement tick. */
export class EventRuntime implements RuntimePort {
  invoke<K extends EventMethod>(method: K, args: Parameters<EventEngine[K]>, audit?: StaffAudit): Promise<ReturnType<EventEngine[K]>> {
    return this.execute(() => (this.engine[method] as Function).apply(this.engine, args), audit);
  }
  async admit(id: string, name: string, role?: AccountRole) {
    await this.execute(() => {
      if (isStaff(role)) this.engine.addObserver(id, name);
      else { this.engine.ensurePlayer(id, name); this.engine.setOnline(id, true); }
    });
  }
  async offline(id: string, at = Date.now()) {
    await this.execute(() => { if (!this.connections.getByPlayerId(id)) this.engine.setOnline(id, false, at); });
  }
  canMove(id: string) { return this.engine.canMove(id); }
  canTravel(id: string) { return this.engine.canTravel(id); }
  status() { return this.engine.status(); }
  eventKey() { return this.engine.eventKey(); }

  private stopped = false;
  private timer: NodeJS.Timeout | null = null;
  constructor(
    public engine: EventEngine,
    private world: World,
    private connections: ConnectionManager,
    private persistence?: EventPersistence,
  ) {
    engine.positionOf = (id) => {
      const e = world.getEntityByPlayerId(id);
      return e ? { x: e.x, y: e.y } : undefined;
    };
    engine.connected = (id) => !!connections.getByPlayerId(id);
    world.eventRuntime = this;
    if (!persistence) engine.markAllOffline();
  }
  execute<T>(operation: () => T, audit?: StaffAudit): Promise<T> {
    if(this.stopped)return Promise.reject(new Error('Game runtime is stopped'));
    return this.persistence
      ? this.persistence.run(operation, audit)
      : Promise.resolve().then(()=>{if(this.stopped)throw new Error('Game runtime is stopped');return operation();});
  }
  async reset(expected: string, audit?: StaffAudit) {
    if (!this.persistence)
      throw new Error("Durable reset requires MongoDB mode");
    if (expected !== this.engine.eventKey())
      throw new Error(
        "This reset confirmation is stale. Reload the control panel.",
      );
    const fresh = await this.persistence.reset(this.engine.roster(), expected, audit);
    this.engine = fresh;
    fresh.positionOf = (id) => {
      const e = this.world.getEntityByPlayerId(id);
      return e ? { x: e.x, y: e.y } : undefined;
    };
    fresh.connected = (id) => !!this.connections.getByPlayerId(id);
    // The fresh roster starts everyone online; correct it to who is connected.
    await this.execute(() =>
      fresh.reconcilePresence((id) => !!this.connections.getByPlayerId(id)),
    );
    for (const conn of this.connections.getAll())
      if (isStaff(conn.role)) fresh.addObserver(conn.playerId, conn.username);
    const spawn = this.world.map.spawns[0];
    for (const entity of this.world.getAllEntities()) {
      entity.pending.length = 0;
      entity.data.eventGeneration=fresh.eventKey();
      entity.x = spawn.x;
      entity.y = spawn.y;
      entity.dir = DIR.DOWN;
      entity.dirty = true;
      this.world.chunkGrid.update(
        entity,
        chunkOf(entity.x, entity.y, this.world.config.chunkSize),
      );
    }
    for (const conn of this.connections.getAll())
      conn.close(
        1001,
        "The super-admin reset the event. Reconnecting to the new lobby.",
      );
  }
  start() {
    let pending = false;
    this.timer = setInterval(() => {
      if (pending || this.stopped) return;
      pending = true;
      void this.execute(() => this.engine.tick())
        .then(() => {
          try {
            for (const conn of this.connections.getAll()) this.sendState(conn);
          } catch (error) {
            console.error("[Event scheduler]", error);
          }
        })
        .catch(() =>
          console.error("[Event scheduler] Durable authority unavailable"),
        )
        .finally(() => {
          pending = false;
        });
    }, 1000);
  }
  stop() {
    if (this.stopped) return;
    this.stopped = true;
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    if (this.persistence)
      return (async () => {
        try { await this.persistence!.close?.(); }
        finally { this.engine.close(); }
      })();
    this.engine.close();
  }
  sendState(conn: ClientConnection) {
    if (this.stopped) return;
    conn.outbox.push(
      encodeS2CJson(
        JSON.stringify({
          ...this.engine.view(conn.playerId),
          role: conn.role ?? "player",
        }),
      ),
    );
  }
  async handle(conn: ClientConnection, request: EventRequest) {
    if (this.stopped) return;
    try {
      if (
        typeof request.action !== "string" ||
        request.action.length > 40 ||
        (request.answer &&
          (typeof request.answer !== "string" ||
            request.answer.length > 600)) ||
        (request.input &&
          (typeof request.input !== "string" || request.input.length > 600))
      )
        throw new Error("Invalid action");
      const result = await this.execute(() => {
        try {
          return this.engine.action(conn.playerId, request);
        } catch (error) {
          return {
            type: "game_result",
            error: true,
            message: error instanceof Error ? error.message : "Action failed",
          };
        }
      });
      conn.outbox.push(encodeS2CJson(JSON.stringify(result)));
      this.sendState(conn);
    } catch (error) {
      conn.outbox.push(
        encodeS2CJson(
          JSON.stringify({
            type: "game_result",
            error: true,
            message: error instanceof Error ? error.message : "Action failed",
          }),
        ),
      );
    }
  }
}
