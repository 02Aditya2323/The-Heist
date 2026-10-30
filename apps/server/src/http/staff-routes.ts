import type { FastifyInstance } from "fastify";
import type { Database } from "../persistence/interfaces.js";
import type { World } from "../world/world.js";
import { randomBytes } from "node:crypto";
import { isStaff, type AccountRole, type ChallengeView } from "@heist/shared";
import { CHALLENGE_CATALOGUE } from "../game/challenge-catalogue.js";
import { generateFinalChallenge } from "../game/final-challenges.js";

export function registerStaffRoutes(
  app: FastifyInstance,
  world: World,
  database: Database,
) {
  const previews = new Map<
      string,
      {
        owner: string;
        model: ReturnType<typeof generateFinalChallenge>;
        view: ChallengeView;
        lastAnswer: number;
        guesses: number;
      }
    >(),
    secret = randomBytes(32).toString("hex");
  let generation = world.eventRuntime?.eventKey();
  const currentGeneration = () => {
    const next = world.eventRuntime?.eventKey();
    if (next !== generation) {
      previews.clear();
      generation = next;
    }
  };
  const identity = async (req: any, reply: any, staff = false) => {
    const bearer =
      typeof req.headers.authorization === "string"
        ? req.headers.authorization.match(/^Bearer ([a-f0-9]{64})$/)?.[1]
        : undefined;
    const session = bearer ? await database.sessions.findByToken(bearer) : null;
    const account = session
      ? await database.players.findById(session.playerId)
      : null;
    if (!account) {
      reply.code(401).send({ error: "Sign in with an account" });
      return null;
    }
    if (staff && !isStaff(account.role)) {
      reply.code(403).send({ error: "Staff access required" });
      return null;
    }
    return account;
  };
  const organizer = async (req: any, reply: any) => {
    const token = process.env.HEIST_ADMIN_TOKEN;
    if (token && req.headers["x-heist-admin"] === token)
      return {
        id: "ORGANIZER",
        username: "Organizer key",
        role: "admin" as AccountRole,
      };
    const a = await identity(req, reply, true);
    if (a && a.role !== "superadmin") {
      reply.code(403).send({ error: "Super-admin controls required" });
      return null;
    }
    return a;
  };
  app.get("/api/account", async (req, reply) => {
    const a = await identity(req, reply);
    if (a) return { id: a.id, username: a.username, role: a.role ?? "player" };
  });
  app.get("/api/admin/event", async (req, reply) => {
    if (!(await organizer(req, reply))) return;
    const rt = world.eventRuntime;
    return rt
      ? rt.invoke('adminView', [])
      : reply.code(503).send({ error: "Event unavailable" });
  });
  app.get<{ Params: { id: string }; Querystring: { before?: string } }>(
    "/api/admin/history/:id",
    async (req, reply) => {
      if (!(await organizer(req, reply))) return;
      const rt = world.eventRuntime;
      return rt?.invoke('history', [req.params.id, req.query.before ? Number(req.query.before) : undefined]);
    },
  );
  app.post<{
    Body: {
      action?: string;
      id?: string;
      text?: string;
      confirm?: string;
      eventKey?: string;
    };
  }>("/api/admin/event", async (req, reply) => {
    const a = await organizer(req, reply);
    if (!a) return;
    const rt = world.eventRuntime;
    if (!rt) return reply.code(503).send({ error: "Event unavailable" });
    try {
      const body = req.body ?? {};
      const audit = { actor: a.id, username: a.username, action: body.action ?? '', target: body.id };
      if (body.action === "reset") {
        if (a.role !== "superadmin")
          return reply
            .code(403)
            .send({ error: "Only the super-admin can reset the game" });
        if (body.confirm !== "RESET" || typeof body.eventKey !== "string")
          return reply
            .code(400)
            .send({ error: "Type RESET and confirm the current event" });
        await rt.reset(body.eventKey, audit);
      } else {
        switch (body.action) {
          case 'start': await rt.invoke('start', [], audit); break;
          case 'freeze': await rt.invoke('freeze', [], audit); break;
          case 'pause': await rt.invoke('pause', [], audit); break;
          case 'resume': await rt.invoke('resume', [], audit); break;
          case 'announce':
            if (typeof body.text !== 'string' || body.text.length > 300) throw new Error('Announcement must be at most 300 characters');
            await rt.invoke('announce', [body.text], audit); break;
          case 'release': await rt.invoke('releaseLock', [body.id ?? ''], audit); break;
          case 'unlock_all': await rt.invoke('adminUnlockAll', [], audit); break;
          default: throw new Error('Unknown organizer action');
        }
      }
      return rt.invoke('adminView', []);
    } catch (e) {
      return reply
        .code(400)
        .send({
          error: e instanceof Error ? e.message : "Organizer action failed",
        });
    }
  });
  // ── Roster ───────────────────────────────────────────────────────────────
  /**
   * The organizer's record of who signed up, with the contact details collected
   * at registration. Supports `?format=csv` so the roster can be taken into a
   * spreadsheet for prize payouts.
   *
   * Password hashes are never present: the repository projects them out at the
   * query, so they cannot reach this handler even by mistake.
   */
  app.get<{ Querystring: { format?: string } }>(
    "/api/admin/roster",
    async (req, reply) => {
      if (!(await organizer(req, reply))) return;
      if (!database.players.listPlayers)
        return reply
          .code(501)
          .send({ error: "This database backend cannot list players" });
      const players = await database.players.listPlayers();
      const rows = players.map((p) => ({
        username: p.username,
        role: p.role ?? "player",
        fullName: p.profile?.fullName ?? "",
        email: p.profile?.email ?? "",
        phone: p.profile?.phone ?? "",
        team: p.profile?.team ?? "",
        registeredAt: p.createdAt.toISOString(),
      }));
      if (req.query?.format !== "csv") return { players: rows };

      const headers = [
        "username",
        "role",
        "fullName",
        "email",
        "phone",
        "team",
        "registeredAt",
      ] as const;
      // A value beginning =, +, - or @ is prefixed with an apostrophe. Without
      // this, a spreadsheet would treat a pasted name like "=cmd" as a formula,
      // which is the standard CSV injection hazard for an exported roster.
      const cell = (value: string) => {
        const risky = /^[=+\-@\t\r]/.test(value) ? `'${value}` : value;
        return `"${risky.replace(/"/g, '""')}"`;
      };
      const csv = [
        headers.join(","),
        ...rows.map((r) => headers.map((h) => cell(String(r[h]))).join(",")),
      ].join("\r\n");
      return reply
        .header("Content-Type", "text/csv; charset=utf-8")
        .header(
          "Content-Disposition",
          'attachment; filename="heist-roster.csv"',
        )
        .send(csv);
    },
  );

  // ── Live settings ────────────────────────────────────────────────────────
  // The console renders its whole form from this metadata, so the schema,
  // bounds and help text live only on the server.
  app.get("/api/admin/settings", async (req, reply) => {
    if (!(await organizer(req, reply))) return;
    const rt = world.eventRuntime;
    return rt
      ? rt.invoke('settingsView', [])
      : reply.code(503).send({ error: "Event unavailable" });
  });
  app.post<{ Body: { overrides?: Record<string, unknown>; reset?: boolean } }>(
    "/api/admin/settings",
    async (req, reply) => {
      const a = await organizer(req, reply);
      if (!a) return;
      const rt = world.eventRuntime;
      if (!rt) return reply.code(503).send({ error: "Event unavailable" });
      const body = req.body ?? {};
      const audit = {
        actor: a.id,
        username: a.username,
        action: body.reset ? "settings_reset" : "settings_update",
      };
      try {
        if (body.reset)
          return await rt.invoke('clearSettings', [], audit);
        const raw = body.overrides;
        if (!raw || typeof raw !== "object" || Array.isArray(raw))
          return reply.code(400).send({ error: "Send an overrides object" });
        const overrides: Record<string, number> = {};
        for (const [key, value] of Object.entries(raw)) {
          // Coerce once, here, so the engine only ever sees numbers and the
          // validation in settings.ts is the single source of rule truth.
          const n = typeof value === "string" ? Number(value) : value;
          if (typeof n !== "number" || !Number.isFinite(n))
            return reply
              .code(400)
              .send({ error: `${key} must be a finite number` });
          overrides[key] = Math.round(n);
        }
        return await rt.invoke('updateSettings', [overrides], audit);
      } catch (e) {
        return reply.code(400).send({
          error: e instanceof Error ? e.message : "Settings update failed",
        });
      }
    },
  );
  // ── Per-operator management ──────────────────────────────────────────────
  app.post<{
    Body: { action?: string; id?: string; paise?: number; reason?: string };
  }>("/api/admin/player", async (req, reply) => {
    const a = await organizer(req, reply);
    if (!a) return;
    const rt = world.eventRuntime;
    if (!rt) return reply.code(503).send({ error: "Event unavailable" });
    const body = req.body ?? {};
    const id = typeof body.id === "string" ? body.id : "";
    if (!id) return reply.code(400).send({ error: "Name the operator" });
    const audit = {
      actor: a.id,
      username: a.username,
      action: `player_${body.action ?? ""}`,
      target: id,
    };
    try {
      switch (body.action) {
        case 'adjust': {
          const paise = Number(body.paise);
          if (!Number.isFinite(paise)) throw new Error('Enter an amount in paise.');
          return await rt.invoke('adminAdjustMoney', [id, Math.round(paise), typeof body.reason === 'string' ? body.reason : ''], audit);
        }
        case 'clear-penalties': return await rt.invoke('adminClearPenalties', [id], audit);
        case 'release-holds': return await rt.invoke('adminReleaseHolds', [id], audit);
        default: throw new Error('Unknown operator action');
      }
    } catch (e) {
      return reply.code(400).send({
        error: e instanceof Error ? e.message : "Operator action failed",
      });
    }
  });
  app.get("/api/staff/challenges", async (req, reply) => {
    if (!(await identity(req, reply, true))) return;
    return CHALLENGE_CATALOGUE;
  });
  app.post<{ Body: { template?: string } }>(
    "/api/staff/challenges/open",
    async (req, reply) => {
      const a = await identity(req, reply, true);
      if (!a) return;
      currentGeneration();
      const id = req.body?.template,
        spec = CHALLENGE_CATALOGUE.find((c) => c.id === id);
      if (!spec) return reply.code(400).send({ error: "Unknown challenge" });
      for (const [key, p] of previews)
        if (p.view.expiresAt < Date.now()) previews.delete(key);
      // One personal preview per account: reopening never consumes paid capacity.
      for (const [key, p] of previews) if (p.owner === a.id) previews.delete(key);
      const key = randomBytes(16).toString("hex"),
        model = generateFinalChallenge(secret, a.id, spec.id, key);
      const view: ChallengeView = {
        id: key,
        title: `${spec.id} · ${spec.title}`,
        topic: spec.type,
        prompt: model.prompt,
        client: model.client,
        objective: model.objective,
        difficulty: model.difficulty,
        workbench: model.workbench,
        brief: model.brief,
        reward: 0,
        expiresAt: Date.now() + 30 * 60000,
        solved: false,
        minimumSolveMs: 0,
        openedAt: Date.now(),
      };
      previews.set(key, {
        owner: a.id,
        model,
        view,
        lastAnswer: 0,
        guesses: 0,
      });
      return {
        challenge: view,
        serverTime: Date.now(),
        scope: "Unpaid staff sandbox; no player progression or prizes",
      };
    },
  );
  app.post<{
    Body: { action?: string; id?: string; answer?: string; input?: string };
  }>("/api/staff/challenges/action", async (req, reply) => {
    const a = await identity(req, reply, true);
    if (!a) return;
    currentGeneration();
    const body = req.body ?? {},
      p = previews.get(body.id ?? "");
    if (!p || p.owner !== a.id)
      return reply
        .code(404)
        .send({ error: "No matching personal staff preview" });
    if (body.action === "abandon") {
      previews.delete(p.view.id);
      return { message: "Preview closed" };
    }
    if (p.view.expiresAt <= Date.now())
      return reply.code(400).send({ error: "Preview expired" });
    if (p.view.solved)
      return { challenge: p.view, message: "Already verified" };
    const input = body.action === "probe" ? body.input : body.answer;
    if (typeof input !== "string" || input.length > 600)
      return reply.code(400).send({ error: "Invalid input" });
    if (body.action === "probe") {
      if (p.model.runFixes)
        { p.view.feedback = p.model.runFixes(input); return { challenge: p.view, message: p.view.feedback }; }
      if (p.model.workbench.steps) {
        if ((p.view.testRuns ?? 0) >= 5) return reply.code(400).send({ error: 'All five machine test runs have been used.' });
        const start = Number(input);
        if (!input.trim() || !Number.isFinite(start) || Math.abs(start)>1e9)
          return reply.code(400).send({ error: "Enter a finite number within ±1,000,000,000." });
        const result = p.model.workbench.steps.reduce(
              (v, s) => (v * s.multiply + s.add) / s.divide,
              start,
            );
        p.view.testRuns = (p.view.testRuns ?? 0) + 1;
        p.view.feedback = `Run ${p.view.testRuns}/5: ${start} → ${result}`;
        return { challenge: p.view, message: p.view.feedback };
      }
      return reply
        .code(400)
        .send({ error: "This challenge has no server probe" });
    }
    if (body.action !== "answer")
      return reply.code(400).send({ error: "Invalid staff challenge action" });
    if (Date.now() - p.lastAnswer < 5000)
      return reply.code(429).send({ error: "Answer cooldown is active" });
    p.lastAnswer = Date.now();
    p.view.answerReadyAt = p.lastAnswer + 5000;
    const correct = p.model.validate(input);
    p.view.solved = correct;
    if (!correct) {
      p.guesses++;
      p.view.feedback = p.model.oracle?.(input);
      if (p.guesses >= (p.view.workbench?.maxGuesses ?? Infinity))
        p.view.expiresAt = Date.now();
    }
    return {
      challenge: p.view,
      serverTime: Date.now(),
      message: correct
        ? "Server verified. Staff sandbox complete; no prize or player progress changed."
        : (p.view.feedback ?? "Answer rejected. Recheck the evidence."),
      correct,
    };
  });
}
