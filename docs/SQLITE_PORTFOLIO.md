# SQLite portfolio build

This branch turns the former event deployment into a server-local SQLite demo.
The old event failed; historical handoffs and deployment claims are not a current
health or capacity certificate. MongoDB and the Azure VM are no longer part of the
application's startup path. Old Mongo migration/diagnostic sources remain for
historical work, not as runtime dependencies of this configuration.

The demo deliberately accepts data loss when Render Free replaces or spins down
its instance. It does not need an external database. On a machine with retained
storage, the same SQLite file preserves accounts and event progress across restarts.
No saved Atlas world is imported or modified by this change.

## Run locally

Use Node 22.19 or newer. CI and the Docker image select 22.19.0.

```sh
npm ci
npm run build
DATABASE_BACKEND=sqlite DB_URL=sqlite:./data/heist.db npm -w @heist/server start
```

Open `http://localhost:8080`. The one server serves frontend assets, HTTP and
WebSocket traffic. Relative SQLite paths are resolved from the repository root,
so root scripts and npm workspace commands use the same file.

For editing: build shared once, run `npm run dev:server` and
`npm run dev:client`, then open port 5173. The database worker supports both
source-mode `tsx` and emitted production JavaScript.

An existing private `.env` that selects MongoDB must be changed to
`DATABASE_BACKEND=sqlite`. Remove `EVENT_DB_PATH`: accounts, positions and the
event now live in **one** `DB_URL` file. The server refuses a separate legacy event
path rather than silently ignoring it. Existing databases are not deleted.

For a fresh demo owner, set these private environment values before startup:

```dotenv
HEIST_ADMIN_USERNAME=heist_owner
HEIST_ADMIN_PASSWORD=YOUR_PRIVATE_PASSWORD_AT_LEAST_12_CHARACTERS
```

Bootstrap only creates a missing superadmin. It never promotes an existing player
or overwrites a saved password. Sign in as that owner and use Event Control to
start, pause, reset or configure the round. Player registration remains unchanged.
The initial round starts in the lobby, not automatically in a timed event.

Local CLI alternatives:

```sh
npx tsx tools/provision-admins.mts --create-four-staff-accounts
npx tsx tools/reset-staff-password.mts --username=heist_owner --confirm-reset
```

Both now use SQLite. The reset transaction changes the staff password and revokes
its sessions together; player accounts cannot be reset through this staff tool.

## Execution and transactions

```text
HTTP / WebSocket → asynchronous repository or event command
                         ↓ bounded worker message queue
                 one SQLite worker thread
                 ├─ accounts, sessions, position snapshots
                 └─ event simulation, SQL, ledger and audit
                         ↓ committed result + movement permissions
main thread: movement tick → shared codecs → client outboxes
```

`SqliteDatabase` contains no database handle on the game thread. Its methods send
named operations to `sqlite-worker.ts`. `DatabaseSync` is synchronous **inside the
worker**; the caller awaits a message without blocking movement timers. Merely
marking the previous synchronous adapter's methods `async` did not provide this.

The same worker and SQLite connection own the event engine. This also moves its
SQL-backed audit, answer validation and event calculations off the movement
thread. The main thread retains authoritative positions and a small committed
movement/travel-permission cache. Position/connection context accompanies event
commands; browser coordinates are never accepted as authority.

The queue accepts at most 1,024 outstanding requests. Overflow is rejected,
never silently dropped. Worker failure rejects pending promises and disables
movement. A stale permission cache also stops movement. Per-client view requests
are coalesced and the event scheduler never queues another tick while one is
pending. A 30-second database lease prevents two game servers from owning the
same file; it renews every 10 seconds and is released on clean shutdown. After a
crash, a replacement may need to wait for that lease to expire.

SQLite uses WAL, foreign keys, a five-second lock timeout and `synchronous=FULL`.
Event mutations, money transfers and the staff audit row commit together.
An SQL/commit failure rolls back in-memory event state and rule overrides too.
Staff reset archives the complete prior event and replaces the round and saved
positions in one transaction. Round identifiers fence old position snapshots so
queued writes cannot restore pre-reset positions.

Shutdown stops new gameplay work, drains pending event commands, waits for
in-flight and queued position snapshots, then closes the worker. A failed final
snapshot is reported and produces a nonzero exit status.

## Database shape

| Storage | Contents |
| --- | --- |
| `players` | Unique usernames, password hashes, roles, optional profiles |
| `sessions` | Tokens with a foreign key to the account |
| `player_state` | Latest position, direction, map/round identity, timestamp |
| `event_state` | Versioned event aggregate snapshot, including settings, accounts, slots, attempts, raids and deadlines |
| `event_ledger` | Indexed, hash-chained transfers; ordinary update/delete prohibited |
| `event_answers`, `event_requests`, `event_notices` | Answer outcomes, action history and announcements |
| `event_archives` | Immutable full snapshots of completed/reset rounds |
| `staff_audit` | Append-only organizer mutations recorded with their event generation |
| `runtime_lease`, `schema_migrations` | World ownership and schema version tracking |
| `event_accounts`, `event_players`, `event_contracts`, `event_attempts` | SQL views into the current event snapshot |

The event aggregate stays a JSON snapshot in SQLite to preserve the existing,
extensively tested state-machine semantics. The ledger/history are relational
rows; the inspection views are virtual, not independent duplicate balances.
This migration does not claim a fully normalized rewrite of the gameplay model.
Every money mutation still reconciles to exactly 400,000 paise and must have the
corresponding ledger transfers. Reset archives the old ledger before beginning a
new chain; prior archived records cannot be updated or deleted by normal SQL.

## Render Free

`render.yaml` creates one free Docker web service. The multi-stage root
`Dockerfile` builds shared, server and client, removes development dependencies,
and runs the server as the unprivileged `node` user. See [Render deployment](RENDER_DEPLOYMENT.md).

- Build: `npm run build:deploy` inside the image (no bots or load tests)
- Start: `node apps/server/dist/main.js`
- Health check: `/health`
- Storage: `sqlite:/app/data/heist.db`, intentionally ephemeral

Render supplies `PORT`; the server binds to `0.0.0.0`. The blueprint generates a
private owner password; retrieve it from the service environment, then sign in
as `heist_owner`. No database service, disk, Atlas URI or Azure secret is needed.
Do not set `EVENT_DB_PATH`. Do not deploy multiple instances sharing one world.
The old Azure workflow is manual-only so pushing the future portfolio repository
does not automatically target the previous VM.

The hosting limit is accepted: [Render Free local files are ephemeral](https://render.com/docs/free).
A fresh instance can require registration again. Once deployed, measure its
actual CPU/memory/network behavior; a laptop result is not a Render capacity claim.

## Validation and metrics

```sh
npm run build
npm run test:shared
npm run test:server
npm run test:bots
npx tsc -p apps/client/tsconfig.json --noEmit
npm run bots:hosting -- --profile=smoke
npm run bots:gameplay
```

Hosting and gameplay suites create disposable SQLite files and server processes.
The hosting fixture now seeds the same unified file used by the running server.
Do not point legacy bot tools at real data without reviewing their behavior.

`/metrics` includes the existing movement/tick/CPU/event-loop/bandwidth figures
plus a `database` section: health, pending/completed/rejected requests, queue high
watermark, and mean/max RPC latency. RPC latency includes queue time and execution;
it is not a pure SQL duration. `/health` returns 503 after worker failure.

The migration regression suite explicitly tests SQL-lock responsiveness, restart
recovery, atomic rollback, single-world ownership, reset archives, stale snapshot
rejection, worker loss, staff password/session atomicity, and shutdown draining.
See [SQLite validation](SQLITE_VALIDATION.md) for measured results and their limits.
