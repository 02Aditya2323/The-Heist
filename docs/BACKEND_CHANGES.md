# Backend work delivered

This summarizes the changes made while upgrading the existing teammate backend,
including earlier commits and the MongoDB/admin/playtest release on 14 October
2026. The original shared binary protocol, authoritative movement and map/collision
contracts were retained, not replaced.

## Gameplay and event authority

- Added the Zero Hour event engine: lobby/live/frozen phases, scheduled job waves,
  finite paid slots, per-operator eligibility, deadlines and final settlement.
- Implemented the approved 40-player economy: Starter ₹10, Standard ₹20, Treasury
  ₹300, conserved ₹4,000 pool, and Bank holding fee of 0.1% per minute.
- Added Home ownership, banking/deposit transit, five-minute withdrawals, raids,
  races, burglary/custody/capping and Golden Hour operations. Voluntary Checkout
  opens at minute 150. Raid crew size is eight below 36 event-start registrations,
  otherwise ten. An active raid retains the approved 10% withdrawal reserve.
- Added the final-book/workbook challenge catalogue: 42 templates, 17 workbench
  kinds, generated variants, server validators, reading/answer readiness,
  cooldowns and bounded machine/debug probes. Answers and generation seeds are
  not included in normal public event views. This is **not** a guarantee that
  every player receives globally unique questions; generated variants can repeat.
- Standard/Expert claims use paid-slot locks and FIFO queues. Released/expired
  holds offer the next eligible waiter a limited acceptance window; a successful
  solve consumes the prize slot rather than giving everyone in its queue a prize.
- Removed player training acquisition and submissions server-side, including
  legacy copies/probes. Historical credits/balances remain intact; unpaid,
  role-protected staff previews are intentionally separate.
- Added compact, authenticated completion history with district/station/Home
  locations, retained beyond the old five-minute solved-card window. The frontend
  uses it for its checklist; it contains no solutions.

## MongoDB persistence and administration

- Moved persistent players, password hashes, sessions, positions, current event,
  ledger/history, archives and staff audit to MongoDB Atlas. SQLite is retained
  for isolated test fixtures and non-persistent transactional event simulation;
  it is not the durable store in MongoDB mode.
- Added a serialized writer, renewable world lease, revision checks, majority
  transactions and rollback/staging before successful actions are acknowledged.
  Database failure rejects financial actions; a second host cannot concurrently
  own the same world. Position saves are coalesced and reject stale batches.
- Added an offline, empty-target-only migration tool preserving existing account
  hashes, sessions, coordinates and event history, with retained source backups.
- Added database-backed player/admin/superadmin roles. Public signup cannot assign
  itself a privileged role. Staff have four separate network slots and do not
  occupy player Homes, prize slots or raid crews.
- Provisioned one superadmin and three review admins with distinct random hashed
  passwords. Credentials stay in ignored local artifacts, not in Git.
- Added authenticated catalogue/private-preview APIs and superadmin Start,
  Freeze/settlement, announcements, lock release, roster/history/audit and Reset.
  Reset requires typed confirmation and the current event key; it archives the
  old event, retains accounts/history, clears progress/locks/balances, returns
  operators to spawn and reconnects them. A stale confirmation is rejected.

## Networking, performance and hosting

- Kept the built frontend, artwork, HTTP APIs and WebSocket on one host/port 8080,
  with a production LAN launcher and distinct-account setup instructions.
- Added CPU/RSS, event-loop, tick, traffic, backpressure and replica metrics.
- Cached bounded public challenge presentations and reduced repeated view and
  transaction work. The measured 40-view preparation benchmark improved from
  30.689 ms median to 4.376 ms; this is a workload-specific result, not an overall
  game speedup guarantee.
- Yielded reconnect/presence work between clients and protected against stale
  disconnects, queued shutdown admissions and ghost movement, preserving durable
  accounting and the shared packet protocol.
- Added smoke/lab/soak hosting tests and actual gameplay bots with independent
  public-evidence solvers, navigation, queue/reconnect/banking/settlement checks.
  Test worlds are isolated from the saved prize database and private reports are
  Git-ignored. See the audits for precisely which operations were exercised.
- Added an official-SDK ngrok HTTPS tunnel to the currently running server. The
  existing frontend automatically uses WSS on that origin. Edge policy allows
  player APIs/assets/socket only and blocks staff HTTP/debug/metrics/editor paths,
  including encoded Windows path traversal. The tunnel does not reset the event.

## Verification and limits

The 14 October release build and regression run passed **294 tests**: 123 server,
100 shared and 71 bot tests. The contract-history/overlapping-travel UX check also
passed. Earlier isolated Atlas QA exercised migration/roles, real paid WebSocket
solving, archives, stale-reset protection, rollback and recovery.

The current public tunnel was checked for HTTP/assets/map/event delivery, visible
browser login and WSS upgrade with correct invalid-token rejection. This does
not certify a remote two-player playthrough. Likewise, earlier load results were
measured on an i7 development PC and isolated SQLite fixtures, **not** on the
proposed i5 lab PC/VM or Atlas at 40-player load. Atlas internet reliability,
latency/tier and the actual host still need event-day certification. An abrupt
host crash can lose recent position movement; acknowledged ledger transactions
are durably committed.

Further detail:

- [MongoDB setup, migration, role boundaries and resets](MONGODB_AND_ADMINS.md)
- [Hosting measurements and limitations](hosting-performance-audit.md)
- [Gameplay bot evidence and coverage](gameplay-bot-audit-2026-10-14.md)
- [Training removal audit](training-removal-audit-2026-10-14.md)
- [Public tunnel setup](NGROK_PLAYTEST.md)
