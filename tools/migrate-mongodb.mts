/** One-time, explicitly confirmed offline import. Never overwrites an existing Mongo world. */
import { loadEnvFile } from "node:process";
import { DatabaseSync } from "node:sqlite";
import { resolve, join } from "node:path";
import { readFileSync, mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { randomBytes, createHash } from "node:crypto";
import { MongoDatabase } from "../apps/server/src/persistence/mongodb.js";
import { EventEngine } from "../apps/server/src/game/event-engine.js";
import {
  EVENT_TABLES,
  type EventPersistenceData,
} from "../apps/server/src/game/persistence-contract.js";
import { loadMap } from "@heist/shared";
if (process.argv[2] !== "--confirm-stopped-server")
  throw new Error("Stop the SQLite server, then pass --confirm-stopped-server");
loadEnvFile(resolve(".env"));
const mongo = new MongoDatabase(
  process.env.MONGODB_URI!,
  process.env.MONGODB_DATABASE || "heist_zero_hour",
);
await mongo.initialize();
const source = resolve("apps/server/data"),
  backupRoot = resolve("bot-runs");
mkdirSync(backupRoot, { recursive: true });
const archive = mkdtempSync(join(backupRoot, "before-mongo-"));
const auth = new DatabaseSync(join(source, "heist.db"), { readOnly: true }),
  event = new DatabaseSync(join(source, "heist.db.event.db"), {
    readOnly: true,
  });
try {
  if (
    (await mongo.db.collection("players").countDocuments()) ||
    (await mongo.db.collection("event_current").countDocuments())
  )
    throw new Error("MongoDB target is not empty; refusing an overwrite");
  for (const [db, name] of [
    [auth, "heist.db"],
    [event, "heist.db.event.db"],
  ] as const)
    db.exec(`VACUUM INTO '${join(archive, name).replaceAll("'", "''")}'`);
  const data = (
    event.prepare("SELECT data FROM event_state WHERE id=1").get() as {
      data: string;
    }
  ).data;
  const tables = Object.fromEntries(
    EVENT_TABLES.map((t) => [
      t,
      event.prepare(`SELECT * FROM ${t} ORDER BY id`).all(),
    ]),
  ) as EventPersistenceData["tables"];
  const verify = new EventEngine(
    ":memory:",
    loadMap(JSON.parse(readFileSync("maps/art-world.json", "utf8"))),
  );
  verify.importPersistence({ data, tables });
  const audit = verify.audit();
  verify.close();
  if (!audit.ok) throw new Error("Source ledger audit failed");
  const players = (auth.prepare("SELECT * FROM players").all() as any[]).map(
    (r) => ({
      _id: r.id,
      username: r.username,
      passwordHash: r.password_hash,
      role: r.role ?? "player",
      createdAt: new Date(r.created_at),
    }),
  );
  const sessions = (auth.prepare("SELECT * FROM sessions").all() as any[]).map(
    (r) => ({
      _id: r.token,
      playerId: r.player_id,
      createdAt: new Date(r.created_at),
      lastSeen: new Date(r.last_seen),
    }),
  );
  const positions = (
    auth.prepare("SELECT * FROM player_state").all() as any[]
  ).map((r) => ({
    _id: r.player_id,
    x: r.x,
    y: r.y,
    dir: r.dir,
    data: r.data,
    updatedAt: new Date(r.updated_at),
  }));
  const epoch = randomBytes(16).toString("hex"),
    records = EVENT_TABLES.flatMap((table) =>
      tables[table].map((row) => ({
        ...row,
        _id: `${epoch}:${table}:${row.id}`,
        epoch,
        table,
      })),
    );
  const session = mongo.client.startSession();
  try {
    await session.withTransaction(
      async () => {
        if (players.length)
          await mongo.db
            .collection<any>("players")
            .insertMany(players, { session });
        if (sessions.length)
          await mongo.db
            .collection<any>("sessions")
            .insertMany(sessions, { session });
        if (positions.length)
          await mongo.db
            .collection<any>("player_state")
            .insertMany(positions, { session });
        if (records.length)
          await mongo.db
            .collection<any>("event_records")
            .insertMany(records, { session });
        await mongo.db
          .collection<any>("event_current")
          .insertOne(
            { _id: "world", epoch, revision: 0, data, owner: null },
            { session },
          );
        await mongo.db
          .collection<any>("migration_records")
          .insertOne(
            {
              _id: "sqlite-v1",
              migratedAt: new Date(),
              sourceSha256: createHash("sha256").update(data).digest("hex"),
              players: players.length,
              sessions: sessions.length,
              positions: positions.length,
              ledger: tables.event_ledger.length,
            },
            { session },
          );
      },
      { writeConcern: { w: "majority" }, readConcern: { level: "snapshot" } },
    );
  } finally {
    await session.endSession();
  }
  const report = {
    status: "PASS",
    database: process.env.MONGODB_DATABASE,
    players: players.length,
    sessions: sessions.length,
    positions: positions.length,
    ledgerRows: tables.event_ledger.length,
    phase: JSON.parse(data).phase,
    ledgerTotal: audit.total,
    backupDirectory: archive,
  };
  writeFileSync(
    join(archive, "migration-report.json"),
    JSON.stringify(report, null, 2),
  );
  console.log(JSON.stringify(report, null, 2));
} finally {
  auth.close();
  event.close();
  await mongo.close();
}
