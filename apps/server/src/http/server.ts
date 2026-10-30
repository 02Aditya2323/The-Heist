/**
 * apps/server/src/http/server.ts
 *
 * Fastify HTTP server implementing auth endpoints, map delivery, health checks,
 * metrics, and AoI debug endpoints.
 */

import Fastify, { type FastifyInstance } from 'fastify';
import { randomBytes } from 'node:crypto';
import argon2 from 'argon2';
import {
  USERNAME_REGEX,
  MIN_USERNAME_LEN,
  MAX_USERNAME_LEN,
  MIN_PASSWORD_LEN,
} from '@heist/shared';
import type { Config } from '../config.js';
import type { Database } from '../persistence/interfaces.js';
import type { World } from '../world/world.js';
import type { MetricsTracker } from '../metrics/metrics.js';
import { registerClientAssets } from './client-assets.js';
import { registerStaffRoutes } from './staff-routes.js';

export function createHttpServer(
  world: World,
  database: Database,
  metrics: MetricsTracker,
  config: Config
): FastifyInstance {
  const app = Fastify({
    logger: false,
  });
  registerClientAssets(app);
  app.get('/api/event',async()=>world.eventRuntime?.status()||{phase:'unavailable'});
  registerStaffRoutes(app,world,database);

  // Enable CORS headers for client development
  app.addHook('onRequest', async (req, reply) => {
    reply.header('Access-Control-Allow-Origin', '*');
    reply.header('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    reply.header('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-Heist-Admin');
    if (req.method === 'OPTIONS') {
      reply.status(204).send();
    }
  });

  /**
   * Normalise one optional profile field.
   *
   * Registration must stay frictionless, so nothing here can reject a sign-up:
   * a value that is missing, blank or the wrong type simply becomes undefined,
   * and an over-long value is truncated rather than refused. Control characters
   * are stripped so a pasted value cannot corrupt a CSV export of the roster.
   */
  const profileField = (value: unknown, limit: number): string | undefined => {
    if (typeof value !== 'string') return undefined;
    const clean = value
      // eslint-disable-next-line no-control-regex
      .replace(/[\u0000-\u001f\u007f]/g, ' ')
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, limit);
    return clean || undefined;
  };

  // ── POST /api/register ─────────────────────────────────────────────
  app.post<{
    Body: {
      username?: string;
      password?: string;
      fullName?: string;
      email?: string;
      phone?: string;
      team?: string;
    };
  }>(
    '/api/register',
    async (req, reply) => {
      if (!config.allowRegister) {
        return reply.status(403).send({ error: 'Registration is disabled' });
      }

      const { username, password } = req.body ?? {};

      if (!username || !USERNAME_REGEX.test(username)) {
        return reply.status(400).send({
          error: `Username must be ${MIN_USERNAME_LEN}-${MAX_USERNAME_LEN} alphanumeric characters or underscore`,
        });
      }

      if (!password || password.length < MIN_PASSWORD_LEN) {
        return reply.status(400).send({
          error: `Password must be at least ${MIN_PASSWORD_LEN} characters`,
        });
      }

      const existing = await database.players.findByUsername(username);
      if (existing) {
        return reply.status(409).send({ error: 'Username already taken' });
      }

      // Async argon2 hashing in libuv worker pool
      const passwordHash = await argon2.hash(password);
      const playerId = randomBytes(16).toString('hex');

      // Contact details for the organizer's roster. Collected, never required:
      // an empty object is stored as no profile at all.
      const body = req.body ?? {};
      const profile = {
        fullName: profileField(body.fullName, 80),
        email: profileField(body.email, 120),
        phone: profileField(body.phone, 32),
        team: profileField(body.team, 80),
      };
      const supplied = Object.fromEntries(
        Object.entries(profile).filter(([, v]) => v !== undefined),
      );

      await database.players.createPlayer(
        playerId,
        username,
        passwordHash,
        'player',
        Object.keys(supplied).length ? supplied : undefined,
      );

      const token = randomBytes(32).toString('hex');
      await database.sessions.createSession(token, playerId);

      return reply.status(201).send({
        token,
        playerId,
        username,
      });
    }
  );

  // ── POST /api/login ────────────────────────────────────────────────
  app.post<{ Body: { username?: string; password?: string } }>(
    '/api/login',
    async (req, reply) => {
      const { username, password } = req.body ?? {};

      if (!username || !password) {
        return reply.status(400).send({ error: 'Username and password required' });
      }

      const player = await database.players.findByUsername(username);
      if (!player) {
        return reply.status(401).send({ error: 'Invalid credentials' });
      }

      // Async argon2 verification in libuv worker pool
      const valid = await argon2.verify(player.passwordHash, password);
      if (!valid) {
        return reply.status(401).send({ error: 'Invalid credentials' });
      }

      const token = randomBytes(32).toString('hex');
      await database.sessions.createSession(token, player.id);

      return reply.send({
        token,
        playerId: player.id,
        username: player.username,
      });
    }
  );

  // ── GET /api/board ─────────────────────────────────────────────────
  /**
   * Feed for the big-screen spectator board. Unauthenticated on purpose: it is
   * shown on a projector nobody is signed in on, and every figure in it is
   * already visible to every player in their own HUD.
   */
  app.get('/api/board', async (_req, reply) => {
    const runtime = world.eventRuntime;
    if (!runtime) return reply.status(503).send({ error: 'Event unavailable' });
    return runtime.invoke('boardView', []);
  });

  // ── GET /api/map ───────────────────────────────────────────────────
  app.get('/api/map', async () => {
    return world.rawMap;
  });

  // ── GET /health ────────────────────────────────────────────────────
  app.get('/health', async (_req, reply) => {
    // `status()` is the deliberately cheap read: it reports the phase without
    // scanning or mutating the economy audit. The phase is included so an
    // automated deploy can refuse to restart the process mid-event, and so an
    // operator can tell "running" from "running a live event" at a glance.
    const event = world.eventRuntime?.status();
    const healthy = database.metrics?.().healthy !== false;
    if (!healthy) reply.code(503);
    return {
      ok: healthy,
      tick: world.tick,
      players: world.connectedPlayerCount,
      uptimeSec: Math.floor(process.uptime()),
      phase: event?.phase ?? 'unavailable',
      paused: event?.paused ?? false,
    };
  });

  // ── GET /metrics ───────────────────────────────────────────────────
  app.get('/metrics', async () => {
    return { ...metrics.getSnapshot(world.connectedPlayerCount, world.ghostCount), database: database.metrics?.() };
  });

  // ── Debug Endpoints (if DEBUG_ENDPOINTS=1 or in dev/test) ─────────
  if (config.debugEndpoints || process.env.NODE_ENV !== 'production') {
    const verifyDebugToken = (req: { headers: Record<string, unknown> }, reply: { status: (c: number) => { send: (b: unknown) => void } }) => {
      if (process.env.DEBUG_TOKEN && req.headers['x-debug-token'] !== process.env.DEBUG_TOKEN) {
        reply.status(401).send({ error: 'Unauthorized' });
        return false;
      }
      return true;
    };

    app.get<{ Params: { playerId: string } }>(
      '/debug/aoi/:playerId',
      async (req, reply) => {
        if (!verifyDebugToken(req as any, reply as any)) return;
        const info = world.getVisibleEntityIds(req.params.playerId);
        if (!info) {
          return reply.status(404).send({ error: 'Player not found in world' });
        }
        return info;
      }
    );

    app.get('/debug/entities', async (req, reply) => {
      if (!verifyDebugToken(req as any, reply as any)) return;
      return {
        total: world.entityCount,
        connected: world.connectedPlayerCount,
        ghosts: world.ghostCount,
        byChunk: world.chunkGrid.getChunkCounts(),
      };
    });

    app.get('/debug/positions', async (req, reply) => {
      if (!verifyDebugToken(req as any, reply as any)) return;
      const entities = [];
      for (const ent of world.getAllEntities()) {
        entities.push({
          id: ent.id,
          playerId: ent.playerId,
          name: ent.name,
          x: ent.x,
          y: ent.y,
          dir: ent.dir,
          connected: ent.connected,
        });
      }
      return {
        tick: world.tick,
        entities,
      };
    });

    app.get('/debug/config', async (req, reply) => {
      if (!verifyDebugToken(req as any, reply as any)) return;
      return {
        tickRate: config.tickRate,
        stepTicks: config.stepTicks,
        chunkSize: config.chunkSize,
        ghostGraceMs: config.ghostGraceMs,
        snapshotIntervalMs: config.snapshotIntervalMs,
        heartbeatTimeoutMs: config.heartbeatTimeoutMs,
        mapVersion: world.rawMap.version ?? world.map.version,
        GHOST_GRACE_MS: config.ghostGraceMs,
        SNAPSHOT_INTERVAL_MS: config.snapshotIntervalMs,
        HEARTBEAT_TIMEOUT_MS: config.heartbeatTimeoutMs,
      };
    });
  }

  return app;
}
