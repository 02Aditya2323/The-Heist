/**
 * @heist/shared - index.ts
 *
 * Public API barrel file. Everything the server, client, and bots need.
 */

// Constants & types
export {
  DIR, DIR_DELTA, C2S, S2C,
  KICK_REASON, CLOSE_CODE, DEFAULTS,
  MAX_FRAME_SIZE, MAX_USERNAME_LEN, MIN_USERNAME_LEN,
  MIN_PASSWORD_LEN, USERNAME_REGEX,
  RECONNECT_MIN_MS, RECONNECT_MAX_MS,
  ENTITY_ID_REUSE_DELAY_MS, MAX_ENTITY_ID,
  type Direction, type C2SOpcode, type S2COpcode,
} from './constants.js';

// Protocol codec
export {
  // Message types
  type MoveMsg, type PingMsg, type C2SJsonMsg, type C2SMessage,
  type WelcomeMsg, type EntityEnterMsg, type EntityLeaveMsg,
  type EntityMoveMsg, type MoveAckMsg, type MoveRejectMsg,
  type PongMsg, type S2CJsonMsg, type KickMsg, type EntityTeleportMsg,
  type S2CMessage, type AnyMessage,
  // Encoders (C2S)
  encodeMove, encodePing, encodeC2SJson,
  // Encoders (S2C)
  encodeWelcome, encodeEntityEnter, encodeEntityLeave,
  encodeEntityMove, encodeMoveAck, encodeMoveReject,
  encodePong, encodeS2CJson, encodeKick, encodeEntityTeleport,
  // Frame utils
  concatMessages, decodeC2SFrame, decodeS2CFrame,
} from './protocol.js';

// Map
export {
  type Hotspot, type Spawn, type MapData, type GameMap, type ArtScene, type DistrictExit, type CityRoute, type HomePlot,
  loadMap, isWalkable, randomSpawn, sceneAt,
} from './map.js';

// Movement
export { type StepResult, tryStep } from './movement.js';

// Chunks / AoI
export {
  type ChunkCoord,
  chunkOf, chunkKey, chunkFromKey,
  neighbours3x3, neighbours3x3Coords,
  chunkSetDiff, aoiDiff, sameChunk,
} from './chunks.js';

// Pathfinding (used by bots)
export { findPath, pathToDirections } from './pathfinding.js';
export type { EventView, EventRequest, ChallengeView, ChallengeBrief, EventPlayerView, ChallengeWorkbench, WorkbenchKind, CompletedChallengeView } from './event.js';
export { isStaff, type AccountRole } from './access.js';
