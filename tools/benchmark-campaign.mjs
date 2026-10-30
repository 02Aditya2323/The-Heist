/** Adaptive portfolio campaign; no remote services or saved player databases. */
import { spawnSync } from "node:child_process";
import { readdirSync, readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { resolve, join } from "node:path";
const root = resolve(import.meta.dirname, ".."),
  node = process.execPath;
const resume = process.argv.find((a) => a.startsWith("--resume="))?.slice(9);
const output = resume
  ? resolve(resume)
  : join(
      root,
      "bot-runs",
      `campaign-${new Date().toISOString().replace(/[:.]/g, "-")}`,
    );
mkdirSync(output, { recursive: true });
const manifest = resume
  ? JSON.parse(readFileSync(join(output, "campaign.json"), "utf8"))
  : {
      startedAt: new Date().toISOString(),
      runs: [],
      decisions: [],
      complete: false,
    };
function save() {
  writeFileSync(
    join(output, "campaign.json"),
    JSON.stringify(manifest, null, 2),
  );
}
function run(label, opts) {
  const before = new Set(readdirSync(join(root, "bot-runs")));
  console.log(`[campaign] ${label}`);
  const args = Object.entries(opts).map(([k, v]) => `--${k}=${v}`);
  const child = spawnSync(
    node,
    [join(root, "apps/bots/dist/benchmark.js"), ...args],
    { cwd: root, stdio: "inherit" },
  );
  const created = readdirSync(join(root, "bot-runs")).filter(
    (p) => p.startsWith("benchmark-") && !before.has(p),
  );
  if (created.length !== 1)
    throw Error(`Expected one benchmark result for ${label}`);
  const path = join(root, "bot-runs", created[0], "result.json");
  const result = JSON.parse(readFileSync(path, "utf8"));
  manifest.runs.push({
    label,
    options: opts,
    exitCode: child.status,
    path,
    status: result.status,
  });
  save();
  return result;
}
try {
  const passed = manifest.runs
    .filter((r) => r.status === "PASS" && r.label.startsWith("core-active-"))
    .map((r) => r.options.players);
  const candidates = new Set(passed);
  const levels = resume
    ? [500, 1000, 1500, 2000]
    : [10, 50, 100, 250, 500, 1000, 1500, 2000];
  for (const [index, players] of levels.entries()) {
    const result = run(
      `core-active-${players}${resume ? `-repeat-${index + 1}` : ""}`,
      {
        players,
        seconds: 180,
        warmup: 30,
        cleanup: 32,
        engine: "core",
        scenario: "steady",
        seed: 42,
      },
    );
    if (result.status === "PASS") {
      passed.push(players);
      candidates.add(players);
      continue;
    }
    const failed = Object.entries(result.gates || {})
      .filter(([, v]) => !v)
      .map(([k]) => k);
    const transientOnly =
      failed.length === 1 &&
      failed[0] === "tickBudget" &&
      result.tick.p95 < 25 &&
      result.tick.overrunPercent < 1;
    if (transientOnly) {
      candidates.add(players);
      manifest.decisions.push(
        `${players} failed only rare execution overruns (${result.tick.overrunPercent.toFixed(3)}%), while p95 processing stayed below 25ms. Treat as a candidate for the stricter long soak, not as a passing short run.`,
      );
      save();
      continue;
    }
    manifest.decisions.push(
      `Stopped the ramp at ${players}: ${failed.join(", ") || result.error}. Preserve this failure; soak a lower candidate.`,
    );
    save();
    break;
  }
  for (const players of [...candidates].sort((a, b) => b - a)) {
    const result = run(`core-soak-${players}`, {
      players,
      seconds: 900,
      warmup: 30,
      cleanup: 32,
      engine: "core",
      scenario: "soak",
      seed: 42,
    });
    if (result.status === "PASS") {
      manifest.soakedPlayers = players;
      break;
    }
    manifest.decisions.push(
      `The ${players}-player soak did not pass; test the next lower candidate.`,
    );
    save();
  }
  const comparison = Math.min(
    100,
    manifest.soakedPlayers || passed.at(-1) || 10,
  );
  run("aoi-spatial", {
    players: comparison,
    seconds: 180,
    warmup: 30,
    cleanup: 32,
    engine: "core",
    scenario: "steady",
    aoi: "spatial",
    seed: 991,
  });
  run("aoi-global", {
    players: comparison,
    seconds: 180,
    warmup: 30,
    cleanup: 32,
    engine: "core",
    scenario: "steady",
    aoi: "global",
    seed: 991,
  });
  run("hotspot", {
    players: comparison,
    seconds: 180,
    warmup: 30,
    cleanup: 32,
    engine: "core",
    scenario: "hotspot",
    seed: 42,
  });
  run("session-storms", {
    players: comparison,
    seconds: 45,
    warmup: 10,
    cleanup: 32,
    engine: "core",
    scenario: "reconnect",
    seed: 42,
  });
  run("connect-storm", {
    players: comparison,
    seconds: 45,
    warmup: 10,
    cleanup: 32,
    engine: "core",
    scenario: "connect-storm",
    seed: 42,
  });
  run("full-game", {
    players: 40,
    seconds: 180,
    warmup: 30,
    cleanup: 32,
    engine: "game",
    scenario: "steady",
    seed: 42,
  });
  manifest.complete = true;
  manifest.finishedAt = new Date().toISOString();
  save();
  console.log(`[campaign] COMPLETE ${output}`);
} catch (error) {
  manifest.error = String(error);
  save();
  throw error;
}
