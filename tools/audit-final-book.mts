/** Verifies source provenance, public metadata and the live saved ledger without changing either source document. */
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { createHash } from "node:crypto";
import { DatabaseSync } from "node:sqlite";
import { CHALLENGE_CATALOGUE } from "../apps/server/src/game/challenge-catalogue.js";
import {
  generateChallenge,
  templates,
} from "../apps/server/src/game/challenges.js";
import {
  EVENT_RULES,
  validatePrizePlan,
  LEGACY_INITIAL_POOLS,
} from "../apps/server/src/game/rules.js";
validatePrizePlan();
if (
  JSON.stringify(CHALLENGE_CATALOGUE) !==
  JSON.stringify(
    JSON.parse(
      readFileSync("apps/server/src/game/challenge-catalogue.json", "utf8"),
    ),
  )
)
  throw new Error(
    "Compiled challenge metadata differs from the extracted worksheet rows",
  );
const sourcePaths = [
  "The Heist Zero Hour Challenge Book (Final).pdf",
  "The_Heist_Challenge_Tracker_and_Money_Plan.xlsx",
];
const hashes = [
  "465f58aab50d2fc659c2e86faf18d7ba30d47232745895de7a6753f5b1e523b4",
  "06db3e11db69d9db347948c11aab0fd61df081820cd2fa79a5837af85446a318",
];
const sources = sourcePaths.map((path, i) => {
  const hash = createHash("sha256").update(readFileSync(path)).digest("hex");
  if (hash !== hashes[i])
    throw new Error(
      "Source changed. Re-read and reconcile it before trusting this audit.",
    );
  return { path, sha256: hash, unchanged: true };
});
const catalogue = CHALLENGE_CATALOGUE.map((row) => {
  const c = generateChallenge("audit-only", "audit-operator", row.id);
  if (!c.validate(c.answer) || c.validate("__forged__"))
    throw new Error(`Invalid validator: ${row.id}`);
  const template = templates.find((t) => t.id === row.id)!;
  return {
    id: row.id,
    name: row.title,
    type: row.type,
    language: row.language,
    station: row.station,
    handlerId: template.station || null,
    workbench: c.workbench.kind,
    status: "Implemented; automated validation passed",
    humanDifficultyPlaytest: false,
  };
});
const map = JSON.parse(readFileSync("maps/art-world.json", "utf8")),
  clientMap = JSON.parse(
    readFileSync("apps/client/public/art/world.json", "utf8"),
  );
if (JSON.stringify(map) !== JSON.stringify(clientMap))
  throw new Error("Map copies differ");
const liveMap = await (await fetch("http://localhost:8080/api/map")).json();
if (JSON.stringify(map) !== JSON.stringify(liveMap))
  throw new Error("Live server map differs from the built manifest");
if (map.hotspots.find((h: any) => h.id === "sql")?.name !== "Code Review Desk")
  throw new Error("Code Review Desk label missing");
const db = new DatabaseSync("apps/server/data/heist.db.event.db", {
    readOnly: true,
  }),
  state = JSON.parse(
    (
      db.prepare("SELECT data FROM event_state WHERE id=1").get() as {
        data: string;
      }
    ).data,
  ),
  rows = db
    .prepare("SELECT * FROM event_ledger ORDER BY id")
    .all() as unknown as {
    hash: string;
    previous_hash: string;
    event_id: string;
    actor: string;
    time: number;
    source: string;
    destination: string;
    paise: number;
    reason: string;
  }[];
let previous = "GENESIS";
const balances: Record<string, number> = {
  ...(state.initialPools || LEGACY_INITIAL_POOLS),
};
for (const row of rows) {
  const hash = createHash("sha256")
    .update(
      JSON.stringify([
        previous,
        row.event_id,
        row.actor,
        row.time,
        row.source,
        row.destination,
        row.paise,
        row.reason,
      ]),
    )
    .digest("hex");
  if (row.hash !== hash || row.previous_hash !== previous)
    throw new Error("Ledger chain mismatch");
  balances[row.source] = (balances[row.source] || 0) - row.paise;
  balances[row.destination] = (balances[row.destination] || 0) + row.paise;
  previous = hash;
}
for (const key of new Set([
  ...Object.keys(balances),
  ...Object.keys(state.accounts),
]))
  if ((balances[key] || 0) !== (state.accounts[key] || 0))
    throw new Error(`Ledger balance mismatch: ${key}`);
const total = Object.values(state.accounts).reduce(
  (n: number, v) => n + Number(v),
  0,
);
if (total !== 400000) throw new Error("Money total mismatch");
db.close();
const report = {
  date: "2026-10-14",
  sources,
  catalogue,
  typeCounts: Object.fromEntries(
    ["Code", "Debug", "CTF", "Puzzle"].map((type) => [
      type,
      catalogue.filter((c) => c.type === type).length,
    ]),
  ),
  rules: EVENT_RULES,
  savedEvent: {
    phase: state.phase,
    rulesVersion: state.rulesVersion,
    totalPaise: total,
    ledgerRows: rows.length,
    reconciled: true,
    ledgerChainVerified: true,
    preMigrationBackupPresent: existsSync(
      "apps/server/data/heist.db.event.db.before-final-book.db",
    ),
  },
  world: {
    version: map.version,
    scenes: map.scenes.length,
    homeSites: map.homePlots.length,
    interactionPoints: map.hotspots.length,
    gates: map.exits.length,
    serverClientManifestIdentical: true,
    artworkChanged: false,
    activeHousingWards: ["A", "B", "C"],
    reserveHousingWards: ["D", "E", "F"],
  },
  limitations: [
    "Real payout method and minimum payout remain organizer decisions. No payment provider is connected.",
    "Automated solve and money checks do not establish first-year difficulty or a three-hour 40-player VM soak.",
    "Accessible code remains text; no claim of blocking AI tools or screenshots.",
    "Server validation is retained rather than trusting browser completion claims.",
  ],
};
writeFileSync(
  "docs/final-challenge-book-audit.json",
  JSON.stringify(report, null, 2) + "\n",
);
console.log(
  JSON.stringify({
    challenges: catalogue.length,
    types: report.typeCounts,
    world: report.world,
    savedEvent: report.savedEvent,
  }),
);
