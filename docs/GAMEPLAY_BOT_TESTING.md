# Actual-game player-agent testing

This complements the infrastructure load suite in [BOT_TESTING.md](BOT_TESTING.md). It exercises ordinary gameplay acquisition and competition, not just moving bots or preloaded practice payloads.

## Run it

From the repository root on the intended test PC:

```powershell
npm ci
npm run build
npm run bots:gameplay -- --help
# Full condensed schedule: 40 real accounts, up to 620 seconds after Start
npm run bots:gameplay
# Normal event clock: first 15 minutes, no timeline compression
npm run bots:gameplay -- --event-minutes=180 --seconds=900 --seed=43
```

The default uses the server's existing `EVENT_DURATION_MINUTES=10` option. Milestone minutes (waves, races, Bank opening, Checkout, final settlement) are scaled into ten real minutes. **Movement, five-second reading/answer cooldowns, 30-second queue acceptance, six/ten-minute job locks, five-minute withdrawals and raid durations remain real-time.** This is not a claim that three-hour timing was certified. Use `--event-minutes=180 --seconds=10820` for the full normal schedule; reserve over three hours plus preparation.

Options are strictly validated: `--bots=8..40`, `--seconds=150..11000`, `--event-minutes=10..180`, `--seed=0..2147483647`. There is deliberately **no `--url` override**: the runner cannot target or start the prize server by mistake.

## What the bots actually do

- Register and log in via real password hashing/verification, with distinct accounts.
- Connect using `@heist/shared` codecs, wait for WELCOME and use its movement cadence. Heartbeats are sent every 2.5 seconds.
- Walk from the normal authored spawn using shared pathfinding and collision checks. Move one ACK at a time; no blocked-tile packets, debug teleports or injected positions.
- Traverse district entrances through server-validated nearby interactions and inspect the actual job terminals.
- Acquire each Starter normally and solve its personal public puzzle after a variable reading/thinking delay.
- Exercise four parallel Standard slots, two FIFO waiters, voluntary release, the 30-second offer, accepted offer, successful slot consumption and a deliberately missed offer passing to the next waiter.
- Verify direct player training requests are rejected without exposing any question, including while paid slots are occupied.
- Disconnect/reconnect an operator in the ghost window, preserving entity and position.
- Autonomously choose paid jobs, visit Bank and safehouses, enter available races, and attempt Checkout once it opens. All balances, eligibility and results remain server-authoritative. No player training is available.
- Audit the final ledger, protocol/movement counts, network safety and saved-lobby preservation. A complete default run also checks automatic settlement.

The independent solver accepts only public `ChallengeView` fields. It never imports server puzzle generators, answers or variant seeds. Server generators appear only in unit tests as a test oracle. Supported acquisition puzzles currently cover Starter/Standard/Expert jobs and the three races (23 public puzzle templates including compatible Golden Hour solvers, but the runner does not acquire Golden Hour). Unsupported evidence fails closed, rather than marking a challenge solved.

These are **protocol player agents**, not humans or full browser sessions. Their delay, choices and travel emulate ordinary behavior; they do not certify visual controls, rendering FPS, novel human strategies, burglary, Golden Hour acquisition or raid crews. Use the separate screenshot playthrough and real multiplayer browsers for visual testing, and the hosting suite for declared resource/latency gates.

## Safety, reports and reset

Every invocation creates `bot-runs/gameplay-TIMESTAMP/` and launches the built production server against new disk-backed `auth.db` and `event.db` files. It uses a random unused port, a private organizer secret and disabled debug routes. It never imports the preloaded hosting fixture or modifies the normal server's environment.

Before launch, SQLite `VACUUM INTO` snapshots of the default saved lobby databases are placed in `preserved-lobby/`; committed WAL data is included. This is not an unsafe file copy of a live database. If the normal host uses another data directory, back it up separately: the runner does not discover alternate paths. The default saved event's clock, roster and accounts are read-only checked again at completion. Independent user changes during testing can cause that preservation comparison to fail and must be investigated, not overwritten.

Outputs:

- `report.md` and `summary.json`: gates, per-bot counts, solved types, metrics and explicit limits.
- `actions.ndjson`: ordinary actions, public responses, travel and accepted solves. No answer/password/token logging.
- `metrics.ndjson`: server resource/network samples at two-second intervals.
- `server.log`: production-server diagnostics.
- `private-fixture.json`: random disposable password, organizer secret and account IDs. **Keep private.**
- Databases and `preserved-lobby/`: retained for investigation. They contain private auth/session/state data. Never upload the run directory or snapshots publicly.

The entire `bot-runs/` directory is Git-ignored. Exit 0 means every declared gate passed; failed, incomplete or cancelled runs return nonzero and still retain evidence. Do not rerun just to hide failures.

After a run has stopped, verify accepted answers and actual financial transfers directly from its retained authority database, replacing the example with the printed directory:

```powershell
npx tsx tools/audit-gameplay-run.mts bot-runs/gameplay-TIMESTAMP
```

This read-only post-run audit writes `authority-audit.json`. It separates practice, paid-job and race clears; checks for duplicate accepted attempts or answers before the five-second minimum; and counts recorded deposits, withdrawal requests/arrivals, fees, Home transitions and Checkout requests. A complete-timeline audit requires those later roles to have been exercised. It refuses paths outside an explicitly named `bot-runs/gameplay-*` directory and never opens the prize-event database.

The owned server and bot sockets stop at completion. **No destructive reset is needed:** another invocation creates a fresh test world, while the real lobby remains unchanged. Old test databases remain stopped and recoverable for audit. Do not delete/reset the real accounts to clean up these bots.

## Does a newcomer have to queue?

Not for the building or all challenges globally:

| Activity | Concurrent-player behavior |
| --- | --- |
| Training | Disabled on the server and absent from player menus |
| Starter | One paid Starter per operator; different operators play independently |
| Standard | Four slots for each of two templates per wave (eight prizes); a free eligible slot can be held concurrently |
| Expert | One paid slot for the scheduled template |
| Busy Standard/Expert | If all eligible unpaid slots are held, requesting that template queues the operator FIFO on one occupied slot; maximum two queues per operator |
| Released/expired lock | Next eligible waiter gets a 30-second journal offer; accepting begins a fresh normal lock |
| Successful paid solve | That prize slot is consumed and its queue is cleared; it is **not** handed to the next player. They need another eligible paid slot |
| Race | Entrants compete simultaneously, not a one-player terminal queue |

Other exclusive mechanics (a targeted Home lock, courier lock, raid crew) have their own authority/eligibility rules; they are not this paid-job FIFO mechanism. Shared tile occupancy does not by itself lock a terminal.
