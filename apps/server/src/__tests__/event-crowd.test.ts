import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { WebSocket } from "ws";
import { pino } from "pino";
import {
  loadMap,
  decodeS2CFrame,
  encodeMove,
  encodePing,
  DIR,
  S2C,
  findPath,
  pathToDirections,
  type MapData,
  type Direction,
} from "@heist/shared";
import { loadConfig } from "../config.js";
import { SqliteDatabase } from "../persistence/sqlite.js";
import { Snapshotter } from "../persistence/snapshotter.js";
import { MetricsTracker } from "../metrics/metrics.js";
import { World } from "../world/world.js";
import { TickLoop } from "../world/tick.js";
import { ConnectionManager } from "../net/connection.js";
import { GameWsServer } from "../net/ws-server.js";
import { createHttpServer } from "../http/server.js";
import { EventEngine } from "../game/event-engine.js";
import { EventRuntime } from "../game/runtime.js";
const soakMs = Math.min(
  30 * 60000,
  Math.max(0, Number(process.env.HEIST_QA_SOAK_MS) || 0),
);

describe("40-operator event on the complete city", () => {
  it(
    "streams authoritative event state and resolves concurrent movement for every operator",
    async () => {
      const raw = JSON.parse(
        readFileSync(
          new URL("../../../../maps/art-world.json", import.meta.url),
          "utf8",
        ),
      ) as MapData;
      const config = loadConfig(),
        db = new SqliteDatabase(":memory:"),
        logger = pino({ level: "silent" }),
        metrics = new MetricsTracker(config.tickRate),
        world = new World(loadMap(raw), raw, config),
        connections = new ConnectionManager(),
        engine = new EventEngine(":memory:", world.map),
        runtime = new EventRuntime(engine, world, connections),
        app = createHttpServer(world, db, metrics, config),
        wsServer = new GameWsServer(
          app.server,
          world,
          connections,
          db,
          config,
          metrics,
          logger,
        ),
        snapshots = new Snapshotter(
          db.state,
          config.snapshotIntervalMs,
          world,
          logger,
        ),
        tick = new TickLoop(
          world,
          connections,
          config,
          metrics,
          snapshots,
          logger,
        );
      const peers: { ws: WebSocket; packets: any[]; rejected: number }[] = [];
      let ping: NodeJS.Timeout | undefined;
      const wait = async (check: () => boolean) => {
        const end = Date.now() + 12000;
        while (!check()) {
          if (Date.now() > end) throw new Error("40-player packet timeout");
          await new Promise((r) => setTimeout(r, 20));
        }
      };
      try {
        await app.listen({ port: 0, host: "127.0.0.1" });
        const address = app.server.address() as { port: number };
        tick.start();
        runtime.start();
        for (let i = 0; i < 40; i++) {
          const id = `load-${i}`,
            token = `local-test-token-${i}`;
          await db.players.createPlayer(
            id,
            `load_operator_${i}`,
            "test-only-unused-password-hash",
          );
          await db.sessions.createSession(token, id);
          const ws = new WebSocket(
              `ws://127.0.0.1:${address.port}/ws?token=${token}`,
            ),
            packets: any[] = [];
          const peer = { ws, packets, rejected: 0 };
          ws.on("message", (b) => {
            const decoded = decodeS2CFrame(new Uint8Array(b as Buffer));
            peer.rejected += decoded.filter(
              (m) => m?.opcode === S2C.MOVE_REJECT,
            ).length;
            packets.push(...decoded);
            if (packets.length > 500) packets.splice(0, packets.length - 500);
          });
          peers.push(peer);
        }
        await wait(() =>
          peers.every((p) => p.packets.some((m) => m.opcode === S2C.WELCOME)),
        );
        engine.start();
        // Include real workbench payloads, not only empty journals, in the load smoke.
        for (let i = 0; i < 40; i++)
          for (const id of ["ST-01", "ST-02", "ST-03", "SD-07", "EX-01"]) {
            const internal = engine as any;
            internal.attempt(
              internal.state.players[`load-${i}`],
              id,
              "job",
              Date.now() + 30 * 60000,
              "crowd-workbench",
            );
          }
        ping = setInterval(() => {
          for (const p of peers)
            if (p.ws.readyState === WebSocket.OPEN)
              p.ws.send(encodePing(performance.now() | 0));
        }, 2500);
        const marker = world.map.hotspots.find((h) => h.id === "raid")!;
        for (const p of peers) {
          const welcome = p.packets.find((m) => m.opcode === S2C.WELCOME);
          const path = findPath(
            world.map,
            welcome.x,
            welcome.y,
            marker.x,
            marker.y,
          );
          expect(path).toBeTruthy();
          const dir =
            pathToDirections(welcome.x, welcome.y, path!)[0] ?? DIR.RIGHT;
          p.ws.send(encodeMove(1, dir as Direction));
        }
        await wait(() =>
          peers.every((p) =>
            p.packets.some((m) => m.opcode === S2C.MOVE_ACK && m.seq === 1),
          ),
        );
        await wait(() =>
          peers.every((p) =>
            p.packets.some(
              (m) =>
                m.opcode === S2C.JSON &&
                JSON.parse(m.payload).type === "event_state" &&
                JSON.parse(m.payload).phase === "live",
            ),
          ),
        );
        const welcome = peers[0].packets.find((m) => m.opcode === S2C.WELCOME),
          cadence = (welcome.stepTicks / welcome.tickRate) * 1000;
        const rounds = soakMs
          ? Math.max(13, Math.ceil(soakMs / (cadence + 20)))
          : 13;
        for (let seq = 2; seq <= rounds; seq++) {
          await new Promise((r) => setTimeout(r, cadence + 20));
          for (const p of peers) {
            const previous = p.packets.find(
              (m) => m.opcode === S2C.MOVE_ACK && m.seq === seq - 1,
            );
            const target = seq % 2 === 0 ? marker.x - 1 : marker.x;
            const path = findPath(
              world.map,
              previous.x,
              previous.y,
              target,
              marker.y,
            );
            const dir =
              pathToDirections(previous.x, previous.y, path!)[0] ?? DIR.RIGHT;
            p.ws.send(encodeMove(seq, dir as Direction));
          }
          await wait(() =>
            peers.every((p) =>
              p.packets.some((m) => m.opcode === S2C.MOVE_ACK && m.seq === seq),
            ),
          );
        }
        expect(world.connectedPlayerCount).toBe(40);
        expect(engine.view("load-0").homes).toHaveLength(40);
        expect(engine.view("load-0").challenges).toHaveLength(5);
        expect(peers.reduce((sum, p) => sum + p.rejected, 0)).toBe(0);
        expect(engine.audit().total).toBe(400000);
        const snapshot = metrics.getSnapshot(40, 0);
        expect(snapshot.network.backpressureEvents).toBe(0);
        expect(snapshot.network.rateLimitDrops).toBe(0);
        expect(snapshot.network.malformedMessages).toBe(0);
        console.log("40-player event smoke:", JSON.stringify(snapshot));
      } finally {
        if (ping) clearInterval(ping);
        tick.stop();
        for (const p of peers) p.ws.terminate();
        wsServer.close();
        await new Promise((r) => setTimeout(r, 30));
        runtime.stop();
        snapshots.stop();
        metrics.stop();
        await app.close();
        await db.close();
      }
    },
    Math.max(20000, soakMs * 1.4 + 20000),
  );
});
