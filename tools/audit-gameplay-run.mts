/** Read-only post-run verification of an explicitly named disposable gameplay run. */
import { readFileSync, writeFileSync } from "node:fs";
import { resolve, join, sep, basename } from "node:path";
import { DatabaseSync } from "node:sqlite";
const directory = resolve(process.argv[2] ?? "");
const allowed = resolve("bot-runs");
if (
  !directory.startsWith(allowed + sep) ||
  !basename(directory).startsWith("gameplay-")
)
  throw new Error(
    "Pass an explicit bot-runs/gameplay-* directory, never the saved event",
  );
const summary = JSON.parse(
  readFileSync(join(directory, "summary.json"), "utf8"),
);
const actions = readFileSync(join(directory, "actions.ndjson"), "utf8")
  .trim()
  .split("\n")
  .filter(Boolean)
  .map((l) => JSON.parse(l));
const db = new DatabaseSync(join(directory, "event.db"), { readOnly: true });
const count = (action: string) =>
  actions.filter((a) => a.action === action && !a.error).length;
try {
  const accepted = db
    .prepare(
      `SELECT json_extract(a.value,'$.mode') AS mode,json_extract(a.value,'$.template') AS template,COUNT(*) AS clears
    FROM event_answers AS r JOIN event_state AS s ON s.id=1 JOIN json_each(s.data,'$.attempts') AS a ON a.key=r.challenge
    WHERE r.accepted=1 GROUP BY mode,template ORDER BY mode,template`,
    )
    .all() as { mode: string; template: string; clears: number }[];
  const early = db
    .prepare(
      `SELECT COUNT(*) AS n FROM event_answers AS r JOIN event_state AS s ON s.id=1
    JOIN json_each(s.data,'$.attempts') AS a ON a.key=r.challenge
    WHERE r.accepted=1 AND json_extract(a.value,'$.mode')!='training'
    AND r.time < MAX(json_extract(a.value,'$.openedAt'),COALESCE((SELECT json_extract(c.value,'$.start') FROM json_each(s.data,'$.contests') AS c
      WHERE json_extract(a.value,'$.mode')='race' AND json_extract(c.value,'$.id')=json_extract(a.value,'$.template')),0))+5000`,
    )
    .get() as { n: number };
  const duplicates = db
    .prepare(
      `SELECT challenge,COUNT(*) AS n FROM event_answers WHERE accepted=1 GROUP BY challenge HAVING n>1`,
    )
    .all();
  const withdrawals = db
    .prepare(
      `SELECT reason,COUNT(*) AS transfers,SUM(paise) AS paise FROM event_ledger
    WHERE reason IN ('Bank deposit','Withdrawal requested','Withdrawal arrived','Bank holding fee','Checkout') GROUP BY reason`,
    )
    .all() as { reason: string; transfers: number; paise: number }[];
  const deposits =
    withdrawals.find((r) => r.reason === "Bank deposit")?.transfers ?? 0;
  const requests =
    withdrawals.find((r) => r.reason === "Withdrawal requested")?.transfers ??
    0;
  const arrivals =
    withdrawals.find((r) => r.reason === "Withdrawal arrived")?.transfers ?? 0;
  const completeTimeline =
    summary.options.seconds >= summary.options.eventMinutes * 60 + 10;
  const audit = {
    status:
      summary.status === "PASS" &&
      early.n === 0 &&
      duplicates.length === 0 &&
      (!completeTimeline ||
        (deposits > 0 &&
          requests > 0 &&
          arrivals === requests &&
          count("enter_home") > 0 &&
          count("race_enter") > 0 &&
          count("checkout") > 0))
        ? "PASS"
        : "FAIL",
    liveRunStatus: summary.status,
    players: summary.options.bots,
    accepted,
    acceptedTotal: accepted.reduce((n, r) => n + r.clears, 0),
    paidJobs: accepted
      .filter((r) => r.mode === "job")
      .reduce((n, r) => n + r.clears, 0),
    practiceClears: accepted
      .filter((r) => r.mode === "training")
      .reduce((n, r) => n + r.clears, 0),
    raceClears: accepted
      .filter((r) => r.mode === "race")
      .reduce((n, r) => n + r.clears, 0),
    tooEarlyPaidAnswers: early.n,
    duplicateAcceptedAttempts: duplicates.length,
    finance: withdrawals,
    queueAccepts: count("accept_queue"),
    homeEntries: count("enter_home"),
    homeLeaves: count("leave_home"),
    raceEntries: count("race_enter"),
    voluntaryCheckoutRequests: count("checkout"),
    queueTests: summary.gates["four-slots-plus-fifo"],
    ledgerConserved: summary.finalAudit?.ok,
    finalPhase: summary.finalPhase,
    savedEventPreserved: summary.gates["saved-event-preserved"]?.passed,
    network: {
      moves: summary.bots.reduce((n: number, b: any) => n + b.moves, 0),
      acks: summary.bots.reduce((n: number, b: any) => n + b.acks, 0),
      rejects: summary.bots.reduce((n: number, b: any) => n + b.rejects, 0),
      protocolErrors: summary.bots.reduce(
        (n: number, b: any) => n + b.protocolErrors,
        0,
      ),
      worstBotAckP99Ms: Math.max(
        ...summary.bots.map((b: any) => b.ack.p99 ?? 0),
      ),
    },
    scope:
      "Read-only authority audit after ordinary acquisition/solve actions. Condensed schedule where configured; not a three-hour, raid, burglary, browser-FPS or lab-network certification.",
  };
  writeFileSync(
    join(directory, "authority-audit.json"),
    JSON.stringify(audit, null, 2),
  );
  console.log(JSON.stringify(audit, null, 2));
  if (audit.status !== "PASS") process.exitCode = 1;
} finally {
  db.close();
}
