# Hosting-PC bot testing

For bots that acquire and solve actual paid jobs, exercise FIFO queues, travel, Bank, safehouses and races, see [the real-game player-agent suite](GAMEPLAY_BOT_TESTING.md). This infrastructure suite remains a separate certification workload.

**Fixture repaired — 16 October 2026:** this suite used to seed training-mode
workbenches and required a practice solve and probe. Player training was
removed, so the server hides those copies from the event view and refuses to
answer or probe them, and the smoke profile exited 1 with
**Missing mixed workbench state**.

The fixture now preloads paid contracts rather than training copies, which is
what it always wanted: the mode was incidental to its purpose of making the
broadcast payload realistically large. Two consequences were fixed with it. The
preloaded contracts are backdated a minute, because creating the fixture,
booting the server, connecting the peers and starting the event can finish
inside five seconds on a fast machine and trip the genuine minimum-solve-time
rule. The exercise no longer asserts the player's balance stays at zero, which
held only because training pays nothing; it now asserts the server verified the
answer and the probe, with the ledger audit alongside it proving the Starter
award is a conserved transfer rather than created money.

Training was **not** re-enabled and no gate was weakened to get a green report.
The functional checks pass; the performance gates remain strict and will fail on
a loaded development machine, so run them on the real host for a capacity
result. Measurements elsewhere in this guide predate the repair.

## What to run

Install/build from the repository root first:

```powershell
npm ci
npm run build
npm run bots:hosting -- --help
npm run bots:hosting -- --profile=smoke
npm run bots:hosting -- --profile=lab
npm run bots:hosting -- --profile=soak
```

| Profile | Operators | Workload | Timed traffic |
| --- | --- | --- | --- |
| `smoke` | 40 | Crowded then spread over the city | 45 seconds each |
| `lab` | 40 | Crowded then spread over the city | 300 seconds each |
| `soak` | 40 | Worst-case crowded scene | 10,800 seconds (3 hours) |

Preparation, password hashes, correctness checkpoints and reconnect checks add time beyond the timed traffic. Run them on the **actual host/VM**, not just a faster development laptop. Overrides: `--bots=20 --seconds=600 --seed=123`. Bot count is intentionally capped at 40 to match current event enrollment, not the older 200-connection backend setting. Unknown, duplicate, NaN and out-of-range options fail before launch.

Local mode needs no already-running server, admin token or debug token. It launches the **built** server in a separate process, with independent disk-backed SQLite files, an unused port and random test secrets. The generator and server share the machine's hardware, so this is intentionally resource-contended. The production saved lobby/event is not opened. Process cleanup targets only the spawned child. Do not change your main server's environment to run these tests.

## Workload and correctness

The suite builds on the earlier bot harness' shared packet codecs, seeded random behavior and area-of-interest verification approach. The new runner is distinct from the old realistic/probe/canary tools and retains those tools.

Each layout exercises:

1. Forty simultaneous real password verifications (not token-only fake authentication).
2. Forty real registration/hash requests while all operators are connected. Extra accounts are authentication-only and never enroll in the event.
3. Five mixed public challenge payloads per operator: code, debugging, cipher, logs and machine. Test fixture expiry is extended to sustain this payload through the soak; **production lifetimes and validators are unchanged**.
4. An explicit Start on the exact disposable roster. The runner refuses an already-started event, mismatched fixture or unexpected players.
5. A practice answer derived from the visible fare code and a machine probe, both verified by the server. No prize is paid for this fixture's training.
6. ACK-driven movement using WELCOME cadence, shared `tryStep`, enum directions and one in-flight move. No blocked tile packets or catch-up bursts. Heartbeats use shared encoding every 2.5 seconds.
7. Forty players clustered within eight tiles for dense broadcasts; the spread layout starts operators across all 19 scenes, including connectors and residential wards.
8. State sync requests every five seconds alongside normal once-per-second state delivery.
9. Periodic drained area-of-interest replica comparisons against authoritative positions, including entity entry, movement and leave behavior. Server positions are read through protected debug endpoints only.
10. All operators disconnect together, then resume within the ghost window with the same token, entity and position. The reconnect storm is included in tick-overrun counters.
11. Final economy audit and conserved account total.

The suite does not solve every paid challenge, act as an adversarial penetration test, exercise every three-hour timeline branch, emulate bad Wi-Fi, or measure browser rendering FPS. Existing server unit/network tests cover rules and validators separately. Fixed seeds reproduce direction choices, not OS scheduling/timings. Run different seeds and actual player browsers too.

## Reports, gates and failed tests

Every run prints its absolute `bot-runs/hosting-TIMESTAMP` path:

- `report.md`: readable gate-by-gate results.
- `summary.json`: hardware/topology, workload, coverage, per-layout results and limitations.
- `crowd/result.json`, `spread/result.json`: per-operator movement, bytes and RTT distributions.
- `metrics.ndjson`: full sampled server metrics, including authentication and reconnect phases.
- `server.log`: child server output.
- `auth.db`, `event.db`: disposable disk-backed fixtures, retained for investigation.
- `fixture.json`: **contains random test password and admin/debug secrets**. Private transfer only; never commit/upload publicly. The entire `bot-runs` directory is Git-ignored.

Exit code 0 means **every declared gate passed**; failed/incomplete/cancelled runs exit 1. Missing ACK/health samples, zero AoI coverage and missing exercise checks cannot produce a pass. Read failures rather than simply rerunning until green.

| Gate | Required result |
| --- | --- |
| Connections/reconnect | Every operator welcomes and resumes at the exact position/entity |
| Movement | At least five moves each; every move ACKed; no rejects |
| Replica/protocol | Every operator checked; no differences, decode errors, kicks or unexpected drops |
| Coverage | Dense crowd sees every other operator at peak; spread reaches all 19 scenes with 40 operators |
| State/economy | Live payloads delivered; practice/probe confirmed; balanced ledger |
| Tick | p99 execution ≤10 ms; no overruns since steady baseline, including reconnect storm |
| Network | No backpressure, rate-limit drops or malformed messages |
| Response | Worst operator ACK p99 <150 ms loopback / <400 ms remote; health p99 <500 ms |
| Resource headroom | Steady RSS <1 GiB, event-loop p99 <75 ms, mean CPU <75% of one core |
| Long-term memory | ≥10-minute runs: final minute mean minus 60–180s warm window mean <128 MiB |

The 20ms event-loop histogram resolution has a nonzero normal baseline; do not interpret it as a zero-target lag metric. CPU `100%` means one fully busy core, not the entire multicore PC; hashing workers may exceed 100%. CPU/loop metrics cover intervals between metric reads. Use one sampler during certification so another poller does not subdivide them unexpectedly. Authentication burst RSS/loop latency are reported separately from steady-state gates.

Short profiles report memory growth as `null` (not assessed), even when all applicable gates pass. They do **not** certify long-term memory stability. ACK percentiles use deterministic bounded per-operator reservoirs (4,096 retained values each); the reported worst operator p99 is an estimate when longer than that. Exact counts, sums and maxima remain tracked. The full metric time series is written incrementally; neither bot traces nor metrics grow unbounded in RAM.

If the suite fails, inspect the phase/time in `metrics.ndjson`, `server.log` and Windows/VM CPU, RAM and disk graphs. Investigate single-core saturation, memory pressure, SSD write latency, shared host contention, CPU throttling, noisy security scans and LAN loss. Do not lower tick/security rates, disable ledger durability or remove correctness gates to manufacture a pass.

## Two-PC LAN certification

This separates bot-generator load from host load and measures your actual lab network. Both PCs need this same built revision. Use a **new disposable server**, never the prize event.

On the intended host, from the repository root:

```powershell
npm run build
npm run bots:hosting -- --serve --profile=lab --port=8765
```

The command prepares a fresh crowd fixture and waits. It prints the private `fixture.json` path, not its secret values. Copy that file privately to the generator PC (for example `C:\HeistQA\fixture.json`). Have the lab administrator allow **TCP 8765 from the generator PC only** through the intended host firewall profile for this rehearsal. The script does not change firewall policy.

On the generator PC, replace the example address with the actual host LAN IP:

```powershell
npm run build
npm run bots:hosting -- --profile=lab --url=http://192.168.1.50:8765 --fixture=C:\HeistQA\fixture.json --confirm-rehearsal
```

`--confirm-rehearsal` explicitly authorizes login/registration and Start on that copied disposable fixture. The exact roster, unstarted phase, protected admin/debug secrets and map version are checked before the event is started. The fixture count/duration must match or exceed the generator's request. Never point at 8080 just because it responds.

Read generator-side report files. Server CPU/RSS come from host metrics; `environment.json` CPU name/RAM inventory describe the **generator**. Record host/VM hardware separately with the report. Use Ctrl+C in the host terminal afterward. Stop/prepare a **new** disposable host for each additional run; a used fixture is deliberately refused. The generator cannot shut down a remote host for you.

For three hours, use `--profile=soak` on both PCs. Private fixture transfer and the HTTP test port must remain on the trusted lab network. Do not expose debug/admin test endpoints publicly; the real hosting launcher disables debug endpoints.

## Earlier teammate modules

These remain available:

```powershell
npm run test:bots
npm run bots -- --scenario=probes
npm run bots -- --scenario=canary
npm run bots -- --scenario=realistic --bots=40 --duration=300 --seed=42
```

The latter three expect an existing **disposable** debug-enabled server (`HTTP_URL`, `WS_URL`, optional `DEBUG_TOKEN`), register their own `agent_*` accounts and may inject intentionally invalid traffic. Never run them against a live event. They predate the current event enrollment/payloads and have their own coverage and bandwidth assumptions; their performance pass is not a replacement for this event-specific hosting suite. The built-server fixture added here is not imported by normal server startup.

Pure regression checks and the isolated broadcast benchmark:

```powershell
npm -w @heist/bots run test -- src/__tests__/hosting-stats.test.ts
npm run test:server
npm run test:shared
npm run benchmark:views
```

## Hardware expectations and safe tuning

An i5 12th-generation CPU with 16 GiB RAM is a **reasonable candidate for 40 players**, especially native Node on an SSD/wired LAN. This is an engineering estimate, not a model-specific certification: i5 desktop/mobile models, power limits, VM allocation, storage and networking vary. The development machine is an i7-13650HX/16 GiB, so its measurements cannot be relabelled as i5 results. Certify the actual host with the profiles above and simultaneous real browsers before event day.

For a VM, begin with 4 vCPU/4 GiB RAM and preserve host OS headroom; measure before adding resources. Node's movement/event loop is mostly single-threaded, so adding cores alone cannot cure synchronous pauses. Do not run a cluster of independent servers against the same game database: this game has one authoritative world, not a distributed coordinator.

Backend improvements retain shared protocol/cadence and money authority:

- A 512-entry **public-only** immutable-puzzle presentation cache avoids repeated generation; per-player timers/results stay live. Returned workbenches are cloned so a caller cannot poison the cache. Answers/validators are not cached into public views.
- Each view filters its player's attempts once instead of repeatedly scanning everyone's history for every station.
- Financial transactions still capture rollback state, check transfer/account conservation and append the ledger atomically. Successful transactions no longer eagerly deserialize an extra full deep clone.
- Presence-only changes use a bound atomic SQLite JSON patch, avoiding a full JavaScript state clone/serialization per simultaneous reconnect. Memory changes only after the write succeeds; failure is tested.
- Connection admission and queued disconnect persistence yield between lifecycle operations so a burst cannot monopolize the event loop. Disconnected entities stop accepting movement immediately; queued writes retain the actual disconnect timestamp and cannot override a newer connection. Shutdown also closes sockets still awaiting admission.
- Public event status reads no longer invoke the organizer's full audit/ledger view.
- RSS, host memory, one-core CPU, event-loop p99 and utilization are available in `/metrics` for measurement.

No money schema/timing/security rule was weakened. The event ledger keeps **WAL + synchronous FULL**: it is intentionally not switched to NORMAL for a speed score. [SQLite documents the power-loss durability trade-off](https://www.sqlite.org/pragma.html#pragma_synchronous). The interval metrics use [Node's performance APIs](https://nodejs.org/api/perf_hooks.html), and the presence update uses [SQLite's atomic JSON merge patch](https://www.sqlite.org/json1.html#jpatch).

Follow [the one-host deployment steps](LAB_HOSTING.md) for the real event.

Measured development-PC results, including the discovered reconnect pause and its fix, are in [the performance audit](hosting-performance-audit.md). Do not confuse those results with certification of your lab's i5 host.
