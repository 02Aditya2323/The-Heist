/**
 * Throughput test for the MongoDB event authority, against a real cluster.
 *
 * Uses a throwaway database named heist_loadtest_<random> on the configured
 * cluster, never the event's database, and drops it afterwards. It enrols
 * players, starts an event, then fires a burst of concurrent operations the
 * way live players and the scheduler tick do, and reports how long the queue
 * takes to clear and whether the economy and every result stayed correct.
 *
 * Usage: npx tsx tools/load-mongo-authority.mts [--ops=300]
 * Reads MONGODB_URI from HEIST_ENV_FILE or ./.env.
 */
import { loadEnvFile } from "node:process";
import { resolve } from "node:path";
import { readFileSync } from "node:fs";
import { randomBytes } from "node:crypto";
import { loadMap } from "@heist/shared";
import { MongoDatabase } from "../apps/server/src/persistence/mongodb.js";
import { MongoAuthority } from "../apps/server/src/game/mongo-authority.js";
import { EVENT_RULES } from "../apps/server/src/game/rules.js";

loadEnvFile(process.env.HEIST_ENV_FILE || resolve(".env"));
const uri = process.env.MONGODB_URI;
if (!uri) throw new Error("MONGODB_URI is not set");
const ops = Number(
  process.argv.find((a) => a.startsWith("--ops="))?.slice(6) ?? 300,
);
const name = `heist_loadtest_${randomBytes(4).toString("hex")}`;
const map = loadMap(
  JSON.parse(readFileSync(resolve("maps/art-world.json"), "utf8")),
);

const database = new MongoDatabase(uri, name);
await database.initialize();
try {
  const authority = new MongoAuthority(database, map, 180);
  await authority.initialize();
  const engine = () => authority.engine;
  const players = Array.from({ length: 17 }, (_, i) => `load-${i}`);
  for (const id of players)
    await authority.run(() => engine().ensurePlayer(id, id));
  await authority.run(() => engine().start());

  // A mix like live play: state-changing actions (claims that will mostly be
  // refused for location, which still writes a request-log row), sync reads,
  // and the scheduler tick. Every result must come back to its own caller.
  const started = Date.now();
  const results = await Promise.allSettled(
    Array.from({ length: ops }, (_, i) => {
      const id = players[i % players.length];
      if (i % 10 === 0) return authority.run(() => engine().tick());
      return authority.run(() => {
        try {
          return engine().action(id, {
            type: "game_action",
            action: i % 3 ? "job" : "sync",
            id: "ST-01",
          });
        } catch (error) {
          return { error: (error as Error).message };
        }
      });
    }),
  );
  const elapsed = Date.now() - started;
  const rejected = results.filter((r) => r.status === "rejected");
  const total = Object.values(engine().audit().accounts).reduce(
    (a: number, b) => a + Number(b),
    0,
  );
  console.log(`database        ${name} (throwaway)`);
  console.log(`operations      ${ops}`);
  console.log(`queue cleared   ${(elapsed / 1000).toFixed(1)} s`);
  console.log(`throughput      ${(ops / (elapsed / 1000)).toFixed(1)} ops/s`);
  console.log(`rejected        ${rejected.length}`);
  for (const r of rejected.slice(0, 3))
    console.log(`  ${(r as PromiseRejectedResult).reason}`);
  console.log(`ledger ok       ${engine().audit().ok}`);
  console.log(
    `money total     ${total} paise (expected ${EVENT_RULES.total})`,
  );
  // Durability: a fresh authority must load exactly the committed state.
  const reload = new MongoAuthority(database, map, 180);
  const view = JSON.stringify(engine().audit().accounts);
  await authority.close?.();
  await reload.initialize();
  console.log(
    `reload matches  ${JSON.stringify(reload.engine.audit().accounts) === view}`,
  );
  await reload.close?.();
  if (rejected.length || !engine().audit().ok || total !== EVENT_RULES.total)
    process.exitCode = 1;
} finally {
  await database.client.db(name).dropDatabase();
  await database.client.close();
}
