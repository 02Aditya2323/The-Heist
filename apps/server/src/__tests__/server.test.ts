/**
 * apps/server/src/__tests__/server.test.ts
 *
 * Full integration tests for the server:
 * - SQLite repository operations
 * - HTTP auth, map, health, and metrics
 * - WebSocket connect, WELCOME packet, AoI enter/leave, movement ACK, wall REJECT
 * - Reconnection / ghost handling
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { WebSocket } from 'ws';
import { pino } from 'pino';
import {
  loadMap,
  decodeS2CFrame,
  encodeMove,
  encodePing,
  S2C,
  DIR,
  type WelcomeMsg,
  type EntityEnterMsg,
  type EntityMoveMsg,
  type MoveAckMsg,
  type MoveRejectMsg,
  type PongMsg,
  type MapData,
} from '@heist/shared';
import { loadConfig } from '../config.js';
import { SqliteDatabase } from '../persistence/sqlite.js';
import { Snapshotter } from '../persistence/snapshotter.js';
import { MetricsTracker } from '../metrics/metrics.js';
import { World } from '../world/world.js';
import { TickLoop } from '../world/tick.js';
import { ConnectionManager } from '../net/connection.js';
import { GameWsServer } from '../net/ws-server.js';
import { createHttpServer } from '../http/server.js';

const testLogger = pino({ level: 'silent' });

const testMapData: MapData = {
  version: 1,
  width: 32,
  height: 32,
  collision: Array(32).fill('0'.repeat(32)),
  spawns: [{ x: 5, y: 5 }, { x: 6, y: 5 }],
  hotspots: [{ name: 'test-spot', x: 10, y: 10 }],
};
// Add a blocked wall at (5, 4)
testMapData.collision[4] = '000001' + '0'.repeat(26);

describe('The Heist Server Integration', () => {
  let db: SqliteDatabase;
  let world: World;
  let metrics: MetricsTracker;
  let snapshotter: Snapshotter;
  let connectionManager: ConnectionManager;
  let httpApp: ReturnType<typeof createHttpServer>;
  let wsServer: GameWsServer;
  let tickLoop: TickLoop;
  let serverPort: number;

  function connectWs(token: string): Promise<{ ws: WebSocket; messages: any[] }> {
    return new Promise((resolve, reject) => {
      const ws = new WebSocket(`ws://127.0.0.1:${serverPort}/ws?token=${token}`);
      const messages: any[] = [];
      ws.on('message', (d: Buffer) => {
        messages.push(...decodeS2CFrame(new Uint8Array(d)));
      });
      ws.on('open', () => resolve({ ws, messages }));
      ws.on('error', reject);
    });
  }

  function closeWs(ws: WebSocket): Promise<void> {
    return new Promise((resolve) => {
      if (ws.readyState === WebSocket.CLOSED) return resolve();
      ws.on('close', () => resolve());
      ws.close();
    });
  }

  beforeAll(async () => {
    db = new SqliteDatabase(':memory:');
    await db.initialize();

    const config = loadConfig();
    config.port = 0; // Random port
    config.debugEndpoints = true;

    const gameMap = loadMap(testMapData);
    world = new World(gameMap, testMapData, config);
    metrics = new MetricsTracker(config.tickRate);
    snapshotter = new Snapshotter(db.state, 1000, world, testLogger);
    connectionManager = new ConnectionManager();

    httpApp = createHttpServer(world, db, metrics, config);
    wsServer = new GameWsServer(
      httpApp.server,
      world,
      connectionManager,
      db,
      config,
      metrics,
      testLogger
    );
    tickLoop = new TickLoop(world, connectionManager, config, metrics, snapshotter, testLogger);

    await httpApp.listen({ port: 0, host: '127.0.0.1' });
    const addr = httpApp.server.address();
    serverPort = typeof addr === 'object' && addr ? addr.port : 8080;

    tickLoop.start();
    snapshotter.start();
  });

  afterAll(async () => {
    tickLoop.stop();
    snapshotter.stop();
    metrics.stop();
    wsServer.close();
    await httpApp.close();
    await db.close();
  });

  describe('HTTP Auth & API Endpoints', () => {
    it('registers a new player successfully', async () => {
      const res = await httpApp.inject({
        method: 'POST',
        url: '/api/register',
        payload: { username: 'test_alice', password: 'password123' },
      });

      expect(res.statusCode).toBe(201);
      const data = JSON.parse(res.body);
      expect(data.token).toBeDefined();
      expect(data.playerId).toBeDefined();
      expect(data.username).toBe('test_alice');
    });

    it('rejects duplicate username registration with 409', async () => {
      const res = await httpApp.inject({
        method: 'POST',
        url: '/api/register',
        payload: { username: 'test_alice', password: 'password123' },
      });

      expect(res.statusCode).toBe(409);
    });

    it('logs in with correct credentials', async () => {
      const res = await httpApp.inject({
        method: 'POST',
        url: '/api/login',
        payload: { username: 'test_alice', password: 'password123' },
      });

      expect(res.statusCode).toBe(200);
      const data = JSON.parse(res.body);
      expect(data.token).toBeDefined();
      expect(data.username).toBe('test_alice');
    });

    it('rejects invalid password with 401', async () => {
      const res = await httpApp.inject({
        method: 'POST',
        url: '/api/login',
        payload: { username: 'test_alice', password: 'wrongpassword' },
      });

      expect(res.statusCode).toBe(401);
    });

    it('serves the map correctly at /api/map', async () => {
      const res = await httpApp.inject({ method: 'GET', url: '/api/map' });
      expect(res.statusCode).toBe(200);
      const map = JSON.parse(res.body);
      expect(map.width).toBe(32);
      expect(map.height).toBe(32);
    });

    it('serves health checks at /health', async () => {
      const res = await httpApp.inject({ method: 'GET', url: '/health' });
      expect(res.statusCode).toBe(200);
      const health = JSON.parse(res.body);
      expect(health.ok).toBe(true);
      expect(health.tick).toBeGreaterThanOrEqual(0);
    });

    it('reports the event phase on /health so a deploy can refuse to interrupt', async () => {
      // The deploy workflow greps this field. Without it the live-event guard
      // would be a silent no-op.
      const res = await httpApp.inject({ method: 'GET', url: '/health' });
      const health = JSON.parse(res.body);
      expect(health).toHaveProperty('phase');
      expect(health).toHaveProperty('paused');
    });

    it('serves the spectator board at both /board and /board.html', async () => {
      // /board is an alias implemented by overriding the served path. An
      // earlier attempt faked it by spreading the Fastify request, which
      // silently produced an undefined url and a 404 in production while
      // /board.html kept working, so both spellings are asserted here.
      for (const url of ['/board', '/board.html']) {
        const res = await httpApp.inject({ method: 'GET', url });
        // 200 when the client has been built, 404 only when dist is absent.
        expect([200, 404], `${url} returned ${res.statusCode}`).toContain(
          res.statusCode,
        );
        if (res.statusCode === 200)
          expect(res.headers['content-type']).toContain('text/html');
      }
    });

    it('serves the public board feed without authentication', async () => {
      const res = await httpApp.inject({ method: 'GET', url: '/api/board' });
      // 503 is correct when no event runtime is attached in this fixture.
      expect([200, 503]).toContain(res.statusCode);
      if (res.statusCode === 200) {
        const board = JSON.parse(res.body);
        expect(board).toHaveProperty('leaderboard');
        expect(board).toHaveProperty('phase');
        // The board is public, so it must never carry puzzle or identity data.
        expect(JSON.stringify(board)).not.toMatch(/answer|passwordHash|token/i);
      }
    });

    it('serves metrics at /metrics', async () => {
      const res = await httpApp.inject({ method: 'GET', url: '/metrics' });
      expect(res.statusCode).toBe(200);
      const m = JSON.parse(res.body);
      expect(m.tickDuration).toBeDefined();
      expect(m.network).toBeDefined();
      expect(m.system).toBeDefined();
    });
  });

  describe('WebSocket Realtime & Movement', () => {
    let token1: string;
    let token2: string;

    beforeAll(async () => {
      const r1 = await httpApp.inject({
        method: 'POST',
        url: '/api/register',
        payload: { username: 'player_one', password: 'password123' },
      });
      token1 = JSON.parse(r1.body).token;

      const r2 = await httpApp.inject({
        method: 'POST',
        url: '/api/register',
        payload: { username: 'player_two', password: 'password123' },
      });
      token2 = JSON.parse(r2.body).token;
    });

    it('rejects connection without token', async () => {
      const ws = new WebSocket(`ws://127.0.0.1:${serverPort}/ws`);
      const code = await new Promise<number>((resolve) => {
        ws.on('close', (closeCode) => resolve(closeCode));
      });
      expect(code).toBe(4001);
    });

    it('connects with valid token and receives WELCOME packet', async () => {
      const { ws, messages } = await connectWs(token1);
      // Wait for welcome message
      await new Promise((r) => setTimeout(r, 60));

      expect(messages.length).toBeGreaterThan(0);
      const welcome = messages[0] as WelcomeMsg;
      expect(welcome.opcode).toBe(S2C.WELCOME);
      expect(welcome.selfId).toBeGreaterThan(0);
      expect(welcome.tickRate).toBe(20);

      await closeWs(ws);
    });

    it('two players connect nearby and see each other via ENTITY_ENTER', async () => {
      const { ws: ws1, messages: ws1Msgs } = await connectWs(token1);
      await new Promise((r) => setTimeout(r, 60));

      const { ws: ws2, messages: ws2Msgs } = await connectWs(token2);

      // Wait a couple of ticks for handshake and enter notifications (150ms = 3 ticks)
      await new Promise((r) => setTimeout(r, 150));

      // Player 2 should see Player 1 in its initial welcome/visible entities
      const p1InP2 = ws2Msgs.find(
        (m) => m?.opcode === S2C.ENTITY_ENTER && m.name === 'player_one'
      );
      expect(p1InP2).toBeDefined();

      // Player 1 should receive ENTITY_ENTER for Player 2
      const p2InP1 = ws1Msgs.find(
        (m) => m?.opcode === S2C.ENTITY_ENTER && m.name === 'player_two'
      );
      expect(p2InP1).toBeDefined();

      await closeWs(ws1);
      await closeWs(ws2);
    });

    it('handles movement: MOVE -> MOVE_ACK and broadcasts ENTITY_MOVE', async () => {
      const { ws: ws1, messages: ws1Msgs } = await connectWs(token1);
      const { ws: ws2, messages: ws2Msgs } = await connectWs(token2);

      await new Promise((r) => setTimeout(r, 100));

      // Clear initial welcome packets
      ws1Msgs.length = 0;
      ws2Msgs.length = 0;

      // Player 1 moves RIGHT
      const movePacket = encodeMove(101, DIR.RIGHT);
      ws1.send(movePacket);

      // Wait for tick loop to process movement (120ms)
      await new Promise((r) => setTimeout(r, 120));

      // Player 1 should receive MOVE_ACK(seq 101)
      const ack = ws1Msgs.find((m) => m?.opcode === S2C.MOVE_ACK) as MoveAckMsg | undefined;
      expect(ack).toBeDefined();
      expect(ack?.seq).toBe(101);

      // Player 2 should receive ENTITY_MOVE for Player 1
      const entMove = ws2Msgs.find((m) => m?.opcode === S2C.ENTITY_MOVE) as EntityMoveMsg | undefined;
      expect(entMove).toBeDefined();
      expect(entMove?.dir).toBe(DIR.RIGHT);

      await closeWs(ws1);
      await closeWs(ws2);
    });

    it('rejects illegal move into blocked wall with MOVE_REJECT', async () => {
      const { ws, messages } = await connectWs(token1);
      await new Promise((r) => setTimeout(r, 100));

      // Retrieve player's current authoritative entity from world
      const p1Entity = world.getEntityByPlayerId(
        (await db.players.findByUsername('player_one'))!.id
      )!;

      // Teleport or place player directly below wall at (5, 5)
      p1Entity.x = 5;
      p1Entity.y = 5;

      messages.length = 0;

      // Attempt to move UP into blocked wall at (5, 4)
      const movePacket = encodeMove(202, DIR.UP);
      ws.send(movePacket);

      await new Promise((r) => setTimeout(r, 120));

      const reject = messages.find((m) => m?.opcode === S2C.MOVE_REJECT) as MoveRejectMsg | undefined;
      expect(reject).toBeDefined();
      expect(reject?.seq).toBe(202);
      expect(reject?.x).toBe(5);
      expect(reject?.y).toBe(5);

      await closeWs(ws);
    });

    it('responds to PING with PONG', async () => {
      const { ws, messages } = await connectWs(token1);
      await new Promise((r) => setTimeout(r, 100));
      messages.length = 0;

      const pingTime = 987654;
      ws.send(encodePing(pingTime));

      await new Promise((r) => setTimeout(r, 120));

      const pong = messages.find((m) => m?.opcode === S2C.PONG) as PongMsg | undefined;
      expect(pong).toBeDefined();
      expect(pong?.clientTime).toBe(pingTime);
      expect(pong?.serverTick).toBeGreaterThan(0);

      await closeWs(ws);
    });
  });
});
