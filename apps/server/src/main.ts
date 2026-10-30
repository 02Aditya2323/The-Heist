/**
 * apps/server/src/main.ts
 *
 * Server boot orchestrator and graceful shutdown handler.
 * Loads the canonical city atlas, routes and collision from one generated map.
 */

import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pino } from 'pino';
import { loadMap, type MapData } from '@heist/shared';
import { loadConfig } from './config.js';
import { EVENT_RULES } from './game/rules.js';
import { Snapshotter } from './persistence/snapshotter.js';
import { MetricsTracker } from './metrics/metrics.js';
import { World } from './world/world.js';
import { TickLoop } from './world/tick.js';
import { ConnectionManager } from './net/connection.js';
import { GameWsServer } from './net/ws-server.js';
import { createHttpServer } from './http/server.js';
import { SqliteEventRuntime } from './game/sqlite-runtime.js';
import { bootstrapStaff } from './persistence/bootstrap-staff.js';
import { resolveSqlitePath } from './persistence/path.js';
import { SqliteDatabase } from './persistence/sqlite.js';
import { loadEnvFile } from 'node:process';

try{loadEnvFile(resolve(import.meta.dirname,'../../../.env'));}catch(error){if((error as NodeJS.ErrnoException).code!=='ENOENT')throw error;}

const logger = pino({
  name: 'heist-server',
  level: process.env.LOG_LEVEL || 'info',
  transport:
    process.env.NODE_ENV !== 'production'
      ? { target: 'pino/file', options: { destination: 1 } }
      : undefined,
});

async function main() {
  const config = loadConfig();
  // MAX_PLAYERS caps connections; EVENT_RULES.maxPlayers funds the Starter pool
  // (starterPay x maxPlayers). They are separate numbers and nothing kept them
  // in step, so a host admitting more players than the economy funds would seat
  // operators who can never claim a Starter contract. Money is conserved, so the
  // pool cannot stretch: the organizer has to raise maxPlayers in Game settings,
  // which re-derives the pools and rebases the Treasury with the remainder.
  if (config.maxPlayers > EVENT_RULES.maxPlayers) {
    logger.warn(
      { networkCap: config.maxPlayers, fundedPlayers: EVENT_RULES.maxPlayers },
      `MAX_PLAYERS admits ${config.maxPlayers} operators but the Starter pool funds only ` +
        `${EVENT_RULES.maxPlayers}. Raise maxPlayers in Game settings before the event, ` +
        `or the last ${config.maxPlayers - EVENT_RULES.maxPlayers} operators to arrive get no Starter contract.`,
    );
  }
  if (process.env.DATABASE_BACKEND && process.env.DATABASE_BACKEND !== 'sqlite') throw new Error('This build uses server-local SQLite. Set DATABASE_BACKEND=sqlite and DB_URL=sqlite:/path/heist.db.');
  logger.info({ port: config.port, tickRate: config.tickRate, database: 'SQLite worker' }, 'Booting The Heist Server');

  // 1. Initialize Database
  const database = new SqliteDatabase(resolveSqlitePath(config.dbUrl));
  await database.initialize();
  await bootstrapStaff(database);
  logger.info('Database initialized successfully');

  // 2. Load Map
  const candidatePaths = [
    process.env.MAP_PATH,
    resolve(process.cwd(), 'maps/art-world.json'),
    resolve(process.cwd(), '../../maps/art-world.json'),
    resolve(process.cwd(), 'maps/dev-map.json'),
    resolve(process.cwd(), '../../maps/dev-map.json'),
    resolve(process.cwd(), '../maps/dev-map.json'),
  ].filter(Boolean) as string[];

  let mapRaw: MapData | null = null;
  let loadedPath = '';

  for (const p of candidatePaths) {
    if (existsSync(p)) {
      try {
        const content = await readFile(p, 'utf8');
        mapRaw = JSON.parse(content) as MapData;
        loadedPath = p;
        break;
      } catch {}
    }
  }

  if (!mapRaw) {
    logger.error({ candidatePaths }, 'Failed to load map file from any candidate path');
    process.exit(1);
  }

  const map = loadMap(mapRaw);
  logger.info({ width: map.width, height: map.height, version: map.version, path: loadedPath, scenes: map.scenes?.length, routes: map.routes?.length, exits: map.exits?.length, landmarks: map.hotspots.length }, 'Canonical city map loaded');

  // 3. Create Core Subsystems
  const world = new World(map, mapRaw, config);
  const metrics = new MetricsTracker(config.tickRate);
  const snapshotter = new Snapshotter(database.state, config.snapshotIntervalMs, world, logger);
  const connectionManager = new ConnectionManager();
  if (process.env.EVENT_DB_PATH && resolve(process.env.EVENT_DB_PATH) !== resolveSqlitePath(config.dbUrl)) throw new Error('Event state now shares DB_URL. Remove EVENT_DB_PATH to start a fresh SQLite demo. Existing legacy files are not modified.');
  const duration=Number(process.env.EVENT_DURATION_MINUTES||180);
  if(!Number.isFinite(duration)||duration<10||duration>1440)throw new Error('EVENT_DURATION_MINUTES must be 10–1440');
  const eventRuntime = new SqliteEventRuntime(database, world, connectionManager);
  await eventRuntime.initialize(mapRaw, duration);

  // 4. Create HTTP & WS Servers
  const httpApp = createHttpServer(world, database, metrics, config);
  const wsServer = new GameWsServer(
    httpApp.server,
    world,
    connectionManager,
    database,
    config,
    metrics,
    logger
  );

  // 5. Create Authoritative Tick Loop
  const tickLoop = new TickLoop(world, connectionManager, config, metrics, snapshotter, logger);

  // 6. Start HTTP Listening & Tick Loop
  await httpApp.listen({ port: config.port, host: config.host });
  logger.info({ port: config.port, host: config.host }, `Server listening on http://${config.host}:${config.port}`);

  tickLoop.start();
  snapshotter.start();
  eventRuntime.start();
  logger.info('Tick loop started at %d Hz', config.tickRate);

  // 7. Register Graceful Shutdown
  let isShuttingDown = false;
  async function shutdown(signal: string) {
    if (isShuttingDown) return;
    isShuttingDown = true;
    logger.info({ signal }, 'Graceful shutdown initiated');

    tickLoop.stop();
    snapshotter.stop();
    metrics.stop();

    logger.info('Closing WebSocket client connections...');
    wsServer.close();
    await eventRuntime.stop();

    logger.info('Flushing state snapshot to database...');
    let shutdownFailed = false;
    try {
      await snapshotter.flushAll();
    } catch (err) {
      shutdownFailed = true;
      logger.error({ err }, 'Error during final snapshot flush');
    }

    logger.info('Closing HTTP server and database...');
    await httpApp.close();
    await database.close();

    logger.info('Graceful shutdown completed');
    process.exit(shutdownFailed ? 1 : 0);
  }

  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('SIGTERM', () => shutdown('SIGTERM'));
}

main().catch((err) => {
  logger.fatal({ err }, 'Fatal error during boot');
  process.exit(1);
});
