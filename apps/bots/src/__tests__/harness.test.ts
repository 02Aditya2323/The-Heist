/**
 * apps/bots/src/__tests__/harness.test.ts
 *
 * Automated test executing bot scenarios against an in-memory server:
 * - Login Storm (batch agent registration and WS connect)
 * - Reconnect Storm (ghost preservation and resume at exact tile)
 * - Traffic Validation (all 7 player behavior models, A* navigation, AoI replica equality)
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

describe('Bot Test Harness & Scenarios', () => {
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

  it('runs Login Storm scenario (15 bots concurrent login)', async () => {
    const result = await harness.runLoginStorm(15, 1500);
    expect(result.passed).toBe(true);
    expect(result.botCount).toBe(15);
  });

  it('runs Reconnect Storm scenario (10 bots drop & resume)', async () => {
    const result = await harness.runReconnectStorm(10);
    expect(result.passed).toBe(true);
    expect(result.desyncs).toBe(0);
  });

  it('runs Traffic Validation scenario (14 bots, all 7 behaviors, 0 desyncs)', async () => {
    const result = await harness.runTrafficValidation(14, 5);
    expect(result.passed, result.details.join('\n')).toBe(true);
    expect(result.desyncs).toBe(0);
    expect(result.tickOverruns).toBe(0);
  });
});
