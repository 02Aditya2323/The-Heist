/**
 * @heist/shared - constants.ts
 *
 * All game constants. These are the single source of truth for server, client, and bots.
 * Values here match the spec defaults; the server overrides them from env at boot
 * and sends TICK_RATE + STEP_TICKS in the WELCOME packet.
 */

// ── Directions ──────────────────────────────────────────────────────────────
/** UP = y-1, DOWN = y+1, LEFT = x-1, RIGHT = x+1 */
export const DIR = {
  UP: 0,
  DOWN: 1,
  LEFT: 2,
  RIGHT: 3,
} as const;

export type Direction = (typeof DIR)[keyof typeof DIR]; // 0 | 1 | 2 | 3

/** Direction vectors: [dx, dy] indexed by Direction */
export const DIR_DELTA: ReadonlyArray<readonly [number, number]> = [
  [0, -1],  // UP
  [0, 1],   // DOWN
  [-1, 0],  // LEFT
  [1, 0],   // RIGHT
] as const;

// ── Opcodes ─────────────────────────────────────────────────────────────────
/** Client → Server opcodes */
export const C2S = {
  MOVE: 0x01,
  PING: 0x02,
  JSON: 0x03,
} as const;

/** Server → Client opcodes */
export const S2C = {
  WELCOME: 0x81,
  ENTITY_ENTER: 0x82,
  ENTITY_LEAVE: 0x83,
  ENTITY_MOVE: 0x84,
  MOVE_ACK: 0x85,
  MOVE_REJECT: 0x86,
  PONG: 0x87,
  JSON: 0x88,
  KICK: 0x89,
  ENTITY_TELEPORT: 0x8a,
} as const;

export type C2SOpcode = (typeof C2S)[keyof typeof C2S];
export type S2COpcode = (typeof S2C)[keyof typeof S2C];

// ── Kick reason codes ───────────────────────────────────────────────────────
export const KICK_REASON = {
  INVALID_TOKEN: 0,
  REPLACED: 1,
  RATE_LIMIT: 2,
  SERVER_FULL: 3,
  HEARTBEAT_TIMEOUT: 4,
} as const;

/** WS close codes */
export const CLOSE_CODE = {
  INVALID_TOKEN: 4001,
  REPLACED: 4002,
  RATE_LIMIT: 4003,
  SERVER_FULL: 4004,
  HEARTBEAT_TIMEOUT: 4005,
} as const;

// ── Tick / timing defaults ──────────────────────────────────────────────────
export const DEFAULTS = {
  PORT: 8080,
  TICK_RATE: 20,                       // ticks per second
  STEP_TICKS: 5,                       // ticks per tile step (250 ms at 20 Hz)
  CHUNK_SIZE: 16,                      // tiles per chunk side (power of two)
  MAX_PLAYERS: 200,
  MAX_PENDING_MOVES: 2,
  MSG_RATE_PER_SEC: 30,
  MSG_BURST: 60,
  HEARTBEAT_TIMEOUT_MS: 15_000,
  GHOST_GRACE_MS: 30_000,
  SNAPSHOT_INTERVAL_MS: 30_000,
  BACKPRESSURE_BYTES: 256 * 1024,
  DB_URL: 'sqlite:./data/heist.db',
  ALLOW_REGISTER: true,
  DEBUG_ENDPOINTS: true,
} as const;

// ── Protocol limits ─────────────────────────────────────────────────────────
export const MAX_FRAME_SIZE = 1024;    // 1 KB max inbound WS frame
export const MAX_USERNAME_LEN = 20;
export const MIN_USERNAME_LEN = 3;
export const MIN_PASSWORD_LEN = 6;
export const USERNAME_REGEX = /^[a-zA-Z0-9_]+$/;

// ── Reconnect ───────────────────────────────────────────────────────────────
export const RECONNECT_MIN_MS = 500;
export const RECONNECT_MAX_MS = 5000;

// ── Entity id management ────────────────────────────────────────────────────
/** After releasing an entity id, hold it for this long before reuse */
export const ENTITY_ID_REUSE_DELAY_MS = 2000;
export const MAX_ENTITY_ID = 0xffff; // u16
