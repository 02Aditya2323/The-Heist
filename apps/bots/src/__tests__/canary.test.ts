/**
 * apps/bots/src/__tests__/canary.test.ts
 *
 * Canary tests that prove the test harness fails when intentional faults
 * are introduced:
 * 1. Drop LEAVE packet
 * 2. Drop MOVE packet
 * 3. Send wrong coordinates
 * 4. Break reconnect
 *
 * Each scenario MUST produce FAIL (passed === false).
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { pino } from 'pino';
import { loadMap, type MapData } from '@heist/shared';
import { SqliteDatabase } from '../../../server/dist/persistence/sqlite.js';
import { Snapshotter } from '../../../server/dist/persistence/snapshotter.js';
import { MetricsTracker } from '../../../server/dist/metrics/metrics.js';
import { World } from '../../../server/dist/world/world.js';
import { TickLoop } from '../../../server/dist/world/tick.js';
import { ConnectionManager } from '../../../server/dist/net/connection.js';
import { GameWsServer } from '../../../server/dist/net/ws-server.js';
import { createHttpServer } from '../../../server/dist/http/server.js';
import { TestHarness } from '../harness.js';

const testLogger = pino({ level: 'silent' });

const testMapData: MapData = {
  version: 1,
  width: 32,
  height: 32,
  collision: Array(32).fill('0'.repeat(32)),
  spawns: [
    { x: 5, y: 5 },
    { x: 10, y: 10 },
    { x: 15, y: 15 },
    { x: 20, y: 20 },
  ],
  hotspots: [
    { name: 'bank', x: 8, y: 8 },
    { name: 'jobboard', x: 22, y: 22 },
  ],
};

describe('Harness Canary Fault Injection Tests', () => {
  let db: SqliteDatabase;
  let world: World;
  let metrics: MetricsTracker;
  let snapshotter: Snapshotter;
  let connectionManager: ConnectionManager;
  let httpApp: ReturnType<typeof createHttpServer>;
  let wsServer: GameWsServer;
  let tickLoop: TickLoop;
  let harness: TestHarness;
  let serverPort: number;

  beforeAll(async () => {
    db = new SqliteDatabase(':memory:');
    await db.initialize();

    const config = {
      port: 0,
      tickRate: 20,
      stepTicks: 5,
      chunkSize: 16,
      maxPlayers: 200,
      maxPendingMoves: 2,
      msgRatePerSec: 60,
      msgBurst: 100,
      heartbeatTimeoutMs: 15000,
      ghostGraceMs: 30000,
      snapshotIntervalMs: 10000,
      backpressureBytes: 256000,
      dbUrl: ':memory:',
      allowRegister: true,
      debugEndpoints: true,
    };

    const gameMap = loadMap(testMapData);
    world = new World(gameMap, testMapData, config);
    metrics = new MetricsTracker(config.tickRate);
    snapshotter = new Snapshotter(db.state, 10000, world, testLogger);
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

    harness = new TestHarness({
      httpUrl: `http://127.0.0.1:${serverPort}`,
      wsUrl: `ws://127.0.0.1:${serverPort}`,
    });
    await harness.init();
  });

  afterAll(async () => {
    harness.stopAll();
    tickLoop.stop();
    snapshotter.stop();
    metrics.stop();
    wsServer.close();
    await httpApp.close();
    await db.close();
  });

  it('canary 1: dropping LEAVE packet causes AoI replica desync and FAILS harness', async () => {
    const result = await harness.runCanaryDropLeave();
    expect(result.passed).toBe(false);
    expect(result.desyncs).toBeGreaterThan(0);
  });

  it('canary 2: dropping MOVE packet causes position replica mismatch and FAILS harness', async () => {
    const result = await harness.runCanaryDropMove();
    expect(result.passed).toBe(false);
    expect(result.desyncs).toBeGreaterThan(0);
  });

  it('canary 3: corrupting coordinates causes prediction mismatch and FAILS harness', async () => {
    const result = await harness.runCanaryWrongCoords();
    expect(result.passed).toBe(false);
    expect(result.desyncs).toBeGreaterThan(0);
  });

  it('canary 4: breaking reconnect rejects WebSocket and FAILS harness', async () => {
    const result = await harness.runCanaryBreakReconnect();
    expect(result.passed).toBe(false);
  });
});
