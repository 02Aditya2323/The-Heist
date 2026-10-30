/** Isolated CPU benchmark; never opens the saved event or changes its ledger. */
import { readFileSync } from "node:fs";
import { loadMap } from "@heist/shared";
import { EventEngine } from "../apps/server/src/game/event-engine.js";
const map = loadMap(
  JSON.parse(
    readFileSync(new URL("../maps/art-world.json", import.meta.url), "utf8"),
  ),
);
const engine = new EventEngine(":memory:", map);
try {
  for (let i = 0; i < 40; i++) {
    const id = `benchmark-${i}`;
    engine.ensurePlayer(id, id);
    const internal = engine as any;
    for (const template of ["ST-01", "ST-02", "ST-03", "SD-07", "EX-01"])
      internal.attempt(
        internal.state.players[id],
        template,
        "training",
        Date.now() + 1800000,
        "benchmark",
      );
  }
  const samples: number[] = [];
  for (let round = 0; round < 40; round++) {
    const start = performance.now();
    for (let i = 0; i < 40; i++) JSON.stringify(engine.view(`benchmark-${i}`));
    if (round >= 5) samples.push(performance.now() - start);
  }
  samples.sort((a, b) => a - b);
  console.log(
    JSON.stringify(
      {
        workload: "40 operators × 5 mixed workbenches, view + serialize",
        rounds: samples.length,
        medianBatchMs: +samples[Math.floor(samples.length / 2)].toFixed(3),
        p95BatchMs: +samples[Math.floor(samples.length * 0.95)].toFixed(3),
        maxBatchMs: +samples.at(-1)!.toFixed(3),
      },
      null,
      2,
    ),
  );
} finally {
  engine.close();
}
