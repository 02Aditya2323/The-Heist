/**
 * Reset the password of an existing staff account.
 *
 * Why this exists: `provision-admins.mts` deliberately refuses to touch an
 * account that already exists, so it cannot recover access when a staff
 * password is lost. That refusal is correct — it stops the provisioner being
 * used to silently replace a live credential — but it leaves no path back in,
 * which is a problem on event day.
 *
 * Deliberate limits:
 *
 *  - Only `admin` and `superadmin` accounts can be reset. A player account is
 *    refused, so this tool can never be used to take over a participant's
 *    account and their progress or balance.
 *  - It never creates an account and never changes a role. If the username does
 *    not already exist with a staff role, it exits.
 *  - Every session belonging to the account is deleted, so a session issued
 *    under the old password cannot outlive the reset.
 *  - The new password is printed exactly once and never written to disk. Record
 *    it immediately and pass it to the one person who needs it.
 *
 * Usage:
 *   npx tsx tools/reset-staff-password.mts --username=heist_superadmin --confirm-reset
 *   npx tsx tools/reset-staff-password.mts --username=heist_admin_1 --confirm-reset --password='your own choice'
 *
 * On the VM the credentials live outside the checkout, so run it as:
 *   sudo HEIST_ENV_FILE=/etc/heist/heist.env npx tsx tools/reset-staff-password.mts ...
 */
import { loadEnvFile } from "node:process";
import { randomBytes } from "node:crypto";
import { hash } from "argon2";
import { resolve } from "node:path";
import { SqliteDatabase } from "../apps/server/src/persistence/sqlite.js";
import { resolveSqlitePath } from "../apps/server/src/persistence/path.js";

const args = process.argv.slice(2);
const flag = (name: string) =>
  args.find((a) => a.startsWith(`--${name}=`))?.slice(name.length + 3);

const username = flag("username");
if (!username || !args.includes("--confirm-reset"))
  throw new Error(
    "Usage: --username=NAME --confirm-reset [--password=VALUE]\n" +
      "Only existing admin or superadmin accounts can be reset.",
  );

/**
 * A readable but strong default: 24 characters from an unambiguous alphabet.
 * 0/O/1/l/I are excluded because this gets read aloud or typed from a screen
 * during an event, and a transcription error at that moment is expensive.
 */
function generatePassword() {
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789";
  const bytes = randomBytes(24);
  let out = "";
  for (const b of bytes) out += alphabet[b % alphabet.length];
  return out;
}

const supplied = flag("password");
if (supplied !== undefined && supplied.length < 12)
  throw new Error("A supplied password must be at least 12 characters.");
const password = supplied ?? generatePassword();

try { loadEnvFile(process.env.HEIST_ENV_FILE || resolve('.env')); }
catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
const database = new SqliteDatabase(resolveSqlitePath(process.env.DB_URL));
try {
  await database.initialize();
  const result = await database.resetStaffPassword(username, await hash(password));
  console.log(`Staff password reset: ${username} (${result.role}). Sessions revoked: ${result.revoked}`);
  console.log(`Password (shown once): ${password}`);
} finally { await database.close(); }
