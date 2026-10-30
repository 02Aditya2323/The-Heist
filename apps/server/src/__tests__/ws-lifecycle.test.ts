import { describe, it, expect, vi } from "vitest";
import { GameWsServer } from "../net/ws-server.js";

describe("socket lifecycle fairness", () => {
  it("ghosts immediately and never lets a queued close override a newer session", async () => {
    const server = Object.create(GameWsServer.prototype) as any;
    server.lifecycleTurn = Promise.resolve();
    const original = { entityId: 7, playerId: "operator" };
    let current: typeof original | undefined = original;
    const entity = { connected: true, pending: [1], disconnectedAt: undefined };
    const online = vi.fn();
    server.connections = {
      get: () => current,
      getByPlayerId: () => current,
      remove: () => {
        current = undefined;
      },
    };
    server.world = {
      getEntity: () => entity,
      eventRuntime: { offline: (id:string, at:number) => { online(id, false, at); return Promise.resolve(); } },
    };
    server.logger = { debug: vi.fn(), error: vi.fn() };
    server.handleSocketClose(original);
    expect(entity.connected).toBe(false);
    expect(entity.pending).toHaveLength(0);
    expect(online).not.toHaveBeenCalled();
    current = { ...original };
    await server.lifecycleTurn;
    expect(online).not.toHaveBeenCalled();
    const at = Date.now();
    server.handleSocketClose(current);
    await server.lifecycleTurn;
    expect(online).toHaveBeenCalledWith("operator", false, expect.any(Number));
    expect(online.mock.calls[0][2]).toBeGreaterThanOrEqual(at);
  });
  it("shutdown terminates sockets awaiting admission as well as established ones", () => {
    const server = Object.create(GameWsServer.prototype) as any;
    const pending = { terminate: vi.fn() };
    server.wss = { clients: new Set([pending]), close: vi.fn() };
    server.close();
    expect(server.closing).toBe(true);
    expect(pending.terminate).toHaveBeenCalledOnce();
    expect(server.wss.close).toHaveBeenCalledOnce();
  });
  it("refuses admission after shutdown before touching authentication", async () => {
    const server = Object.create(GameWsServer.prototype) as any;
    server.closing = true;
    const socket = { close: vi.fn() };
    await server.handleConnection(socket, {});
    expect(socket.close).toHaveBeenCalledWith(1001, "Server shutting down");
  });
  it("yields between synchronous presence operations instead of starving timers", async () => {
    // Exercise the real scheduler with deterministic simulated sync I/O cost,
    // without opening sockets, touching the saved database or depending on SSD speed.
    const scheduler = Object.create(GameWsServer.prototype) as any;
    scheduler.lifecycleTurn = Promise.resolve();
    let ticks = 0;
    const executed: number[] = [];
    const timer = setInterval(() => {
      ticks++;
    }, 10);
    try {
      await Promise.all(
        Array.from({ length: 40 }, (_, i) =>
          scheduler.yieldLifecycle().then(() => {
            executed.push(i);
            const end = performance.now() + 3;
            while (performance.now() < end) {
              /* simulate one short synchronous database write */
            }
          }),
        ),
      );
      expect(executed).toEqual(Array.from({ length: 40 }, (_, i) => i));
      expect(ticks).toBeGreaterThan(1);
    } finally {
      clearInterval(timer);
    }
  });
});
