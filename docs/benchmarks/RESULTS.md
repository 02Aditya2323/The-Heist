# Backend benchmark evidence

Measured 2026-10-29T17:00:48.406Z. All completed campaign runs, including failures, appear below. The headline is the highest count that passed this campaign's 15-minute core-engine soak. It is a **validated operating point on this host**, not an architectural maximum or an end-to-end full-game capacity claim.

## Headline

- **500 actively moving core-engine players**, 15 measured minutes.
- 32,727 sustained logical protocol deliveries/s, inbound + outbound.
- MOVE-to-ACK p95 54.85 ms; world-tick p95 8.515 ms within a 50 ms budget.
- 100% exact entity/position reconnect success (500/500).
- 96.81% fewer replication deliveries per acknowledged move with AOI in the 100-player matched comparison.

## Selected soak diagnostics

| Measurement | Observed |
|---|---:|
| Acknowledged moves | 1,442,904 |
| Inbound / outbound logical messages/s | 1,808 / 30,919 |
| Inbound / outbound payload bytes/s | 7,590 / 250,884 |
| Logical messages/player/s | 65.45 |
| Tick mean / p50 / p95 / p99 / max, ms | 6.642 / 6.596 / 8.515 / 9.657 / 617.998 |
| Tick budget use at p95 | 17.03% |
| Execution overruns / effective tick rate | 9 (0.05%) / 19.96 Hz |
| Server CPU mean / peak (100% = one core) | 18.61% / 27.24% |
| Messages/s per consumed CPU core | 175,878 |
| Active players per consumed CPU core | 2,687 |
| Server RSS mean / peak, MiB | 70.29 / 98.3 |
| Heap mean / peak, MiB | 23.09 / 33.8 |
| RSS / heap first-to-last window change, MiB | -26.7 / 0.49 |
| RSS after disconnect / ghost expiry, MiB | 84.1 / 37 |
| Raw incremental RSS/player, KiB | -44.25 |
| Max interval event-loop p50 / p95 / p99, ms | 20.66 / 187.695 / 754.45 |
| Generator event-loop p99, ms | 21.905 |
| Peak heap total / external / array buffers, MiB | 55.4 / 3 / 0.4 |
| Maximum sampled event-loop utilisation | 87.62% |
| SQLite sampled pending peak / lifetime queue peak | 1 / 47 |
| SQLite rejected RPCs / lifetime max RPC latency, ms | 0 / 45.53 |
| Ready sessions / connection failures | 500 / 0 |
| Reconnects / reconnect p95, ms | 500/500 / 21.2 |
| AOI replica checks / mismatches | 1500 / 0 |
| Region transitions / chunk crossings | 331 / 89429 |
| Nearby interactions | 4227 |
| Rejected moves / protocol errors / unexpected disconnects | 0 / 0 / 0 |
| Remaining players / expired ghosts after cleanup | 0 / 0 |

CPU-normalised ratios describe measured efficiency at this operating point, not the number of players another core can necessarily support. The raw negative RSS delta, if present, reflects released startup pages; it is not negative per-player allocation. Long tail execution stalls and ACK maxima remain in the JSON even when the percentile gates pass.

## Environment

Apple M1; 8 physical / 8 logical cores; 8192 MiB RAM; darwin kernel 25.0.0. Node v22.19.0, Fastify 5.12.5, ws 8.22.0. Separate server process; bots and server on same host, loopback. CPU/memory are server process only.

Server commit: f970b77a21aee2a92afbcd1f0170c19af520eed0; dirty checkout: true. Built server/shared JS artifact SHA-256: `916b76f493a7ca3b689b6e8b9881968373487eab4b5af2d77ad21b4857ea113c`. Per-run environment and hashes are in [results.json](results.json). Warn-level logging; 20 Hz simulation, five ticks/step, production heartbeat/rate-limit/backpressure defaults; SQLite worker persists accounts and snapshots. CPU 100% means one fully occupied logical core and includes process worker activity. These measurements are not hardware independent.

## Load model and scope

The final serial-world-intents-v2 load model waits for movement ACKs before interacting and waits for interaction/teleport replies before moving again. This prevents the test client itself from issuing stale moves across travel. Earlier exploratory v1 runs and their failures remain in the table; they are not used as long-soak headlines. Each bot authenticates its fixture session, awaits WELCOME, derives cadence, sends one ACK-driven move at a time with seeded 1.05–1.35× cadence jitter, decodes every server frame with @heist/shared, maintains a visible-entity replica and sends 2.5-second heartbeats. Movement is checked with shared tryStep. Roughly ten percent seek authored gates; occasional nearby interactions occur on a jittered ~20-second schedule. All entities use the real city collision map. Spatial layouts distribute players across the authored regions; hotspot concentrates them near a common central spawn.

Core tests use the production World, TickLoop, WebSocket/auth/SQLite and interaction modules in a loopback-only disposable entrypoint. The event/contract scheduler is excluded, so these larger counts do **not** imply the current 60-seat event economy or full game supports that many players. Steady joins are ramped in batches of 25 with a short yield; connect-storm submits its selected cohort together. Ordinary reconnects use batches of 50, and the reconnect-storm submits its cohort together. Steady core connections use pre-created valid tokens; ten real password logins are sampled separately before measurement. Full-game runs use real password login for all players and the production entrypoint in its unstarted lobby with preloaded workbench payloads. This measures the full engine/payload path, not a live paid-event simulation; the earlier gameplay run separately validates live paid activities and settlement. No paid activity is faked during measured core runs.

Warm-up is excluded. Quantiles pool individual MOVE ACKs and individual tick-execution durations, rather than taking percentiles of rolling percentiles. ACKs use a bounded reservoir of 200,000 samples, tick samples 100,000; each summary records retained count and whether approximate. Event-loop figures are the maximum observed one-second histogram percentiles, not whole-run percentiles. The monitor uses 20 ms resolution, so its normal baseline is near 20 ms; it is not a pure excess-delay stopwatch. CPU/RSS are sampled once per second. The exact measured duration includes the final ACK drain.

Traffic counts every decoded logical packet and every actual outbound batched packet delivery, including recipient copies; it is not a count of unique gameplay actions. Incoming/outgoing WebSocket frames and payload bytes are reported separately. Byte figures exclude WebSocket/TLS/IP overhead. Steady-state throughput uses cumulative counter differences over measured wall time.

## All measured runs

| Engine | Players | Scenario / AOI | Measured s | Msg/s | ACK p50 ms | ACK p95 ms | ACK p99 ms | Tick p95 ms | Execution overrun rate | CPU / one core | RSS mean MiB | Result |
|---|---:|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---|
| core/v1 | 10 | steady/spatial | 180 | 75 | 26 | 49.49 | 52.17 | 0.551 | 0% | 3.67% | 31.64 | PASS |
| core/v1 | 50 | steady/spatial | 180 | 563 | 26.63 | 49.73 | 51.63 | 1.535 | 0% | 5.11% | 37.05 | PASS |
| core/v1 | 100 | steady/spatial | 181 | 1,722 | 27.92 | 50.7 | 53.16 | 3.642 | 0% | 8.1% | 41.6 | PASS |
| core/v1 | 250 | steady/spatial | 180 | 8,924 | 30.27 | 53.6 | 67.47 | 7.088 | 0.111% | 13.51% | 56.81 | FAIL |
| core/v1 | 100 | soak/spatial | — | — | — | — | — | — | — | — | — | INCOMPLETE: Cancelled |
| core/v1 | 250 | steady/spatial | 180 | 9,025 | 29.62 | 52.61 | 55.97 | 6.329 | 0% | 13.48% | 63.24 | PASS |
| core/v1 | 250 | steady/spatial | 180 | 8,871 | 29.14 | 52.16 | 55.54 | 5.976 | 0.028% | 12.09% | 72.03 | PASS |
| core/v1 | 500 | steady/spatial | 181 | 32,579 | 31.04 | 54.25 | 58.1 | 8.124 | 0.056% | 17.13% | 65.61 | PASS |
| core/v1 | 1000 | steady/spatial | 181 | 124,815 | 32.95 | 57.43 | 112.02 | 8.28 | 0.365% | 19.71% | 82.46 | FAIL |
| core/v1 | 500 | soak/spatial | — | — | — | — | — | — | — | — | — | INCOMPLETE: Cancelled |
| core/v2 | 500 | steady/spatial | 181 | 33,105 | 31.72 | 54.89 | 58.43 | 8.448 | 0% | 18.24% | 69.63 | PASS |
| core/v2 | 1000 | steady/spatial | 180 | 125,481 | 32.6 | 56.64 | 97.42 | 7.814 | 0.279% | 19.74% | 88.18 | FAIL |
| core/v2 | 500 | soak/spatial | 900 | 32,727 | 31.57 | 54.85 | 58.58 | 8.515 | 0.05% | 18.61% | 70.29 | PASS |
| core/v2 | 100 | steady/spatial | 180 | 1,740 | 27.59 | 50.29 | 52.59 | 3.271 | 0% | 7.22% | 45.48 | PASS |
| core/v2 | 100 | steady/global | 180 | 32,331 | 28.22 | 51.21 | 54.15 | 4.885 | 0% | 9.73% | 41.32 | PASS |
| core/v2 | 100 | hotspot/spatial | 181 | 22,375 | 27.45 | 50.32 | 52.9 | 3.44 | 0% | 6.76% | 46.32 | PASS |
| core/v2 | 100 | reconnect/spatial | 45 | 1,706 | 27.14 | 49.96 | 52.2 | 2.619 | 0% | 6.87% | 87.72 | PASS |
| core/v2 | 100 | connect-storm/spatial | 45 | 1,630 | 27.49 | 50.12 | 52.31 | 3.057 | 0% | 6.89% | 81.98 | PASS |
| game/v2 | 40 | steady/spatial | 180 | 442 | 26.75 | 49.29 | 51.37 | 1.007 | 0% | 10.68% | 106.67 | PASS |

## Stability definition

A pass requires every sampled connection count to match the requested count; every bot completes at least 1.5 moves/s; all measured moves are acknowledged; zero protocol errors, rejects or unexpected disconnects; zero AOI replica mismatches; exact reconnect recovery for every bot; tick p95 <25 ms, at most 0.1% execution ticks >50 ms and effective tick rate ≥19 Hz; ACK p95 <150 ms and p99 <500 ms; no sampled one-second event-loop utilisation ≥95%; mean server process CPU <150% of one core; last-window minus first-window RSS <128 MiB and heap <64 MiB; healthy bounded DB queue; zero transport drop/backpressure counters; and zero remaining connected players/expired ghosts after cleanup. Memory trends are evidence of bounded growth during this test, not proof that no leak exists. Scheduler catch-up skips are reported separately from execution-budget overruns.

## AOI comparison

Both runs used 100 players, seed 991, the same map, bot algorithm and duration. Spatial chunks were 16 tiles. The global baseline uses a single world-sized chunk (780 tiles), so the same production routing sends every replication update to all clients. This baseline is isolated to benchmark configuration.

| Mode | Delivered replication packets / ACK | Out packets/s | Out payload bytes/s | Tick p95 ms | CPU % |
|---|---:|---:|---:|---:|---:|
| Spatial | 3.16 | 1,378 | 11,077 | 3.271 | 7.22 |
| Global | 99.03 | 31,971 | 255,740 | 4.885 | 9.73 |

Fan-out reduction = (global replication deliveries/ACK − spatial deliveries/ACK) / global deliveries/ACK ×100 = **96.81%**. Normalising by ACK count avoids presenting a lower movement rate as an AOI saving. It includes boundary enter/leave/teleport delivery work. Exact executed paths and ACK counts can differ under scheduling despite identical random seed; those counts are published. This is a topology/workload result, not an invariant percentage for all player distributions.

## Player density

| Layout | Players | Replication deliveries/ACK | Msg/s | ACK p95 ms | Tick p95 ms | CPU % | Result |
|---|---:|---:|---:|---:|---:|---:|---|
| Distributed | 100 | 3.16 | 1,740 | 50.29 | 3.271 | 7.22% | PASS |
| Clustered hotspot | 100 | 68.64 | 22,375 | 50.32 | 3.44 | 6.76% | PASS |

Both scenarios use spatial routing. The hotspot starts the cohort together near Central Exchange and lets them move normally; the distributed scenario spreads players across the authored city. This compares density scenarios, not identical executed paths. AOI cannot remove deliveries between players who are actually nearby.

## Limits, overload and cleanup

- core-active-250: tickBudget.
- aborted-early-soak-100: Cancelled.
- core-active-1000-repeat-4: ackIntegrity, protocol, tickBudget.
- aborted-legacy-bot-soak-500: Cancelled.
- core-active-1000-repeat-2: tickBudget, loop.

Campaign decisions: Interrupted the early 100-player soak to repeat the 250-player boundary: the first 250-player run had zero functional failures, p95 7.09ms, but 4/3604 execution overruns (0.111%). No gates were relaxed. Higher loads will be probed to distinguish a sustained bottleneck from sporadic stalls. Stopped the ramp at 1000: ackIntegrity, protocol, tickBudget. Preserve this failure; soak a lower candidate. Paused the legacy 500-player soak to correct a benchmark-client race discovered at 1000: world travel could overlap an unacknowledged move. The final serial-world-intents-v2 harness serializes these intents and includes a delayed-teleport regression. Earlier runs are preserved, but final soak/paired headlines require v2. Server logic, latency targets and stability gates were not loosened. Stopped the ramp at 1000: tickBudget, loop. Preserve this failure; soak a lower candidate.

The first failing progressive level is a measured operating-envelope boundary for this campaign, not proof of the first intrinsic server bottleneck: co-located generators, OS scheduling and host memory pressure can limit it. Review per-run generator event-loop p99, server event-loop utilisation, tick distributions, CPU, RPC queue/latency and memory before attributing causality. Peak spikes are not used as sustained throughput. Incremental RSS per player can be negative if startup parsing/hash pages are released during warm-up; it is a raw process delta, not an object-allocation estimate. Post-disconnect process memory may stay above baseline because V8 retains allocated pages; after-ghost-expiry values and first/last memory windows are published. Login sessions intentionally persist; cleanup checks connections, ghosts and AOI entities rather than deleting valid accounts.

## Architectural and functional evidence

Client intent → session authentication and input validation → authoritative movement queue → fixed-tick shared collision simulation → chunk/AOI routing → batched state replication → client replica. Position, interaction radius and wealth are owned by the server. Movement never awaits database I/O. The SQLite worker owns persistence and event transactions; the core entrypoint reuses that asynchronous persistence path.

AOI correctness is compared against authoritative positions before/after movement and after reconnect. Every benchmark restores exact entity ID and coordinates; ghost expiry is checked after 32 seconds. The existing server regression suite validates invalid/missing sessions, blocked moves, organizer role checks, forged instant solves, balanced ledger transactions, wrong-location interactions, reconnect ordering and worker failure. No network fuzzing certification is implied. The earlier full 40-bot gameplay run, documented in SQLITE_VALIDATION.md, separately covered paid jobs, deposits, races and automatic settlement; it is not relabelled as this campaign.

## Connection and reconnect bursts

| Scenario | Ready/attempted | All ready, s | Connect p95 ms | Exact reconnects | Reconnect cohort, s | Reconnect p95 ms | Result |
|---|---:|---:|---:|---:|---:|---:|---|
| session-storms | 100/100 | 0.333 | 20.91 | 100/100 | 0.065 | 40.96 | PASS |
| connect-storm | 100/100 | 0.071 | 60.95 | 100/100 | 0.066 | 21.08 | PASS |

Connect-storm opens the cohort together; session-storms reconnects it together. Connection latency ends at WELCOME. These core scenarios authenticate valid fixture tokens; they do not benchmark a simultaneous password-hashing surge. CPU/RSS in the main table describe the measured movement window, not a separately sampled burst peak.

## Session and AOI lifecycle

A valid session token attaches a socket to a server-owned player. Disconnect retains the entity for the 30-second ghost window; reconnect within that window replaces the transport while preserving entity ID and coordinates. Ghost expiry removes the player from world/chunk membership. Tests close all transports, wait 32 seconds and verify zero connected players and ghosts. Login account/session rows intentionally remain available for later authentication.

Spatial membership follows authoritative tile positions through chunk transitions. The server sends enter/leave deltas when visibility changes and batches movement replication to subscribed nearby clients. The benchmark compares each client's complete replica with the server's expected 3×3 chunk neighbourhood after movement and after reconnect; it reports region transitions and chunk crossings separately. Clients submit movement/interaction intent; neither client predictions nor bot replicas own position, balance or contract results.

## Reproduce

Use Node 22.19.0, run npm ci and npm run build, then:

```sh
npm run benchmark -- --players=100 --seconds=180 --warmup=30 --engine=core --scenario=steady
npm run benchmark -- --players=100 --seconds=180 --warmup=30 --engine=core --scenario=hotspot
npm run benchmark -- --players=100 --seconds=180 --warmup=30 --aoi=global
npm run benchmark -- --players=100 --seconds=900 --warmup=30 --scenario=soak
npm run benchmark -- --players=100 --seconds=45 --warmup=10 --scenario=reconnect
npm run benchmark -- --players=100 --seconds=45 --warmup=10 --scenario=connect-storm
npm run benchmark -- --players=40 --seconds=180 --warmup=30 --engine=game
node tools/benchmark-campaign.mjs
node tools/publish-benchmarks.mjs bot-runs/campaign-TIMESTAMP/campaign.json
```

Each command launches a separate loopback server with disposable SQLite files under Git-ignored bot-runs/benchmark-*. Configure players, seconds, warmup, cleanup, seed, movement-ms (0 means WELCOME cadence), interaction-seconds, scenario, engine and aoi. Output includes environment.json, result.json, report.md and metrics.ndjson. fixture-private.json and raw run directories contain test credentials: do not publish them. The publisher reads only result.json, refuses incomplete campaigns or missing passing 15-minute soaks, and copies no secrets. Run the same commands on another host to compare the backend under a new documented environment.

## Deployment note

No public Render target was supplied or deployed in this campaign. Render HTTPS/WSS/wake-up smoke remains unmeasured. Free-tier demo capacity must not be inferred from this local result, and the core engine's tested player count must not be presented as the game's configured event seating.

## Resume wording

- Built an authoritative WebSocket world engine validated with 500 concurrently active simulated players over a 15-minute soak, sustaining 32,727 logical messages/s at 54.85 ms p95 movement-acknowledgement latency in a documented local benchmark.
- Implemented chunk-based AOI replication, reducing delivered state-update fan-out per acknowledged move by 96.81% against global replication in a matched 100-player distributed workload.

These statements deliberately say core world engine and simulated players. Do not omit the workload/environment qualification when comparing the numbers to production user capacity.
