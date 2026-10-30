/** Built-server lab certification runner. Never targets the saved event by default. */
import { spawn, type ChildProcess } from "node:child_process";
import { createServer } from "node:net";
import {
  mkdirSync,
  readFileSync,
  writeFileSync,
  appendFileSync,
  existsSync,
} from "node:fs";
import { resolve, join } from "node:path";
import { fileURLToPath } from "node:url";
import { cpus, totalmem, platform, release, hostname } from "node:os";
import {
  loadMap,
  DIR,
  tryStep,
  chunkOf,
  chunkKey,
  neighbours3x3,
  sceneAt,
  type Direction,
  type GameMap,
} from "@heist/shared";
import {
  createHostingFixture,
  type HostingFixture,
} from "../../server/dist/testing/hosting-fixture.js";
import { HostingPeer, waitFor } from "./hosting-peer.js";
import { hostingOptions, hostingGates, Samples } from "./hosting-stats.js";
import { SeededRNG } from "./tools/random.js";

const root = resolve(fileURLToPath(new URL("../../../", import.meta.url)));
const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));
const options = process.argv.includes("--help")
  ? null
  : hostingOptions(process.argv.slice(2));
if (!options) {
  console.log(`Hosting-PC suite (run npm run build first):
  npm run bots:hosting -- --profile=smoke       40 bots, two 45s layouts
  npm run bots:hosting -- --profile=lab         40 bots, two 5min layouts
  npm run bots:hosting -- --profile=soak        40 bots, one 3h crowd soak
  --bots=2..40 --seconds=15..86400 --seed=42    overrides
  --serve --port=8765                         disposable host for another test PC
  --url=http://HOST:8765 --fixture=PATH --confirm-rehearsal
                                             second-PC generator; NOT the prize server
Results and disposable databases: bot-runs/hosting-*/
Exit 0=all gates passed, 1=failed/incomplete. Fixture files contain test secrets; do not commit/share publicly.`);
} else {
  main(options).catch((error) => {
    console.error(
      "[hosting-suite]",
      error instanceof Error ? error.message : "Failed",
    );
    process.exitCode = 1;
  });
}

type Options = ReturnType<typeof hostingOptions>;
async function json(url: string, init: RequestInit = {}) {
  const response = await fetch(url, {
    ...init,
    signal: AbortSignal.timeout(15000),
  });
  if (!response.ok)
    throw new Error(`HTTP ${response.status} at ${new URL(url).pathname}`);
  return response.json() as Promise<any>;
}
async function freePort() {
  const server = createServer();
  await new Promise<void>((r, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", r);
  });
  const port = (server.address() as { port: number }).port;
  await new Promise<void>((r) => server.close(() => r()));
  return port;
}
async function stopChild(child: ChildProcess) {
  if (child.exitCode !== null || child.signalCode !== null) return;
  const exited = new Promise<void>((r) => child.once("exit", () => r()));
  child.kill("SIGTERM");
  await Promise.race([exited, sleep(5000)]);
  if (child.exitCode === null && child.signalCode === null) {
    child.kill("SIGKILL");
    await Promise.race([exited, sleep(2000)]);
  }
}
async function launch(
  directory: string,
  map: GameMap,
  opts: Options,
  layout: "crowd" | "spread",
  port: number,
) {
  mkdirSync(directory, { recursive: true });
  const fixture = await createHostingFixture(
    directory,
    map,
    opts.bots,
    layout,
    opts.seconds,
  );
  writeFileSync(
    join(directory, "fixture.json"),
    JSON.stringify(fixture, null, 2),
  );
  const child = spawn(
    process.execPath,
    [join(root, "apps/server/dist/main.js")],
    {
      cwd: root,
      windowsHide: true,
      stdio: ["ignore", "pipe", "pipe"],
      env: {
        ...process.env,
        NODE_ENV: "production",
        DATABASE_BACKEND: "sqlite",
        PORT: String(port),
        DB_URL: `sqlite:${join(directory, "auth.db")}`,
        EVENT_DB_PATH: "",
        MAP_PATH: join(root, "maps/art-world.json"),
        CLIENT_BUILD_PATH: join(root, "apps/client/dist"),
        MAX_PLAYERS: String(opts.bots),
        ALLOW_REGISTER: "true",
        DEBUG_ENDPOINTS: "true",
        DEBUG_TOKEN: fixture.debugToken,
        HEIST_ADMIN_TOKEN: fixture.adminToken,
        // Preserve production tick/security defaults even when the caller has a dev override.
        TICK_RATE: "20",
        STEP_TICKS: "5",
        CHUNK_SIZE: "16",
        MAX_PENDING_MOVES: "2",
        MSG_RATE_PER_SEC: "60",
        MSG_BURST: "100",
        HEARTBEAT_TIMEOUT_MS: "15000",
        GHOST_GRACE_MS: "30000",
        SNAPSHOT_INTERVAL_MS: "10000",
        BACKPRESSURE_BYTES: "256000",
        LOG_LEVEL: "warn",
      },
    },
  );
  child.stdout?.on("data", (data) =>
    appendFileSync(join(directory, "server.log"), data),
  );
  child.stderr?.on("data", (data) =>
    appendFileSync(join(directory, "server.log"), data),
  );
  let failure: Error | undefined;
  child.on("error", (error) => {
    failure = error;
  });
  const url = `http://127.0.0.1:${port}`;
  try {
    const end = performance.now() + 20000;
    for (;;) {
      if (failure || child.exitCode !== null)
        throw (
          failure ??
          new Error("Built server exited during startup; inspect server.log")
        );
      try {
        await json(`${url}/api/admin/event`, {
          headers: { "x-heist-admin": fixture.adminToken },
        });
        break;
      } catch {
        if (performance.now() > end)
          throw new Error("Isolated server startup timed out");
        await sleep(200);
      }
    }
  } catch (error) {
    await stopChild(child);
    throw error;
  }
  return { fixture, child, url };
}

async function main(opts: Options) {
  if (!existsSync(join(root, "apps/server/dist/main.js")))
    throw new Error("Run npm run build first");
  const runDir = join(
    root,
    "bot-runs",
    `hosting-${new Date().toISOString().replace(/[:.]/g, "-")}`,
  );
  mkdirSync(runDir, { recursive: true });
  const raw = JSON.parse(
      readFileSync(join(root, "maps/art-world.json"), "utf8"),
    ),
    map = loadMap(raw);
  const environment = {
    hostname: hostname(),
    cpu: cpus()[0]?.model,
    logicalCpus: cpus().length,
    ramMb: Math.round(totalmem() / 1048576),
    platform: platform(),
    osRelease: release(),
    node: process.version,
    topology: opts.url
      ? "separate generator / remote server"
      : "generator and separate server process on same PC",
    caveat:
      "Hardware inventory describes the generator. Server memory/CPU are reported by its metrics.",
  };
  writeFileSync(
    join(runDir, "environment.json"),
    JSON.stringify(environment, null, 2),
  );
  console.log(
    `[hosting-suite] ${opts.bots} operators; profile ${opts.profile}; ${opts.seconds}s per layout`,
  );
  console.log(`[hosting-suite] Reports: ${runDir}`);
  if (opts.serve) {
    const { fixture, child } = await launch(
      join(runDir, "host"),
      map,
      opts,
      "crowd",
      opts.port,
    );
    console.log(
      `[hosting-suite] Disposable host ready on port ${opts.port}. Copy ${join(runDir, "host", "fixture.json")} privately to the generator PC.`,
    );
    console.log(
      "[hosting-suite] Use the host LAN IP with --url, --fixture and --confirm-rehearsal. Stop with Ctrl+C. Never use the real-event port.",
    );
    const done = new Promise<void>((r) => {
      process.once("SIGINT", r);
      process.once("SIGTERM", r);
      child.once("exit", r);
    });
    await done;
    await stopChild(child);
    void fixture;
    return;
  }
  const layouts: ("crowd" | "spread")[] =
    opts.url || opts.profile === "soak" ? ["crowd"] : ["crowd", "spread"];
  const results: any[] = [];
  let cancelled = false;
  const cancel = () => {
    cancelled = true;
  };
  process.on("SIGINT", cancel);
  process.on("SIGTERM", cancel);
  try {
    for (const layout of layouts) {
      if (cancelled) throw new Error("Cancelled: no complete pass");
      const directory = join(runDir, layout);
      mkdirSync(directory, { recursive: true });
      let child: ChildProcess | undefined;
      try {
        let fixture: HostingFixture, url: string;
        if (opts.url) {
          fixture = JSON.parse(readFileSync(resolve(opts.fixture!), "utf8"));
          url = opts.url;
        } else {
          const local = await launch(
            directory,
            map,
            opts,
            layout,
            await freePort(),
          );
          child = local.child;
          fixture = local.fixture;
          url = local.url;
        }
        if (
          fixture.version !== 1 ||
          fixture.count !== opts.bots ||
          fixture.accounts.length !== opts.bots ||
          fixture.durationSeconds < opts.seconds
        )
          throw new Error(
            "Fixture must match bot count and cover requested duration",
          );
        const result = await runLayout(
          directory,
          url,
          fixture,
          map,
          opts,
          () => cancelled,
        );
        results.push(result);
        console.log(
          `[hosting-suite] ${layout}: ${result.status}; tick p99 ${result.measurements.tickP99}ms; ACK p99 ${result.measurements.ack.p99?.toFixed(1)}ms; RSS max ${result.measurements.rss.max?.toFixed(1)}MiB`,
        );
      } finally {
        if (child) await stopChild(child);
      }
    }
  } catch (error) {
    results.push({
      status: "FAIL",
      error: error instanceof Error ? error.message : "Incomplete run",
    });
  } finally {
    process.off("SIGINT", cancel);
    process.off("SIGTERM", cancel);
  }
  const passed =
    results.length === layouts.length &&
    results.every((r) => r.status === "PASS");
  const summary = {
    status: passed ? "PASS" : "FAIL",
    profile: opts.profile,
    seed: opts.seed,
    botCount: opts.bots,
    secondsPerLayout: opts.seconds,
    environment,
    results,
    limitations: [
      "Not a browser FPS test",
      "Loopback does not certify LAN/Wi-Fi latency",
      "Preloaded contract payloads are synthetic; normal challenge lifetimes/rules are unchanged",
      "Short smoke/lab tests do not certify a three-hour event or long-term memory stability",
    ],
  };
  writeFileSync(join(runDir, "summary.json"), JSON.stringify(summary, null, 2));
  const markdown = [
    `# Hosting-PC test: ${summary.status}`,
    "",
    `Bots: ${opts.bots}; ${opts.seconds}s/layout; profile: ${opts.profile}.`,
    "",
    ...results.flatMap((r) =>
      r.gates
        ? [
            `## ${r.layout}`,
            "",
            ...Object.entries(r.gates).map(
              ([name, g]: [string, any]) =>
                `- ${g.passed ? "PASS" : "FAIL"} ${name}: ${JSON.stringify(g.actual)}; ${g.expected}`,
            ),
            "",
          ]
        : [`FAIL: ${r.error}`, ""],
    ),
    "Read summary.json for hardware, coverage and limitations; metrics.ndjson preserves the full time series.",
  ];
  writeFileSync(join(runDir, "report.md"), markdown.join("\n"));
  console.log(
    `[hosting-suite] ${summary.status}: ${join(runDir, "report.md")}`,
  );
  if (!passed) process.exitCode = 1;
}

async function runLayout(
  directory: string,
  url: string,
  fixture: HostingFixture,
  map: GameMap,
  opts: Options,
  cancelled: () => boolean,
) {
  const adminHeaders = {
    "content-type": "application/json",
    "x-heist-admin": fixture.adminToken,
  };
  const debugHeaders = { "x-debug-token": fixture.debugToken };
  const initial = await json(`${url}/api/admin/event`, {
    headers: adminHeaders,
  });
  const fixtureIds = new Set(fixture.accounts.map((a) => a.playerId));
  if (
    initial.phase !== "lobby" ||
    initial.startedAt ||
    initial.players.length !== opts.bots ||
    initial.players.some((p: any) => !fixtureIds.has(p.id))
  )
    throw new Error(
      "Refusing target: expected exact fresh disposable roster, not an existing/live event",
    );
  const config = await json(`${url}/debug/config`, { headers: debugHeaders });
  const raw = await json(`${url}/api/map`);
  if (
    raw.version !== map.version ||
    raw.width !== map.width ||
    raw.height !== map.height
  )
    throw new Error("Generator and host map versions differ");
  const peers: HostingPeer[] = [];
  const auth = new Samples(),
    registration = new Samples(),
    ack = new Samples(),
    health = new Samples(),
    rss = new Samples(),
    cpu = new Samples();
  let errors = 0,
    aoiChecks = 0,
    aoiFailures = 0,
    resumes = 0,
    exercise = false,
    auditOk = false;
  let sampleCount = 0,
    tickP99 = 0,
    loopP99 = 0,
    baseline: any,
    latest: any;
  let authPeakRss = 0,
    authLoopP99 = 0;
  const warmRss: number[] = [],
    endRss: number[] = [];
  let measuredSeconds = 0;
  const rng = new SeededRNG(opts.seed);
  const crowdOrigins = fixture.accounts.map((a) => ({ x: a.x, y: a.y }));
  const scenes = new Set<string>();
  let peakVisible = 0,
    chunkCrossings = 0;
  const log = (phase: string, value: unknown) =>
    appendFileSync(
      join(directory, "metrics.ndjson"),
      JSON.stringify({ at: Date.now(), phase, value }) + "\n",
    );
  const sample = async (phase: string) => {
    const start = performance.now();
    const state = await json(`${url}/health`);
    health.add(performance.now() - start);
    if (!state.ok || state.players !== opts.bots) errors++;
    const metrics = await json(`${url}/metrics`);
    latest = metrics;
    if (
      !Number.isFinite(metrics.system.cpuCorePercent) ||
      !Number.isFinite(metrics.system.eventLoopP99Ms)
    )
      throw new Error("Host needs current build with CPU/event-loop metrics");
    log(phase, metrics);
    if (phase === "auth") {
      authPeakRss = Math.max(authPeakRss, metrics.system.memoryRssMb);
      authLoopP99 = Math.max(authLoopP99, metrics.system.eventLoopP99Ms);
    }
    if (phase !== "steady") return;
    sampleCount++;
    tickP99 = Math.max(tickP99, metrics.tickDuration.p99Ms);
    loopP99 = Math.max(loopP99, metrics.system.eventLoopP99Ms);
    rss.add(metrics.system.memoryRssMb);
    cpu.add(metrics.system.cpuCorePercent);
    if (measuredSeconds >= 60 && measuredSeconds < 180)
      warmRss.push(metrics.system.memoryRssMb);
    endRss.push(metrics.system.memoryRssMb);
    if (endRss.length > 60) endRss.shift();
  };
  const verify = async () => {
    await Promise.all(peers.map((p) => p.drain()));
    await sleep(250);
    const data = await json(`${url}/debug/positions`, {
      headers: debugHeaders,
    });
    const byId = new Map<number, any>(data.entities.map((e: any) => [e.id, e]));
    for (const p of peers) {
      aoiChecks++;
      const self = byId.get(p.id);
      if (!self || self.x !== p.x || self.y !== p.y) {
        aoiFailures++;
        continue;
      }
      const keys = new Set(
        neighbours3x3(
          chunkOf(self.x, self.y, config.chunkSize).cx,
          chunkOf(self.x, self.y, config.chunkSize).cy,
        ),
      );
      const expected = data.entities.filter((e: any) => {
        const chunk = chunkOf(e.x, e.y, config.chunkSize);
        return e.id !== p.id && keys.has(chunkKey(chunk.cx, chunk.cy));
      });
      if (
        expected.length !== p.replica.size ||
        expected.some((e: any) => {
          const copy = p.replica.get(e.id);
          return !copy || copy.x !== e.x || copy.y !== e.y;
        })
      )
        aoiFailures++;
    }
  };
  try {
    // Real password verification; 40 simultaneous requests exercise the libuv hash pool.
    await Promise.all(
      fixture.accounts.map(async (account) => {
        const start = performance.now();
        const login = await json(`${url}/api/login`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            username: account.username,
            password: fixture.password,
          }),
        });
        auth.add(performance.now() - start);
        peers.push(new HostingPeer(login.token, login.playerId, url, map));
      }),
    );
    peers.sort(
      (a, b) =>
        fixture.accounts.findIndex((q) => q.playerId === a.playerId) -
        fixture.accounts.findIndex((q) => q.playerId === b.playerId),
    );
    await Promise.all(peers.map((p) => p.connect()));
    await waitFor(
      () => peers.every((p) => p.event?.challenges.length === 5),
      "Missing mixed workbench state",
    );
    await json(`${url}/api/admin/event`, {
      method: "POST",
      headers: adminHeaders,
      body: JSON.stringify({ action: "start" }),
    });
    await waitFor(
      () => peers.every((p) => p.event?.phase === "live"),
      "Missing live event state",
    );
    // Real registration/hash burst alongside 40 connected operators. These extra
    // auth-only accounts never connect or consume the event's enrollment places.
    let registering = true;
    const storm = Promise.all(
      Array.from({ length: opts.bots }, async (_, i) => {
        const start = performance.now();
        await json(`${url}/api/register`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            username: `burst_${i}`,
            password: fixture.password,
          }),
        });
        registration.add(performance.now() - start);
      }),
    ).finally(() => {
      registering = false;
    });
    // Attach rejection handling immediately while the metric sampler is running.
    let registrationError: unknown;
    const settledStorm = storm.catch((error) => {
      registrationError = error;
    });
    while (registering) {
      await sleep(250);
      await sample("auth");
    }
    await settledStorm;
    if (registrationError) throw registrationError;
    // Correctness under concurrent state delivery. The Starter award this
    // produces is a conserved transfer from POOL_STARTER on a disposable world.
    const first = peers[0],
      fare = first.event!.challenges.find((c) => c.title.startsWith("ST-01"))!;
    const numbers = fare.workbench?.code
      ?.match(/\{\s*(-?\d+(?:\s*,\s*-?\d+)*)\s*\}/)?.[1]
      .split(",")
      .map(Number);
    if (!numbers?.length)
      throw new Error("Preloaded payload no longer matches the fare exercise");
    first.sendJson({
      type: "game_action",
      action: "answer",
      id: fare.id,
      answer: String(numbers.filter((n) => n > 0).reduce((a, b) => a + b, 0)),
    });
    await waitFor(
      () => !!first.event?.challenges.find((c) => c.id === fare.id)?.solved,
      // Carries the server's own words. A bare "not verified" says nothing about
      // whether the answer was wrong or a guard refused the submission.
      () =>
        `Preloaded answer not verified by server. Last replies: ${JSON.stringify(
          first.results.slice(-3),
        )}`,
    );
    const machine = first.event!.challenges.find(
      (c) => c.workbench?.kind === "machine",
    );
    if (!machine) throw new Error("Fixture is missing machine workbench");
    first.sendJson({
      type: "game_action",
      action: "probe",
      id: machine.id,
      input: "12",
    });
    await waitFor(
      () =>
        (first.event?.challenges.find((c) => c.id === machine.id)?.testRuns ??
          0) === 1,
      "Machine probe not verified",
    );
    // The exercise proves the server really verified the work under load: the
    // answer was accepted and the machine probe ran. It used to also require
    // the player's balance to stay at zero, which held only because the
    // payloads were training copies that pay nothing. They are paid contracts
    // now, so the Starter award is expected; what matters is that the award is
    // a conserved transfer rather than created money, which the ledger audit
    // alongside this flag already asserts.
    const fareSolved = !!first.event!.challenges.find((c) => c.id === fare.id)
      ?.solved;
    const probeRan =
      (first.event!.challenges.find((c) => c.id === machine.id)?.testRuns ??
        0) === 1;
    exercise = fareSolved && probeRan;
    await verify();
    await sample("warmup");
    baseline = latest;
    const began = performance.now(),
      deadline = began + opts.seconds * 1000;
    const nextMoves = peers.map((p, i) => began + i * 3),
      nextSync = peers.map((_, i) => began + 5000 + i * 20);
    let nextSample = began + 1000,
      nextVerify = began + 30000;
    while (performance.now() < deadline) {
      if (cancelled()) throw new Error("Cancelled before complete test");
      const now = performance.now();
      measuredSeconds = (now - began) / 1000;
      for (let i = 0; i < peers.length; i++) {
        const p = peers[i];
        peakVisible = Math.max(peakVisible, p.replica.size);
        const scene = sceneAt(map, p.x, p.y);
        if (scene) scenes.add(scene.id);
        if (now >= nextSync[i]) {
          p.sendJson({ type: "game_action", action: "sync" });
          nextSync[i] = now + 5000;
        }
        if (now < nextMoves[i]) continue;
        const directions = rng.shuffle<Direction>([
          DIR.UP,
          DIR.DOWN,
          DIR.LEFT,
          DIR.RIGHT,
        ]);
        const dir = directions.find((d) => {
          const s = tryStep(map, p.x, p.y, d);
          return (
            s.ok &&
            (fixture.layout !== "crowd" ||
              Math.abs(s.x - crowdOrigins[i].x) +
                Math.abs(s.y - crowdOrigins[i].y) <=
                8)
          );
        });
        if (dir !== undefined) {
          const old = chunkOf(p.x, p.y, config.chunkSize),
            s = tryStep(map, p.x, p.y, dir);
          if (p.move(dir) && s.ok) {
            const next = chunkOf(s.x, s.y, config.chunkSize);
            if (next.cx !== old.cx || next.cy !== old.cy) chunkCrossings++;
          }
        }
        nextMoves[i] = now + p.stepMs + p.tickMs; // WELCOME cadence; never catch up in bursts.
      }
      if (now >= nextSample) {
        await sample("steady");
        nextSample = performance.now() + 1000;
      }
      if (now >= nextVerify && deadline - now > 2000) {
        await verify();
        nextVerify = performance.now() + 30000;
        for (let i = 0; i < peers.length; i++)
          nextMoves[i] = performance.now() + peers[i].stepMs + peers[i].tickMs;
      }
      await sleep(10);
    }
    await verify();
    await sample("steady");
    const before = peers.map((p) => ({
      id: p.id,
      x: p.x,
      y: p.y,
      phase: p.event?.phase,
    }));
    await Promise.all(peers.map((p) => p.close()));
    await sleep(750);
    const disconnected = await json(`${url}/metrics`);
    log("disconnect-storm", disconnected);
    await Promise.all(peers.map((p) => p.connect()));
    await waitFor(
      () => peers.every((p) => p.event?.phase === "live"),
      "Reconnect event state timed out",
    );
    peers.forEach((p, i) => {
      if (p.x === before[i].x && p.y === before[i].y && p.id === before[i].id)
        resumes++;
    });
    await verify();
    await sample("reconnect");
    const final = await json(`${url}/api/admin/event`, {
      headers: adminHeaders,
    });
    auditOk = final.audit.ok && final.audit.total === initial.audit.expected;
    log("audit", { ok: final.audit.ok, total: final.audit.total });
    // Worst per-operator percentile, without retaining unbounded raw ACK samples.
    const peerStats = peers.map((p) => ({
      player: fixture.accounts.find((a) => a.playerId === p.playerId)!.username,
      moves: p.moves,
      acks: p.acks,
      rejects: p.rejects,
      bytesReceived: p.bytes,
      averageReceiveKbPerSec: p.bytes / 1024 / opts.seconds,
      rtt: p.rtt.summary(),
    }));
    peerStats.forEach((p) => {
      if (p.rtt.p99 !== null) ack.add(p.rtt.p99);
    });
    const delta = (section: string, key: string) =>
      latest[section][key] - baseline[section][key];
    const mean = (values: number[]) =>
      values.reduce((a, b) => a + b, 0) / values.length;
    const rssGrowth =
      opts.seconds >= 600 && warmRss.length && endRss.length
        ? mean(endRss) - mean(warmRss)
        : null;
    const measurements = {
      auth: auth.summary(),
      registration: registration.summary(),
      authPeakRss,
      authLoopP99,
      ack: {
        p99: ack.summary().max,
        definition: "worst per-operator ACK p99 (bounded reservoirs)",
      },
      health: health.summary(),
      rss: rss.summary(),
      cpu: cpu.summary(),
      loopP99,
      tickP99,
      rssGrowth,
      overruns: delta("tickDuration", "tickOverruns"),
      backpressure: delta("network", "backpressureEvents"),
      malformed: delta("network", "malformedMessages"),
      rateDrops: delta("network", "rateLimitDrops"),
    };
    const gates = hostingGates({
      connected: peers.filter((p) => p.welcomed).length,
      expected: opts.bots,
      moves: peers.reduce((n, p) => n + p.moves, 0),
      acks: peers.reduce((n, p) => n + p.acks, 0),
      rejects: peers.reduce((n, p) => n + p.rejects, 0),
      errors: errors + peers.reduce((n, p) => n + p.errors, 0),
      disconnects: peers.reduce((n, p) => n + p.unexpectedDisconnects, 0),
      aoiChecks,
      aoiFailures,
      resumes,
      eventStates: peers.reduce((n, p) => n + p.eventStates, 0),
      exercise,
      auditOk,
      coverageOk:
        fixture.layout === "crowd"
          ? peakVisible >= opts.bots - 1
          : scenes.size >= Math.min(opts.bots, map.scenes?.length ?? 1),
      metrics: sampleCount,
      tickP99,
      overruns: measurements.overruns,
      backpressure: measurements.backpressure,
      malformed: measurements.malformed,
      rateDrops: measurements.rateDrops,
      ackP99: measurements.ack.p99,
      healthP99: health.summary().p99,
      rssMax: rss.summary().max ?? Infinity,
      rssGrowth,
      loopP99,
      cpuMean: cpu.summary().mean,
      remote: !!opts.url,
    });
    const result = {
      layout: fixture.layout,
      status: Object.values(gates).every((g) => g.passed) ? "PASS" : "FAIL",
      seconds: opts.seconds,
      gates,
      measurements,
      coverage: {
        scenes: [...scenes],
        peakVisible,
        chunkCrossings,
        aoiChecks,
        aoiFailures,
      },
      serverHostMemoryMb: latest.system.hostTotalMemoryMb,
      perBot: peerStats,
    };
    writeFileSync(
      join(directory, "result.json"),
      JSON.stringify(result, null, 2),
    );
    return result;
  } finally {
    await Promise.all(peers.map((p) => p.close()));
  }
}
