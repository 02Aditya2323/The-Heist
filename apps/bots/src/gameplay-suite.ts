/** Real acquisition/competition/finance through public APIs on an owned disposable built server. */
import { spawn, type ChildProcess } from "node:child_process";
import { createServer } from "node:net";
import { randomBytes } from "node:crypto";
import {
  mkdirSync,
  appendFileSync,
  writeFileSync,
  readFileSync,
  existsSync,
} from "node:fs";
import { resolve, join } from "node:path";
import { fileURLToPath } from "node:url";
import { cpus, totalmem } from "node:os";
import { DatabaseSync } from "node:sqlite";
import {
  loadMap,
  findPath,
  pathToDirections,
  sceneAt,
  type GameMap,
  type Direction,
  type ChallengeView,
  type EventRequest,
} from "@heist/shared";
import { HostingPeer, waitFor } from "./hosting-peer.js";
import { SeededRNG } from "./tools/random.js";
import { Samples } from "./hosting-stats.js";
import { solvePublicChallenge } from "./gameplay-solver.js";
import { gameplayOptions } from "./gameplay-options.js";

const root = resolve(fileURLToPath(new URL("../../../", import.meta.url)));
const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));
const supported = new Set([
  "ST-01",
  "ST-02",
  "ST-03",
  "SD-01",
  "SD-02",
  "SD-03",
  "SD-04",
  "SD-05",
  "SD-06",
  "SD-07",
  "SD-08",
  "SD-09",
  "SD-10",
  "EX-01",
  "EX-02",
  "EX-03",
  "EX-04",
  "EX-05",
  "RC-01",
  "RC-02",
  "RC-03",
]);

if (process.argv.includes("--help"))
  console.log(`Real-game player bots (build first):
  npm run bots:gameplay                         40 bots; complete 10-minute test timeline
  npm run bots:gameplay -- --bots=40 --seconds=900 --event-minutes=180 --seed=42
                                               normal 3-hour timeline; first 15 min only
  --bots=8..40 --seconds=150..11000 --event-minutes=10..180 --seed=0..2147483647
Fresh disk-backed server only; no target URL, injected contracts, answer seeds or debug endpoints.
Shortened timeline scales schedule milestones, NOT movement, locks, raid/withdrawal durations or cooldowns.
Reports/private test credentials/backups in Git-ignored bot-runs/gameplay-*. Nothing resets/deletes the real event.`);
else
  main().catch((e) => {
    console.error("[gameplay]", e instanceof Error ? e.message : e);
    process.exitCode = 1;
  });

async function requestJson(url: string, init: RequestInit = {}) {
  const response = await fetch(url, {
    ...init,
    signal: AbortSignal.timeout(15000),
  });
  if (!response.ok)
    throw new Error(`HTTP ${response.status}: ${new URL(url).pathname}`);
  return response.json() as Promise<any>;
}
async function freePort() {
  const socket = createServer();
  await new Promise<void>((r, j) => {
    socket.once("error", j);
    socket.listen(0, "127.0.0.1", r);
  });
  const port = (socket.address() as { port: number }).port;
  await new Promise<void>((r) => socket.close(() => r()));
  return port;
}
async function stopChild(child: ChildProcess) {
  if (child.exitCode !== null || child.signalCode !== null) return;
  const ended = new Promise<void>((r) => child.once("exit", () => r()));
  child.kill("SIGTERM");
  await Promise.race([ended, sleep(5000)]);
  if (child.exitCode === null && child.signalCode === null) {
    child.kill("SIGKILL");
    await Promise.race([ended, sleep(2000)]);
  }
}
function preservedLobby(directory: string) {
  const backups = join(directory, "preserved-lobby");
  mkdirSync(backups, { recursive: true });
  let before: unknown;
  for (const name of ["heist.db", "heist.db.event.db"]) {
    const source = join(root, "apps/server/data", name);
    if (!existsSync(source)) continue;
    const db = new DatabaseSync(source, { readOnly: true });
    try {
      // SQLite creates a consistent standalone snapshot including committed WAL data.
      db.exec(`VACUUM INTO '${join(backups, name).replaceAll("'", "''")}'`);
      if (name.endsWith(".event.db")) {
        const row = db
          .prepare("SELECT data FROM event_state WHERE id=1")
          .get() as { data: string };
        const state = JSON.parse(row.data);
        before = {
          phase: state.phase,
          startedAt: state.startedAt,
          roster: Object.keys(state.players).sort(),
          accounts: state.accounts,
        };
      }
    } finally {
      db.close();
    }
  }
  return before;
}
function readLobby() {
  const file = join(root, "apps/server/data/heist.db.event.db");
  if (!existsSync(file)) return undefined;
  const db = new DatabaseSync(file, { readOnly: true });
  try {
    const state = JSON.parse(
      (
        db.prepare("SELECT data FROM event_state WHERE id=1").get() as {
          data: string;
        }
      ).data,
    );
    return {
      phase: state.phase,
      startedAt: state.startedAt,
      roster: Object.keys(state.players).sort(),
      accounts: state.accounts,
    };
  } finally {
    db.close();
  }
}

class PlayerBot {
  readonly rng: SeededRNG;
  readonly scenes = new Set<string>();
  readonly solved = new Set<string>();
  paid = 0;
  activityClears = 0;
  raceClears = 0;
  queueJoins = 0;
  offers = 0;
  deposits = 0;
  withdrawals = 0;
  homes = 0;
  races = 0;
  checkout = false;
  resumes = 0;
  failures: string[] = [];
  private nextMoveAt = 0;
  constructor(
    readonly index: number,
    readonly peer: HostingPeer,
    private map: GameMap,
    private log: (value: unknown) => void,
    private alive: () => boolean,
    seed: number,
  ) {
    this.rng = new SeededRNG(seed + index);
  }
  record(value: object) {
    this.log({ at: Date.now(), bot: this.index, ...value });
  }
  async action(value: Omit<EventRequest, "type">, allowed?: RegExp) {
    const count = this.peer.resultCount;
    this.peer.sendJson({ type: "game_action", ...value });
    await waitFor(
      () => this.peer.resultCount > count,
      `Bot ${this.index}: ${value.action} response missing`,
    );
    const result = this.peer.results.at(-1)!;
    this.record({
      action: value.action,
      template: value.id?.split(":").at(-1),
      ...result,
    });
    if (result.error && !allowed?.test(result.message))
      throw new Error(`${value.action}: ${result.message}`);
    return result;
  }
  async observe() {
    const count = this.peer.eventStates;
    await this.action({ action: "sync" });
    await waitFor(
      () => this.peer.eventStates > count,
      "Missing refreshed player state",
    );
  }
  async walk(x: number, y: number) {
    const path = findPath(this.map, this.peer.x, this.peer.y, x, y);
    if (!path)
      throw new Error(
        `No walkable path from ${this.peer.x},${this.peer.y} to ${x},${y}`,
      );
    for (const dir of pathToDirections(this.peer.x, this.peer.y, path)) {
      if (!this.alive()) return false;
      const view = this.peer.event;
      // Do not send inputs into the normal end-of-event/Checkout movement lock.
      if (
        view &&
        (view.phase === "frozen" ||
          view.player.checkedOut ||
          (view.startedAt > 0 &&
            Date.now() >= view.startedAt + view.durationMs - 1250))
      )
        return false;
      await sleep(Math.max(0, this.nextMoveAt - performance.now()));
      if (!this.peer.move(dir as Direction))
        throw new Error("Collision/cadence blocked planned path");
      this.nextMoveAt = performance.now() + this.peer.stepMs + 15;
      await this.peer.drain();
      const scene = sceneAt(this.map, this.peer.x, this.peer.y);
      if (scene) this.scenes.add(scene.id);
    }
    return true;
  }
  async travel(target: { x: number; y: number }) {
    const destination = sceneAt(this.map, target.x, target.y)?.id,
      source = sceneAt(this.map, this.peer.x, this.peer.y)?.id;
    if (!source || !destination) throw new Error("Unknown city scene");
    if (source !== destination) {
      // Authored exits are public map data; use ordinary nearby interaction at each entrance.
      const queue: { scene: string; exits: NonNullable<GameMap["exits"]> }[] = [
          { scene: source, exits: [] },
        ],
        seen = new Set([source]);
      let route: NonNullable<GameMap["exits"]> | undefined;
      for (let at = 0; at < queue.length; at++) {
        const node = queue[at];
        if (node.scene === destination) {
          route = node.exits;
          break;
        }
        for (const exit of this.map.exits ?? []) {
          if (sceneAt(this.map, exit.x, exit.y)?.id !== node.scene) continue;
          const next = sceneAt(this.map, exit.targetX, exit.targetY)?.id;
          if (!next || seen.has(next)) continue;
          seen.add(next);
          queue.push({ scene: next, exits: [...node.exits, exit] });
        }
      }
      if (!route)
        throw new Error(`No authored route ${source} → ${destination}`);
      for (const exit of route) {
        if (!(await this.walk(exit.x, exit.y))) return false;
        const count = this.peer.teleports,
          errors = this.peer.errors;
        this.peer.sendJson({ type: "interact", id: exit.id });
        await waitFor(
          () => this.peer.teleports > count || this.peer.errors > errors,
          "Missing district entrance response",
        );
        if (this.peer.errors > errors)
          throw new Error("Server refused normal entrance travel");
        this.nextMoveAt = performance.now() + this.peer.stepMs + 15;
        this.record({
          action: "travel",
          exit: exit.id,
          destination: sceneAt(this.map, this.peer.x, this.peer.y)?.id,
        });
      }
    }
    return this.walk(target.x, target.y);
  }
  async terminal(station: string) {
    const target = this.map.hotspots.find((h) => h.id === station);
    if (!target) throw new Error(`Missing terminal ${station}`);
    if (!(await this.travel(target))) return false;
    const count = this.peer.interactionCount,
      errors = this.peer.errors;
    this.peer.sendJson({ type: "interact", id: station });
    await waitFor(
      () =>
        (this.peer.interactions.at(-1)?.id === station &&
          this.peer.interactionCount > count) ||
        this.peer.errors > errors,
      "Terminal inspection timed out",
    );
    if (this.peer.errors > errors)
      throw new Error(`Server refused nearby ${station}`);
    this.record({ action: "inspect", station });
    return true;
  }
  async acquire(template: string) {
    const job = this.peer.event!.jobs.find((j) => j.id === template)!;
    if (!job) throw new Error(`Unknown public job ${template}`);
    if (!(await this.terminal(job.station!))) return;
    const result = await this.action(
      { action: "job", id: template },
      /No eligible paid slot|already queued|claim has been used|already claimed|current lock|CAPPED|Maximum two queues/,
    );
    if (result.error) return;
    if (result.message.startsWith("Queued")) {
      this.queueJoins++;
      return;
    }
    await waitFor(
      () =>
        !!this.peer.event?.challenges.find(
          (c) => c.title.startsWith(`${template} · `) && !c.solved,
        ),
      "Contract missing after acquisition",
    );
    return this.peer.event!.challenges.find(
      (c) => c.title.startsWith(`${template} · `) && !c.solved,
    )!;
  }
  async solve(challenge: ChallengeView) {
    const answer = solvePublicChallenge(challenge);
    // Human-like briefing/thinking time, always beyond authoritative minimum and cooldown.
    const reading = 6000 + this.rng.int(0, 5000);
    await sleep(reading);
    const current = this.peer.event!.challenges.find(
      (c) => c.id === challenge.id,
    );
    if (
      !this.alive() ||
      !current ||
      current.solved ||
      current.expiresAt <= this.peer.event!.serverTime
    )
      return false;
    const ready = Math.max(
      current.openedAt! + (current.minimumSolveMs ?? 0),
      current.answerReadyAt ?? 0,
      current.blockedUntil ?? 0,
    );
    await sleep(Math.max(0, ready - this.peer.event!.serverTime) + 100);
    if (
      challenge.workbench?.kind === "debug" ||
      challenge.workbench?.kind === "machine"
    )
      await this.action({
        action: "probe",
        id: challenge.id,
        input: answer,
      });
    const result = await this.action({
      action: "answer",
      id: challenge.id,
      answer,
    });
    if (
      !result.message.startsWith("Correct") &&
      !result.message.includes("cleared") &&
      !result.message.includes("accepted")
    )
      throw new Error(
        `Solution rejected: ${challenge.title}: ${result.message}`,
      );
    this.solved.add(challenge.title.split(" · ")[0]);
    if (challenge.reward > 0) this.paid++;
    else if (challenge.id.includes(":race:")) this.raceClears++;
    else this.activityClears++;
    this.record({
      action: "solve-confirmed",
      title: challenge.title,
      reward: challenge.reward,
    });
    return true;
  }
  async loop() {
    let bankTried = false,
      homeTried = false,
      raceTried = false;
    while (
      this.alive() &&
      this.peer.event?.phase === "live" &&
      !this.peer.event.player.checkedOut
    ) {
      const view = this.peer.event!;
      const minute =
        ((view.serverTime - view.startedAt) / view.durationMs) * 180;
      if (minute >= 150) {
        if (await this.terminal("checkout")) {
          await this.action({ action: "checkout", confirm: true });
          this.checkout = true;
        }
        return;
      }
      const offer = view.queues.find(
        (q) => q.offerUntil > view.serverTime && q.position === 0,
      );
      if (offer) {
        await this.action({ action: "accept_queue", id: offer.id });
        this.offers++;
        continue;
      }
      const active = view.challenges.find(
        (c) => !c.solved && supported.has(c.title.split(" · ")[0]),
      );
      if (active) {
        await this.solve(active);
        continue;
      }
      if (
        !bankTried &&
        minute >= 10 &&
        view.player.home >= 1000 &&
        this.index % 4 === 0
      ) {
        bankTried = true;
        if (!(await this.terminal("bank"))) return;
        const deposited = await this.action(
          { action: "deposit", amount: 500 },
          /Bank is locked/,
        );
        if (!deposited.error) {
          this.deposits++;
          await this.action({ action: "withdraw", amount: 200 });
          this.withdrawals++;
        }
        continue;
      }
      const race = view.activities.find(
        (a) =>
          a.id.startsWith("RC-") &&
          a.startsAt <= view.serverTime &&
          a.endsAt > view.serverTime,
      );
      if (!raceTried && race && this.index % 3 === 0) {
        raceTried = true;
        if (!(await this.terminal("race"))) return;
        const result = await this.action(
          { action: "race_enter", id: race.id },
          /unavailable|closed/,
        );
        if (!result.error) {
          this.races++;
        }
        continue;
      }
      if (!homeTried && this.index % 4 === 1 && view.player.completed >= 1) {
        homeTried = true;
        const home = this.map.homePlots?.find(
          (h) => h.id === this.peer.event!.player.homeId,
        );
        if (!home) throw new Error("Assigned Home missing");
        if (!(await this.travel(home))) return;
        await this.action({ action: "enter_home" });
        await sleep(2000);
        await this.action({ action: "leave_home" });
        this.homes++;
        continue;
      }
      const jobs = view.jobs.filter(
        (j) => j.available && j.tier !== "ST" && supported.has(j.id),
      );
      if (jobs.length && this.rng.int(0, 2) !== 0) {
        const job = jobs[this.rng.int(0, jobs.length - 1)];
        const challenge = await this.acquire(job.id);
        if (challenge) await this.solve(challenge);
        else await sleep(1500);
        continue;
      }
      const station = this.map.hotspots.filter((h) => h.action === "jobs")[
        this.rng.int(
          0,
          this.map.hotspots.filter((h) => h.action === "jobs").length - 1,
        )
      ];
      if (!(await this.terminal(station.id!))) return;
      await sleep(2000 + this.rng.int(0, 4000));
    }
  }
  summary() {
    return {
      bot: this.index,
      moves: this.peer.moves,
      acks: this.peer.acks,
      rejects: this.peer.rejects,
      protocolErrors: this.peer.errors,
      kicks: this.peer.kicks,
      unexpectedDisconnects: this.peer.unexpectedDisconnects,
      teleports: this.peer.teleports,
      scenes: [...this.scenes],
      solved: [...this.solved],
      paid: this.paid,
      activityClears: this.activityClears,
      raceClears: this.raceClears,
      queueJoins: this.queueJoins,
      offers: this.offers,
      deposits: this.deposits,
      withdrawals: this.withdrawals,
      homes: this.homes,
      races: this.races,
      checkout: this.checkout,
      resumes: this.resumes,
      ack: this.peer.rtt.summary(),
      failures: this.failures,
    };
  }
}

async function main() {
  const opts = gameplayOptions(process.argv.slice(2));
  if (!existsSync(join(root, "apps/server/dist/main.js")))
    throw new Error("Build first");
  const directory = join(
    root,
    "bot-runs",
    `gameplay-${new Date().toISOString().replace(/[:.]/g, "-")}`,
  );
  mkdirSync(directory, { recursive: true });
  const lobbyBefore = preservedLobby(directory);
  const adminToken = randomBytes(32).toString("hex"),
    password = randomBytes(24).toString("hex"),
    port = await freePort(),
    url = `http://127.0.0.1:${port}`;
  const child = spawn(
    process.execPath,
    ["--max-old-space-size=1024", join(root, "apps/server/dist/main.js")],
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
        HEIST_ADMIN_TOKEN: adminToken,
        DEBUG_ENDPOINTS: "false",
        ALLOW_REGISTER: "true",
        MAX_PLAYERS: String(opts.bots),
        EVENT_DURATION_MINUTES: String(opts.eventMinutes),
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
        UV_THREADPOOL_SIZE: "4",
        LOG_LEVEL: "warn",
      },
    },
  );
  child.stdout?.on("data", (b) =>
    appendFileSync(join(directory, "server.log"), b),
  );
  child.stderr?.on("data", (b) =>
    appendFileSync(join(directory, "server.log"), b),
  );
  let spawnFailure: Error | undefined;
  child.on("error", (e) => (spawnFailure = e));
  let cancelled = false,
    ended = false,
    start = 0;
  const cancel = () => {
    cancelled = true;
  };
  process.once("SIGINT", cancel);
  process.once("SIGTERM", cancel);
  const bots: PlayerBot[] = [],
    gates: Record<string, { passed: boolean; detail: unknown }> = {};
  let final: any;
  let timer: NodeJS.Timeout | undefined,
    sampling = false;
  const resources = {
    rss: new Samples(),
    cpu: new Samples(),
    health: new Samples(),
    tick: new Samples(),
    loop: new Samples(),
  };
  let metricError: string | undefined;
  let lastMetrics: any;
  const trace = (value: unknown) =>
    appendFileSync(
      join(directory, "actions.ndjson"),
      JSON.stringify(value) + "\n",
    );
  const gate = (name: string, passed: boolean, detail: unknown) => {
    gates[name] = { passed, detail };
    console.log(
      `[gameplay] ${passed ? "PASS" : "FAIL"} ${name}: ${JSON.stringify(detail)}`,
    );
    if (!passed) throw new Error(`Gate failed: ${name}`);
  };
  const admin = (action?: string) =>
    requestJson(`${url}/api/admin/event`, {
      headers: {
        "content-type": "application/json",
        "x-heist-admin": adminToken,
      },
      ...(action ? { method: "POST", body: JSON.stringify({ action }) } : {}),
    });
  const alive = () =>
    !cancelled &&
    !ended &&
    (!start || Date.now() < start + opts.seconds * 1000);
  console.log(
    `[gameplay] Fresh live test: ${url}; ${opts.bots} players; ${opts.eventMinutes}-minute timeline; reports ${directory}`,
  );
  const sample = async () => {
    if (sampling) return;
    sampling = true;
    try {
      const t = performance.now();
      await requestJson(`${url}/health`);
      resources.health.add(performance.now() - t);
      const m = await requestJson(`${url}/metrics`);
      lastMetrics = m;
      resources.rss.add(m.system.memoryRssMb);
      resources.cpu.add(m.system.cpuCorePercent);
      resources.tick.add(m.tickDuration.p99Ms);
      resources.loop.add(m.system.eventLoopP99Ms);
      appendFileSync(
        join(directory, "metrics.ndjson"),
        JSON.stringify({ at: Date.now(), ...m }) + "\n",
      );
    } catch (e) {
      metricError = String(e);
    } finally {
      sampling = false;
    }
  };
  try {
    for (let tries = 0; ; tries++) {
      if (spawnFailure || child.exitCode !== null)
        throw spawnFailure ?? new Error("Built server exited");
      try {
        await requestJson(`${url}/health`);
        break;
      } catch {
        if (tries >= 100) throw new Error("Server startup timeout");
        await sleep(200);
      }
    }
    const raw = await requestJson(`${url}/api/map`),
      map = loadMap(raw);
    const accounts: { username: string; playerId: string }[] = [];
    for (let i = 0; i < opts.bots; i += 4) {
      const batch = await Promise.all(
        Array.from({ length: Math.min(4, opts.bots - i) }, async (_, j) => {
          const username = `play_${String(i + j).padStart(3, "0")}`;
          await requestJson(`${url}/api/register`, {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ username, password }),
          });
          const auth = await requestJson(`${url}/api/login`, {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ username, password }),
          });
          const peer = new HostingPeer(auth.token, auth.playerId, url, map);
          await peer.connect();
          await waitFor(
            () => !!peer.event,
            "Initial public event state missing",
          );
          return { username, auth, peer };
        }),
      );
      for (const b of batch) {
        accounts.push({ username: b.username, playerId: b.auth.playerId });
        bots.push(
          new PlayerBot(bots.length, b.peer, map, trace, alive, opts.seed),
        );
      }
    }
    writeFileSync(
      join(directory, "private-fixture.json"),
      JSON.stringify({ url, password, adminToken, accounts }, null, 2),
    );
    const initial = await admin();
    gate(
      "fresh-roster",
      initial.phase === "lobby" &&
        !initial.startedAt &&
        initial.players.length === opts.bots,
      { phase: initial.phase, players: initial.players.length },
    );
    await admin("start");
    start = Date.now();
    timer = setInterval(() => void sample(), 2000);
    await sample();
    await Promise.all(
      bots.map(async (b) => {
        await b.observe();
        const starter =
          b.index < 8 ? "ST-01" : ["ST-01", "ST-02", "ST-03"][b.index % 3];
        const c = await b.acquire(starter);
        if (!c || !(await b.solve(c)))
          throw new Error(`Missing Starter ${b.index}`);
      }),
    );
    gate(
      "normal-starters",
      bots.every((b) => b.paid === 1),
      { players: opts.bots, paid: bots.reduce((n, b) => n + b.paid, 0) },
    );
    const allStates = bots
      .map(
        (b) =>
          b.peer.event!.challenges.find((c) => c.title.startsWith("ST-01"))?.id,
      )
      .filter(Boolean);
    gate(
      "independent-starter-copies",
      new Set(allStates).size === allStates.length,
      { copies: allStates.length },
    );
    const [a, b, c, d, next, waiting, last, practice] = bots;
    const held: ChallengeView[] = [];
    for (const owner of [a, b, c, d]) {
      const contract = await owner.acquire("SD-01");
      if (!contract) throw new Error("Four free Standard slots expected");
      held.push(contract);
    }
    await next.acquire("SD-01");
    await waiting.acquire("SD-01");
    await practice.terminal('cp-lab');
    const deniedTraining = await practice.action({action:'job',id:'SD-01',training:true},/training is disabled/i);
    await next.observe();
    await waiting.observe();
    gate(
      "four-slots-plus-fifo",
      next.peer.event!.queues[0]?.position === 1 &&
        waiting.peer.event!.queues[0]?.position === 2,
      {
        holders: 4,
        first: next.peer.event!.queues,
        second: waiting.peer.event!.queues,
      },
    );
    gate('player-training-disabled',!!deniedTraining.error && !practice.peer.event!.challenges.some(c=>c.title.startsWith('SD-01')), {directTrainingRequestRejected:true});
    await a.action({ action: "abandon", id: held[0].id });
    await next.observe();
    const offer = next.peer.event!.queues.find((q) => q.position === 0)!;
    gate(
      "release-offers-next",
      !!offer && offer.offerUntil > next.peer.event!.serverTime,
      { offerMs: offer?.offerUntil - next.peer.event!.serverTime },
    );
    await next.action({ action: "accept_queue", id: offer.id });
    next.offers++;
    await next.observe();
    const accepted = next.peer.event!.challenges.find(
      (c) => c.title.startsWith("SD-01") && !c.solved,
    )!;
    await next.solve(accepted);
    await waiting.observe();
    gate(
      "successful-slot-consumed",
      !waiting.peer.event!.queues.some((q) => q.id === offer.id),
      {
        queueCleared: true,
        remaining: waiting.peer.event!.jobs.find((j) => j.id === "SD-01")
          ?.remaining,
      },
    );
    await a.acquire("SD-01");
    await waiting.acquire("SD-01");
    await b.action({ action: "abandon", id: held[1].id });
    await a.observe();
    const expiredOffer = a.peer.event!.queues.find((q) => q.position === 0)!;
    gate("next-offer-created", !!expiredOffer, {
      remainingMs: expiredOffer?.offerUntil - a.peer.event!.serverTime,
    });
    // Other players continue real paid play while an inattentive player misses an offer.
    const background = Promise.allSettled(
      bots.slice(8).map(async (bot) => {
        const cp = await bot.acquire('SD-02');
        if (cp) await bot.solve(cp);
      }),
    );
    await waitFor(
      () =>
        waiting.peer.event!.queues.some(
          (q) => q.id === expiredOffer.id && q.position === 0,
        ),
      "Missed queue offer did not pass to next player",
      45000,
    );
    gate(
      "missed-offer-fifo-handoff",
      waiting.peer.event!.serverTime >= expiredOffer.offerUntil,
      {
        deadline: expiredOffer.offerUntil,
        handoff: waiting.peer.event!.serverTime,
      },
    );
    const successor = waiting.peer.event!.queues.find((q) => q.position === 0)!;
    await waiting.action({ action: "accept_queue", id: successor.id });
    waiting.offers++;
    await waiting.observe();
    const successorChallenge = waiting.peer.event!.challenges.find(
      (c) => c.title.startsWith("SD-01") && !c.solved,
    )!;
    await Promise.all([
      waiting.solve(successorChallenge),
      c.solve(held[2]),
      d.solve(held[3]),
    ]);
    const bg = await background;
    gate(
      "parallel-paid-play",
      bg.every((r) => r.status === "fulfilled"),
      {
        players: bg.length,
        errors: bg
          .filter((r) => r.status === "rejected")
          .map((r) => (r as PromiseRejectedResult).reason.message),
      },
    );
    const finalSlots = (await admin()).slots.filter(
      (s: any) => s.template === "SD-01" && s.wave === 1,
    );
    gate(
      "standard-paid-once",
      finalSlots.length === 4 && finalSlots.every((s: any) => !!s.claimed),
      { claimed: finalSlots.filter((s: any) => s.claimed).length },
    );
    await last.peer.drain();
    const identity = { id: last.peer.id, x: last.peer.x, y: last.peer.y };
    await last.peer.close();
    await sleep(600);
    await last.peer.connect();
    await waitFor(() => !!last.peer.event, "Reconnected state missing");
    last.resumes++;
    gate(
      "ghost-resume",
      last.peer.id === identity.id &&
        last.peer.x === identity.x &&
        last.peer.y === identity.y,
      {
        sameEntity: last.peer.id === identity.id,
        samePosition: last.peer.x === identity.x && last.peer.y === identity.y,
      },
    );
    console.log(
      "[gameplay] Autonomous play: paid jobs, district travel, Bank, safehouses, races and Checkout. Player training is disabled.",
    );
    const progress = setInterval(
      () =>
        console.log(
          `[gameplay] elapsed ${Math.round((Date.now() - start) / 1000)}s; paid ${bots.reduce((n, b) => n + b.paid, 0)}; activity clears ${bots.reduce((n, b) => n + b.activityClears, 0)}; deposits ${bots.reduce((n, b) => n + b.deposits, 0)}; raced ${bots.reduce((n, b) => n + b.races, 0)}; checked out ${bots.filter((b) => b.checkout).length}`,
        ),
      30000,
    );
    try {
      const outcomes = await Promise.allSettled(bots.map((bot) => bot.loop()));
      outcomes.forEach((r, i) => {
        if (r.status === "rejected") {
          bots[i].failures.push(String(r.reason));
          trace({ bot: i, error: String(r.reason) });
        }
      });
      while (alive() && bots.some((bot) => bot.peer.event?.phase !== "frozen"))
        await sleep(500);
    } finally {
      clearInterval(progress);
    }
    final = await admin();
    await sample();
    gate(
      "live-ledger-conserved",
      final.audit.ok &&
        final.audit.total === final.audit.expected &&
        final.audit.ledgerValid &&
        final.audit.reconciled,
      {
        total: final.audit.total,
        expected: final.audit.expected,
        rows: final.audit.ledgerRows,
      },
    );
    gate(
      "player-action-errors",
      bots.every((b) => b.failures.length === 0),
      bots
        .filter((b) => b.failures.length)
        .map((b) => ({ bot: b.index, failures: b.failures })),
    );
    gate(
      "movement-and-protocol",
      bots.every(
        (b) =>
          b.peer.acks === b.peer.moves &&
          b.peer.moves >= 5 &&
          !b.peer.rejects &&
          !b.peer.errors &&
          !b.peer.unexpectedDisconnects &&
          !b.peer.kicks.length,
      ),
      bots.map((b) => ({
        bot: b.index,
        moves: b.peer.moves,
        acks: b.peer.acks,
        rejects: b.peer.rejects,
        errors: b.peer.errors,
        drops: b.peer.unexpectedDisconnects,
      })),
    );
    gate("sampled-health", !metricError && resources.health.count >= 3, {
      samples: resources.health.count,
      error: metricError,
    });
    gate(
      "network-safety",
      lastMetrics.network.rateLimitDrops === 0 &&
        lastMetrics.network.backpressureEvents === 0 &&
        lastMetrics.network.malformedMessages === 0,
      lastMetrics.network,
    );
    if (opts.seconds >= opts.eventMinutes * 60 + 10) {
      gate(
        "automatic-event-settlement",
        final.phase === "frozen" &&
          final.players.every((p: any) => p.checkedOut),
        {
          phase: final.phase,
          settled: final.players.filter((p: any) => p.checkedOut).length,
        },
      );
    }
  } catch (e) {
    gates["run-complete"] = { passed: false, detail: String(e) };
    console.error("[gameplay] Failed:", String(e));
    try {
      final = await admin();
    } catch {
      /* Preserve original error. */
    }
  } finally {
    ended = true;
    if (timer) clearInterval(timer);
    await waitFor(() => !sampling, "Metrics sampler stuck").catch(() => {});
    await Promise.all(bots.map((b) => b.peer.close()));
    await stopChild(child);
    process.off("SIGINT", cancel);
    process.off("SIGTERM", cancel);
    const preserved =
      JSON.stringify(lobbyBefore) === JSON.stringify(readLobby());
    gates["saved-event-preserved"] = {
      passed: preserved,
      detail: {
        phase: readLobby()?.phase,
        players: readLobby()?.roster.length,
      },
    };
    if (cancelled)
      gates["not-cancelled"] = { passed: false, detail: "Run cancelled" };
    const status = Object.values(gates).every((g) => g.passed)
      ? "PASS"
      : "FAIL";
    const summary = {
      status,
      options: opts,
      hardware: {
        cpu: cpus()[0]?.model,
        ramMiB: Math.round(totalmem() / 1048576),
        logicalCpus: cpus().length,
        topology: "bots and built server on same development PC",
      },
      gates,
      bots: bots.map((b) => b.summary()),
      resources: Object.fromEntries(
        Object.entries(resources).map(([k, v]) => [k, v.summary()]),
      ),
      finalAudit: final?.audit,
      finalPhase: final?.phase,
      limitations: [
        "Protocol player agents, not human/browser FPS simulation.",
        "Only public-evidence supported puzzles; no burglary/Golden Hour/raid crew certification.",
        "Condensed schedule changes available travel time; actual lock, fee, withdrawal, race and raid durations stay real-time.",
        "Development-PC loopback, not i5 host/LAN certification.",
        "Stopped disposable test retained for audit; saved event unchanged, no destructive reset.",
      ],
    };
    writeFileSync(
      join(directory, "summary.json"),
      JSON.stringify(summary, null, 2),
    );
    writeFileSync(
      join(directory, "report.md"),
      `# Real-game bot run: ${status}\n\n${opts.bots} bots; ${opts.eventMinutes}-minute event timeline; ${opts.seconds}s time budget.\n\n${Object.entries(
        gates,
      )
        .map(
          ([n, g]) =>
            `- ${g.passed ? "PASS" : "FAIL"} ${n}: ${JSON.stringify(g.detail)}`,
        )
        .join(
          "\n",
        )}\n\n## Resources\n\n\`\`\`json\n${JSON.stringify(summary.resources, null, 2)}\n\`\`\`\n\n## Limits\n\n${summary.limitations.map((s) => "- " + s).join("\n")}\n\nPrivate credentials and database backups are in this Git-ignored run directory. The test server is stopped; a new run starts fresh.\n`,
    );
    console.log(`[gameplay] ${status}: ${join(directory, "report.md")}`);
    if (status !== "PASS") process.exitCode = 1;
  }
}
