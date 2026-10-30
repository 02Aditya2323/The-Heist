/** Isolated core-engine entrypoint. Production main.ts never imports this module. */
import { readFileSync } from "node:fs";
import { basename, dirname, resolve } from "node:path";
import { pino } from "pino";
import { loadMap } from "@heist/shared";
import { loadConfig } from "../config.js";
import { SqliteDatabase } from "../persistence/sqlite.js";
import { Snapshotter } from "../persistence/snapshotter.js";
import { MetricsTracker } from "../metrics/metrics.js";
import { World } from "../world/world.js";
import { TickLoop } from "../world/tick.js";
import { ConnectionManager } from "../net/connection.js";
import { GameWsServer } from "../net/ws-server.js";
import { createHttpServer } from "../http/server.js";
const fixturePath = resolve(process.env.DB_URL?.replace(/^sqlite:/, "") || ".");
if (
  process.env.HEIST_BENCHMARK !== "isolated-core" ||
  !basename(dirname(fixturePath)).startsWith("benchmark-") ||
  basename(dirname(dirname(fixturePath))) !== "bot-runs"
)
  throw Error("Requires a disposable benchmark fixture");
const config = { ...loadConfig(), host: "127.0.0.1", debugEndpoints: true };
const raw = JSON.parse(readFileSync(process.env.MAP_PATH!, "utf8")),
  world = new World(loadMap(raw), raw, config);
const logger = pino({ level: process.env.LOG_LEVEL || "warn" }),
  db = new SqliteDatabase(config.dbUrl.replace(/^sqlite:/, ""));
await db.initialize();
const metrics = new MetricsTracker(config.tickRate),
  connections = new ConnectionManager(),
  snapshotter = new Snapshotter(
    db.state,
    config.snapshotIntervalMs,
    world,
    logger,
  );
const app = createHttpServer(world, db, metrics, config),
  ws = new GameWsServer(
    app.server,
    world,
    connections,
    db,
    config,
    metrics,
    logger,
  ),
  loop = new TickLoop(world, connections, config, metrics, snapshotter, logger);
await app.listen({ host: config.host, port: config.port });
loop.start();
snapshotter.start();
let closing = false;
async function stop() {
  if (closing) return;
  closing = true;
  loop.stop();
  snapshotter.stop();
  ws.close();
  await snapshotter.flushAll();
  await app.close();
  await db.close();
  metrics.stop();
  process.exit(0);
}
process.on("SIGTERM", () => void stop());
process.on("SIGINT", () => void stop());
