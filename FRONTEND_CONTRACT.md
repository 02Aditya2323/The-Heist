# The Heist — Frontend Integration Contract & Architecture Guide

> **Audience**: Frontend Engineering Team  
> **Backend Status**: Fully Built, Conformance-Tested, and Stress-Verified (20 Hz, 100+ concurrent bots, sub-5ms tick P99)  
> **Shared Library**: `@heist/shared` (monorepo package containing all codecs, math, and types)  
> **Server Base URL (Local Dev)**: `http://localhost:8080` (HTTP) & `ws://localhost:8080/ws` (WebSocket)  
> **Client Base URL (Local Dev)**: `http://localhost:5173` (Vite)

---

## 1. System Overview & Core Paradigms

**The Heist** is a 2D tile-based MMO game running on a high-performance authoritative game server. As the frontend team, you are building the interactive game client (canvas/WebGL viewport, HUD, auth, camera, and controls).

### Key Architectural Tenets You Must Know:
1. **Server-Authoritative Tile Movement**:
   - The world is an integer grid of tiles (e.g., 256×256 tiles).
   - The server runs at **20 Hz** (50 ms tick interval).
   - Every movement step takes **5 server ticks = 250 ms** (`stepTicks = 5`, `tickRate = 20`).
   - The client predicts movement immediately for 0 ms input lag, but the server is the absolute ground truth.
2. **Binary WebSocket Protocol (Little-Endian)**:
   - Real-time communication runs over a single binary WebSocket.
   - All numbers (`u16`, `u32`) are packed **little-endian**.
   - Multiple messages can be packed inside a single WebSocket binary frame.
   - You do **not** need to manually pack bytes: use the pre-built encoders and decoders in `@heist/shared`.
3. **Spatial Chunk Partitioning (Area of Interest - AoI)**:
   - The map is divided into **16×16 tile chunks**.
   - The server only sends entity updates (`ENTITY_ENTER`, `ENTITY_MOVE`, `ENTITY_LEAVE`) for the player's current chunk and its 8 adjacent neighbor chunks (a **3×3 chunk visibility window**).
   - You do not need to cull offscreen entities manually; the server already filters out all entities beyond the 3×3 chunk radius.
4. **Authoritative Cadence & Queue Limit**:
   - The server allows a maximum of **2 unacknowledged moves in-flight** per client.
   - If a client spams movement packets faster than the 250 ms cadence, excess moves are rejected with `MOVE_REJECT` (queue overflow).

---

## 2. REST API Specification

All HTTP endpoints run on port `8080`.

### 2.1 Register New Player
Create an account and receive an active session token.

- **Endpoint**: `POST /api/register`
- **Headers**: `Content-Type: application/json`
- **Request Body**:
  ```json
  {
    "username": "shadow_operative",
    "password": "supersecretpassword"
  }
  ```
  - `username`: 3–20 alphanumeric characters / underscores (`^[a-zA-Z0-9_]+$`).
  - `password`: Minimum 6 characters.
- **Success Response (`201 Created`)**:
  ```json
  {
    "token": "d8f1e29a3b4c5d6e7f8a9b0c1d2e3f4a5b6c7d8e9f0a1b2c3d4e5f6a7b8c9d0e",
    "playerId": "a1b2c3d4e5f67890",
    "username": "shadow_operative"
  }
  ```
- **Error Responses**:
  - `400 Bad Request`: `{"error": "Username must be 3-20 alphanumeric characters or underscore"}` or `{"error": "Password must be at least 6 characters"}`.
  - `409 Conflict`: `{"error": "Username already taken"}`.
  - `403 Forbidden`: `{"error": "Registration is disabled"}` (if disabled on server).

### 2.2 Login Existing Player
Authenticate an existing account.

- **Endpoint**: `POST /api/login`
- **Headers**: `Content-Type: application/json`
- **Request Body**:
  ```json
  {
    "username": "shadow_operative",
    "password": "supersecretpassword"
  }
  ```
- **Success Response (`200 OK`)**:
  ```json
  {
    "token": "d8f1e29a3b4c5d6e7f8a9b0c1d2e3f4a5b6c7d8e9f0a1b2c3d4e5f6a7b8c9d0e",
    "playerId": "a1b2c3d4e5f67890",
    "username": "shadow_operative"
  }
  ```
- **Error Responses**:
  - `400 Bad Request`: `{"error": "Username and password required"}`.
  - `401 Unauthorized`: `{"error": "Invalid credentials"}`.

### 2.3 Fetch Map Data
Download the authoritative static map structure before or immediately after logging in.

- **Endpoint**: `GET /api/map`
- **Success Response (`200 OK`)**:
  ```json
  {
    "version": 1,
    "width": 256,
    "height": 256,
    "collision": [
      "111111111111...",
      "100000000000..."
    ],
    "spawns": [
      { "x": 10, "y": 10 },
      { "x": 32, "y": 32 }
    ],
    "hotspots": [
      { "name": "bank", "x": 64, "y": 64 },
      { "name": "hideout", "x": 128, "y": 128 }
    ]
  }
  ```
  - `collision`: Array of strings (`height` strings of length `width`).
    - `'1'`: Solid wall / obstacle (blocked / non-walkable).
    - `'0'`: Walkable floor / street.
  - `spawns`: Array of `{ x: number, y: number }` spawn coordinates.
  - `hotspots`: Key landmark locations `{ name: string, x: number, y: number }`.
- **Parsing Helper**: Always pass this response directly into `loadMap(data)` from `@heist/shared`. It parses `collision` into a fast, flat `Uint8Array` (`index = y * width + x`) and returns a `GameMap` object used by `isWalkable(map, x, y)` and `tryStep(map, x, y, dir)`.

### 2.4 Server Health & Metrics
- **Health Endpoint**: `GET /health` (`200 OK`)
  ```json
  {
    "ok": true,
    "tick": 12450,
    "players": 14,
    "uptimeSec": 622
  }
  ```
- **Metrics Endpoint**: `GET /metrics` (`200 OK`)
  Provides server performance diagnostics: tick latency P50/P99, message rates, connected players, ghosts, etc.

### 2.5 Developer & Debug Endpoints (Dev/Test Mode)
Available when `DEBUG_ENDPOINTS=true` (or non-production). If `process.env.DEBUG_TOKEN` is set on the server, include header `x-debug-token: <token>`.
- `GET /debug/aoi/:playerId`: Returns visible entities, player's current chunk `(cx, cy)`, and the 3×3 neighbor chunks.
- `GET /debug/positions`: Returns current server tick and all active entity coordinates `[{ id, playerId, name, x, y, dir, connected }]`.
- `GET /debug/entities`: Returns total, connected, and ghost entity counts and per-chunk breakdown.
- `GET /debug/config`: Returns authoritative server configuration (tickRate, stepTicks, chunkSize, etc.).

---

## 3. Real-Time WebSocket Protocol

### 3.1 Connection Handshake
Connect via WebSocket using the session token returned from login/registration:
```ts
const wsUrl = `ws://localhost:8080/ws?token=${encodeURIComponent(sessionToken)}`;
const ws = new WebSocket(wsUrl);
ws.binaryType = 'arraybuffer'; // MUST be 'arraybuffer'
```

### 3.2 WebSocket Close Codes
The server issues standard and custom close codes defined in `CLOSE_CODE`:
| Close Code | Identifier | Meaning & Frontend Action Required |
|---|---|---|
| `1000` | `NORMAL` | Clean intentional disconnect. |
| `4001` | `INVALID_TOKEN` | Token is invalid, expired, missing, or player not found. Redirect user to login screen. |
| `4002` | `REPLACED` | Newer connection opened with the same token / session. Show "Session opened in another window". |
| `4003` | `RATE_LIMIT` | Message rate exceeded token bucket (>60 burst or >30/s) or frame > 1 KB. Throttle inputs. |
| `4004` | `SERVER_FULL` | Server has reached max player capacity (`MAX_PLAYERS = 200`). Show retry later. |
| `4005` | `HEARTBEAT_TIMEOUT` | Client failed to send `PING` heartbeat within 15 seconds. Auto-reconnect. |

### 3.3 Heartbeat Ping/Pong Cadence
To keep the connection alive, the client **must** send a `PING` packet every **2 to 3 seconds**.
```ts
import { encodePing } from '@heist/shared';

// Send every 2.5s
setInterval(() => {
  const clientTimeMs = performance.now() | 0;
  ws.send(encodePing(clientTimeMs));
}, 2500);
```
When the server responds with `PONG`:
```ts
const rttMs = Math.max(0, (performance.now() | 0) - pong.clientTime);
// rttMs gives the true roundtrip network latency
```

---

## 4. Binary Message Specifications

All real-time messages are binary frames. A single received WebSocket frame may contain **multiple** concatenated messages. 

Use `decodeS2CFrame(new Uint8Array(event.data))` from `@heist/shared` to automatically unpack them into an array of typed message objects.

### 4.1 Direction Enum (`Direction`)
> ⚠️ **CRITICAL**: The numerical order is `UP=0, DOWN=1, LEFT=2, RIGHT=3`. Do not confuse this with clock order!
```ts
export const DIR = {
  UP: 0,    // dy = -1
  DOWN: 1,  // dy = +1
  LEFT: 2,  // dx = -1
  RIGHT: 3, // dx = +1
} as const;

export type Direction = (typeof DIR)[keyof typeof DIR]; // 0 | 1 | 2 | 3
```

---

### 4.2 Client-to-Server Messages (C2S)

#### `MOVE (0x01)` — 4 bytes
Request a 1-tile movement step in direction `dir`.
```text
Offset | Type | Field       | Description
0      | u8   | opcode (0x01) | C2S.MOVE
1      | u16  | seq         | Client sequence number (0 to 65535, wraps)
3      | u8   | dir         | Direction (0=UP, 1=DOWN, 2=LEFT, 3=RIGHT)
```
*Helper*: `encodeMove(seq: number, dir: Direction): Uint8Array`

#### `PING (0x02)` — 5 bytes
Heartbeat ping for latency calculation.
```text
Offset | Type | Field       | Description
0      | u8   | opcode (0x02) | C2S.PING
1      | u32  | clientTime  | Client timestamp in ms (performance.now() | 0)
```
*Helper*: `encodePing(clientTime: number): Uint8Array`

#### `JSON (0x03)` — Variable length
Send arbitrary JSON string payload (chat, commands, or client metadata).
```text
Offset | Type | Field       | Description
0      | u8   | opcode (0x03) | C2S.JSON
1      | u16  | len         | UTF-8 string byte length
3      | utf8 | payload     | UTF-8 encoded JSON string
```
*Helper*: `encodeC2SJson(payload: string): Uint8Array`

---

### 4.3 Server-to-Client Messages (S2C)

> Note: All Server-to-Client opcodes have high bit `0x80` set to distinguish them from Client-to-Server opcodes.

#### `WELCOME (0x81)` — 16 bytes
Sent immediately upon successful WebSocket handshake. Initializes the local player.
```text
Offset | Type | Field       | Description
0      | u8   | opcode (0x81) | S2C.WELCOME
1      | u16  | selfId      | Client's numeric entity ID in the world
3      | u16  | x           | Initial spawn tile X coordinate
5      | u16  | y           | Initial spawn tile Y coordinate
7      | u8   | dir         | Initial facing direction (0=UP, 1=DOWN, 2=LEFT, 3=RIGHT)
8      | u8   | tickRate    | Server tick rate (20 Hz)
9      | u8   | stepTicks   | Number of ticks per step (5 ticks = 250 ms)
10     | u16  | mapVersion  | Version number of active map
12     | u32  | serverTick  | Current authoritative server tick counter
```

#### `ENTITY_ENTER (0x82)` — Variable length
Sent when another entity enters your 3×3 chunk Area of Interest (either by moving into range or connecting).
```text
Offset | Type | Field       | Description
0      | u8   | opcode (0x82) | S2C.ENTITY_ENTER
1      | u16  | id          | Entity numeric ID
3      | u16  | x           | Entity tile X
5      | u16  | y           | Entity tile Y
7      | u8   | dir         | Facing direction
8      | u8   | nameLen     | Length of player codename
9      | utf8 | name        | UTF-8 codename string
```

#### `ENTITY_LEAVE (0x83)` — 3 bytes
Sent when an entity leaves your 3×3 chunk Area of Interest or disconnects.
```text
Offset | Type | Field       | Description
0      | u8   | opcode (0x83) | S2C.ENTITY_LEAVE
1      | u16  | id          | Entity numeric ID to remove from view
```

#### `ENTITY_MOVE (0x84)` — 8 bytes
Sent when another entity inside your AoI steps to a new tile.
```text
Offset | Type | Field       | Description
0      | u8   | opcode (0x84) | S2C.ENTITY_MOVE
1      | u16  | id          | Entity numeric ID
3      | u16  | x           | New tile X coordinate
5      | u16  | y           | New tile Y coordinate
7      | u8   | dir         | New facing direction
```

#### `MOVE_ACK (0x85)` — 7 bytes
Authoritative acknowledgment of the local player's previous `MOVE` request.
```text
Offset | Type | Field       | Description
0      | u8   | opcode (0x85) | S2C.MOVE_ACK
1      | u16  | seq         | The client sequence number being acknowledged
3      | u16  | x           | Authoritative player tile X after this move
5      | u16  | y           | Authoritative player tile Y after this move
```

#### `MOVE_REJECT (0x86)` — 8 bytes
Rejection of an illegal or rate-limited move.
```text
Offset | Type | Field       | Description
0      | u8   | opcode (0x86) | S2C.MOVE_REJECT
1      | u16  | seq         | The rejected move sequence number
3      | u16  | x           | Authoritative correct tile X coordinate
5      | u16  | y           | Authoritative correct tile Y coordinate
7      | u8   | dir         | Authoritative facing direction
```

#### `PONG (0x87)` — 9 bytes
Response to client `PING`.
```text
Offset | Type | Field       | Description
0      | u8   | opcode (0x87) | S2C.PONG
1      | u32  | clientTime  | Echo of client's timestamp
5      | u32  | serverTick  | Authoritative tick on the server when processed
```

#### `JSON (0x88)` — Variable length
Broadcasted JSON string from server.
```text
Offset | Type | Field       | Description
0      | u8   | opcode (0x88) | S2C.JSON
1      | u16  | len         | UTF-8 string byte length
3      | utf8 | payload     | UTF-8 encoded string
```

#### `KICK (0x89)` — 2 bytes
Sent right before disconnecting the socket with a specific kick reason.
```text
Offset | Type | Field       | Description
0      | u8   | opcode (0x89) | S2C.KICK
1      | u8   | reason      | Kick reason (0=INVALID_TOKEN, 1=REPLACED, 2=RATE_LIMIT, 3=SERVER_FULL, 4=HEARTBEAT_TIMEOUT)
```

#### `ENTITY_TELEPORT (0x8A)` — 8 bytes
Sent when an entity is instantly repositioned without walking animation (e.g., spawn, respawn, or admin teleport).
```text
Offset | Type | Field       | Description
0      | u8   | opcode (0x8A) | S2C.ENTITY_TELEPORT
1      | u16  | id          | Entity ID
3      | u16  | x           | Target tile X
5      | u16  | y           | Target tile Y
7      | u8   | dir         | Target direction
```

---

## 5. Movement, Prediction & Cadence Rules (The Core Engine Mechanics)

Movement in **The Heist** feels instant to the player (0 ms perceived lag) while remaining 100% server-authoritative. Achieving this requires precise synchronization between the server's tick clock and the client's animation frames.

---

### 5.1 The Cadence Math: Ticks, Step Ticks, and Milliseconds

The server operates on a fixed discrete clock:
- **`tickRate`**: 20 ticks per second (1 tick = 50 ms).
- **`stepTicks`**: 5 ticks per movement step.
- **`stepDurationMs`**: `(stepTicks / tickRate) * 1000 = (5 / 20) * 1000 = 250 ms`.

#### ⚠️ Rule #1: NEVER Hardcode 250 ms as a Static Constant
Do not hardcode `250` across your frontend code. When the WebSocket connects, the server sends `WELCOME` containing the authoritative parameters:
```ts
ws.onmessage = (event) => {
  const [welcome] = decodeS2CFrame(new Uint8Array(event.data));
  if (welcome.opcode === S2C.WELCOME) {
    // Dynamically compute authoritative step duration
    const tickRate = welcome.tickRate;   // e.g. 20 Hz
    const stepTicks = welcome.stepTicks; // e.g. 5 ticks
    const stepDurationMs = (stepTicks / tickRate) * 1000; // = 250 ms
    
    // Store in your game engine state
    gameEngine.setCadence(tickRate, stepTicks, stepDurationMs);
  }
};
```
If the server is ever reconfigured (e.g. to 60 Hz or 3 stepTicks), your frontend will automatically adapt with zero drift or code changes.

---

### 5.2 Server In-Flight Queue Limit & Queue Overflow Rejects

The server allows a maximum of **2 unacknowledged moves** in an entity's input queue (`entity.pending.length < 2`).
- If a client sends a 3rd move before the 1st has been processed by the tick loop, the server immediately drops it and replies with `MOVE_REJECT` (reason: `queue_overflow`).
- **Frontend Requirement**: Maintain an array of unacknowledged predictions `pending: PendingPrediction[]`. Before dispatching any move, verify:
  ```ts
  if (this.pending.length >= 2) {
    return; // Wait for server MOVE_ACK before sending more
  }
  ```

---

### 5.3 The Timer Drift Pitfall: Chaining vs. Idle Clamping

When holding a directional key (hold-to-walk), consecutive steps should chain seamlessly without stutter. However, **timer drift** can cause massive problems if not handled carefully:

#### The Bug That Happens Without Clamping:
If you simply write `this.animStart += this.stepDurationMs`:
- Suppose the player stands still for 3 seconds. `animStart` is now 3000 ms in the past.
- When the player presses 'W', `elapsed = now - animStart` is 3000 ms.
- If your loop attempts to "catch up", it will fire multiple `MOVE` packets simultaneously in the same animation frame!
- Firing 2 or 3 moves in the same millisecond blows past the server's queue limit of 2, triggering immediate `queue_overflow` `MOVE_REJECT`s and rubberbanding the player.

#### The Correct Chaining Formula:
Only chain `animStart += stepDurationMs` if the previous step finished recently (`elapsed < stepDurationMs * 1.5`). Otherwise, reset `animStart = now`:
```ts
update(): void {
  const now = performance.now();
  const elapsed = now - this.selfEntity.animStart;

  // 1. Must wait for current 250ms tile step to complete
  if (elapsed < this.stepDurationMs) {
    return;
  }

  // 2. Respect server queue limit (max 2 in-flight)
  if (this.pending.length >= 2) {
    return;
  }

  const dir = this.getActiveDirection();
  if (dir === null) return;

  // Turn facing direction immediately
  this.selfEntity.dir = dir;

  // 3. Check map collision locally using shared tryStep
  const step = tryStep(this.map, this.selfEntity.tileX, this.selfEntity.tileY, dir);
  if (!step.ok) {
    // Wall blocked locally: do NOT send packet, do NOT enter cooldown
    return;
  }

  // 4. Increment sequence number (wraps at u16 65535)
  this.seq = (this.seq + 1) & 0xffff;

  // 5. Enqueue prediction
  this.pending.push({
    seq: this.seq,
    dir,
    x: step.x,
    y: step.y,
  });

  // 6. Send binary MOVE frame
  this.net.send(encodeMove(this.seq, dir));

  // 7. Update animation coordinates
  this.selfEntity.prevTileX = this.selfEntity.tileX;
  this.selfEntity.prevTileY = this.selfEntity.tileY;
  this.selfEntity.tileX = step.x;
  this.selfEntity.tileY = step.y;

  // 8. Prevent drift: chain smoothly if holding, or reset if starting fresh
  if (elapsed < this.stepDurationMs * 1.5) {
    this.selfEntity.animStart += this.stepDurationMs;
  } else {
    this.selfEntity.animStart = now;
  }
  this.selfEntity.animDuration = this.stepDurationMs;
}
```

---

### 5.4 Wall Collisions vs. Step Cooldown (Crucial Distinction)

There is a fundamental difference in how the server treats **valid moves** versus **wall collisions**:
- **Valid Move**: The server steps the entity and sets `nextMoveTick = serverTick + stepTicks` (250 ms cooldown).
- **Wall Collision**: The move is blocked. **THE SERVER DOES NOT ADVANCE NEXT_MOVE_TICK AND INCURS NO COOLDOWN!**

#### Frontend Implications:
1. **Always test `tryStep` locally before sending**: If the tile in front is a wall, do not send `MOVE` over the WebSocket. Simply update `selfEntity.dir = dir` to face the wall. This avoids wasted bandwidth and prevents spamming the server.
2. **If the server does send `MOVE_REJECT`**:
   - Immediately snap to the authoritative position: `tileX = reject.x; tileY = reject.y; dir = reject.dir;`
   - Wipe all pending predictions: `this.pending.length = 0;`
   - Reset the animation timer: `animStart = performance.now();` so the client can resume movement cleanly.

---

### 5.5 Handling `MOVE_ACK` (Authoritative Acknowledgment)

When the server processes a move, it replies with `MOVE_ACK(ack)`:
1. Locate `ack.seq` in your `pending` predictions array.
2. Remove all predictions up to and including `ack.seq`.
3. Check for divergence:
   ```ts
   handleAck(ack: MoveAckMsg): void {
     let ackIdx = -1;
     for (let i = 0; i < this.pending.length; i++) {
       if (this.pending[i].seq === ack.seq) {
         ackIdx = i;
         break;
       }
     }

     if (ackIdx !== -1) {
       const predictedAtAck = this.pending[ackIdx];
       this.pending.splice(0, ackIdx + 1);

       // Reconcile if server position disagrees with prediction
       if (predictedAtAck.x !== ack.x || predictedAtAck.y !== ack.y) {
         let currX = ack.x;
         let currY = ack.y;
         for (const p of this.pending) {
           const next = tryStep(this.map, currX, currY, p.dir);
           if (next.ok) {
             currX = next.x;
             currY = next.y;
             p.x = currX;
             p.y = currY;
           }
         }
         this.selfEntity.tileX = currX;
         this.selfEntity.tileY = currY;
       }
     }
   }
   ```

---

### 5.6 Handling `MOVE_REJECT` (Authoritative Rollback)

When the server rejects a move:
```ts
handleReject(reject: MoveRejectMsg): void {
  // Snap directly to authoritative server coordinates
  this.selfEntity.tileX = reject.x;
  this.selfEntity.tileY = reject.y;
  this.selfEntity.prevTileX = reject.x;
  this.selfEntity.prevTileY = reject.y;
  this.selfEntity.dir = reject.dir;

  // Clear in-flight predictions since the chain broke
  this.pending.length = 0;

  // Reset animation window to current time
  this.selfEntity.animStart = performance.now();
  this.selfEntity.animDuration = this.stepDurationMs;
}
```

---

## 6. Rendering & Smooth Interpolation

### 6.1 Tile Coordinate vs Pixel Position
- Tiles are discrete integers `(tileX, tileY)`.
- Choose a pixel tile size (e.g., `TILE_SIZE = 32px` or `48px`).
- The player's rendered pixel position is smoothly interpolated:
  ```ts
  const t = Math.min(1.0, (now - entity.animStart) / entity.animDuration);
  const smoothX = entity.prevTileX + (entity.tileX - entity.prevTileX) * t;
  const smoothY = entity.prevTileY + (entity.tileY - entity.prevTileY) * t;
  const pixelX = smoothX * TILE_SIZE;
  const pixelY = smoothY * TILE_SIZE;
  ```

### 6.2 Other Players' Movement
When receiving `ENTITY_MOVE` for another player:
```ts
otherPlayer.prevTileX = otherPlayer.tileX;
otherPlayer.prevTileY = otherPlayer.tileY;
otherPlayer.tileX = msg.x;
otherPlayer.tileY = msg.y;
otherPlayer.dir = msg.dir;
otherPlayer.animStart = performance.now();
otherPlayer.animDuration = 250; // Smooth slide over the 250 ms step window
```

### 6.3 Camera Viewport
Center the camera on the local player:
```ts
const cameraX = pixelX - viewportWidth / 2;
const cameraY = pixelY - viewportHeight / 2;
```

---

## 7. Reconnection & Ghost State

- **Ghost Window**: When a player drops connection (Wi-Fi blip, tab refresh, accidental close), their entity remains in the world as a **ghost** for **30 seconds**.
- **Instant Resume**: If the client reconnects within 30 seconds using the same `token`, the server:
  - Rebinds the WebSocket connection to the existing entity.
  - Sends a fresh `WELCOME` packet containing the player's exact coordinates.
  - Does **not** respawn the player at spawn points.
- **Frontend Action on Disconnect**:
  - Keep `token` in `sessionStorage` or `localStorage`.
  - Automatically attempt reconnection with exponential backoff (e.g. 500ms, 1000ms, 2000ms, max 5000ms).
  - Clear pending movement queues upon disconnect.

---

## 8. TypeScript Import Reference (`@heist/shared`)

All protocol definitions, opcodes, and map math are exported by `@heist/shared`. Your `package.json` in `apps/client` already depends on `"@heist/shared": "*"`.

```ts
import {
  // Encoders (C2S)
  encodeMove,
  encodePing,
  encodeC2SJson,
  
  // Encoders (S2C)
  encodeWelcome,
  encodeEntityEnter,
  encodeEntityLeave,
  encodeEntityMove,
  encodeMoveAck,
  encodeMoveReject,
  encodePong,
  encodeS2CJson,
  encodeKick,
  encodeEntityTeleport,
  
  // Decoders & Frame Utils
  decodeC2SFrame,
  decodeS2CFrame,
  concatMessages,
  
  // Constants & Enums
  DIR,
  DIR_DELTA,
  C2S,
  S2C,
  CLOSE_CODE,
  KICK_REASON,
  DEFAULTS,
  
  // Types
  type Direction,
  type WelcomeMsg,
  type EntityEnterMsg,
  type EntityLeaveMsg,
  type EntityMoveMsg,
  type MoveAckMsg,
  type MoveRejectMsg,
  type PongMsg,
  type S2CJsonMsg,
  type KickMsg,
  type EntityTeleportMsg,
  type MapData,
  type GameMap,
  type Hotspot,
  type Spawn,
  type StepResult,
  type ChunkCoord,
  
  // Map & Math Utilities
  loadMap,
  isWalkable,
  randomSpawn,
  tryStep,
  chunkOf,
  chunkKey,
  chunkFromKey,
  neighbours3x3,
  neighbours3x3Coords
} from '@heist/shared';
```

---

## 9. Recommended Frontend Feature Roadmap

To deliver a polished player experience, the following feature breakdown is recommended:

| Phase | Component / Feature | Description |
|---|---|---|
| **P1** | **Auth & Welcome Screen** | Login/Register modal, token persistence (`sessionStorage`), error toasts. |
| **P2** | **World Canvas & Camera** | Canvas/WebGL renderer, tile map drawing, camera panning locked to local player. |
| **P3** | **Player Input & Prediction** | WASD / Arrow keys input, prediction queue, ACK reconciliation, wall check. |
| **P4** | **Multiplayer Entities** | Rendering other players in AoI (`ENTITY_ENTER/MOVE/LEAVE`), 4-directional sprite facing. |
| **P5** | **HUD & Diagnostics Overlay** | Coordinates `(X, Y)`, Ping (RTT ms), Server tick, visible entity count, connection status badge. |
| **P6** | **Auto-Reconnect & Polish** | Seamless ghost reconnection on network drops, smooth step interpolation easing, audio/visual cues. |

---

## 10. Local Dev Setup & Verification

1. **Start Backend Server**:
   ```bash
   npm run dev:server
   # Server listens on http://localhost:8080 and ws://localhost:8080/ws
   ```
2. **Start Frontend Dev Server**:
   ```bash
   npm run dev:client
   # Vite starts on http://localhost:5173 with HMR
   ```
3. **Verify Connectivity**:
   - Open `http://localhost:5173` in two browser windows.
   - Register user `Alice` in window 1 and `Bob` in window 2.
   - Walk toward the center vault: observe both players entering each other's 3×3 chunk view and moving smoothly in real-time.
