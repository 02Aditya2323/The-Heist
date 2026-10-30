# Live gameplay and 40-player load audit — 14 October 2026

## Outcome

**Functional gameplay and authority audit: PASS. Dedicated 40-player smoke load gates: PASS.** The tests used the built production server, separate disk-backed databases and real HTTP/WebSocket traffic. The original saved event was not started, populated with bots or reset. It remained in lobby with three operators and `startedAt=0`; clock, roster and account balances matched the pre-test read-only snapshot.

Every test server and bot socket was stopped afterward. Old test databases and consistent original-lobby backups are retained privately under Git-ignored `bot-runs/`; another invocation starts a fresh world. No real accounts or ledger data were deleted.

## Actual gameplay

Run: `bot-runs/gameplay-2026-10-14T11-59-06-616Z/`.

40 distinct accounts registered and logged in normally. Bots walked from normal spawn, crossed authored district entrances, inspected nearby terminals and acquired contracts through the same public actions as players. Puzzle answers were derived independently from public evidence, with variable reading/thinking delays. No answer seeds, injected contracts, debug teleports or forced solved flags were used.

| Server-recorded outcome | Result |
| --- | --- |
| Paid Starter jobs | 40: ST-01 ×19, ST-02 ×10, ST-03 ×11 |
| Paid Standard jobs | All 40 prizes: four clears for each SD-01 through SD-10 |
| Paid Expert jobs | All five prizes: EX-01 through EX-05 |
| Practice clears | 239 |
| Race clears | 14 entrants completed RC-01; 3 finite prizes awarded |
| Total accepted attempts | 338 |
| Answers accepted before five-second paid minimum | 0 |
| Duplicate accepted attempts | 0 |
| Movement | 61,156 sent / 61,156 ACKed; zero rejects |
| Protocol failures / unexpected disconnects | 0 |
| Bank | 10 deposits, 10 withdrawal requests and all 10 arrivals |
| Safehouses | 10 own-Home entries and 10 exits |
| Voluntary Checkout | All 40 operators completed Checkout |
| Final schedule | Automatic frozen/settled phase reached |
| Ledger | 170 rows; conserved 400,000 paise (₹4,000); reconciled hash chain and nonnegative integer balances |

The final payout account held 170,000 paise (₹1,700), matching 40 Starter rewards, 40 Standard rewards, five Expert rewards and the first race's three prizes. This is test-world accounting, not an external payment transfer.

The original run's bot progress/summary `training` counter included its race clears because both public views have reward 0. The **239 practice / 14 race split above comes from accepted server records in `authority-audit.json`**, not that progress counter. The runner now reports separate counters for future runs. Tiny retained Bank balances rounded the holding fee to zero in this run; nonzero-fee behavior was not established by this workload.

### Queue behavior was exercised, not inferred only from source

Four operators simultaneously held the four SD-01 paid slots. Two additional operators queued FIFO on one occupied slot. Another operator acquired and completed independent training at that same terminal while the paid slots were occupied.

- A voluntary release offered the slot to the first waiter, with the normal 30-second acceptance window. The waiter accepted and solved it.
- That successful solve consumed the paid prize slot and cleared its queue; it did **not** give a second paid copy to the next waiter.
- On another occupied slot, a deliberately missed offer expired and passed to the next waiter. That waiter accepted and solved successfully.
- All four wave-one SD-01 slots were ultimately claimed exactly once.
- An operator reconnected inside the ghost window with the same entity and exact authoritative position.

An earlier eight-player, 150-second integration run also passed these controlled cases and acknowledged all 2,179 moves. That short run did not reach final settlement; its report is retained separately at `bot-runs/gameplay-2026-10-14T11-56-12-764Z/`.

## Performance evidence — keep the workloads separate

Development hardware: **i7-13650HX, 20 logical CPUs, approximately 16 GiB RAM**, Windows, Node 22.19.0. Bots and each owned server ran on the same PC. These are **not measurements from the intended i5 lab host or its LAN/VM**.

The full gameplay run observed seven scheduling/catch-up overruns and a worst operator ACK p99 of **172.6 ms**. Server RSS peaked at **113.8 MiB during sampled gameplay**; peak sampled rolling tick-execution p99 was **4.313 ms**. Functional acceptance passed, but this run is **not a zero-spike latency certification**. Other development processes and regression tests were active during parts of it; the observed stalls' cause has not been proven.

The separate infrastructure smoke suite ran afterward, with 40 operators in each 45-second steady traffic layout, plus authentication, correctness checkpoints and reconnect storms:

| Dedicated load layout | Worst operator ACK p99 | Peak sampled tick p99 | Peak steady RSS | Steady/reconnect overruns | Gates |
| --- | --- | --- | --- | --- | --- |
| Crowded | 64.3 ms | 5.141 ms | 86.8 MiB | 0 | PASS |
| Spread across all 19 scenes | 64.1 ms | 6.115 ms | 84.3 MiB | 0 | PASS |

Both layouts had zero malformed packets, backpressure events, rate-limit drops, replica differences or unexpected disconnects. Every operator resumed at the exact position/entity. Authentication-burst RSS peaked around **338.5 MiB**, higher than steady play. Short smoke tests do **not** establish long-term memory stability.

Infrastructure report: `bot-runs/hosting-2026-10-14T12-09-50-461Z/report.md` and `summary.json`.

## Scope and limits

- The gameplay run used the supported **ten-minute milestone timeline**. Locks, answer cooldowns, movement, withdrawals and raid durations stayed real-time. A three-hour normal-timeline event was not certified.
- Paid acquisition/solving covered all 18 ordinary job templates, plus RC-01. RC-02/RC-03 solver variants passed unit checks but their live race entry/prize branches were not exercised in this run.
- Burglary, Golden Hour acquisition, simultaneous raid crews/results, capped-player branches and network faults were not certified by this gameplay run. Existing regression tests are separate evidence, not a substitute for full live crews.
- Protocol agents do not establish browser FPS, UI controls, player decision quality, Wi-Fi behavior or i5/VM headroom. The earlier screenshot playthrough exercised the actual workbench controls separately.
- Regression suites passed **283 tests**: 71 bot, 112 server, 100 shared. Public solver tests also exercised 690 generated variants using an oracle confined to tests, never imported by the executable player logic.
- The test runner, documentation and audit tools were changed; production game rules, economy, maps and UI were not changed by this testing task.

## Repeat safely

```powershell
npm run build
npm run bots:gameplay
# Use the printed run directory, after its server has stopped:
npx tsx tools/audit-gameplay-run.mts bot-runs/gameplay-TIMESTAMP
npm run bots:hosting -- --profile=smoke
```

See [the gameplay bot guide](GAMEPLAY_BOT_TESTING.md) and [the hosting-PC guide](BOT_TESTING.md) for normal-clock testing and actual-host/LAN certification. Private fixture passwords, organizer secrets and database backups must not be committed or uploaded publicly.
