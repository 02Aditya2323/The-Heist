/** Isolated, in-memory browser fixture. Never connects to or changes the real event databases. */
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { resolve } from "node:path";
import { pino } from "pino";
import { loadMap, DIR, type MapData } from "@heist/shared";
import { loadConfig } from "../apps/server/src/config.js";
import { SqliteDatabase } from "../apps/server/src/persistence/sqlite.js";
import { Snapshotter } from "../apps/server/src/persistence/snapshotter.js";
import { MetricsTracker } from "../apps/server/src/metrics/metrics.js";
import { World } from "../apps/server/src/world/world.js";
import { TickLoop } from "../apps/server/src/world/tick.js";
import { ConnectionManager } from "../apps/server/src/net/connection.js";
import { GameWsServer } from "../apps/server/src/net/ws-server.js";
import { createHttpServer } from "../apps/server/src/http/server.js";
import { EventEngine } from "../apps/server/src/game/event-engine.js";
import { EventRuntime } from "../apps/server/src/game/runtime.js";
import { CHALLENGE_CATALOGUE } from "../apps/server/src/game/challenge-catalogue.js";
const raw = JSON.parse(readFileSync("maps/art-world.json", "utf8")) as MapData;
const stationIndex = process.argv.indexOf("--station");
const stationId = stationIndex >= 0 ? process.argv[stationIndex + 1] : "logic";
const station = raw.hotspots!.find((h) => h.id === stationId);
if (!station) throw new Error(`Unknown QA station: ${stationId}`);
raw.spawns = [{ x: station.x, y: station.y }];
const config = loadConfig(),
  db = new SqliteDatabase(":memory:"),
  logger = pino({ level: "silent" }),
  metrics = new MetricsTracker(config.tickRate),
  world = new World(loadMap(raw), raw, config),
  connections = new ConnectionManager(),
  engine = new EventEngine(":memory:", world.map),
  runtime = new EventRuntime(engine, world, connections),
  app = createHttpServer(world, db, metrics, config),
  ws = new GameWsServer(
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
  tick = new TickLoop(world, connections, config, metrics, snapshots, logger);
await app.listen({ port: 0, host: "127.0.0.1" });
const port = (app.server.address() as { port: number }).port;
const register = await fetch(`http://127.0.0.1:${port}/api/register`, {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({
    username: "workbench_qa",
    password: "Local-QA-only-123",
  }),
});
const auth = (await register.json()) as { playerId: string };
if (!register.ok) throw new Error("QA fixture registration failed");
engine.ensurePlayer(auth.playerId, "workbench_qa");
const ids = [
  "ST-02",
  "ST-03",
  "SD-06",
  "SD-07",
  "SD-09",
  "SD-10",
  "EX-01",
  "EX-02",
  "EX-04",
  "EX-05",
  "BG-01",
  "BG-03",
  "GH-02",
  "BR-09",
  "BR-10",
  "BL-03",
  "ST-01",
];
const internal = engine as any;
for (const id of process.argv.includes("--contract-ux") || process.argv.includes("--empty") ||
process.argv.includes("--centres")
  ? []
  : process.argv.includes("--all")
    ? CHALLENGE_CATALOGUE.map((c) => c.id)
    : ids)
  internal.attempt(
    internal.state.players[auth.playerId],
    id,
    "training",
    Date.now() + 60 * 60000,
    "browser-fixture",
  );
if(process.argv.includes('--contract-ux')){
  // Isolated browser test only: normal live rules, no seeded solutions or real database.
  const login=await fetch(`http://127.0.0.1:${port}/api/register`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({username:'travel_qa',password:'Local-QA-only-123'})});
  const second=await login.json() as {playerId:string};if(!login.ok)throw new Error('Travel fixture registration failed');engine.ensurePlayer(second.playerId,'travel_qa');
  const gate=world.map.exits!.find(e=>e.id==='c07-back-b')!;
  await db.state.save({playerId:second.playerId,x:gate.x,y:gate.y,dir:DIR.DOWN,data:JSON.stringify({mapVersion:world.map.version}),updatedAt:new Date()});
  engine.start();
}
if (process.argv.includes("--centres")) {
  const centreTargets = raw.hotspots!.filter((h) => h.action !== "homes");
  const rows: {
    username: string;
    station: string;
    name: string;
    action: string;
    x: number;
    y: number;
  }[] = [];
  const plans = [
    ...centreTargets.map((h) => ({
      station: h.id!,
      name: h.name,
      action: h.action || "info",
      x: h.x,
      y: h.y,
    })),
    { station: "own-home", name: "Own Home", action: "homes", x: 0, y: 0 },
    {
      station: "home-h001",
      name: "Other operator Home H001",
      action: "homes",
      x: 0,
      y: 0,
    },
    {
      station: raw.hotspots!.find(
        (h) => h.action === "homes" && !h.id?.startsWith("home-h"),
      )!.id!,
      name: "Home district guide",
      action: "homes",
      x: 0,
      y: 0,
    },
  ];
  for (let index = 0; index < plans.length; index++) {
    const plan = plans[index],
      username = `centre_${String(index).padStart(2, "0")}`;
    const response = await fetch(`http://127.0.0.1:${port}/api/register`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ username, password: "Local-QA-only-123" }),
    });
    if (!response.ok) throw new Error("Centre fixture registration failed");
    const account = (await response.json()) as { playerId: string };
    engine.ensurePlayer(account.playerId, username);
    const homeId = engine.view(account.playerId).player.homeId;
    const targetId = plan.station === "own-home" ? homeId : plan.station;
    const target = raw.hotspots!.find((h) => h.id === targetId);
    if (!target) throw new Error(`Missing centre target ${targetId}`);
    await db.state.save({
      playerId: account.playerId,
      x: target.x,
      y: target.y,
      dir: DIR.DOWN,
      data: JSON.stringify({ mapVersion: world.map.version }),
      updatedAt: new Date(),
    });
    rows.push({
      ...plan,
      station: targetId,
      x: target.x,
      y: target.y,
      username,
    });
  }
  const directory = resolve("screenshots/playthrough-2026-10-14");
  mkdirSync(directory, { recursive: true });
  writeFileSync(
    resolve(directory, "centre-fixtures.json"),
    JSON.stringify({ url: `http://localhost:${port}/`, rows }, null, 2),
  );
  console.log(
    `Centre card fixture: ${rows.length} stations; private local test accounts listed in screenshots/playthrough-2026-10-14/centre-fixtures.json`,
  );
}
runtime.start();
tick.start();
console.log(
  `Isolated UI QA: http://localhost:${port}/ · station ${stationId} · existing QA login workbench_qa · ${process.argv.includes("--centres") ? "centre-card inspection accounts" : process.argv.includes("--empty") ? "empty journal" : process.argv.includes("--all") ? "all 42 challenge templates" : "all 17 workbench kinds"} · no real prizes.`,
);
async function stop() {
  tick.stop();
  snapshots.stop();
  ws.close();
  runtime.stop();
  metrics.stop();
  await app.close();
  await db.close();
  process.exit(0);
}
process.on("SIGINT", stop);
process.on("SIGTERM", stop);
