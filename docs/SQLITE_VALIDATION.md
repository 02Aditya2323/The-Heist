# SQLite migration validation — 29 October 2026

The SQLite runtime is implemented and passes the migration regression tests.
The longer gameplay run passed. The hosting smoke **did not pass its performance
gates**; these results do not establish a supported player count on Render Free.
Nothing was deployed or pushed during this work.

## Environment and scope

- Local Apple M1, 8 logical CPUs, 8 GiB RAM, macOS; bots and server ran on the same computer.
- The final server regression suite and latest hosting smoke used Node 22.19.0,
  matching CI and `render.yaml`. The gameplay run used the installed Node 26.12.1.
- Hosting samples reported as little as 63–67 MiB host free memory. This is
  context, not proof of the cause of latency spikes.
- Disposable unified SQLite databases, production server build, loopback HTTP/WebSocket.
- Protocol bots exercise server behavior; they do not measure browser rendering,
  internet latency or Render CPU/network limits.

## Regression results

| Check | Result |
| --- | --- |
| Build shared, server, client and bots | PASS |
| Server tests on Node 22.19.0 | 196/196 PASS |
| Shared protocol/movement/map tests | 100/100 PASS |
| Bot harness tests | 71/71 PASS |
| Client TypeScript check | PASS |
| Existing deployment-tool tests | 14/14 PASS |
| World reachability | PASS: 19 scenes, 13,475 walkable tiles, 124 hotspots, 44 gates, 90 homes, 3 spawns |
| Dialog visibility rules | PASS: 32 checks |
| Client input and contract UX checks | PASS |
| City atlas, terminal cards, workbench design and arithmetic | PASS |
| Challenge generation audit | PASS: 1,008 variants across 42 templates |

The 11 new worker tests cover restart recovery, atomic event/audit/reset rollback,
immutable archives, stale position fencing, responsiveness during a SQLite writer
lock, single-world ownership, batch rollback, worker failure, owner bootstrap,
reconnect ordering, staff password/session transactions and shutdown draining.
One test deliberately fails the request-history insert after a successful player
action and verifies that both its saved and in-memory state roll back.

The lock test holds an external writer lock for 160 ms while a database request
waits. Main-thread interval callbacks continue running, directly checking that
SQLite lock waits occur off the movement thread.

Use the documented workspace scripts (`npm run test:server`, etc.). Some existing
fixtures resolve files from their workspace directory; running every repository
test through a root-level Vitest invocation also mistakenly collects Node test
runner files and is not the supported invocation.

## Full gameplay run

Local evidence directory: `bot-runs/gameplay-2026-10-28T22-13-14-823Z/`.
The run used 40 bots, a condensed 10-minute event and a 620-second budget.

- **PASS** overall; 68,481 movement commands acknowledged with zero rejects,
  protocol errors or reported drops.
- 85 paid challenge completions, 10 deposits, 14 race entries and 40 checkouts.
- Slot contention, FIFO offers, missed-offer handoff, one-time rewards,
  parallel paid work and exact ghost-resume position checks passed.
- Final automatic settlement reached the frozen phase with all 40 players settled.
- Ledger audit: 170 rows, exactly 400,000 paise conserved.
- 302 successful health samples; zero backpressure events, malformed messages
  or rate-limit drops in the reported network counters.
- Maximum sampled server RSS: 353.5 MiB. Median sampled RSS: 168.3 MiB.

This run preceded the final worker-loader, reconnect-ordering and action-history
failure fixes, which were subsequently covered by the Node 22 regression suite.
It did not certify burglary, Golden Hour or raid crews, and recorded no activity
clears. The condensed schedule preserves real lock/fee/race durations but changes
the travel time available to players.

## Hosting smoke on Node 22.19.0

Local evidence directory: `bot-runs/hosting-2026-10-28T22-23-33-601Z/`.
40 bots, 45 seconds per layout; unchanged acceptance thresholds.

| Measurement | Crowd | Spread |
| --- | ---: | ---: |
| Overall | FAIL | FAIL |
| Movement acknowledged / sent | 5,861 / 5,861 | 5,808 / 5,808 |
| Movement rejects | 0 | 0 |
| AOI comparisons / differences | 160 / 0 | 160 / 0 |
| Exact-position reconnects | 40 / 40 | 40 / 40 |
| Reported tick p99 | 16.483 ms | 7.900 ms |
| Tick overruns | 0 | 1 |
| ACK p99 | 64.7 ms | 320.3 ms |
| Event-loop p99 | 40.468 ms | 363.332 ms |
| Maximum server RSS | 372.2 MiB | 386.9 MiB |
| Steady mean CPU, percent of one core | 15.48% | 15.44% |
| Database requests rejected | 0 | 0 |
| Maximum outstanding database requests | 80 | 65 |
| Mean database RPC latency | 34.84 ms | 32.21 ms |
| Maximum database RPC latency | 1,206.06 ms | 964.17 ms |

Both layouts passed connections, movement, HTTP health, protocol, AOI, scene
coverage, reconnect, event/economy and transport gates. Crowd failed the tick p99
threshold of 10 ms. Spread failed the zero-overrun gate, ACK p99 below 150 ms and
event-loop p99 below 75 ms. RPC timings include queueing, execution and delivery;
they are not individual SQL-query timings. Short tests do not assess memory growth.

Earlier Node 26 exploratory runs are also retained locally:

- `hosting-2026-10-28T17-47-43-593Z`: 12 bots, 15 seconds/layout; crowd passed,
  spread failed scene coverage. This undersized run was not a capacity result.
- `hosting-2026-10-28T17-49-38-104Z`: 40 bots, 45 seconds/layout; both layouts
  failed performance gates, while movement/reconnect/AOI/economy checks passed.

## Remaining measurement work

Deploy the portfolio repository to Render Free, then measure that actual service
with gradual client counts and a longer soak before publishing capacity claims.
The default 60-connection configuration is an admission limit, not a measured
capacity guarantee. Intentional ephemeral-data loss is accepted for this demo.

The existing browser HUD audit runner is configured for Windows/Linux browsers;
it was not run on this Mac. Its disposable server configuration now uses the
unified SQLite file. Frontend artwork and interaction behavior were not redesigned
in this migration. CI checks were not weakened to hide benchmark failures.

Raw run directories are Git-ignored and contain disposable credentials/databases.
This summary contains no tokens, passwords or database copies. Use it for public
documentation; review any raw evidence before sharing it.
