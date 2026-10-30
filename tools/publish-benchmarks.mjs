/** Publish only completed, passing-soak evidence. Never reads fixture credentials. */
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { resolve, join, basename } from "node:path";
const root = resolve(import.meta.dirname, ".."),
  manifestPath = process.argv[2];
if (!manifestPath)
  throw Error(
    "Usage: node tools/publish-benchmarks.mjs bot-runs/campaign-.../campaign.json",
  );
const manifest = JSON.parse(readFileSync(resolve(manifestPath), "utf8"));
if (!manifest.complete)
  throw Error(
    "Campaign has not completed; do not publish partial headline claims.",
  );
const results = manifest.runs.map((run) => {
  const r = {
    ...JSON.parse(readFileSync(run.path, "utf8")),
    label: run.label,
    run: basename(resolve(run.path, "..")),
  };
  if (r.tick) {
    // Include the final ACK-drain interval as well as each steady sample. This
    // reconstructs the exact tick distribution from raw observations, not rolling quantiles.
    const lines = readFileSync(
      join(resolve(run.path, ".."), "metrics.ndjson"),
      "utf8",
    )
      .trim()
      .split("\n")
      .map((s) => JSON.parse(s));
    const observed = lines.filter(
      (s) => s.phase === "steady" || s.phase === "end",
    );
    r.loop.maxIntervalUtilization = Math.max(
      ...lines
        .filter((s) => s.phase === "steady")
        .map((s) => s.system.eventLoopUtilization),
    );
    const db = observed.map((s) => s.database).filter(Boolean);
    r.persistence = db.length
      ? {
          healthy: db.every((s) => s.healthy),
          maxSampledPending: Math.max(...db.map((s) => s.pending)),
          maxLifetimePending: Math.max(...db.map((s) => s.maxPending)),
          rejected: db.at(-1).rejected,
          maxLifetimeRpcLatencyMs: Math.max(...db.map((s) => s.maxLatencyMs)),
          meanLifetimeRpcLatencyMs: db.at(-1).meanLatencyMs,
        }
      : null;
    r.memory.peakHeapTotalMiB = Math.max(
      ...observed.map((s) => s.system.heapTotalMb),
    );
    r.memory.peakExternalMiB = Math.max(
      ...observed.map((s) => s.system.externalMb),
    );
    r.memory.peakArrayBuffersMiB = Math.max(
      ...observed.map((s) => s.system.arrayBuffersMb),
    );
    const ticks = lines
      .filter((s) => s.phase === "steady" || s.phase === "end")
      .flatMap((s) => s.measurement.tickSamplesMs)
      .sort((a, b) => a - b);
    if (ticks.length !== r.tick.count)
      throw Error(
        `Missing/duplicate raw tick observations in ${run.label}: ${ticks.length}/${r.tick.count}`,
      );
    const pct = (p) =>
      ticks[Math.min(ticks.length - 1, Math.floor(ticks.length * p))];
    r.tick = {
      ...r.tick,
      mean: ticks.reduce((n, v) => n + v, 0) / ticks.length,
      p50: pct(0.5),
      p95: pct(0.95),
      p99: pct(0.99),
      p95UtilizationPercent: (pct(0.95) / r.tick.budgetMs) * 100,
      max: ticks.at(-1),
      retained: ticks.length,
      approximate: false,
    };
    r.gates.tickBudget = r.tick.p95 < 25 && r.tick.overrunPercent <= 0.1;
    r.status = Object.values(r.gates).every(Boolean) ? "PASS" : "FAIL";
  }
  return r;
});
const valid = (r) =>
  r.status === "PASS" &&
  r.measuredSeconds >= 900 &&
  r.environment.engine === "core" &&
  r.environment.loadModel === "serial-world-intents-v2" &&
  r.cleanup.seconds >= 31 &&
  Object.values(r.gates).every(Boolean);
const soak = results
  .filter(valid)
  .sort((a, b) => b.environment.count - a.environment.count)[0];
if (!soak) throw Error("No passing 15-minute core soak. Retain placeholders.");
const spatial = results.find((r) => r.label === "aoi-spatial"),
  global = results.find((r) => r.label === "aoi-global"),
  full = results.find((r) => r.label === "full-game");
const paired =
  spatial?.status === "PASS" &&
  global?.status === "PASS" &&
  spatial.environment.aoi === "spatial" &&
  global.environment.aoi === "global" &&
  [
    "count",
    "seed",
    "seconds",
    "warmup",
    "tickRate",
    "stepTicks",
    "engine",
    "loadModel",
    "artifactSha256",
    "runnerSha256",
  ].every((k) => spatial.environment[k] === global.environment[k]);
const reduction = paired
  ? (100 *
      (global.traffic.recipientsPerAck - spatial.traffic.recipientsPerAck)) /
    global.traffic.recipientsPerAck
  : null;
const output = join(root, "apps/client/public/art/benchmark");
mkdirSync(output, { recursive: true });
mkdirSync(join(root, "docs/benchmarks"), { recursive: true });
const data = {
  schemaVersion: 1,
  status: "measured",
  measuredAt: manifest.finishedAt,
  core: {
    players: soak.environment.count,
    seconds: soak.measuredSeconds,
    messagesPerSecond: soak.traffic.packetsPerSecond,
    ackP95Ms: soak.latency.p95,
    tickP95Ms: soak.tick.p95,
    soaked: true,
  },
  aoi:
    reduction !== null && Number.isFinite(reduction)
      ? { players: spatial.environment.count, reductionPercent: reduction }
      : null,
  environment: soak.environment,
  fullGame: full
    ? { players: full.environment.count, status: full.status }
    : null,
  reportUrl: "/art/benchmark/report.html",
};
writeFileSync(join(output, "latest.json"), JSON.stringify(data, null, 2));
writeFileSync(
  join(output, "all-results.json"),
  JSON.stringify(results, null, 2),
);
writeFileSync(
  join(root, "docs/benchmarks/results.json"),
  JSON.stringify(
    {
      campaign: {
        startedAt: manifest.startedAt,
        finishedAt: manifest.finishedAt,
        decisions: manifest.decisions,
      },
      headline: data,
      results,
    },
    null,
    2,
  ),
);
const fmt = (v, d = 2) =>
  v === null || v === undefined
    ? "—"
    : Number(v).toLocaleString("en-US", { maximumFractionDigits: d });
const rows = results.map((r) =>
  r.traffic
    ? `| ${r.environment.engine}/${r.environment.loadModel === "serial-world-intents-v2" ? "v2" : "v1"} | ${r.environment.count} | ${r.environment.scenario}/${r.environment.aoi} | ${fmt(r.measuredSeconds, 0)} | ${fmt(r.traffic.packetsPerSecond, 0)} | ${fmt(r.latency.p50)} | ${fmt(r.latency.p95)} | ${fmt(r.latency.p99)} | ${fmt(r.tick.p95, 3)} | ${fmt(r.tick.overrunPercent, 3)}% | ${fmt(r.cpu.mean)}% | ${fmt(r.memory.rss.mean)} | ${r.status} |`
    : `| ${r.environment.engine}/${r.environment.loadModel === "serial-world-intents-v2" ? "v2" : "v1"} | ${r.environment.count} | ${r.environment.scenario}/${r.environment.aoi} | — | — | — | — | — | — | — | — | — | INCOMPLETE: ${r.error} |`,
);
const failures = results
  .filter((r) => r.status !== "PASS")
  .map(
    (r) =>
      `- ${r.label}: ${
        r.error ??
        Object.entries(r.gates)
          .filter(([, v]) => !v)
          .map(([k]) => k)
          .join(", ")
      }.`,
  );
const e = soak.environment;
let intro = `# Backend benchmark evidence\n\nMeasured ${manifest.finishedAt}. All completed campaign runs, including failures, appear below. The headline is the highest count that passed this campaign's 15-minute core-engine soak. It is a **validated operating point on this host**, not an architectural maximum or an end-to-end full-game capacity claim.\n\n## Headline\n\n- **${e.count} actively moving core-engine players**, ${fmt(soak.measuredSeconds / 60, 1)} measured minutes.\n- ${fmt(soak.traffic.packetsPerSecond, 0)} sustained logical protocol deliveries/s, inbound + outbound.\n- MOVE-to-ACK p95 ${fmt(soak.latency.p95)} ms; world-tick p95 ${fmt(soak.tick.p95, 3)} ms within a 50 ms budget.\n- ${fmt(soak.reconnect.percent)}% exact entity/position reconnect success (${soak.reconnect.success}/${soak.reconnect.total}).\n- ${data.aoi ? `${fmt(data.aoi.reductionPercent)}% fewer replication deliveries per acknowledged move with AOI in the ${data.aoi.players}-player matched comparison.` : "No passing paired AOI percentage is published."}\n\n## Environment\n\n${e.cpu}; ${e.physicalCores ?? "unknown"} physical / ${e.logicalCores} logical cores; ${e.ramMiB} MiB RAM; ${e.os} kernel ${e.osRelease}. Node ${e.node}, Fastify ${e.fastify}, ws ${e.ws}. ${e.topology}\n\nServer commit: ${e.commit}; dirty checkout: ${e.dirty}. Built server/shared JS artifact SHA-256: \`${e.artifactSha256}\`. Per-run environment and hashes are in [results.json](results.json). Warn-level logging; 20 Hz simulation, five ticks/step, production heartbeat/rate-limit/backpressure defaults; SQLite worker persists accounts and snapshots. CPU 100% means one fully occupied logical core and includes process worker activity. These measurements are not hardware independent.\n\n## Load model and scope\n\nThe final serial-world-intents-v2 load model waits for movement ACKs before interacting and waits for interaction/teleport replies before moving again. This prevents the test client itself from issuing stale moves across travel. Earlier exploratory v1 runs and their failures remain in the table; they are not used as long-soak headlines. Each bot authenticates its fixture session, awaits WELCOME, derives cadence, sends one ACK-driven move at a time with seeded 1.05–1.35× cadence jitter, decodes every server frame with @heist/shared, maintains a visible-entity replica and sends 2.5-second heartbeats. Movement is checked with shared tryStep. Roughly ten percent seek authored gates; occasional nearby interactions occur on a jittered ~20-second schedule. All entities use the real city collision map. Spatial layouts distribute players across the authored regions; hotspot concentrates them near a common central spawn.\n\nCore tests use the production World, TickLoop, WebSocket/auth/SQLite and interaction modules in a loopback-only disposable entrypoint. The event/contract scheduler is excluded, so these larger counts do **not** imply the current 60-seat event economy or full game supports that many players. Steady joins are ramped in batches of 25 with a short yield; connect-storm submits its selected cohort together. Ordinary reconnects use batches of 50, and the reconnect-storm submits its cohort together. Steady core connections use pre-created valid tokens; ten real password logins are sampled separately before measurement. Full-game runs use real password login for all players and the production entrypoint in its unstarted lobby with preloaded workbench payloads. This measures the full engine/payload path, not a live paid-event simulation; the earlier gameplay run separately validates live paid activities and settlement. No paid activity is faked during measured core runs.\n\nWarm-up is excluded. Quantiles pool individual MOVE ACKs and individual tick-execution durations, rather than taking percentiles of rolling percentiles. ACKs use a bounded reservoir of 200,000 samples, tick samples 100,000; each summary records retained count and whether approximate. Event-loop figures are the maximum observed one-second histogram percentiles, not whole-run percentiles. The monitor uses 20 ms resolution, so its normal baseline is near 20 ms; it is not a pure excess-delay stopwatch. CPU/RSS are sampled once per second. The exact measured duration includes the final ACK drain.\n\nTraffic counts every decoded logical packet and every actual outbound batched packet delivery, including recipient copies; it is not a count of unique gameplay actions. Incoming/outgoing WebSocket frames and payload bytes are reported separately. Byte figures exclude WebSocket/TLS/IP overhead. Steady-state throughput uses cumulative counter differences over measured wall time.\n\n## All measured runs\n\n| Engine | Players | Scenario / AOI | Measured s | Msg/s | ACK p50 ms | ACK p95 ms | ACK p99 ms | Tick p95 ms | Execution overrun rate | CPU / one core | RSS mean MiB | Result |\n|---|---:|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---|\n${rows.join("\n")}\n\n## Stability definition\n\nA pass requires every sampled connection count to match the requested count; every bot completes at least 1.5 moves/s; all measured moves are acknowledged; zero protocol errors, rejects or unexpected disconnects; zero AOI replica mismatches; exact reconnect recovery for every bot; tick p95 <25 ms, at most 0.1% execution ticks >50 ms and effective tick rate ≥19 Hz; ACK p95 <150 ms and p99 <500 ms; no sampled one-second event-loop utilisation ≥95%; mean server process CPU <150% of one core; last-window minus first-window RSS <128 MiB and heap <64 MiB; healthy bounded DB queue; zero transport drop/backpressure counters; and zero remaining connected players/expired ghosts after cleanup. Memory trends are evidence of bounded growth during this test, not proof that no leak exists. Scheduler catch-up skips are reported separately from execution-budget overruns.\n\n## AOI comparison\n\n${paired ? `Both runs used ${spatial.environment.count} players, seed ${spatial.environment.seed}, the same map, bot algorithm and duration. Spatial chunks were 16 tiles. The global baseline uses a single world-sized chunk (${global.environment.chunkSize} tiles), so the same production routing sends every replication update to all clients. This baseline is isolated to benchmark configuration.\n\n| Mode | Delivered replication packets / ACK | Out packets/s | Out payload bytes/s | Tick p95 ms | CPU % |\n|---|---:|---:|---:|---:|---:|\n| Spatial | ${fmt(spatial.traffic.recipientsPerAck)} | ${fmt(spatial.traffic.outPerSecond, 0)} | ${fmt(spatial.traffic.bytesOutPerSecond, 0)} | ${fmt(spatial.tick.p95, 3)} | ${fmt(spatial.cpu.mean)} |\n| Global | ${fmt(global.traffic.recipientsPerAck)} | ${fmt(global.traffic.outPerSecond, 0)} | ${fmt(global.traffic.bytesOutPerSecond, 0)} | ${fmt(global.tick.p95, 3)} | ${fmt(global.cpu.mean)} |\n\nFan-out reduction = (global replication deliveries/ACK − spatial deliveries/ACK) / global deliveries/ACK ×100 = **${fmt(reduction)}%**. Normalising by ACK count avoids presenting a lower movement rate as an AOI saving. It includes boundary enter/leave/teleport delivery work. Exact executed paths and ACK counts can differ under scheduling despite identical random seed; those counts are published. This is a topology/workload result, not an invariant percentage for all player distributions.` : "One or both paired runs did not pass. Their raw measurements remain in the table/JSON; no headline AOI percentage is asserted."}\n\n## Limits, overload and cleanup\n\n${failures.length ? failures.join("\n") : "No tested run exceeded the selected gates; the actual failure ceiling was not established."}\n\nCampaign decisions: ${manifest.decisions.join(" ") || "All planned levels completed."}\n\nThe first failing progressive level is a measured operating-envelope boundary for this campaign, not proof of the first intrinsic server bottleneck: co-located generators, OS scheduling and host memory pressure can limit it. Review per-run generator event-loop p99, server event-loop utilisation, tick distributions, CPU, RPC queue/latency and memory before attributing causality. Peak spikes are not used as sustained throughput. Incremental RSS per player can be negative if startup parsing/hash pages are released during warm-up; it is a raw process delta, not an object-allocation estimate. Post-disconnect process memory may stay above baseline because V8 retains allocated pages; after-ghost-expiry values and first/last memory windows are published. Login sessions intentionally persist; cleanup checks connections, ghosts and AOI entities rather than deleting valid accounts.\n\n## Architectural and functional evidence\n\nClient intent → session authentication and input validation → authoritative movement queue → fixed-tick shared collision simulation → chunk/AOI routing → batched state replication → client replica. Position, interaction radius and wealth are owned by the server. Movement never awaits database I/O. The SQLite worker owns persistence and event transactions; the core entrypoint reuses that asynchronous persistence path.\n\nAOI correctness is compared against authoritative positions before/after movement and after reconnect. Every benchmark restores exact entity ID and coordinates; ghost expiry is checked after 32 seconds. The existing server regression suite validates invalid/missing sessions, blocked moves, organizer role checks, forged instant solves, balanced ledger transactions, wrong-location interactions, reconnect ordering and worker failure. No network fuzzing certification is implied. The earlier full 40-bot gameplay run, documented in SQLITE_VALIDATION.md, separately covered paid jobs, deposits, races and automatic settlement; it is not relabelled as this campaign.\n\n## Reproduce\n\nUse Node 22.19.0, run npm ci and npm run build, then:\n\n\`\`\`sh\nnpm run benchmark -- --players=100 --seconds=180 --warmup=30 --engine=core --scenario=steady\nnpm run benchmark -- --players=100 --seconds=180 --warmup=30 --engine=core --scenario=hotspot\nnpm run benchmark -- --players=100 --seconds=180 --warmup=30 --aoi=global\nnpm run benchmark -- --players=100 --seconds=900 --warmup=30 --scenario=soak\nnpm run benchmark -- --players=100 --seconds=45 --warmup=10 --scenario=reconnect\nnpm run benchmark -- --players=100 --seconds=45 --warmup=10 --scenario=connect-storm\nnpm run benchmark -- --players=40 --seconds=180 --warmup=30 --engine=game\nnode tools/benchmark-campaign.mjs\nnode tools/publish-benchmarks.mjs bot-runs/campaign-TIMESTAMP/campaign.json\n\`\`\`\n\nEach command launches a separate loopback server with disposable SQLite files under Git-ignored bot-runs/benchmark-*. Configure players, seconds, warmup, cleanup, seed, movement-ms (0 means WELCOME cadence), interaction-seconds, scenario, engine and aoi. Output includes environment.json, result.json, report.md and metrics.ndjson. fixture-private.json and raw run directories contain test credentials: do not publish them. The publisher reads only result.json, refuses incomplete campaigns or missing passing 15-minute soaks, and copies no secrets. Run the same commands on another host to compare the backend under a new documented environment.\n\n## Deployment note\n\nNo public Render target was supplied or deployed in this campaign. Render HTTPS/WSS/wake-up smoke remains unmeasured. Free-tier demo capacity must not be inferred from this local result, and the core engine's tested player count must not be presented as the game's configured event seating.\n\n## Resume wording\n\n- Built an authoritative WebSocket world engine validated with ${e.count} concurrently active simulated players over a ${fmt(soak.measuredSeconds / 60, 0)}-minute soak, sustaining ${fmt(soak.traffic.packetsPerSecond, 0)} logical messages/s at ${fmt(soak.latency.p95)} ms p95 movement-acknowledgement latency in a documented local benchmark.\n${data.aoi ? `- Implemented chunk-based AOI replication, reducing delivered state-update fan-out per acknowledged move by ${fmt(data.aoi.reductionPercent)}% against global replication in a matched ${data.aoi.players}-player distributed workload.` : "- Implemented authoritative input validation, chunk-based spatial replication and exact reconnect recovery, backed by automated integration tests."}\n\nThese statements deliberately say core world engine and simulated players. Do not omit the workload/environment qualification when comparing the numbers to production user capacity.\n`;
const diagnostics = `## Selected soak diagnostics

| Measurement | Observed |
|---|---:|
| Acknowledged moves | ${fmt(soak.traffic.acks, 0)} |
| Inbound / outbound logical messages/s | ${fmt(soak.traffic.inPerSecond, 0)} / ${fmt(soak.traffic.outPerSecond, 0)} |
| Inbound / outbound payload bytes/s | ${fmt(soak.traffic.bytesInPerSecond, 0)} / ${fmt(soak.traffic.bytesOutPerSecond, 0)} |
| Logical messages/player/s | ${fmt(soak.traffic.packetsPerPlayerPerSecond)} |
| Tick mean / p50 / p95 / p99 / max, ms | ${[soak.tick.mean, soak.tick.p50, soak.tick.p95, soak.tick.p99, soak.tick.max].map((v) => fmt(v, 3)).join(" / ")} |
| Tick budget use at p95 | ${fmt(soak.tick.p95UtilizationPercent)}% |
| Execution overruns / effective tick rate | ${soak.tick.executionOverruns} (${fmt(soak.tick.overrunPercent, 3)}%) / ${fmt(soak.tick.effectiveHz)} Hz |
| Server CPU mean / peak (100% = one core) | ${fmt(soak.cpu.mean)}% / ${fmt(soak.cpu.max)}% |
| Messages/s per consumed CPU core | ${fmt(soak.efficiency.messagesPerCpuCoreSecond, 0)} |
| Active players per consumed CPU core | ${fmt(soak.efficiency.activePlayersPerCpuCore, 0)} |
| Server RSS mean / peak, MiB | ${fmt(soak.memory.rss.mean)} / ${fmt(soak.memory.rss.max)} |
| Heap mean / peak, MiB | ${fmt(soak.memory.heap.mean)} / ${fmt(soak.memory.heap.max)} |
| RSS / heap first-to-last window change, MiB | ${fmt(soak.memory.growth.rssMiB)} / ${fmt(soak.memory.growth.heapMiB)} |
| RSS after disconnect / ghost expiry, MiB | ${fmt(soak.memory.afterDisconnect.memoryRssMb)} / ${fmt(soak.memory.afterGhostExpiry.memoryRssMb)} |
| Raw incremental RSS/player, KiB | ${fmt(soak.memory.incrementalRssMiBPerPlayer * 1024)} |
| Max interval event-loop p50 / p95 / p99, ms | ${[soak.loop.maxIntervalP50Ms, soak.loop.maxIntervalP95Ms, soak.loop.maxIntervalP99Ms].map((v) => fmt(v, 3)).join(" / ")} |
| Generator event-loop p99, ms | ${fmt(soak.loop.generatorP99Ms, 3)} |
| Peak heap total / external / array buffers, MiB | ${fmt(soak.memory.peakHeapTotalMiB)} / ${fmt(soak.memory.peakExternalMiB)} / ${fmt(soak.memory.peakArrayBuffersMiB)} |
| Maximum sampled event-loop utilisation | ${fmt(100 * soak.loop.maxIntervalUtilization)}% |
| SQLite sampled pending peak / lifetime queue peak | ${soak.persistence?.maxSampledPending ?? "—"} / ${soak.persistence?.maxLifetimePending ?? "—"} |
| SQLite rejected RPCs / lifetime max RPC latency, ms | ${soak.persistence?.rejected ?? "—"} / ${fmt(soak.persistence?.maxLifetimeRpcLatencyMs)} |
| Ready sessions / connection failures | ${soak.connections.ready} / ${soak.connections.failures} |
| Reconnects / reconnect p95, ms | ${soak.reconnect.success}/${soak.reconnect.total} / ${fmt(soak.reconnect.latency.p95)} |
| AOI replica checks / mismatches | ${soak.correctness.aoiChecks} / ${soak.correctness.aoiFailures} |
| Region transitions / chunk crossings | ${soak.correctness.regionTransitions} / ${soak.correctness.chunkCrossings} |
| Nearby interactions | ${soak.correctness.interactions} |
| Rejected moves / protocol errors / unexpected disconnects | ${soak.correctness.rejects} / ${soak.correctness.errors} / ${soak.correctness.disconnects} |
| Remaining players / expired ghosts after cleanup | ${soak.cleanup.players} / ${soak.cleanup.ghosts} |

CPU-normalised ratios describe measured efficiency at this operating point, not the number of players another core can necessarily support. The raw negative RSS delta, if present, reflects released startup pages; it is not negative per-player allocation. Long tail execution stalls and ACK maxima remain in the JSON even when the percentile gates pass.

`;
intro = intro.replace("## Environment", diagnostics + "## Environment");
intro = intro.replace(
  "## Reproduce",
  `## Session and AOI lifecycle

A valid session token attaches a socket to a server-owned player. Disconnect retains the entity for the 30-second ghost window; reconnect within that window replaces the transport while preserving entity ID and coordinates. Ghost expiry removes the player from world/chunk membership. Tests close all transports, wait 32 seconds and verify zero connected players and ghosts. Login account/session rows intentionally remain available for later authentication.

Spatial membership follows authoritative tile positions through chunk transitions. The server sends enter/leave deltas when visibility changes and batches movement replication to subscribed nearby clients. The benchmark compares each client's complete replica with the server's expected 3×3 chunk neighbourhood after movement and after reconnect; it reports region transitions and chunk crossings separately. Clients submit movement/interaction intent; neither client predictions nor bot replicas own position, balance or contract results.

## Reproduce`,
);
const hotspot = results.find((r) => r.label === "hotspot");
if (spatial?.traffic && hotspot?.traffic) {
  const density = [spatial, hotspot].map(
    (r) =>
      `| ${r.environment.scenario === "hotspot" ? "Clustered hotspot" : "Distributed"} | ${r.environment.count} | ${fmt(r.traffic.recipientsPerAck)} | ${fmt(r.traffic.packetsPerSecond, 0)} | ${fmt(r.latency.p95)} | ${fmt(r.tick.p95, 3)} | ${fmt(r.cpu.mean)}% | ${r.status} |`,
  );
  intro = intro.replace(
    "## Limits, overload and cleanup",
    `## Player density

| Layout | Players | Replication deliveries/ACK | Msg/s | ACK p95 ms | Tick p95 ms | CPU % | Result |
|---|---:|---:|---:|---:|---:|---:|---|
${density.join("\n")}

Both scenarios use spatial routing. The hotspot starts the cohort together near Central Exchange and lets them move normally; the distributed scenario spreads players across the authored city. This compares density scenarios, not identical executed paths. AOI cannot remove deliveries between players who are actually nearby.

## Limits, overload and cleanup`,
  );
}
const storms = results.filter(
  (r) => ["session-storms", "connect-storm"].includes(r.label) && r.connections,
);
if (storms.length) {
  const rows = storms.map(
    (r) =>
      `| ${r.label} | ${r.connections.ready}/${r.connections.attempts} | ${fmt(r.connections.seconds, 3)} | ${fmt(r.connections.latency.p95)} | ${r.reconnect.success}/${r.reconnect.total} | ${fmt(r.reconnect.seconds, 3)} | ${fmt(r.reconnect.latency.p95)} | ${r.status} |`,
  );
  intro = intro.replace(
    "## Session and AOI lifecycle",
    `## Connection and reconnect bursts

| Scenario | Ready/attempted | All ready, s | Connect p95 ms | Exact reconnects | Reconnect cohort, s | Reconnect p95 ms | Result |
|---|---:|---:|---:|---:|---:|---:|---|
${rows.join("\n")}

Connect-storm opens the cohort together; session-storms reconnects it together. Connection latency ends at WELCOME. These core scenarios authenticate valid fixture tokens; they do not benchmark a simultaneous password-hashing surge. CPU/RSS in the main table describe the measured movement window, not a separately sampled burst peak.

## Session and AOI lifecycle`,
  );
}
writeFileSync(join(root, "docs/benchmarks/RESULTS.md"), intro);
const readmePath = join(root, "README.md"),
  readme = readFileSync(readmePath, "utf8");
const block = `<!-- measured-benchmark:start -->\n## Measured backend performance\n\nThe core world engine passed a ${fmt(soak.measuredSeconds / 60, 0)}-minute soak with **${e.count} actively moving simulated players**, sustaining **${fmt(soak.traffic.packetsPerSecond, 0)} logical protocol messages/s** at **${fmt(soak.latency.p95)} ms p95 MOVE-to-ACK latency** and **${fmt(soak.tick.p95, 3)} ms p95 tick processing** (50 ms budget).\n\n${data.aoi ? `Spatial AOI reduced replication deliveries per acknowledged move by **${fmt(data.aoi.reductionPercent)}%** against global replication in a matched ${data.aoi.players}-player distributed test.\n\n` : ""}Measured on ${e.cpu}, ${Math.round(e.ramMiB / 1024)} GiB RAM, Node ${e.node}; bots and server on the same host. These are core-engine measurements, not the full event economy's player limit or a hardware-independent capacity guarantee. All passing and failing runs, full-game validation, exact environment, stability gates, resume wording and reproduction commands are in [the benchmark report](docs/benchmarks/RESULTS.md).\n<!-- measured-benchmark:end -->`;
const marker =
  /<!-- measured-benchmark:start -->[\s\S]*?<!-- measured-benchmark:end -->/;
const anchor = "\n## Complete project handoff";
writeFileSync(
  readmePath,
  marker.test(readme)
    ? readme.replace(marker, block)
    : readme.includes(anchor)
      ? readme.replace(anchor, "\n\n" + block + "\n" + anchor)
      : readme + "\n\n" + block + "\n",
);

const escape = (s) =>
  String(s)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
const reportRows = results
  .map(
    (r) =>
      `<tr><td>${escape(r.label)} <small>(${r.environment.loadModel === "serial-world-intents-v2" ? "v2" : "legacy v1"})</small></td><td>${r.environment.count}</td><td>${r.traffic ? fmt(r.traffic.packetsPerSecond, 0) : "—"}</td><td>${r.latency ? fmt(r.latency.p95) : "—"}</td><td>${r.tick ? fmt(r.tick.p95, 3) : "—"}</td><td>${r.tick ? fmt(r.tick.overrunPercent, 3) + "%" : "—"}</td><td class="${r.status === "PASS" ? "pass" : "fail"}">${escape(r.status)}</td></tr>`,
  )
  .join("");
writeFileSync(
  join(output, "report.html"),
  `<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>THE HEIST — Backend benchmark evidence</title><style>body{margin:0;background:#07121d;color:#cad9e2;font:14px/1.8 system-ui;padding:40px 6%}a{color:#e8bd7d}h1{font-size:clamp(28px,4vw,48px);font-weight:500;color:#e8bd7d;max-width:900px;line-height:1.2}h2{font-weight:500;margin-top:45px}p{max-width:900px;color:#9fb5c4}pre{white-space:pre-wrap;overflow-wrap:anywhere;font:12px/1.85 ui-monospace,monospace;max-width:1200px}nav{display:flex;gap:25px;margin-bottom:45px;font-size:12px}.eyebrow{font:10px monospace;letter-spacing:.15em;color:#86c9c7}.headline{font-size:22px;color:#dce5e8}.table-wrap{overflow-x:auto}table{border-collapse:collapse;width:100%;font-size:12px;white-space:nowrap}th,td{text-align:left;padding:13px 15px;border-bottom:1px solid #2c4251}th{color:#83a6b7;font-weight:500}.pass{color:#9bd3b7}.fail{color:#efb19a}details{margin:35px 0;border-top:1px solid #2c4251;padding-top:22px}summary{cursor:pointer;color:#e8bd7d}</style><nav><a href="/">← THE HEIST</a><a href="all-results.json">Complete measured JSON ↗</a></nav><div class="eyebrow">MEASURED BACKEND EVIDENCE / ${escape(manifest.finishedAt)}</div><h1>A real-time world engine, put under active load.</h1><p class="headline">${e.count} moving simulated players. ${fmt(soak.measuredSeconds / 60, 0)} minutes. ${fmt(soak.traffic.packetsPerSecond, 0)} sustained protocol messages/s.</p><p>${fmt(soak.latency.p95)} ms p95 MOVE-to-ACK latency · ${fmt(soak.tick.p95, 3)} ms p95 tick execution · 50 ms tick budget.</p><p>Core world engine; event/contract scheduling excluded. ${escape(e.cpu)}, ${Math.round(e.ramMiB / 1024)} GiB RAM, Node ${escape(e.node)}. Server and bots share one host. This is a validated operating point, not an architectural maximum or a Render capacity guarantee.</p><h2>All campaign runs</h2><p>Passing, failing and interrupted runs are preserved. Public headline numbers come from the highest passing 15-minute core soak.</p><div class="table-wrap"><table><thead><tr><th>Run / scenario</th><th>Players</th><th>Logical msg/s</th><th>ACK p95 ms</th><th>Tick p95 ms</th><th>Ticks over budget</th><th>Gates</th></tr></thead><tbody>${reportRows}</tbody></table></div><h2>AOI replication</h2><p>${data.aoi ? `${fmt(data.aoi.reductionPercent)}% fewer delivered replication packets per acknowledged move in the ${data.aoi.players}-player spatial-versus-global comparison.` : "A paired AOI percentage is not published because both comparison runs did not pass."}</p><p>Global mode uses one world-sized chunk through the same production routing path. The metric is normalised by acknowledged movement so a slower bot stream cannot masquerade as a replication saving.</p><h2>Reproduce and audit</h2><p>Every run records CPU/runtime, source commit and build hash, workload configuration, raw tick timings, application ACK latency, frame/packet/byte counters, CPU and memory, reconnect/AOI checks and cleanup. Exact gates and commands are included below.</p><details><summary>Full methodology, environment, results and resume wording</summary><pre>${escape(intro)}</pre></details></html>`,
);
console.log(
  `Published passing ${e.count}-player soak and ${results.length} complete/failed results. Website: ${output}`,
);
