# The Heist — Agent & Frontend Engineering Rules

These rules are strictly authoritative for all development in this repository. All contributors and AI agents must follow them without exception.

---

## 1. Network & Protocol Rules

1. **Protocol & Math Source of Truth**:
   - Use **only** `@heist/shared` for binary packet codecs (`encode*`, `decodeS2CFrame`, etc.), map decoding (`loadMap`), step simulation (`tryStep`), and chunk math (`chunkOf`, `neighbours3x3`, etc.).
   - **Never** write custom binary encoders/decoders or manual byte manipulation codecs.

2. **Direction Enum & Numerical Order**:
   - Numerical order is strictly:
     - `UP = 0` (dy = -1)
     - `DOWN = 1` (dy = +1)
     - `LEFT = 2` (dx = -1)
     - `RIGHT = 3` (dx = +1)
   - Always reference `DIR.UP`, `DIR.DOWN`, `DIR.LEFT`, `DIR.RIGHT` from `@heist/shared`.

3. **Authoritative Cadence Calculation**:
   - `stepDurationMs = (stepTicks / tickRate) * 1000`, computed dynamically upon receiving `WELCOME`.
   - **Never** hardcode 250 ms, and **never** provide 5/20 fallback defaults.
   - Until the first `WELCOME` packet arrives, input must be disabled.

4. **Heartbeat Cadence**:
   - Send `PING` heartbeat packet every **2500 ms** (2.5 seconds) using `encodePing(performance.now() | 0)`.

5. **Server Opcode Handling & JSON Event Bus**:
   - Handle all server opcodes:
     - `S2C.WELCOME` (0x81)
     - `S2C.ENTITY_ENTER` (0x82)
     - `S2C.ENTITY_LEAVE` (0x83)
     - `S2C.ENTITY_MOVE` (0x84)
     - `S2C.MOVE_ACK` (0x85)
     - `S2C.MOVE_REJECT` (0x86)
     - `S2C.PONG` (0x87)
     - `S2C.JSON` (0x88): Decode string payload and route to typed event bus.
     - `S2C.KICK` (0x89): Map reason codes to UI states.
     - `S2C.ENTITY_TELEPORT` (0x8A)
   - Expose `sendJson(payload: string | object)` using `encodeC2SJson`.

---

## 2. Movement, Prediction & Reconciliation Rules

1. **In-Flight Prediction Limit**:
   - Maximum **2 pending moves in flight** (`pending.length < 2`).
   - If `pending.length >= 2`, drop input until `MOVE_ACK` arrives.

2. **Local Collision Checks**:
   - **Never** send `MOVE` into a locally blocked tile (`tryStep(map, x, y, dir).ok === false`).
   - If blocked by a wall, only turn the player to face that direction locally; do not send a packet, do not enqueue prediction, and do not enter cooldown.

3. **Timer Drift & Chaining Clamping**:
   - When holding a direction:
     - If `elapsed < stepDurationMs * 1.5`: Chain smoothly with `animStart += stepDurationMs`.
     - Otherwise: Reset `animStart = now`.
   - Never allow catch-up bursts.

4. **Handling `MOVE_REJECT`**:
   - Immediately snap to authoritative server position: `tileX = reject.x; tileY = reject.y; dir = reject.dir;`
   - Reset animation coordinates: `prevTileX = reject.x; prevTileY = reject.y;`
   - Wipe all in-flight predictions: `pending.length = 0`.
   - Reset animation timer: `animStart = performance.now(); animDuration = stepDurationMs;`.

5. **Handling `MOVE_ACK`**:
   - Locate `ack.seq` in `pending` and splice all predictions up to that index.
   - If predicted position matches `(ack.x, ack.y)`: Prediction succeeded; continue smooth interpolation.
   - If divergent: Re-simulate remaining pending predictions from `(ack.x, ack.y)` using `tryStep` and update `selfEntity.tileX/tileY` without snapping `prevTileX/prevTileY` or resetting `animStart`.

6. **Resetting on `WELCOME` (First Connect & Reconnect)**:
   - On every `WELCOME`:
     - Clear pending movement queue (`pending.length = 0`).
     - Reset sequence counter (`seq = 0`).
     - Set player coordinates and facing direction directly from `WELCOME` (`x, y, dir`).
     - Recompute `stepDurationMs = (welcome.stepTicks / welcome.tickRate) * 1000`.
     - Clear the entities map before new `ENTITY_ENTER` messages arrive.

7. **Handling `ENTITY_TELEPORT`**:
   - If `msg.id === selfEntity.id`:
     - Clear pending prediction queue (`pending.length = 0`).
     - Snap position: `tileX = msg.x; tileY = msg.y; prevTileX = msg.x; prevTileY = msg.y; dir = msg.dir;`.
     - Reset animation start: `animStart = performance.now()`.
   - If other entity: Jump instantly with no sliding animation (`prevTileX = msg.x; prevTileY = msg.y; tileX = msg.x; tileY = msg.y;`).

---

## 3. Connection Lifecycle, Reconnect & Session Handling

1. **Token Persistence**:
   - Persist session token in `sessionStorage` so refreshing the tab within the 30-second ghost window resumes in place.

2. **Exponential Backoff**:
   - Reconnect delays: `500ms`, `1000ms`, `2000ms`, `4000ms`, capped at `5000ms`.

3. **WebSocket Close Code Policies**:
   - `4001 (INVALID_TOKEN)`: Clear stored token from `sessionStorage` and redirect to login screen. Do not auto-reconnect.
   - `4002 (REPLACED)`: Show UI message *"Session opened in another window"*. Do not auto-reconnect.
   - `4003 (RATE_LIMIT)`: Throttle outgoing inputs and attempt reconnect.
   - `4004 (SERVER_FULL)`: Show *"Server at capacity, retry later"* screen with manual retry option.
   - `4005 (HEARTBEAT_TIMEOUT)` and `1006 (ABNORMAL_CLOSURE)`: Automatically reconnect using exponential backoff.

4. **Disconnect Prediction Reset**:
   - On socket disconnect, immediately clear pending prediction queues so reconnection does not start in a locked state.

---

## 4. Architecture & Separation of Concerns

1. **Unidirectional Data Flow**:
   - Data strictly flows: `Network -> Game Store / State -> Engine / Systems -> Renderer & UI`.
   - The Renderer and UI components must **never** touch the raw WebSocket or send network packets directly.

2. **Server Authority**:
   - The game server is 100% authoritative.
   - The client never decides money, combat outcomes, inventory, or authoritative positions.

3. **Visual Style**:
   - Per the user's clarified direction: **the supplied district and connector images define the look; Pokémon Emerald defines the feel** (four-direction movement, a following camera, simple nearby interactions and readable menus).
   - Preserve original map artwork. Render it directly at display resolution; do not reduce it to a tiny pixel buffer or replace it with generic tile rectangles.
   - Keep collision, spawn points, exits and interaction coordinates as separate inspectable server-authoritative data aligned to the artwork.

## HUD design priority

**The map must stay almost completely unobstructed.** The artwork carries the visual quality. UI must frame it, not cover it. Use compact persistent controls, contextual interaction prompts and details on demand. Preserve gameplay, networking, server authority and original assets during HUD changes.
