/** Explicitly authorized local organizer restart; retains accounts and backs up the pre-start lobby. */
import { spawn, execFileSync, type ChildProcess } from "node:child_process";
import { randomBytes } from "node:crypto";
import {
  mkdirSync,
  mkdtempSync,
  writeFileSync,
  appendFileSync,
  existsSync,
} from "node:fs";
import { resolve, join } from "node:path";
import { DatabaseSync } from "node:sqlite";

const root = resolve("."),
  args = process.argv.slice(2);
if (args.length !== 3 || !args.includes("--confirm-restart-current-server"))
  throw new Error(
    "Requires explicit --confirm-restart-current-server --server-pid=PID --watcher-pid=PID",
  );
function pid(key: string) {
  const value = args
    .find((s) => s.startsWith(`--${key}=`))
    ?.slice(key.length + 3);
  if (!value || !/^\d+$/.test(value) || Number(value) <= 0)
    throw new Error(`Invalid ${key}`);
  return Number(value);
}
const serverPid = pid("server-pid"),
  watcherPid = pid("watcher-pid");
for (const file of [
  "apps/server/dist/main.js",
  "apps/client/dist/index.html",
  "apps/server/data/heist.db",
  "apps/server/data/heist.db.event.db",
])
  if (!existsSync(join(root, file))) throw new Error(`Missing ${file}`);
const origin = "http://localhost:8080";
const oldResponse = await fetch(`${origin}/api/event`, {
  signal: AbortSignal.timeout(5000),
});
if (!oldResponse.ok || (await oldResponse.json()).phase !== "lobby")
  throw new Error(
    "Refusing restart: the existing server must be a responsive unstarted lobby",
  );
const runRoot = join(root, "bot-runs");
mkdirSync(runRoot, { recursive: true });
const directory = mkdtempSync(
  join(
    runRoot,
    `manual-live-${new Date().toISOString().replace(/[:.]/g, "-")}-`,
  ),
);
const backupDir = join(directory, "before-start");
mkdirSync(backupDir);
let manifest: any;
for (const name of ["heist.db", "heist.db.event.db"]) {
  const db = new DatabaseSync(join(root, "apps/server/data", name), {
    readOnly: true,
  });
  try {
    db.exec(`VACUUM INTO '${join(backupDir, name).replaceAll("'", "''")}'`);
    if (name.endsWith(".event.db")) {
      const state = JSON.parse(
        (
          db.prepare("SELECT data FROM event_state WHERE id=1").get() as {
            data: string;
          }
        ).data,
      );
      if (state.phase !== "lobby" || state.startedAt)
        throw new Error("Saved event already started; refusing restart");
      manifest = {
        sourceDirectory: join(root, "apps/server/data"),
        phase: state.phase,
        startedAt: state.startedAt,
        players: Object.keys(state.players).length,
        durationMinutes: state.duration / 60000,
      };
    }
  } finally {
    db.close();
  }
}
writeFileSync(
  join(backupDir, "manifest.json"),
  JSON.stringify(manifest, null, 2),
);
console.log(`Consistent pre-start snapshots: ${backupDir}`);
// Validate both exact process identities and listener ownership before stopping anything.
const projectPattern = root.replaceAll("'", "''");
execFileSync(
  "powershell.exe",
  [
    "-NoProfile",
    "-Command",
    `
$ErrorActionPreference='Stop';
$liveServer=Get-CimInstance Win32_Process -Filter 'ProcessId = ${serverPid}';
$liveWatcher=Get-CimInstance Win32_Process -Filter 'ProcessId = ${watcherPid}';
$liveListener=Get-NetTCPConnection -LocalPort 8080 -State Listen;
if(-not $liveServer -or -not $liveWatcher -or $liveServer.ParentProcessId -ne ${watcherPid} -or $liveListener.OwningProcess -notcontains ${serverPid}){throw 'Server process identity changed';}
if($liveServer.CommandLine -notlike '*${projectPattern.replaceAll("\\", "/")}*src/main.ts*' -and $liveServer.CommandLine -notlike '*${projectPattern}*src/main.ts*'){throw 'Unexpected server command';}
if($liveWatcher.CommandLine -notlike '*tsx*watch src/main.ts*'){throw 'Unexpected watcher command';}
Stop-Process -Id ${watcherPid};
if(Get-Process -Id ${serverPid} -ErrorAction SilentlyContinue){Stop-Process -Id ${serverPid};}
`,
  ],
  { windowsHide: true, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] },
);
const organizerToken = randomBytes(32).toString("hex");
writeFileSync(
  join(directory, "organizer-private.json"),
  JSON.stringify(
    { url: origin, organizerToken, backupDirectory: backupDir },
    null,
    2,
  ),
);
const child = spawn(
  process.execPath,
  ["--max-old-space-size=1024", join(root, "apps/server/dist/main.js")],
  {
    cwd: root,
    windowsHide: true,
    stdio: ["ignore", "pipe", "pipe"],
    env: {
      ...process.env,
      NODE_ENV: "production",
      PORT: "8080",
      DB_URL: `sqlite:${join(root, "apps/server/data/heist.db")}`,
      EVENT_DB_PATH: join(root, "apps/server/data/heist.db.event.db"),
      MAP_PATH: join(root, "maps/art-world.json"),
      CLIENT_BUILD_PATH: join(root, "apps/client/dist"),
      HEIST_ADMIN_TOKEN: organizerToken,
      DEBUG_ENDPOINTS: "false",
      ALLOW_REGISTER: "true",
      MAX_PLAYERS: "40",
      EVENT_DURATION_MINUTES: "180",
      TICK_RATE: "20",
      STEP_TICKS: "5",
      CHUNK_SIZE: "16",
      MAX_PENDING_MOVES: "2",
      MSG_RATE_PER_SEC: "60",
      MSG_BURST: "100",
      HEARTBEAT_TIMEOUT_MS: "15000",
      GHOST_GRACE_MS: "30000",
      SNAPSHOT_INTERVAL_MS: "10000",
      BACKPRESSURE_BYTES: "256000",
      UV_THREADPOOL_SIZE: "4",
      LOG_LEVEL: "info",
    },
  },
);
child.stdout?.on("data", (b) =>
  appendFileSync(join(directory, "server.log"), b),
);
child.stderr?.on("data", (b) =>
  appendFileSync(join(directory, "server.log"), b),
);
let spawnError: Error | undefined;
child.on("error", (e) => (spawnError = e));
const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));
async function admin(action?: string) {
  const response = await fetch(`${origin}/api/admin/event`, {
    headers: {
      "content-type": "application/json",
      "x-heist-admin": organizerToken,
    },
    ...(action ? { method: "POST", body: JSON.stringify({ action }) } : {}),
    signal: AbortSignal.timeout(5000),
  });
  if (!response.ok)
    throw new Error(`Organizer request failed (${response.status})`);
  return response.json() as Promise<any>;
}
try {
  let initial: any;
  for (let i = 0; ; i++) {
    if (spawnError || child.exitCode !== null)
      throw spawnError ?? new Error("Server exited; inspect server.log");
    try {
      initial = await admin();
      break;
    } catch {
      if (i >= 60) throw new Error("Restart failed; inspect server.log");
      await sleep(250);
    }
  }
  if (
    initial.phase !== "lobby" ||
    initial.startedAt ||
    !initial.audit.ok ||
    initial.players.length !== manifest.players
  )
    throw new Error("Restarted roster/lobby/audit differs; clock not started");
  const live = await admin("start");
  if (live.phase !== "live" || !live.startedAt || !live.audit.ok)
    throw new Error("Live event verification failed");
  const result = {
    url: origin,
    phase: live.phase,
    players: live.players.length,
    startedAt: live.startedAt,
    startsLocal: new Intl.DateTimeFormat("en-IN", {
      timeZone: "Asia/Kolkata",
      dateStyle: "medium",
      timeStyle: "medium",
    }).format(live.startedAt),
    durationMinutes: live.durationMs / 60000,
    paidSlots: live.slots.filter((s: any) => s.openMinute === 0).length,
    serverPid: child.pid,
    backupDirectory: backupDir,
    privateOrganizerFile: join(directory, "organizer-private.json"),
  };
  writeFileSync(
    join(directory, "started.json"),
    JSON.stringify(result, null, 2),
  );
  console.log(JSON.stringify(result, null, 2));
  console.log(
    "Live server remains running. No bot accounts added; original accounts retained.",
  );
} catch (error) {
  if (child.exitCode === null) child.kill("SIGTERM");
  throw error;
}
const stop = () => {
  if (child.exitCode === null) child.kill("SIGTERM");
};
process.once("SIGINT", stop);
process.once("SIGTERM", stop);
await new Promise<void>((r) => child.once("exit", () => r()));
