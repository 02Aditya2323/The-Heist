/**
 * apps/server/src/config.ts
 *
 * Server configuration from environment variables with defaults.
 * All values are validated at startup. The tick loop, net layer, and persistence
 * all read from the Config object — they never touch process.env directly.
 */

import { DEFAULTS } from '@heist/shared';

export interface Config {
  host: string;
  port: number;
  tickRate: number;
  stepTicks: number;
  chunkSize: number;
  maxPlayers: number;
  maxPendingMoves: number;
  msgRatePerSec: number;
  msgBurst: number;
  heartbeatTimeoutMs: number;
  ghostGraceMs: number;
  snapshotIntervalMs: number;
  backpressureBytes: number;
  dbUrl: string;
  allowRegister: boolean;
  debugEndpoints: boolean;
}

function envInt(key: string, fallback: number): number {
  const v = process.env[key];
  if (v === undefined) return fallback;
  const n = parseInt(v, 10);
  if (isNaN(n)) throw new Error(`Invalid integer for ${key}: ${v}`);
  return n;
}

function envBool(key: string, fallback: boolean): boolean {
  const v = process.env[key];
  if (v === undefined) return fallback;
  return v === '1' || v === 'true';
}

function envStr(key: string, fallback: string): string {
  return process.env[key] ?? fallback;
}

export function loadConfig(): Config {
  return {
    // LAN hosting stays compatible; a public VM sets HOST=127.0.0.1 behind TLS.
    host: envStr('HOST', '0.0.0.0'),
    port: envInt('PORT', DEFAULTS.PORT),
    tickRate: envInt('TICK_RATE', DEFAULTS.TICK_RATE),
    stepTicks: envInt('STEP_TICKS', DEFAULTS.STEP_TICKS),
    chunkSize: envInt('CHUNK_SIZE', DEFAULTS.CHUNK_SIZE),
    maxPlayers: envInt('MAX_PLAYERS', DEFAULTS.MAX_PLAYERS),
    maxPendingMoves: envInt('MAX_PENDING_MOVES', DEFAULTS.MAX_PENDING_MOVES),
    msgRatePerSec: envInt('MSG_RATE_PER_SEC', DEFAULTS.MSG_RATE_PER_SEC),
    msgBurst: envInt('MSG_BURST', DEFAULTS.MSG_BURST),
    heartbeatTimeoutMs: envInt('HEARTBEAT_TIMEOUT_MS', DEFAULTS.HEARTBEAT_TIMEOUT_MS),
    ghostGraceMs: envInt('GHOST_GRACE_MS', DEFAULTS.GHOST_GRACE_MS),
    snapshotIntervalMs: envInt('SNAPSHOT_INTERVAL_MS', DEFAULTS.SNAPSHOT_INTERVAL_MS),
    backpressureBytes: envInt('BACKPRESSURE_BYTES', DEFAULTS.BACKPRESSURE_BYTES),
    dbUrl: envStr('DB_URL', DEFAULTS.DB_URL),
    allowRegister: envBool('ALLOW_REGISTER', DEFAULTS.ALLOW_REGISTER),
    debugEndpoints: envBool('DEBUG_ENDPOINTS', DEFAULTS.DEBUG_ENDPOINTS),
  };
}
