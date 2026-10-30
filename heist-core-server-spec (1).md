# The Heist: Core Server Spec (Phase 1)

> Brief for Claude Code. Scope of this phase: **the real-time core server only**, plus a bare-bones test client and a realistic bot tester. Challenges, economy, heists, stocks, and frontend polish are later phases (see section 15).

---

## 0. Plain-English overview

- ~80-90 players walk around a big tile-based map (Pokemon Emerald style: one tile per step, top-down).
- **One server process is the boss.** It keeps every player's position in memory, decides if a move is legal, and tells nearby players what happened.
- Players only hear about things **near them** (Area of Interest). Far-away players cost nothing.
- Movement messages are tiny **binary** packets (about 8 bytes), not JSON.
- The database is used for **login only** (plus a periodic safety snapshot). It is never touched during the game loop.
- If someone's Wi-Fi drops, they reconnect and continue from the same spot.
- Before building anything else, we prove the server can hold 90+ **realistic bots** walking around for a long time without lag.

---

## 1. Scope

### In scope
1. Auth (register/login, session token) backed by DB
2. WebSocket server, authoritative world, fixed tick loop
3. Tile movement with server-side validation
4. Chunk-based Area of Interest (AoI)
5. Binary protocol for hot path, JSON channel reserved for later
6. Reconnect with session token
7. Periodic state snapshot to DB, graceful shutdown
8. Cheap protections (message-rate cap, heartbeat, backpressure)
9. Minimal metrics and debug endpoints
10. Minimal browser client (prediction + interpolation + debug overlay)
11. Realistic bot test harness with pass/fail criteria

### Out of scope (do NOT build now)
Challenges, economy/ledger, stock market, heists, bounties, police, teams, businesses, anti-cheat, server-side per-action rate limiting, pretty UI, sound, animations beyond basic walking.

---

## 2. Tech stack

| Concern | Choice |
|---|---|
| Runtime | Node.js 20+ with TypeScript (strict) |
| WebSocket | `ws` |
| HTTP | `fastify` (or plain `http`; keep it light) |
| DB | Repository interface with **SQLite** (`better-sqlite3`) adapter for dev/LAN and **Postgres** (`pg`) adapter for hosted deploy. Selected by env `DB_URL` |
| Password hashing | `argon2` or native `bcrypt` (async, runs in the libuv threadpool). **Never** use sync hashing or a pure-JS bcrypt (a login storm would freeze the tick loop) |
| Logging | `pino` |
| Tests | `vitest` |
| Client build | Vite, plain Canvas 2D (no game framework needed in this phase) |
| Monorepo | npm workspaces |

---

## 3. Repo layout

```
heist/
  package.json                # workspaces
  packages/
    shared/                   # used by server, client, bots
      src/
        constants.ts          # DIR, OPCODE, TICK_RATE, STEP_TICKS, CHUNK_SIZE
        protocol.ts           # binary encode/decode for every message
        map.ts                # map type, isWalkable, loader
        movement.ts           # tryStep(map, x, y, dir) -> {ok, x, y}
        chunks.ts             # chunkOf, neighbours3x3
  apps/
    server/
      src/
        main.ts               # boot, config, graceful shutdown
        config.ts             # env + defaults
        http/                 # /api/register, /api/login, /api/map, /health, /metrics, /debug/*
        net/                  # ws accept, per-connection state, rate cap, heartbeat, outbox
        world/                # World, Entity, ChunkGrid, AoI diffing, tick loop
        persistence/          # repo interfaces, sqlite + pg adapters, write queue, snapshotter
        metrics/              # tick timing ring buffer, counters
    client/                   # minimal Vite canvas client
    bots/                     # bot harness (section 12)
  maps/
    dev-map.json              # generated test map
  tools/
    gen-map.ts                # generates dev map with walls, rooms, hotspots
```

Rule: **movement, collision, chunk math and the protocol codec live only in `shared`.** The client's prediction must use the exact same code as the server.

---

## 4. Config (env, with defaults)

| Var | Default | Notes |
|---|---|---|
| `PORT` | 8080 | |
| `TICK_RATE` | 20 | ticks per second |
| `STEP_TICKS` | 5 | ticks per tile step (5 x 50 ms = 250 ms per step) |
| `CHUNK_SIZE` | 16 | tiles per chunk side (power of two) |
| `MAX_PLAYERS` | 200 | reject joins beyond this |
| `MAX_PENDING_MOVES` | 2 | per-player move queue |
| `MSG_RATE_PER_SEC` | 30 | token bucket refill |
| `MSG_BURST` | 60 | token bucket size |
| `HEARTBEAT_TIMEOUT_MS` | 15000 | no traffic then drop |
| `GHOST_GRACE_MS` | 30000 | keep disconnected player in world |
| `SNAPSHOT_INTERVAL_MS` | 30000 | DB snapshot of dirty players |
| `BACKPRESSURE_BYTES` | 256 * 1024 | ws.bufferedAmount threshold |
| `DB_URL` | `sqlite:./data/heist.db` | or `postgres://...` |
| `ALLOW_REGISTER` | 1 | set 0 if accounts are pre-seeded |
| `DEBUG_ENDPOINTS` | 0 | set 1 for bot consistency checks |

Why 20 Hz with 5-tick steps: a step is exactly 250 ms, and the cost is tiny because only *events* are sent, not full snapshots.

---

## 5. World model

### Map file (`maps/dev-map.json`)
```json
{
  "version": 1,
  "width": 256,
  "height": 256,
  "collision": ["000111...", "..."],   // one string per row, '1' = blocked, '0' = walkable
  "spawns": [{"x": 10, "y": 10}],
  "hotspots": [{"name": "bank", "x": 120, "y": 80}, {"name": "jobboard", "x": 60, "y": 60}]
}
```
- `tools/gen-map.ts` generates a 256x256 map: outer wall, scattered buildings, plazas, roads, hotspots. Hotspots are used by bots and later by gameplay.
- Later, a converter turns Tiled (`.tmj`) exports into this format. The server only ever sees this format.
- Server serves it at `GET /api/map`. The client checks `mapVersion` from WELCOME against the loaded map.

### Entities
```ts
interface Entity {
  id: number;          // u16, session-scoped
  playerId: string;    // DB id
  name: string;
  x: number; y: number; dir: 0|1|2|3;
  nextMoveTick: number;
  pending: {seq:number, dir:number}[];   // max MAX_PENDING_MOVES
  chunk: {cx:number, cy:number};
  connected: boolean;
  disconnectedAt?: number;
  dirty: boolean;      // needs snapshot
  data: Record<string, unknown>;  // reserved for later phases (money, inventory...). Empty now.
}
```
- Directions: `0 = UP (y-1), 1 = DOWN (y+1), 2 = LEFT (x-1), 3 = RIGHT (x+1)`.
- **Players do not collide with each other** (overlap allowed). It avoids blocking/griefing and deadlocks in doorways. Keep behind a config flag in case it is wanted later.
- No separate "turn" mechanic. Every move input moves one tile (and sets facing).
- Entity ids: allocate from a free list; after release, hold an id for ~2 s before reuse so late packets cannot confuse clients.

---

## 6. Tick loop

Fixed timestep, drift-corrected (accumulator on `process.hrtime.bigint()`). If behind, run at most 2 catch-up ticks, then skip and increment `tickOverruns`.

Per tick, in this order:
1. `tick++`
2. Network handlers have already parsed incoming messages and pushed `MOVE` into each player's `pending` queue (parsing is cheap and happens on arrival, not in the tick).
3. For each entity with `tick >= nextMoveTick` and a non-empty `pending`: pop one move and apply (section 7).
4. Compute AoI changes for every entity that moved this tick (section 8) and append events to the right outboxes.
5. Flush: for each connection with a non-empty outbox, concatenate the messages into **one** `ws.send` binary frame.
6. Every ~20 ticks: heartbeat check, ghost expiry, metrics rollover.
7. Record tick duration (`hrtime`) into a ring buffer.

**Hard rules**
- No DB calls, no `await` on I/O, no JSON parsing of large data inside the tick.
- Total tick work for 90 players should be well under 5 ms. The budget is 50 ms.

---

## 7. Movement and netcode

### Client to server
`MOVE(seq u16, dir u8)`. The client sends one move per step it wants. `seq` increments per move, wraps at 65535.

### Server handling
On arrival: if `pending.length >= MAX_PENDING_MOVES`, immediately send `MOVE_REJECT` with the current authoritative position. Otherwise enqueue.

In the tick, if cooldown is ready (`tick >= nextMoveTick`):
- Compute `(nx, ny)` with `tryStep` (shared code). The tile must be inside the map and walkable.
- **OK**: update `x, y, dir`, set `nextMoveTick = tick + STEP_TICKS`, set `dirty`, send `MOVE_ACK(seq, x, y)` to the mover, and broadcast `ENTITY_MOVE` to watchers.
- **Blocked**: send `MOVE_REJECT(seq, x, y, dir)`, no cooldown applied.
- Timing is never a reason to reject. A move that arrives slightly early simply waits in the queue until the cooldown is ready.

### Client prediction and reconciliation (test client)
- Keep a list of `pending` sent-but-unacked moves.
- On key hold: when the current step animation is nearly done, send the next `MOVE`, apply `tryStep` locally and start a 250 ms slide animation.
- On `MOVE_ACK(seq, x, y)`: drop all pending with `seq <= ack.seq`. If the server position differs from the predicted position at that seq, snap to the server position and replay the remaining pending moves.
- On `MOVE_REJECT`: snap to the given position, clear pending.
- Other players: on `ENTITY_MOVE`, animate a 250 ms slide from the old tile to the new one (no snapshot buffering needed). On `ENTITY_TELEPORT`, jump directly.

---

## 8. Area of Interest (chunks)

- `chunk = (x >> 4, y >> 4)` for `CHUNK_SIZE = 16`.
- `ChunkGrid`: `Map<chunkKey, Set<entityId>>`.
- A player **watches** its own chunk plus the 8 neighbours (3x3 chunks = 48x48 tiles), which is bigger than any screen, so entities appear before they are visible.
- **Same-chunk move:** send `ENTITY_MOVE` to every connected player watching that chunk (except the mover, who gets `MOVE_ACK`).
- **Chunk change (A to B):**
  - Let `oldWatch = 3x3(A)`, `newWatch = 3x3(B)`.
  - **Mover:** for entities in chunks of `oldWatch \ newWatch` send `ENTITY_LEAVE`; for entities in chunks of `newWatch \ oldWatch` send `ENTITY_ENTER`.
  - **Other players:**
    - watching old chunk only (could see the mover, now cannot): send `ENTITY_LEAVE(mover)`
    - watching new chunk only (could not see, now can): send `ENTITY_ENTER(mover)`
    - watching both: send `ENTITY_MOVE(mover)`
- **Join:** send `WELCOME`, then `ENTITY_ENTER` for every entity in the 3x3 chunks; send `ENTITY_ENTER(newPlayer)` to watchers.
- **Leave** (ghost expiry, kick, shutdown): send `ENTITY_LEAVE` to watchers.

Invariant that tests and bots check: **the set of entities a client believes it can see equals the server's computed set for that player.**

---

## 9. Protocol (binary, little-endian)

Each WebSocket frame contains **one or more messages back to back**. Each message is `[opcode u8][payload]`. The payload length is fixed per opcode, except where a length prefix is shown, so a parser can walk the frame without extra framing bytes.

### Client to Server
| Opcode | Name | Payload |
|---|---|---|
| `0x01` | MOVE | `seq u16, dir u8` |
| `0x02` | PING | `clientTime u32` |
| `0x03` | JSON | `len u16, utf8[len]` (reserved for cold-path features later) |

### Server to Client
| Opcode | Name | Payload |
|---|---|---|
| `0x81` | WELCOME | `selfId u16, x u16, y u16, dir u8, tickRate u8, stepTicks u8, mapVersion u16, serverTick u32` |
| `0x82` | ENTITY_ENTER | `id u16, x u16, y u16, dir u8, nameLen u8, name utf8[nameLen]` |
| `0x83` | ENTITY_LEAVE | `id u16` |
| `0x84` | ENTITY_MOVE | `id u16, x u16, y u16, dir u8` |
| `0x85` | MOVE_ACK | `seq u16, x u16, y u16` |
| `0x86` | MOVE_REJECT | `seq u16, x u16, y u16, dir u8` |
| `0x87` | PONG | `clientTime u32, serverTick u32` |
| `0x88` | JSON | `len u16, utf8[len]` (reserved) |
| `0x89` | KICK | `reason u8` (server then closes) |
| `0x8A` | ENTITY_TELEPORT | `id u16, x u16, y u16, dir u8` (also used for self if `id == selfId`; reserved for jail/police later) |

A movement broadcast is therefore **8 bytes** (1 opcode + 7 payload).

Close codes: `4001` invalid token, `4002` replaced by a newer connection, `4003` rate-limit kick, `4004` server full, `4005` heartbeat timeout.

Rules: unknown opcode or malformed message increments a counter and is ignored. After a threshold within a window, kick with `4003`. Max accepted frame size: 1 KB.

`packages/shared/protocol.ts` must expose `encodeX(...)` / `decodeFrame(buffer) -> Message[]` and have round-trip unit tests for every opcode.

---

## 10. Auth and database

### HTTP endpoints
- `POST /api/register {username, password}` (disabled when `ALLOW_REGISTER=0`)
- `POST /api/login {username, password}` returns `{token}`
- `GET /api/map`
- `GET /health` returns `{ok, tick, players, uptimeSec}`

Validation: username 3-20 chars `[a-zA-Z0-9_]`, password min 6 chars. Token: 32 random bytes hex. WebSocket connects to `/ws?token=...`.

### Tables
```sql
players(id TEXT PRIMARY KEY, username TEXT UNIQUE NOT NULL, password_hash TEXT NOT NULL, created_at TIMESTAMP)
sessions(token TEXT PRIMARY KEY, player_id TEXT NOT NULL, created_at TIMESTAMP, last_seen TIMESTAMP)
player_state(player_id TEXT PRIMARY KEY, x INT, y INT, dir INT, data TEXT /* JSON, empty for now */, updated_at TIMESTAMP)
```

### Repository interfaces (thin, so SQLite/Postgres are swappable)
`PlayerRepo`, `SessionRepo`, `StateRepo`. The world and net layers know only these interfaces.

### Access pattern
- Login/register: DB read/write (rare, async hashing).
- WS connect: session lookup once, then cached in memory.
- Join: load `player_state` once (or use a spawn point if none).
- During play: **no DB access.**

---

## 11. Persistence, reconnect, shutdown

### Snapshot
- Every `SNAPSHOT_INTERVAL_MS`: collect entities with `dirty = true`, push into a write queue, clear dirty.
- The write queue is async, coalesces by player, has one batch in flight at a time, is bounded, and on failure retries next interval and logs.
- Also snapshot on disconnect finalisation (ghost expiry) and on graceful shutdown.
- Result: a crash loses at most ~30 s of position, not the whole session.

### Reconnect
- On socket close: entity stays in the world as a **ghost** (static, still visible) for `GHOST_GRACE_MS`.
- On reconnect with a valid token: rebind the new socket to the existing entity, send `WELCOME` with current state and `ENTITY_ENTER` for everything in view. No leave/enter flicker for others.
- A second connection with the same token **replaces** the first (close the old with `4002`).
- After the grace period: finalise (snapshot, `ENTITY_LEAVE` to watchers, free id).

### Graceful shutdown (SIGTERM/SIGINT)
Stop accepting new connections, flush a final snapshot, close sockets with code 1001. The client auto-reconnects with exponential backoff (500 ms to 5 s).

### Cheap protections (always on)
- Per-connection token bucket (`MSG_RATE_PER_SEC`, `MSG_BURST`). Excess messages are dropped; sustained abuse leads to kick `4003`.
- Heartbeat: client sends PING every 5 s; no traffic for `HEARTBEAT_TIMEOUT_MS` leads to drop (becomes ghost).
- Backpressure: if `ws.bufferedAmount > BACKPRESSURE_BYTES`, stop queuing non-essential movement events for that client and count it; if it persists for more than 5 s, close it (it can reconnect).
- Server never trusts client positions; all moves are validated.

---

## 12. Metrics and debug

`GET /metrics` returns JSON:
- `players`, `ghosts`
- tick duration: `avg`, `p50`, `p99`, `max` (last 60 s), `tickOverruns`
- `msgsInPerSec`, `bytesOutPerSec`, `avgBytesPerClientPerSec`
- `outboxFlushesPerTick`, `backpressureEvents`, `rateLimitDrops`, `malformedMessages`
- `memoryRssMb`, `heapUsedMb`, event-loop lag

Only when `DEBUG_ENDPOINTS=1`:
- `GET /debug/aoi/:playerId` returns `{x, y, visibleEntityIds:[...]}` (server-computed truth)
- `GET /debug/entities` returns counts per chunk

Log (pino) a warning whenever a tick takes more than 25 ms.

---

## 13. Test client (apps/client)

Deliberately basic, for visual verification only:
- Login/register form, loads `/api/map`, connects WebSocket.
- Draws tiles as coloured squares, players as coloured squares with name labels, camera follows self.
- Arrow keys / WASD hold-to-walk, with prediction/reconciliation/interpolation as in section 7.
- Debug overlay: ping (PING/PONG RTT), server tick, entity count in view, own position, rejects count, bytes/sec in.
- Auto-reconnect with backoff.

---

## 14. Bot test harness (apps/bots)

**Goal: simulate how real players actually move, and verify correctness, not just survive random noise.**

Bots are real protocol clients: they register/login over HTTP, connect over WebSocket, use the shared codec, and run their own movement prediction/ack handling just like the test client. Run the bot process **on a different machine** from the server when possible (bots use CPU too).

### Behaviour models (assigned per bot)
| Model | Share | What it does |
|---|---|---|
| **Roamer** | 45% | Picks a random walkable destination, finds a path with **A\*** on the shared collision grid, walks it at the real step rate (with small jitter), pauses 1-8 s, repeats |
| **Hotspot-goer** | 20% | Cycles between map hotspots (bank, job board...), lingers 5-20 s at each. Creates realistic crowds |
| **Explorer** | 10% | Walks in a direction for a random 3-20 tiles, turns, occasionally bumps walls (like a person using arrow keys) |
| **Border-crosser** | 10% | Walks back and forth across chunk boundaries to stress enter/leave logic |
| **AFK** | 5% | Connects, stands still for long periods (idle but present) |
| **Reconnector** | 5% | Mid-walk, drops its socket, waits 1-10 s, reconnects with the same token |
| **Human-pauser** | 5% | Roamer that stops/starts erratically, changes its mind mid-path |

### Network profiles (assigned per bot)
- 60% good (5-30 ms), 30% medium (50-120 ms +/- jitter), 10% bad (150-400 ms with occasional 1-2 s stalls). Implemented by delaying bot send/receive.

### Timing realism
- Bots send the next MOVE slightly before the current step ends (like key-hold), with 0-60 ms jitter.
- Human think-time distributions for pauses (not constant).

### Correctness checks (the part that matters)
Each bot maintains a local replica of visible entities from ENTER/LEAVE/MOVE events. Every ~10 s it calls `GET /debug/aoi/:id` and asserts:
1. Own predicted position equals the server's position.
2. The set of visible entity ids equals the server's `visibleEntityIds`.
3. No entity appears that should have left (no ghosts in the replica), none missing.

Any mismatch increments a `desync` counter and logs the details (bot id, tick, diff).

### Per-bot and aggregate stats
- MOVE-to-ACK RTT (p50/p95/p99, **excluding injected latency**)
- rejects (and why), desyncs, disconnects, reconnect success time
- bytes in/out per second

### Scenarios
1. **Login storm:** 90 bots register/login within 10 s (tests async hashing + WS accept).
2. **Ramp:** 0 to 90 over 60 s, then **steady 90 for 30 min** with the behaviour mix above.
3. **Crowd rush:** all 90 converge on one hotspot, hold 60 s, then disperse (worst-case AoI density).
4. **Spike:** go to 150 bots for 5 min (headroom check).
5. **Reconnect storm:** all bots drop at once, then reconnect within 5 s.
6. **Soak:** 90 bots for 1 hour+; watch memory and tick time for drift.
7. **Border churn:** 30 border-crossers + the normal mix.

### Pass criteria (print a PASS/FAIL report at the end)
| Metric | Target |
|---|---|
| Tick time p99 at 90 bots | <= 10 ms (budget is 50 ms) |
| Tick time max | < 50 ms, `tickOverruns = 0` over 30 min |
| Tick time p99 at 150 bots | <= 25 ms |
| Desyncs | 0 |
| MOVE-to-ACK RTT p95 (excl. injected latency) | < 150 ms |
| Outbound bandwidth per client p95 | < 5 KB/s |
| Memory growth over 1 h soak | < 10% |
| Reconnect storm | 100% of bots resume at correct position within 10 s |
| Server CPU at 90 bots | < 50% of one core |

---

## 15. Build order (milestones with "done when")

| # | Milestone | Done when |
|---|---|---|
| M0 | Monorepo, `shared` package: constants, codec, map, `tryStep`, chunk math | Unit tests pass: codec round-trip for all opcodes, collision edge cases, chunk neighbours |
| M1 | Server skeleton: config, HTTP auth + DB (SQLite adapter), WS connect, entity join/leave | Two clients can log in and see each other appear/disappear |
| M2 | Tick loop + movement validation + ACK/REJECT | Single client walks, walls block, tick metrics visible at `/metrics` |
| M3 | Chunk AoI with enter/leave/move diffs | Test with many scripted clients: `visible == server truth` always |
| M4 | Test client: prediction, reconciliation, interpolation, debug overlay | Smooth walking with 100 ms injected latency; no rubber-banding on open ground |
| M5 | Reconnect/ghosts, snapshots, graceful shutdown, cheap protections, Postgres adapter | Kill -9 and restart loses <= 30 s; refresh tab resumes in place; flooding client gets cut off without lagging others |
| M6 | Bot harness: Roamer + correctness checks first, then the full behaviour/network mix and scenarios | All scenarios run and print PASS/FAIL |
| M7 | Tune, soak, dry-run on the real target host (Railway or LAN machine) with bots from a separate machine | All pass criteria met on target host |

Engineering rules for Claude Code:
- TypeScript strict. No `any` in the shared package.
- No I/O inside the tick. DB writes only through the write queue.
- Write unit tests for `shared` (movement, chunks, codec) and an integration test for AoI diffs before building on them.
- Commit per milestone.

---

## 16. Later phases (recorded now so we design hooks, but do not build)

### 16.1 Challenge flow (next phase)
Planned design, to keep in mind while building the core:
1. Server issues an **attempt**: problem statement plus a few sample tests (with answers) for local practice.
2. Player runs their code/SQL client-side against the samples.
3. On **Submit**, the server sends only **hidden inputs** (a random subset of a stored pool) with a short window (about 15-20 s).
4. The client runs the code on each input and returns the **outputs**.
5. The server compares them with the expected outputs it holds and never reveals. Pass/fail goes through the ledger (reward).

This makes it hard to hardcode or mock answers. It adds some server load, which is accepted.

**Hooks the core must leave:** the reserved `JSON` opcodes (cold path), `Entity.data`, a clean module boundary for a future `ChallengeService`, and the `player_state.data` column.

### 16.2 Other later phases
Economy and money ledger, stock market, heists (solo/player/collaborative), bounties and police, teams and businesses, dynamic events, admin dashboard, projector leaderboard, security hardening (server-side per-action rate limits, anti-spam), frontend beautification (Tiled maps, sprites, Pokemon Emerald look).

---

## 17. Open decisions (defaults chosen; change if needed)

| Decision | Default in this spec |
|---|---|
| Hosting | Hosting-agnostic. Decide before M7 (cloud host vs a lab machine on the LAN) |
| DB engine | SQLite for dev, Postgres adapter before cloud deploy |
| Map size | 256 x 256 tiles |
| Player-player collision | Off |
| Registration | Open (`ALLOW_REGISTER=1`); switch to pre-seeded accounts for the event if wanted |
