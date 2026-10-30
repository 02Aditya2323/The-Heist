/** Trusted operator CLI only; public registration cannot select or change account roles. */
import { loadEnvFile } from "node:process";
import { randomBytes } from "node:crypto";
import { hash } from "argon2";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { resolve, join } from "node:path";
import { SqliteDatabase } from "../apps/server/src/persistence/sqlite.js";
import { resolveSqlitePath } from "../apps/server/src/persistence/path.js";
import type { AccountRole } from "@heist/shared";
if (process.argv[2] !== "--create-four-staff-accounts")
  throw new Error("Pass --create-four-staff-accounts");
// VM deployments keep credentials outside the checkout, in a root-only file.
try { loadEnvFile(process.env.HEIST_ENV_FILE || resolve('.env')); }
catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
const db = new SqliteDatabase(resolveSqlitePath(process.env.DB_URL));
await db.initialize();
try {
  const entries = [
    { username: "heist_superadmin", role: "superadmin" as AccountRole },
    ...[1, 2, 3].map((i) => ({
      username: `heist_admin_${i}`,
      role: "admin" as AccountRole,
    })),
  ];
  for (const a of entries)
    if (await db.players.findByUsername(a.username))
      throw new Error(
        `Account ${a.username} already exists; refusing promotion or password replacement`,
      );
  const credentials = entries.map((a) => ({
    ...a,
    password: randomBytes(24).toString("base64url"),
  }));
  const directory = resolve("bot-runs");
  mkdirSync(directory, { recursive: true });
  const output = mkdtempSync(join(directory, "admin-access-"));
  writeFileSync(
    join(output, "credentials.json"),
    JSON.stringify(credentials, null, 2),
    {mode:0o600},
  );
  for (const a of credentials)
    await db.players.createPlayer(
      randomBytes(16).toString("hex"),
      a.username,
      await hash(a.password),
      a.role,
    );
  console.log(
    JSON.stringify(
      {
        created: entries,
        privateCredentialsFile: join(output, "credentials.json"),
      },
      null,
      2,
    ),
  );
} finally {
  await db.close();
}
