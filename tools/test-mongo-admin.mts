/** Real Atlas integration in an explicitly named disposable QA database, never the saved world. */
import { loadEnvFile } from "node:process";
import { randomBytes } from "node:crypto";
import { hash } from "argon2";
import { readFileSync, mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { resolve, join } from "node:path";
import assert from "node:assert/strict";
import { pino } from "pino";
import {
  loadMap,
  findPath,
  pathToDirections,
  sceneAt,
  type Direction,
} from "@heist/shared";
import { MongoDatabase } from "../apps/server/src/persistence/mongodb.js";
import { MongoAuthority } from "../apps/server/src/game/mongo-authority.js";
import { EventRuntime } from "../apps/server/src/game/runtime.js";
import { World } from "../apps/server/src/world/world.js";
import { loadConfig } from "../apps/server/src/config.js";
import { ConnectionManager } from "../apps/server/src/net/connection.js";
import { GameWsServer } from "../apps/server/src/net/ws-server.js";
import { TickLoop } from "../apps/server/src/world/tick.js";
import { Snapshotter } from "../apps/server/src/persistence/snapshotter.js";
import { MetricsTracker } from "../apps/server/src/metrics/metrics.js";
import { createHttpServer } from "../apps/server/src/http/server.js";
import { HostingPeer, waitFor } from "../apps/bots/src/hosting-peer.js";
import { solvePublicChallenge } from "../apps/bots/src/gameplay-solver.js";
if (process.argv[2] !== "--confirm-remote-qa")
  throw new Error(
    "Pass --confirm-remote-qa for an isolated Atlas integration test",
  );
loadEnvFile(resolve(".env"));
const name = `heist_admin_qa_${randomBytes(8).toString("hex")}`,
  db = new MongoDatabase(process.env.MONGODB_URI!, name);
await db.initialize();
const raw = JSON.parse(readFileSync("maps/art-world.json", "utf8")),
  map = loadMap(raw),
  world = new World(map, raw, loadConfig()),
  authority = new MongoAuthority(db, map),
  connections = new ConnectionManager();
await authority.initialize();
const rt = new EventRuntime(authority.engine, world, connections, authority),
  metrics = new MetricsTracker(20),
  log = pino({ level: "silent" }),
  app = createHttpServer(world, db, metrics, loadConfig()),
  ws = new GameWsServer(
    app.server,
    world,
    connections,
    db,
    loadConfig(),
    metrics,
    log,
  ),
  snapshots = new Snapshotter(db.state, 10000, world, log),
  tick = new TickLoop(
    world,
    connections,
    loadConfig(),
    metrics,
    snapshots,
    log,
  );
await app.listen({ host: "127.0.0.1", port: 0 });
const url = `http://127.0.0.1:${(app.server.address() as { port: number }).port}`;
rt.start();
tick.start();
snapshots.start();
mkdirSync("bot-runs", { recursive: true });
const directory = mkdtempSync(resolve("bot-runs/mongo-admin-qa-"));
const reports: object[] = [];
let peer: HostingPeer | undefined;
const password = randomBytes(24).toString("hex");
const check = (name: string, detail: unknown) => {
  reports.push({ name, detail, status: "PASS" });
  console.log(`PASS ${name}: ${JSON.stringify(detail)}`);
};
async function call(path: string, token?: string, body?: object) {
  const r = await fetch(url + path, {
    headers: {
      "content-type": "application/json",
      ...(token ? { authorization: `Bearer ${token}` } : {}),
    },
    ...(body ? { method: "POST", body: JSON.stringify(body) } : {}),
  });
  return { status: r.status, data: await r.json() };
}
try {
  const staffTokens: Record<string, string> = {};
  for (const role of ["admin", "superadmin"] as const) {
    await db.players.createPlayer(
      role,
      `qa_${role}`,
      await hash(password),
      role,
    );
    const login = await call("/api/login", undefined, {
      username: `qa_${role}`,
      password,
    });
    assert.equal(login.status, 200);
    staffTokens[role] = login.data.token;
  }
  const signup = await call("/api/register", undefined, {
    username: "qa_player",
    password,
    role: "superadmin",
  });
  assert.equal(signup.status, 201);
  const playerToken = signup.data.token;
  assert.equal(
    (await db.players.findById(signup.data.playerId))!.role,
    "player",
  );
  assert.equal((await call("/api/admin/event", playerToken)).status, 403);
  assert.equal((await call("/api/admin/event", staffTokens.admin)).status, 403);
  check("real Mongo role boundaries", {
    publicSignupRole: "player",
    adminControls: "superadmin-only",
  });
  const cat = await call("/api/staff/challenges", staffTokens.admin);
  assert.equal(cat.data.length, 42);
  const kinds = new Set<string>();
  for (const c of cat.data) {
    const opened = await call("/api/staff/challenges/open", staffTokens.admin, {
      template: c.id,
    });
    assert.equal(opened.status, 200);
    kinds.add(opened.data.challenge.workbench.kind);
    assert.equal(opened.data.challenge.reward, 0);
    assert.equal(opened.data.challenge.answer, undefined);
    await call("/api/staff/challenges/action", staffTokens.admin, {
      action: "abandon",
      id: opened.data.challenge.id,
    });
  }
  assert.equal(kinds.size, 17);
  check("entire protected challenge catalogue", { templates: 42, kinds: 17 });
  const opened = await call("/api/staff/challenges/open", staffTokens.admin, {
      template: "ST-01",
    }),
    challenge = opened.data.challenge;
  assert.equal(
    (
      await call("/api/staff/challenges/action", staffTokens.superadmin, {
        action: "answer",
        id: challenge.id,
        answer: "0",
      })
    ).status,
    404,
  );
  const solved = await call("/api/staff/challenges/action", staffTokens.admin, {
    action: "answer",
    id: challenge.id,
    answer: solvePublicChallenge(challenge),
  });
  assert.equal(solved.data.correct, true);
  assert.equal(authority.engine.roster().length, 0);
  check("unpaid private staff solve", { correct: true, staffEnrollment: 0 });
  assert.equal(
    (
      await call("/api/admin/event", staffTokens.admin, {
        action: "reset",
        confirm: "RESET",
        eventKey: authority.engine.eventKey(),
      })
    ).status,
    403,
  );
  const started = await call("/api/admin/event", staffTokens.superadmin, {
    action: "start",
  });
  assert.equal(started.status, 200);
  assert.equal(started.data.phase, "live");
  peer = new HostingPeer(playerToken, signup.data.playerId, url, map);
  await peer.connect();
  await waitFor(() => !!peer!.event, "Player state missing");
  const cp = map.hotspots.find((h) => h.id === "cp-lab")!;
  const from = sceneAt(map, peer.x, peer.y)!.id,
    to = sceneAt(map, cp.x, cp.y)!.id;
  const queue: { scene: string; exits: NonNullable<typeof map.exits> }[] = [
      { scene: from, exits: [] },
    ],
    seen = new Set([from]);
  let route: NonNullable<typeof map.exits> | undefined;
  for (let i = 0; i < queue.length; i++) {
    const node = queue[i];
    if (node.scene === to) {
      route = node.exits;
      break;
    }
    for (const exit of map.exits ?? []) {
      if (sceneAt(map, exit.x, exit.y)?.id !== node.scene) continue;
      const next = sceneAt(map, exit.targetX, exit.targetY)?.id;
      if (next && !seen.has(next)) {
        seen.add(next);
        queue.push({ scene: next, exits: [...node.exits, exit] });
      }
    }
  }
  assert(route);
  const walk = async (x: number, y: number) => {
    const path = findPath(map, peer!.x, peer!.y, x, y);
    assert(path);
    for (const dir of pathToDirections(peer!.x, peer!.y, path)) {
      assert(peer!.move(dir as Direction));
      await peer!.drain();
      await new Promise((r) => setTimeout(r, peer!.stepMs + 15));
    }
  };
  for (const exit of route) {
    await walk(exit.x, exit.y);
    const before = peer.teleports;
    peer.sendJson({ type: "interact", id: exit.id });
    await waitFor(() => peer!.teleports > before, "Travel not accepted");
    await new Promise((r) => setTimeout(r, peer!.stepMs + 15));
  }
  await walk(cp.x, cp.y);
  peer.sendJson({ type: "game_action", action: "job", id: "ST-01" });
  await waitFor(
    () => !!peer!.event?.challenges.find((c) => c.title.startsWith("ST-01")),
    "Paid contract acquisition missing",
  );
  const paid = peer.event!.challenges.find((c) => c.title.startsWith("ST-01"))!;
  await new Promise((r) => setTimeout(r, 6000));
  peer.sendJson({
    type: "game_action",
    action: "answer",
    id: paid.id,
    answer: solvePublicChallenge(paid),
  });
  await waitFor(
    () => peer!.event!.player.home === 1000,
    "Mongo paid reward did not settle",
  );
  assert.equal(peer.rejects, 0);
  assert.equal(peer.errors, 0);
  const ledgerBefore = await db.db
    .collection<any>("event_records")
    .find({ table: "event_ledger" })
    .toArray();
  assert.equal(ledgerBefore.length, 1);
  assert(authority.engine.audit().ok);
  check("actual acquired paid job through WebSocket", {
    homePaise: 1000,
    moves: peer.moves,
    acks: peer.acks,
    ledgerRows: 1,
  });
  const key = authority.engine.eventKey();
  const reset = await call("/api/admin/event", staffTokens.superadmin, {
    action: "reset",
    confirm: "RESET",
    eventKey: key,
  });
  assert.equal(reset.status, 200);
  assert.equal(reset.data.phase, "lobby");
  assert.equal(reset.data.players[0].home, 0);
  assert.notEqual(reset.data.eventKey, key);
  const ledgerAfter = await db.db
    .collection<any>("event_records")
    .find({ _id: ledgerBefore[0]._id })
    .toArray();
  assert.deepEqual(ledgerAfter, ledgerBefore);
  assert.equal(await db.db.collection("event_archives").countDocuments(), 1);
  assert.equal((await call("/api/account", playerToken)).status, 200);
  assert.equal(
    (
      await call("/api/admin/event", staffTokens.superadmin, {
        action: "reset",
        confirm: "RESET",
        eventKey: key,
      })
    ).status,
    400,
  );
  check("super-admin Reset preserves accounts and immutable archived ledger", {
    archives: 1,
    oldLedgerUnchanged: true,
    oldSessionWorks: true,
    staleReplayRejected: true,
  });
  const document = await db.db
    .collection<any>("event_current")
    .findOne({ _id: "world" });
  assert.equal(JSON.parse(document.data).phase, "lobby");
  check("durable Atlas state", { revision: document.revision, phase: "lobby" });
  const audits = await db.db.collection('staff_audit').find().toArray();
  assert.deepEqual(audits.map(a => a.action), ['start', 'reset']);
  check('organizer actions atomically audited', { actions: audits.map(a => a.action) });
  const stored = await db.state.findByPlayerId(signup.data.playerId);
  assert(stored);
  await db.state.save({ ...stored, x: cp.x, y: cp.y, updatedAt: new Date(0) });
  assert.equal((await db.state.findByPlayerId(signup.data.playerId))!.x, map.spawns[0].x);
  check('old snapshot cannot undo Reset', { stalePositionIgnored: true });
  await peer.close(); peer = undefined;
  tick.stop(); snapshots.stop(); ws.close(); await rt.stop();
  const restored = new MongoAuthority(db, map);
  await restored.initialize();
  try {
    assert.equal(restored.engine.eventKey(), reset.data.eventKey);
    assert.equal(restored.engine.adminView().phase, 'lobby');
    assert.equal(restored.engine.roster().length, 1);
    assert(restored.engine.audit().ok);
    check('fresh process authority hydrates Atlas state', { phase: 'lobby', accountsPreserved: true, ledgerBalanced: true });
  } finally { await restored.close(); restored.engine.close(); }
  writeFileSync(
    join(directory, "report.json"),
    JSON.stringify({ status: "PASS", database: name, reports }, null, 2),
  );
  console.log(`Atlas integration PASS: ${join(directory, "report.json")}`);
} catch (e) {
  writeFileSync(
    join(directory, "report.json"),
    JSON.stringify(
      {
        status: "FAIL",
        database: name,
        reports,
        error: e instanceof Error ? e.message : "Test failed",
      },
      null,
      2,
    ),
  );
  throw e;
} finally {
  if (peer) await peer.close();
  tick.stop();
  snapshots.stop();
  metrics.stop();
  ws.close();
  await rt.stop();
  await app.close();
  await db.close();
}
