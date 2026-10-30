import { SeededRNG } from "./tools/random.js";

/** Bounded reservoir: three-hour tests cannot retain millions of RTT samples. */
export class Samples {
  count = 0;
  sum = 0;
  max = 0;
  private values: number[] = [];
  private rng = new SeededRNG(914);
  constructor(private capacity = 4096) {}
  add(value: number) {
    if (!Number.isFinite(value) || value < 0)
      throw new Error("Invalid measurement");
    this.count++;
    this.sum += value;
    this.max = Math.max(this.max, value);
    if (this.values.length < this.capacity) this.values.push(value);
    else {
      const i = this.rng.int(0, this.count - 1);
      if (i < this.capacity) this.values[i] = value;
    }
  }
  summary() {
    const sorted = [...this.values].sort((a, b) => a - b);
    const pct = (p: number) =>
      sorted.length
        ? sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * p))]
        : null;
    return {
      count: this.count,
      mean: this.count ? this.sum / this.count : null,
      p50: pct(0.5),
      p95: pct(0.95),
      p99: pct(0.99),
      max: this.count ? this.max : null,
      retained: sorted.length,
      approximate: this.count > sorted.length,
    };
  }
}

export type HostingProfile = "smoke" | "lab" | "soak";
export function hostingOptions(args: string[]) {
  const known = new Set([
    "profile",
    "bots",
    "seconds",
    "seed",
    "url",
    "confirm-rehearsal",
    "serve",
    "fixture",
    "port",
  ]);
  const values = new Map<string, string>();
  for (const arg of args) {
    const match = /^--([a-z-]+)(?:=(.*))?$/.exec(arg);
    if (!match || !known.has(match[1]) || values.has(match[1]))
      throw new Error(`Unknown or duplicate option: ${arg}`);
    values.set(match[1], match[2] ?? "true");
  }
  const profile = values.get("profile") ?? "smoke";
  if (!["smoke", "lab", "soak"].includes(profile))
    throw new Error("profile must be smoke, lab or soak");
  const int = (key: string, fallback: number, min: number, max: number) => {
    const raw = values.get(key);
    const value = raw === undefined ? fallback : Number(raw);
    if (!Number.isSafeInteger(value) || value < min || value > max)
      throw new Error(`${key} must be an integer ${min}–${max}`);
    return value;
  };
  const bots = int("bots", 40, 2, 40);
  const seconds = int(
    "seconds",
    profile === "smoke" ? 45 : profile === "lab" ? 300 : 10800,
    15,
    86400,
  );
  const seed = int("seed", 42, 0, 2147483647);
  const url = values.get("url");
  if (url) {
    const parsed = new URL(url);
    if (
      !["http:", "https:"].includes(parsed.protocol) ||
      parsed.username ||
      parsed.password ||
      parsed.search ||
      parsed.hash ||
      parsed.pathname !== "/"
    )
      throw new Error(
        "url must be an HTTP(S) origin without credentials, path or query",
      );
    if (values.get("confirm-rehearsal") !== "true")
      throw new Error(
        "Remote mode requires --confirm-rehearsal; it registers bot accounts and starts a disposable event",
      );
    if (!values.get("fixture"))
      throw new Error(
        "Remote mode requires --fixture=<copied disposable fixture.json>",
      );
  }
  if (values.has("serve") && values.get("serve") !== "true")
    throw new Error("serve is a flag");
  if (values.has("serve") && url)
    throw new Error("serve cannot be combined with url");
  if (values.has("fixture") && !url)
    throw new Error("fixture is only valid with url");
  const port = int("port", 8765, 1024, 65535);
  if (values.has("port") && !values.has("serve"))
    throw new Error("port is only valid with serve");
  return {
    profile: profile as HostingProfile,
    bots,
    seconds,
    seed,
    url: url?.replace(/\/$/, ""),
    serve: values.has("serve"),
    fixture: values.get("fixture"),
    port,
  };
}

export function hostingGates(input: {
  connected: number;
  expected: number;
  moves: number;
  acks: number;
  rejects: number;
  errors: number;
  disconnects: number;
  aoiChecks: number;
  aoiFailures: number;
  resumes: number;
  eventStates: number;
  exercise: boolean;
  auditOk: boolean;
  coverageOk: boolean;
  metrics: number;
  tickP99: number;
  overruns: number;
  backpressure: number;
  malformed: number;
  rateDrops: number;
  ackP99: number | null;
  healthP99: number | null;
  rssMax: number;
  rssGrowth: number | null;
  loopP99: number;
  cpuMean: number | null;
  remote: boolean;
}) {
  const gate = (passed: boolean, actual: unknown, expected: string) => ({
    passed,
    actual,
    expected,
  });
  return {
    connections: gate(
      input.connected === input.expected,
      input.connected,
      String(input.expected),
    ),
    movement: gate(
      input.moves >= input.expected * 5 &&
        input.acks === input.moves &&
        input.rejects === 0,
      { sent: input.moves, acknowledged: input.acks, rejected: input.rejects },
      ">=5 moves/operator, all acknowledged, zero rejects",
    ),
    health: gate(
      input.metrics >= 3 && input.healthP99 !== null && input.healthP99 < 500,
      input.healthP99,
      ">=3 samples, HTTP p99 <500ms",
    ),
    protocol: gate(
      input.errors === 0 && input.disconnects === 0,
      { errors: input.errors, unexpectedDisconnects: input.disconnects },
      "zero",
    ),
    aoi: gate(
      input.aoiChecks >= input.expected && input.aoiFailures === 0,
      { checked: input.aoiChecks, failures: input.aoiFailures },
      "every operator checked; zero replica differences",
    ),
    coverage: gate(
      input.coverageOk,
      input.coverageOk,
      "dense crowd or requested spread scene coverage reached",
    ),
    reconnect: gate(
      input.resumes === input.expected,
      input.resumes,
      "every operator resumes at exact authoritative position",
    ),
    event: gate(
      input.eventStates >= input.expected * 2 &&
        input.exercise &&
        input.auditOk,
      {
        states: input.eventStates,
        exercise: input.exercise,
        audit: input.auditOk,
      },
      "live state, server-verified answer/probe and balanced ledger",
    ),
    tick: gate(
      input.tickP99 <= 10 && input.overruns === 0,
      { p99Ms: input.tickP99, overruns: input.overruns },
      "p99 <=10ms, zero overruns",
    ),
    transport: gate(
      input.backpressure === 0 &&
        input.malformed === 0 &&
        input.rateDrops === 0,
      {
        backpressure: input.backpressure,
        malformed: input.malformed,
        rateDrops: input.rateDrops,
      },
      "zero",
    ),
    responsiveness: gate(
      input.ackP99 !== null && input.ackP99 < (input.remote ? 400 : 150),
      input.ackP99,
      input.remote ? "ACK p99 <400ms over LAN" : "ACK p99 <150ms loopback",
    ),
    resources: gate(
      input.rssMax < 1024 &&
        input.loopP99 < 75 &&
        input.cpuMean !== null &&
        input.cpuMean < 75,
      {
        rssMb: input.rssMax,
        loopP99Ms: input.loopP99,
        cpuCorePercent: input.cpuMean,
      },
      "RSS <1GiB, event loop p99 <75ms, steady mean CPU <75% of one core",
    ),
    memoryGrowth: gate(
      input.rssGrowth === null || input.rssGrowth < 128,
      input.rssGrowth,
      "end-window minus warm-window mean <128MiB; short tests not assessed",
    ),
  };
}
