import { describe, it, expect } from "vitest";
import { WebSocket } from "ws";
import { pino } from "pino";
import { randomUUID } from "node:crypto";
import {
  loadMap,
  decodeS2CFrame,
  encodeC2SJson,
  concatMessages,
  S2C,
  DIR,
  type MapData,
} from "@heist/shared";
import { loadConfig } from "../config.js";
import { SqliteDatabase } from "../persistence/sqlite.js";
import { MetricsTracker } from "../metrics/metrics.js";
import { World } from "../world/world.js";
import { ConnectionManager } from "../net/connection.js";
import { GameWsServer } from "../net/ws-server.js";
import { createHttpServer } from "../http/server.js";
import { EventEngine } from "../game/event-engine.js";
import { EventRuntime } from "../game/runtime.js";
import { generateChallenge } from "../game/challenges.js";

describe("Gameplay over the actual HTTP and shared WebSocket protocol", () => {
  it("enrolls a Home, validates a terminal, solves a paid job once, and checks out without minting", async () => {
    const raw: MapData = {
      version: 30,
      width: 20,
      height: 20,
      collision: Array(20).fill("0".repeat(20)),
      spawns: [{ x: 5, y: 5 }],
      hotspots: [
        { id: "tech-jobs", name: "Tech Board", action: "jobs", x: 5, y: 5 },
        { id: "checkout", name: "Checkout", action: "checkout", x: 5, y: 5 },
      ],
      homePlots: [
        { id: "home-h001", address: "H001", sceneId: "tech", x: 6, y: 6 },
      ],
      scenes: [
        {
          id: "tech",
          name: "Tech",
          kind: "district",
          x: 0,
          y: 0,
          width: 20,
          height: 20,
          image: "",
          color: "",
        },
      ],
    };
    let now = Date.now();
    const config = loadConfig(),
      db = new SqliteDatabase(":memory:"),
      metrics = new MetricsTracker(config.tickRate),
      world = new World(loadMap(raw), raw, config),
      connections = new ConnectionManager(),
      engine = new EventEngine(":memory:", world.map, () => now),
      runtime = new EventRuntime(engine, world, connections),
      app = createHttpServer(world, db, metrics, config),
      wsServer = new GameWsServer(
        app.server,
        world,
        connections,
        db,
        config,
        metrics,
        pino({ level: "silent" }),
      );
    const sockets: WebSocket[] = [];
    const priorAdminToken = process.env.HEIST_ADMIN_TOKEN;
    const adminToken = randomUUID();
    process.env.HEIST_ADMIN_TOKEN = adminToken;
    let flush: NodeJS.Timeout | undefined;
    try {
      await app.listen({ port: 0, host: "127.0.0.1" });
      const address = app.server.address() as { port: number },
        base = `http://127.0.0.1:${address.port}`;
      const response = await fetch(`${base}/api/register`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          username: "event_operator",
          password: "Local-QA-only-123",
        }),
      });
      expect(response.status).toBe(201);
      const auth = (await response.json()) as {
        token: string;
        playerId: string;
      };
      const ws = new WebSocket(
        base.replace("http", "ws") + `/ws?token=${auth.token}`,
      );
      sockets.push(ws);
      const packets: any[] = [];
      ws.on("message", (b) =>
        packets.push(...decodeS2CFrame(new Uint8Array(b as Buffer))),
      );
      flush = setInterval(() => {
        for (const conn of connections.getAll())
          if (conn.outbox.length) {
            conn.send(concatMessages(conn.outbox));
            conn.outbox = [];
          }
      }, 10);
      const wait = async (check: () => boolean) => {
        const end = Date.now() + 4000;
        while (!check()) {
          if (Date.now() > end) throw new Error("Protocol result timeout");
          await new Promise((r) => setTimeout(r, 10));
        }
      };
      const events = () =>
        packets
          .filter((p) => p.opcode === S2C.JSON)
          .map((p) => JSON.parse(p.payload));
      await wait(() => events().some((e) => e.type === "event_state"));
      expect(events().find((e) => e.type === "event_state").player.homeId).toBe(
        "home-h001",
      );
      const denied = await fetch(`${base}/api/admin/event`);
      expect(denied.status).toBe(401);
      const adminAction = async (body: object) =>
        fetch(`${base}/api/admin/event`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "X-Heist-Admin": adminToken,
          },
          body: JSON.stringify(body),
        });
      const started = await adminAction({ action: "start" });
      expect(started.status).toBe(200);
      expect(((await started.json()) as { phase: string }).phase).toBe("live");
      expect(
        (
          await adminAction({
            action: "announce",
            text: "Isolated protocol rehearsal",
          })
        ).status,
      ).toBe(200);
      ws.send(
        encodeC2SJson(JSON.stringify({ type: "interact", id: "tech-jobs" })),
      );
      await wait(() =>
        events().some((e) => e.type === "interaction" && e.id === "tech-jobs"),
      );
      ws.send(encodeC2SJson(JSON.stringify({type:'game_action',action:'job',id:'ST-01',training:true})));
      await wait(()=>events().some(e=>e.type==='game_result'&&e.error&&/training is disabled/i.test(e.message)));
      expect(engine.view(auth.playerId).challenges).toHaveLength(0);
      expect(engine.ledger()).toHaveLength(0);
      ws.send(
        encodeC2SJson(
          JSON.stringify({ type: "game_action", action: "job", id: "ST-01" }),
        ),
      );
      await wait(() => engine.view(auth.playerId).challenges.length === 1);
      const challenge = engine.view(auth.playerId).challenges[0],
        state = (engine as any).state,
        attempt = state.attempts[challenge.id],
        answer = generateChallenge(
          state.secret,
          auth.playerId,
          "ST-01",
          attempt.variant,
        ).answer;
      now += 5000;
      for (let i = 0; i < 10; i++)
        ws.send(
          encodeC2SJson(
            JSON.stringify({
              type: "game_action",
              action: "answer",
              id: challenge.id,
              answer,
            }),
          ),
        );
      await wait(() => engine.view(auth.playerId).player.home === 1000);
      expect(engine.ledger()).toHaveLength(1);
      expect(engine.audit().total).toBe(400000);
      now += 150 * 60000;
      ws.send(
        encodeC2SJson(
          JSON.stringify({
            type: "game_action",
            action: "checkout",
            confirm: true,
          }),
        ),
      );
      await wait(() => engine.view(auth.playerId).player.checkedOut);
      expect(engine.view(auth.playerId).player.payout).toBe(1000);
      expect(
        world.queueMove([...world.getAllEntities()][0].id, 1, DIR.UP),
      ).toBe(false);
      expect(engine.audit().ok).toBe(true);
      ws.send(
        encodeC2SJson(
          JSON.stringify({
            type: "game_action",
            action: "answer",
            id: challenge.id,
            answer,
          }),
        ),
      );
      await wait(() =>
        events().some(
          (e) =>
            e.type === "game_result" &&
            e.error &&
            e.message === "Submissions are closed.",
        ),
      );
      const history = await fetch(
        `${base}/api/admin/history/${auth.playerId}`,
        { headers: { "X-Heist-Admin": adminToken } },
      );
      expect(history.status).toBe(200);
      const operatorHistory = (await history.json()) as ReturnType<
        EventEngine["history"]
      >;
      expect(operatorHistory.ledger).toHaveLength(2);
      expect(operatorHistory.answers).toHaveLength(1);
      expect(
        operatorHistory.requests.some(
          (r: any) => r.message === "Submissions are closed.",
        ),
      ).toBe(true);
      const frozen = await adminAction({ action: "freeze" });
      expect(frozen.status).toBe(200);
      expect(((await frozen.json()) as { phase: string }).phase).toBe("frozen");
      const closes: number[] = [];
      ws.on("close", (code) => closes.push(code));
      const twins = [
        new WebSocket(base.replace("http", "ws") + `/ws?token=${auth.token}`),
        new WebSocket(base.replace("http", "ws") + `/ws?token=${auth.token}`),
      ];
      for (const twin of twins) {
        sockets.push(twin);
        twin.on("close", (code) => closes.push(code));
      }
      await wait(
        () =>
          closes.length === 2 &&
          twins.filter((t) => t.readyState === WebSocket.OPEN).length === 1,
      );
      expect(closes).toEqual([4002, 4002]);
      expect([...connections.getAll()]).toHaveLength(1);
      expect((engine as any).state.players[auth.playerId].offlineAt).toBe(0);
    } finally {
      if (priorAdminToken === undefined) delete process.env.HEIST_ADMIN_TOKEN;
      else process.env.HEIST_ADMIN_TOKEN = priorAdminToken;
      if (flush) clearInterval(flush);
      for (const ws of sockets) ws.terminate();
      wsServer.close();
      await new Promise((r) => setTimeout(r, 20));
      runtime.stop();
      metrics.stop();
      await app.close();
      await db.close();
    }
  });
});
