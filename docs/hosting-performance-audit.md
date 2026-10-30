# Hosting suite and backend optimization audit — 14 October 2026

## Scope and hardware

Target: the approved **40-player** event on one lab PC, with separate browsers/accounts on player PCs. Implemented an isolated built-server load runner, real password/login and registration bursts, disk-backed event fixtures, crowded/spread movement, challenge-state traffic, replica checks, reconnect storms, private remote-generator mode, reports and a production hosting launcher.

Measured on **i7-13650HX, 20 logical CPUs, approximately 16 GiB RAM, Windows, Node 22.19.0**. These are development-host results, **not i5-12th-generation or lab-VM measurements**. No three-hour soak or physical two-PC LAN certification was performed here. The delivered commands support both on the actual host.

## Broadcast benchmark

Same isolated workload: 40 operators, five mixed workbenches each, generate public views and serialize all 40; 35 measured rounds after five warmups.

| Build | Median batch | p95 batch | Maximum batch |
| --- | --- | --- | --- |
| Before | 30.689 ms | 33.946 ms | 34.505 ms |
| Optimized rerun | 4.376 ms | 5.691 ms | 6.526 ms |

About **7× faster for this particular view/broadcast preparation workload**, not a 7× claim for the entire game. `npm run benchmark:views` reproduces the CPU test without opening the saved event.

## Failure-driven changes, not a hidden green rerun

Initial 30-second fixtures exposed a reconnect pause: all movement/replica checks passed, but a reconnect storm added an overrun. Atomic presence patches and cheaper successful transaction snapshots improved it; repeated short fixtures then passed.

A subsequent **300 seconds per layout** run acknowledged **38,120/38,120 moves in each layout**, with no rejects, decode errors, unexpected drops or replica differences. Crowd passed; spread failed the strict tick gate with **one overrun during reconnect**, not steady movement. Its reconnect event-loop p99 was 172.229 ms. This failed run is retained at `bot-runs/hosting-2026-10-14T09-50-19-079Z`, not described as a certification pass.

The final fairness change yields between socket lifecycle operations instead of batching forty synchronous commits/admissions into one callback turn. Ghost entities stop accepting moves immediately, queued writes preserve the real disconnect timestamp, an old close cannot mark a new session offline, and shutdown closes sockets awaiting admission. A timer-fairness regression simulates forty short synchronous writes; separate tests cover stale closes, immediate ghosting and shutdown. The zero-overrun gate was **not relaxed**.

## Post-fairness 40-player result

`npm run bots:hosting -- --profile=lab --seconds=60 --seed=987` passed both layouts:

| Measurement | Crowd | Spread |
| --- | --- | --- |
| Timed traffic | 60 s | 60 s |
| Moves / acknowledgements | 7,680 / 7,680 | 7,680 / 7,680 |
| Worst sampled tick p99 | 4.955 ms | 5.136 ms |
| Worst operator ACK p99 | 65.87 ms | 63.99 ms |
| Steady RSS maximum | 85.8 MiB | 85.2 MiB |
| Registration-burst RSS peak | 336.5 MiB | 336.1 MiB |
| Mean steady CPU (one-core %) | 3.46% | 4.12% |
| Authoritative replica checks | 160 | 160 |
| Replica failures / overruns | 0 / 0 | 0 / 0 |
| Scenes covered | 1 dense crowd | All 19 |

Every operator resumed at the exact entity/position. Crowd visibility peaked at all 39 other operators. Both final economy audits balanced ₹4,000 / 400,000 paise. No backpressure, rate drops or malformed packets occurred. These short runs do not assess long-term memory growth.

Raw evidence: `bot-runs/hosting-2026-10-14T10-03-12-343Z`. All private fixtures and reports remain Git-ignored. Public audit data deliberately excludes fixture credentials and private machine/account identifiers.

The final rebuilt release repeated both 30-second layouts with seed 2026 after the shutdown/stale-close safeguards. Both passed with zero overruns; sampled tick p99 was **4.090 / 4.552 ms**, worst operator ACK p99 **66.1 / 65.2 ms**, and steady RSS maximum **83.9 / 84.0 MiB** (crowd/spread). Raw evidence: `bot-runs/hosting-2026-10-14T10-07-00-013Z`.

## Other verification

- Full workspace production build passed (shared/server/client/bots).
- Shared: **100 tests**; server: **112 tests**; bots: **35 tests**. Total **247**, including earlier teammate login/reconnect/traffic and fault-canary tests.
- Public cache regression checks no answers/validators leak, per-player variants/timers remain distinct, mutable returned workbenches cannot poison later views, and cache size stays bounded at 512.
- Transaction failure tests restore nested state, account balances and SQL ledger; balanced-but-unledgered changes still fail. Presence failure cannot advance in-memory metadata.
- Production PowerShell launcher parsed and actually started a fresh two-slot fixture on 8766. Root/health returned 200/healthy, phase remained lobby, and `/debug/config` returned 404. It did not start/reset the saved event or alter firewall policy.
- Private remote-generator branch passed with two bots against a separate local fixture process. This validates the remote code path over **loopback**, not physical LAN latency. Attempting to reuse its started fixture was correctly refused before event mutation.
- Fixture databases, random passwords/tokens, metrics streams and transient build caches are not included in release commits.
- The original saved database was checked read-only after implementation: lobby phase, the same three operators, and `startedAt: 0`. No main-event Start, reset or paid action was issued. The existing development servers were left available; disposable test servers were stopped.

## Remaining certification

Run `npm run bots:hosting -- --profile=lab` and `--profile=soak` on the actual i5 host/VM and perform the two-PC LAN run described in [BOT_TESTING.md](BOT_TESTING.md). The full five-minute profile must be rerun after this final fairness change; the pre-fix five-minute spread result is explicitly a failure. No guaranteed player capacity is claimed beyond measured workload evidence. Actual SSD latency, VM allocation, thermal/power limits and LAN behavior matter.

For deployment and distinct accounts, follow [LAB_HOSTING.md](LAB_HOSTING.md). The event ledger retains synchronous FULL durability; no movement cadence, prize rule, validator, map/collision data or financial authority was weakened.
