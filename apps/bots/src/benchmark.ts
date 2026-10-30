/** Reproducible active-player engine benchmark. All targets are disposable local children. */
import { spawn, execFileSync, type ChildProcess } from "node:child_process";
import {
  mkdirSync,
  readFileSync,
  writeFileSync,
  appendFileSync,
  readdirSync,
  statSync,
} from "node:fs";
import { resolve, join } from "node:path";
import { fileURLToPath } from "node:url";
import { cpus, totalmem, platform, release } from "node:os";
import { createHash, randomBytes } from "node:crypto";
import { createServer } from "node:net";
import { monitorEventLoopDelay, performance } from "node:perf_hooks";
import { hash } from "argon2";
import {
  DIR,
  loadMap,
  isWalkable,
  sceneAt,
  tryStep,
  chunkOf,
  chunkKey,
  neighbours3x3,
  findPath,
  type Direction,
} from "@heist/shared";
import { SqliteDatabase } from "../../server/dist/persistence/sqlite.js";
import { createHostingFixture } from "../../server/dist/testing/hosting-fixture.js";
import { HostingPeer } from "./hosting-peer.js";
import { Samples } from "./hosting-stats.js";
import { SeededRNG } from "./tools/random.js";
const root = resolve(fileURLToPath(new URL("../../../", import.meta.url)));
const args = new Map(
  process.argv.slice(2).map((a) => {
    const m = /^--([a-z-]+)=(.+)$/.exec(a);
    if (!m) throw Error("Use --key=value options");
    return [m[1], m[2]];
  }),
);
const known = [
  "players",
  "seconds",
  "warmup",
  "scenario",
  "aoi",
  "seed",
  "engine",
  "cleanup",
  "movement-ms",
  "interaction-seconds",
];
for (const k of args.keys())
  if (!known.includes(k)) throw Error(`Unknown option ${k}`);
function integer(k: string, d: number, min: number, max: number) {
  const v = Number(args.get(k) ?? d);
  if (!Number.isSafeInteger(v) || v < min || v > max)
    throw Error(`Invalid ${k}: ${min}..${max}`);
  return v;
}
const count = integer("players", 50, 2, 2000),
  seconds = integer("seconds", 180, 10, 3600),
  warmup = integer("warmup", 30, 0, 180),
  seed = integer("seed", 42, 0, 2147483647),
  cleanup = integer("cleanup", 32, 0, 60);
const movementMs = integer("movement-ms", 0, 0, 10000),
  interactionSeconds = integer("interaction-seconds", 20, 5, 300);
const scenario = args.get("scenario") ?? "steady",
  aoi = args.get("aoi") ?? "spatial",
  engine = args.get("engine") ?? "core";
if (
  !["steady", "hotspot", "connect-storm", "reconnect", "soak"].includes(
    scenario,
  ) ||
  !["spatial", "global"].includes(aoi) ||
  !["core", "game"].includes(engine)
)
  throw Error("Invalid scenario/aoi/engine");
if (engine === "game" && count > 60)
  throw Error(
    "Game fixture capped to the funded 60-player game; use core to benchmark the engine independently.",
  );
const directory = join(
  root,
  "bot-runs",
  `benchmark-${new Date().toISOString().replace(/[:.]/g, "-")}-${engine}-${count}-${scenario}-${aoi}`,
);
mkdirSync(directory, { recursive: true });
const map = loadMap(
    JSON.parse(readFileSync(join(root, "maps/art-world.json"), "utf8")),
  ),
  rng = new SeededRNG(seed),
  chunkSize = aoi === "global" ? Math.max(map.width, map.height) * 2 : 16;
const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));
function command(cmd: string, argv: string[]) {
  try {
    return execFileSync(cmd, argv, { encoding: "utf8" }).trim();
  } catch {
    return null;
  }
}
function artifactHash() {
  const h = createHash("sha256");
  function walk(p: string) {
    for (const name of readdirSync(p).sort()) {
      const full = join(p, name);
      if (statSync(full).isDirectory()) walk(full);
      else if (name.endsWith(".js"))
        h.update(full.slice(root.length)).update(readFileSync(full));
    }
  }
  walk(join(root, "apps/server/dist"));
  walk(join(root, "packages/shared/dist"));
  return h.digest("hex");
}
const env = {
  timestamp: new Date().toISOString(),
  loadModel: "serial-world-intents-v2",
  runnerSha256: createHash("sha256")
    .update(readFileSync(fileURLToPath(import.meta.url)))
    .update(
      readFileSync(
        new URL(
          import.meta.url.endsWith(".ts")
            ? "./hosting-peer.ts"
            : "./hosting-peer.js",
          import.meta.url,
        ),
      ),
    )
    .digest("hex"),
  cpu: cpus()[0]?.model,
  logicalCores: cpus().length,
  physicalCores:
    platform() === "darwin"
      ? Number(command("sysctl", ["-n", "hw.physicalcpu"]))
      : null,
  ramMiB: Math.round(totalmem() / 1048576),
  os: platform(),
  osRelease: release(),
  node: process.version,
  fastify: JSON.parse(
    readFileSync(join(root, "node_modules/fastify/package.json"), "utf8"),
  ).version,
  ws: JSON.parse(
    readFileSync(join(root, "node_modules/ws/package.json"), "utf8"),
  ).version,
  commit: command("git", ["rev-parse", "HEAD"]),
  dirty: !!command("git", ["status", "--porcelain"]),
  artifactSha256: artifactHash(),
  topology:
    "Separate server process; bots and server on same host, loopback. CPU/memory are server process only.",
  tickRate: 20,
  stepTicks: 5,
  tickBudgetMs: 50,
  chunkSize,
  scenario,
  aoi,
  engine,
  count,
  seconds,
  warmup,
  seed,
  logging: "warn",
  movementMs: movementMs || "WELCOME cadence × seeded 1.05–1.35 jitter",
  interactionSeconds,
  coreScope:
    engine === "core"
      ? "Production World, TickLoop, WS/auth/SQLite and interactions. Event/contract scheduler excluded."
      : "Full production server with event/contract engine and preloaded workbenches.",
};
writeFileSync(
  join(directory, "environment.json"),
  JSON.stringify(env, null, 2),
);
console.log(
  `[benchmark] ${engine} ${count} players / ${scenario} / ${aoi}; warm ${warmup}s + measure ${seconds}s\n${directory}`,
);
let child: ChildProcess | undefined, timer: NodeJS.Timeout | undefined;
const peers: HostingPeer[] = [];
let moving = false,
  cancelled = false;
process.on("SIGINT", () => {
  cancelled = true;
});
process.on("SIGTERM", () => {
  cancelled = true;
});
async function json(url: string, init: RequestInit = {}) {
  const r = await fetch(url, { ...init, signal: AbortSignal.timeout(15000) });
  if (!r.ok) throw Error(`HTTP ${r.status} ${new URL(url).pathname}`);
  return r.json() as Promise<any>;
}
async function freePort() {
  const s = createServer();
  await new Promise<void>((r) => s.listen(0, "127.0.0.1", r));
  const port = (s.address() as { port: number }).port;
  await new Promise<void>((r) => s.close(() => r()));
  return port;
}
async function stop() {
  if (timer) clearInterval(timer);
  moving = false;
  await Promise.allSettled(peers.map((p) => p.close()));
  if (child && child.exitCode === null) {
    child.kill("SIGTERM");
    await Promise.race([
      new Promise((r) => child!.once("exit", r)),
      sleep(5000),
    ]);
    if (child.exitCode === null) child.kill("SIGKILL");
  }
}
async function main() {
  const layout = scenario === "hotspot" ? "crowd" : "spread",
    dbPath = join(directory, "auth.db");
  let fixture: {
    password: string;
    adminToken: string;
    debugToken: string;
    accounts: {
      username: string;
      playerId: string;
      x: number;
      y: number;
      token?: string;
    }[];
  };
  if (engine === "game")
    fixture = await createHostingFixture(
      directory,
      map,
      count,
      layout,
      seconds + warmup + 120,
    );
  else {
    fixture = {
      password: randomBytes(18).toString("hex"),
      adminToken: randomBytes(24).toString("hex"),
      debugToken: randomBytes(24).toString("hex"),
      accounts: [],
    };
    const db = new SqliteDatabase(dbPath);
    try {
      await db.initialize();
      const passwordHash = await hash(fixture.password);
      const scenes = map.scenes!,
        points = new Map<string, { x: number; y: number }[]>();
      for (const scene of scenes) {
        const list = [];
        for (let y = scene.y; y < scene.y + scene.height; y++)
          for (let x = scene.x; x < scene.x + scene.width; x++)
            if (
              isWalkable(map, x, y) &&
              [DIR.UP, DIR.DOWN, DIR.LEFT, DIR.RIGHT].filter(
                (d) => tryStep(map, x, y, d).ok,
              ).length >= 2
            )
              list.push({ x, y });
        points.set(scene.id, list);
      }
      for (let i = 0; i < count; i++) {
        const scene =
            layout === "crowd"
              ? scenes.find((s) => s.id === "central")!
              : scenes[i % scenes.length],
          list = points.get(scene.id)!;
        let p = list[rng.int(0, list.length - 1)];
        if (layout === "crowd") {
          const central = map.spawns[0];
          p = list.reduce(
            (best, q) =>
              Math.abs(q.x - central.x) + Math.abs(q.y - central.y) <
              Math.abs(best.x - central.x) + Math.abs(best.y - central.y)
                ? q
                : best,
            p,
          );
        }
        // Ten percent start beside an authored travel gate; normal input handles every crossing.
        if (i % 10 === 0 && layout !== "crowd") {
          const gates = map.exits!.filter(
            (g) => sceneAt(map, g.x, g.y)?.id === scene.id,
          );
          if (gates.length) {
            const g = gates[0];
            p = list.reduce(
              (best, q) =>
                Math.abs(q.x - g.x) + Math.abs(q.y - g.y) <
                Math.abs(best.x - g.x) + Math.abs(best.y - g.y)
                  ? q
                  : best,
              p,
            );
          }
        }
        const playerId = randomBytes(16).toString("hex"),
          username = `bench_${String(i).padStart(4, "0")}`,
          token = randomBytes(24).toString("hex");
        await db.players.createPlayer(playerId, username, passwordHash);
        await db.sessions.createSession(token, playerId);
        await db.state.save({
          playerId,
          ...p,
          dir: DIR.DOWN,
          data: JSON.stringify({ mapVersion: map.version }),
          updatedAt: new Date(),
        });
        fixture.accounts.push({ playerId, username, token, ...p });
      }
    } finally {
      await db.close();
    }
  }
  writeFileSync(
    join(directory, "fixture-private.json"),
    JSON.stringify(fixture),
    { mode: 0o600 },
  );
  const port = await freePort(),
    origin = `http://127.0.0.1:${port}`;
  const childEnv = {
    ...process.env,
    NODE_ENV: "production",
    HOST: "127.0.0.1",
    PORT: String(port),
    DB_URL: `sqlite:${dbPath}`,
    DATABASE_BACKEND: "sqlite",
    EVENT_DB_PATH: "",
    MAP_PATH: join(root, "maps/art-world.json"),
    MAX_PLAYERS: String(count),
    TICK_RATE: "20",
    STEP_TICKS: "5",
    CHUNK_SIZE: String(chunkSize),
    MAX_PENDING_MOVES: "2",
    MSG_RATE_PER_SEC: "60",
    MSG_BURST: "100",
    HEARTBEAT_TIMEOUT_MS: "15000",
    GHOST_GRACE_MS: "30000",
    SNAPSHOT_INTERVAL_MS: "10000",
    BACKPRESSURE_BYTES: "256000",
    DEBUG_ENDPOINTS: "true",
    DEBUG_TOKEN: fixture.debugToken,
    HEIST_ADMIN_TOKEN: fixture.adminToken,
    HEIST_ADMIN_USERNAME: "",
    HEIST_ADMIN_PASSWORD: "",
    LOG_LEVEL: "warn",
    HEIST_BENCHMARK: "isolated-core",
  };
  child = spawn(
    process.execPath,
    [
      join(
        root,
        engine === "core"
          ? "apps/server/dist/testing/benchmark-server.js"
          : "apps/server/dist/main.js",
      ),
    ],
    { cwd: root, env: childEnv, stdio: ["ignore", "pipe", "pipe"] },
  );
  child.stdout?.on("data", (d) =>
    appendFileSync(join(directory, "server.log"), d),
  );
  child.stderr?.on("data", (d) =>
    appendFileSync(join(directory, "server.log"), d),
  );
  let ready = false;
  for (let i = 0; i < 100; i++) {
    try {
      await json(`${origin}/health`);
      ready = true;
      break;
    } catch {
      await sleep(200);
    }
  }
  if (!ready) throw Error("Server startup failed");
  const debug = { "x-debug-token": fixture.debugToken },
    idle = await json(`${origin}/metrics`);
  const connections = new Samples(10000),
    auth = new Samples(10000),
    ack = new Samples(200000),
    tick = new Samples(100000),
    cpu = new Samples(10000),
    rss = new Samples(10000),
    heap = new Samples(10000),
    health = new Samples(10000),
    generatorDelay = monitorEventLoopDelay({ resolution: 20 });
  generatorDelay.enable();
  let measuring = false,
    connectionAttempts = 0,
    connectionFailures = 0;
  const connectStart = performance.now();
  for (
    let start = 0;
    start < count;
    start += scenario === "connect-storm" ? count : 25
  ) {
    const batch = fixture.accounts.slice(
      start,
      start + (scenario === "connect-storm" ? count : 25),
    );
    await Promise.all(
      batch.map(async (account) => {
        connectionAttempts++;
        try {
          // Full-game validation uses real password login. Core steady-state uses fixture sessions;
          // password verification is sampled separately, outside the measured steady window.
          let token = account.token;
          if (!token) {
            const began = performance.now();
            const login = await json(`${origin}/api/login`, {
              method: "POST",
              headers: { "content-type": "application/json" },
              body: JSON.stringify({
                username: account.username,
                password: fixture.password,
              }),
            });
            token = login.token;
            auth.add(performance.now() - began);
          }
          const p = new HostingPeer(token!, account.playerId, origin, map),
            at = performance.now();
          peers.push(p);
          p.onAck = (v) => {
            if (measuring) ack.add(v);
          };
          await p.connect();
          connections.add(performance.now() - at);
        } catch {
          connectionFailures++;
        }
      }),
    );
    if (scenario !== "connect-storm") await sleep(60);
  }
  const connectSeconds = (performance.now() - connectStart) / 1000;
  if (peers.length !== count || connectionFailures)
    throw Error(
      `Connection failure: ${peers.length}/${count}, failures ${connectionFailures}`,
    );
  if (engine === "core")
    for (const a of fixture.accounts.slice(0, Math.min(count, 10))) {
      const at = performance.now();
      await json(`${origin}/api/login`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          username: a.username,
          password: fixture.password,
        }),
      });
      auth.add(performance.now() - at);
    }
  const next = peers.map(() => performance.now() + rng.int(0, 250)),
    nextInteraction = peers.map(
      () => performance.now() + rng.int(1000, interactionSeconds * 1000),
    ),
    paths = new Map<number, { x: number; y: number }[]>();
  let traversals = 0,
    interactions = 0,
    chunkCrossings = 0;
  const lastChunk = peers.map((p) => {
    const c = chunkOf(p.x, p.y, 16);
    return chunkKey(c.cx, c.cy);
  });
  timer = setInterval(() => {
    if (!moving) return;
    const now = performance.now();
    peers.forEach((p, i) => {
      if (now < next[i]) return;
      next[i] =
        now +
        Math.max(p.stepMs, movementMs || p.stepMs) * (1.05 + rng.next() * 0.3);
      const ck = chunkOf(p.x, p.y, 16),
        key = chunkKey(ck.cx, ck.cy);
      if (key !== lastChunk[i]) {
        chunkCrossings++;
        lastChunk[i] = key;
      }
      if (now >= nextInteraction[i]) {
        nextInteraction[i] =
          now + interactionSeconds * 1000 * (0.7 + rng.next() * 0.6);
        const scene = sceneAt(map, p.x, p.y)?.id;
        const target = [
          ...(i % 10 === 0 ? map.exits || [] : []),
          ...map.hotspots.filter((h) => h.id),
        ].find(
          (t) =>
            sceneAt(map, t.x, t.y)?.id === scene &&
            Math.abs(t.x - p.x) + Math.abs(t.y - p.y) <=
              ("radius" in t ? Number(t.radius) : 3),
        );
        if (target && p.interact(target.id!)) {
          interactions++;
          paths.delete(i);
          return;
        }
      }
      let direction: Direction | undefined;
      if (i % 10 === 0 && scenario !== "hotspot") {
        let path = paths.get(i);
        while (path?.length && path[0].x === p.x && path[0].y === p.y)
          path.shift();
        if (!path?.length) {
          const scene = sceneAt(map, p.x, p.y)?.id,
            gates = (map.exits || []).filter(
              (g) => sceneAt(map, g.x, g.y)?.id === scene,
            );
          const gate = gates[rng.int(0, Math.max(0, gates.length - 1))];
          if (gate) {
            const candidates = [
              { x: gate.x, y: gate.y },
              ...map.spawns.filter(
                (q) => Math.abs(q.x - gate.x) + Math.abs(q.y - gate.y) <= 2,
              ),
            ];
            for (const q of candidates) {
              path = findPath(map, p.x, p.y, q.x, q.y, 500) || undefined;
              if (path) break;
            }
            paths.set(i, path || []);
          }
        }
        if (path?.length) {
          const d = path[0];
          direction =
            d.x < p.x
              ? DIR.LEFT
              : d.x > p.x
                ? DIR.RIGHT
                : d.y < p.y
                  ? DIR.UP
                  : DIR.DOWN;
        }
      }
      const dirs = [DIR.UP, DIR.DOWN, DIR.LEFT, DIR.RIGHT].filter(
        (d) => tryStep(map, p.x, p.y, d).ok,
      );
      if (direction === undefined)
        direction =
          rng.next() < 0.65 && dirs.includes(p.dir)
            ? p.dir
            : dirs[rng.int(0, Math.max(0, dirs.length - 1))];
      if (direction !== undefined) p.move(direction);
    });
  }, 20);
  moving = true;
  const series: any[] = [];
  async function sample(phase: string) {
    const at = performance.now();
    const h = await json(`${origin}/health`);
    const m = await json(`${origin}/metrics`);
    const line = {
      at: Date.now(),
      phase,
      healthMs: performance.now() - at,
      health: h,
      ...m,
    };
    appendFileSync(
      join(directory, "metrics.ndjson"),
      JSON.stringify(line) + "\n",
    );
    if (phase === "steady") {
      series.push(line);
      health.add(line.healthMs);
      cpu.add(m.system.cpuCorePercent);
      rss.add(m.system.memoryRssMb);
      heap.add(m.system.heapUsedMb);
    }
    if (phase === "steady" || phase === "end")
      for (const t of m.measurement.tickSamplesMs) tick.add(t);
    return m;
  }
  const started = performance.now();
  while (performance.now() - started < warmup * 1000) {
    if (cancelled) throw Error("Cancelled");
    await sleep(1000);
    await sample("warmup");
  }
  moving = false;
  await Promise.all(peers.map((p) => p.drain()));
  await sleep(200);
  let aoiChecks = 0,
    aoiFailures = 0;
  async function verify() {
    const positions = await json(`${origin}/debug/positions`, {
      headers: debug,
    });
    for (const p of peers) {
      aoiChecks++;
      const self = positions.entities.find((e: any) => e.id === p.id);
      if (!self || self.x !== p.x || self.y !== p.y) {
        aoiFailures++;
        continue;
      }
      const c = chunkOf(p.x, p.y, chunkSize),
        visible = new Set(neighbours3x3(c.cx, c.cy));
      const expected = positions.entities.filter((e: any) => {
        const q = chunkOf(e.x, e.y, chunkSize);
        return e.id !== p.id && visible.has(chunkKey(q.cx, q.cy));
      });
      if (
        expected.length !== p.replica.size ||
        expected.some((e: any) => {
          const q = p.replica.get(e.id);
          return !q || q.x !== e.x || q.y !== e.y;
        })
      )
        aoiFailures++;
    }
  }
  await verify();
  const totals = () => ({
    moves: peers.reduce((n, p) => n + p.moves, 0),
    acks: peers.reduce((n, p) => n + p.acks, 0),
    replication: peers.reduce((n, p) => n + p.replicationPackets, 0),
    bytes: peers.reduce((n, p) => n + p.bytes, 0),
    teleports: peers.reduce((n, p) => n + p.teleports, 0),
  });
  const baseline = await sample("baseline"),
    before = totals(),
    ackBaseline = peers.map((p) => p.acks);
  const measureStart = performance.now();
  measuring = true;
  moving = true;
  let lastProgress = 0;
  while (performance.now() - measureStart < seconds * 1000) {
    if (cancelled) throw Error("Cancelled");
    await sleep(1000);
    const m = await sample("steady");
    const elapsed = (performance.now() - measureStart) / 1000;
    if (elapsed - lastProgress >= 30) {
      lastProgress = elapsed;
      console.log(
        `[benchmark] ${count} ${Math.round(elapsed)}/${seconds}s; ACKs ${totals().acks - before.acks}; CPU ${m.system.cpuCorePercent}%; RSS ${m.system.memoryRssMb} MiB`,
      );
    }
    if (m.system.memoryRssMb > 2000)
      throw Error("Stopped at 2 GiB server RSS safety ceiling");
  }
  moving = false;
  await Promise.all(peers.map((p) => p.drain()));
  const measureEnd = performance.now(),
    after = totals(),
    final = await sample("end");
  measuring = false;
  const elapsed = (measureEnd - measureStart) / 1000;
  await sleep(200);
  await verify();
  const generatorP99Ms = generatorDelay.percentile(99) / 1e6;
  generatorDelay.disable();
  let reconnects = 0;
  const reconnect = new Samples(10000),
    positionsBefore = peers.map((p) => ({ id: p.id, x: p.x, y: p.y }));
  const reconnectStart = performance.now();
  await Promise.all(peers.map((p) => p.close()));
  for (let i = 0; i < peers.length; i += scenario === "reconnect" ? count : 50)
    await Promise.all(
      peers
        .slice(i, i + (scenario === "reconnect" ? count : 50))
        .map(async (p) => {
          const at = performance.now();
          try {
            await p.connect();
            const old = positionsBefore[peers.indexOf(p)];
            if (p.id === old.id && p.x === old.x && p.y === old.y) reconnects++;
            reconnect.add(performance.now() - at);
          } catch {}
        }),
    );
  const reconnectSeconds = (performance.now() - reconnectStart) / 1000;
  await sleep(200);
  await verify();
  const errors = peers.reduce((n, p) => n + p.errors, 0),
    rejects = peers.reduce((n, p) => n + p.rejects, 0),
    disconnects = peers.reduce((n, p) => n + p.unexpectedDisconnects, 0);
  await Promise.all(peers.map((p) => p.close()));
  const afterDisconnect = await sample("disconnected");
  if (cleanup) await sleep(cleanup * 1000);
  const cleaned = await sample("cleanup");
  const quantile = ack.summary(),
    ticks = tick.summary(),
    cpuSummary = cpu.summary(),
    rssSummary = rss.summary(),
    heapSummary = heap.summary();
  const diff = (key: string) => final.network[key] - baseline.network[key],
    packetsIn = diff("totalPacketsIn"),
    packetsOut = diff("totalPacketsOut"),
    msgPerSec = (packetsIn + packetsOut) / elapsed;
  const tickCount =
      final.measurement.totalTicks - baseline.measurement.totalTicks,
    overruns =
      final.measurement.executionOverruns -
      baseline.measurement.executionOverruns,
    scheduleDrops =
      final.tickDuration.tickOverruns - baseline.tickDuration.tickOverruns;
  const first = series.slice(0, Math.min(60, Math.floor(series.length / 3))),
    last = series.slice(-Math.min(60, Math.floor(series.length / 3))),
    mean = (a: any[], key: string) =>
      a.reduce((n, q) => n + q.system[key], 0) / Math.max(1, a.length);
  const growth = {
    rssMiB: mean(last, "memoryRssMb") - mean(first, "memoryRssMb"),
    heapMiB: mean(last, "heapUsedMb") - mean(first, "heapUsedMb"),
  };
  const gates = {
    allConnected: series.every((s) => s.players === count),
    active: peers.every((p, i) => p.acks - ackBaseline[i] >= seconds * 1.5),
    ackIntegrity: after.moves - before.moves === after.acks - before.acks,
    protocol: errors === 0 && rejects === 0 && disconnects === 0,
    aoi: aoiFailures === 0,
    reconnect: reconnects === count,
    tickBudget:
      (ticks.p95 ?? Infinity) < 25 &&
      overruns / Math.max(1, tickCount) <= 0.001,
    effectiveTickRate: tickCount / elapsed >= 19,
    latency:
      (quantile.p95 ?? Infinity) < 150 && (quantile.p99 ?? Infinity) < 500,
    loop: Math.max(...series.map((s) => s.system.eventLoopUtilization)) < 0.95,
    cpu: (cpuSummary.mean ?? Infinity) < 150,
    memory: growth.rssMiB < 128 && growth.heapMiB < 64,
    queue: series.every(
      (s) => !s.database || (s.database.healthy && s.database.pending < 1024),
    ),
    cleanup: cleaned.players === 0 && (cleanup < 31 || cleaned.ghosts === 0),
    transport:
      diff("backpressureEvents") === 0 &&
      diff("rateLimitDrops") === 0 &&
      diff("malformedMessages") === 0,
  };
  const result = {
    schemaVersion: 1,
    status: Object.values(gates).every(Boolean) ? "PASS" : "FAIL",
    environment: env,
    measuredSeconds: elapsed,
    gates,
    connections: {
      attempts: connectionAttempts,
      failures: connectionFailures,
      ready: peers.length,
      seconds: connectSeconds,
      attemptsPerSecond: connectionAttempts / connectSeconds,
      latency: connections.summary(),
      passwordLogin: auth.summary(),
    },
    reconnect: {
      success: reconnects,
      total: count,
      percent: (reconnects / count) * 100,
      seconds: reconnectSeconds,
      latency: reconnect.summary(),
    },
    traffic: {
      packetsIn,
      packetsOut,
      packetsPerSecond: msgPerSec,
      inPerSecond: packetsIn / elapsed,
      outPerSecond: packetsOut / elapsed,
      framesInPerSecond: diff("totalMsgsIn") / elapsed,
      framesOutPerSecond: diff("totalFramesOut") / elapsed,
      bytesInPerSecond: diff("totalBytesIn") / elapsed,
      bytesOutPerSecond: diff("totalBytesOut") / elapsed,
      packetsPerPlayerPerSecond: msgPerSec / count,
      replicationDeliveries: after.replication - before.replication,
      recipientsPerAck:
        (after.replication - before.replication) /
        Math.max(1, after.acks - before.acks),
      acks: after.acks - before.acks,
    },
    latency: quantile,
    tick: {
      ...ticks,
      budgetMs: 50,
      count: tickCount,
      executionOverruns: overruns,
      overrunPercent: (100 * overruns) / Math.max(1, tickCount),
      scheduleDrops,
      effectiveHz: tickCount / elapsed,
      p95UtilizationPercent: ((ticks.p95 ?? 0) / 50) * 100,
    },
    cpu: cpuSummary,
    memory: {
      idleRssMiB: idle.system.memoryRssMb,
      rss: rssSummary,
      heap: heapSummary,
      growth,
      afterDisconnect: afterDisconnect.system,
      afterGhostExpiry: cleaned.system,
      incrementalRssMiBPerPlayer:
        ((rssSummary.mean ?? 0) - idle.system.memoryRssMb) / count,
    },
    efficiency: {
      messagesPerCpuCoreSecond:
        msgPerSec / Math.max(0.001, (cpuSummary.mean ?? 0) / 100),
      activePlayersPerCpuCore:
        count / Math.max(0.001, (cpuSummary.mean ?? 0) / 100),
      note: "Process CPU 100%=one logical core; these ratios are not hardware independent.",
    },
    loop: {
      maxIntervalP50Ms: Math.max(...series.map((s) => s.system.eventLoopP50Ms)),
      maxIntervalP95Ms: Math.max(...series.map((s) => s.system.eventLoopP95Ms)),
      maxIntervalP99Ms: Math.max(...series.map((s) => s.system.eventLoopP99Ms)),
      generatorP99Ms,
    },
    correctness: {
      aoiChecks,
      aoiFailures,
      errors,
      rejects,
      disconnects,
      chunkCrossings,
      interactions,
      regionTransitions: after.teleports - before.teleports,
      traversals,
      minMovesPerPlayer: Math.min(
        ...peers.map((p, i) => p.acks - ackBaseline[i]),
      ),
    },
    cleanup: {
      seconds: cleanup,
      players: cleaned.players,
      ghosts: cleaned.ghosts,
    },
    limitations: [
      "Local loopback; not deployed or a universal capacity guarantee.",
      "Core and game workloads are intentionally distinct.",
      "ACK samples are a bounded reservoir; retained/count/approximate are reported.",
      "Interval tick samples have one poller; no percentile-of-percentiles is used.",
      "Incoming/outgoing logical packets and batched WebSocket frames are separate.",
      "Outgoing bytes are application payload; exclude WebSocket/TLS/IP overhead.",
      "Incremental RSS per player is process delta, not object allocation size.",
      "Global comparison uses a single world-sized chunk, so production routing broadcasts to all.",
      "Sessions persist intentionally; cleanup means connected/ghost/AOI entity removal, not deleting valid logins.",
    ],
  };
  writeFileSync(
    join(directory, "result.json"),
    JSON.stringify(result, null, 2),
  );
  writeFileSync(
    join(directory, "report.md"),
    `# ${engine} engine benchmark: ${result.status}\n\n${count} active simulated players; ${scenario}; ${aoi}; ${elapsed.toFixed(1)} measured seconds.\n\n| Message/s | ACK p50 | ACK p95 | ACK p99 | Tick p95 | CPU (100%=1 core) | RSS mean MiB |\n|---:|---:|---:|---:|---:|---:|---:|\n|${msgPerSec.toFixed(1)}|${quantile.p50?.toFixed(2)}|${quantile.p95?.toFixed(2)}|${quantile.p99?.toFixed(2)}|${ticks.p95?.toFixed(3)}|${cpuSummary.mean?.toFixed(1)}|${rssSummary.mean?.toFixed(1)}|\n\nGates: ${JSON.stringify(gates)}\n\nEnvironment, exact counts, efficiency and limitations: result.json. Raw time series: metrics.ndjson. Credentials are PRIVATE.\n`,
  );
  console.log(
    `[benchmark] ${result.status} ${count}; ${msgPerSec.toFixed(0)} packets/s; ACK p95 ${quantile.p95?.toFixed(2)}ms; tick p95 ${ticks.p95?.toFixed(3)}ms; ${join(directory, "result.json")}`,
  );
  if (result.status !== "PASS") process.exitCode = 1;
}
try {
  await main();
} catch (error) {
  const failure = {
    status: "INCOMPLETE",
    environment: env,
    error: error instanceof Error ? error.message : String(error),
  };
  writeFileSync(
    join(directory, "result.json"),
    JSON.stringify(failure, null, 2),
  );
  console.error(failure.error);
  process.exitCode = 1;
} finally {
  await stop();
}
