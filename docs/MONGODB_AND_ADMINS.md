# MongoDB world and staff accounts

## First-time setup

1. Install Node 22.19+; from the repository root run `npm ci` and `npm run build`.
2. Copy `.env.example` to `.env`. Privately set `DATABASE_BACKEND=mongodb`, `MONGODB_URI` and `MONGODB_DATABASE=heist_zero_hour`. The URI is server-only. Git ignores actual `.env` files and `bot-runs/`.
3. In Atlas, allow the host's outbound public IP and grant the database user read/write access to the chosen database. Use a strong password; rotate any password that was shared in chat. Do not use an unrestricted IP allowlist as a workaround.
4. For existing SQLite saves, perform the migration below **before** creating staff accounts. For an empty world, skip migration.
5. Run `npx tsx tools/provision-admins.mts --create-four-staff-accounts` once. It creates four Argon2-hashed accounts with distinct random passwords and prints the path to `bot-runs/admin-access-*/credentials.json`. Keep that private file safe; distribute each admin only their own login. This command refuses existing usernames; it cannot promote or replace a public account.
6. Run `& .\tools\host-lab.ps1`. Sign in to the game normally with a staff login. The right-side button appears only after the server authenticates its role.
7. Players use `http://HOST-LAN-IP:8080/` and distinct accounts. The host serves frontend, artwork, API and WebSocket; player PCs do not install anything. Port 5173 is development-only. Follow [LAN/firewall setup](LAB_HOSTING.md); do not expose either server publicly without HTTPS/WSS and appropriate network controls.

| Account | Rights |
| --- | --- |
| Player | Normal movement and server-validated paid gameplay |
| `heist_admin_1`, `heist_admin_2`, `heist_admin_3` | Right-side challenge vault: all 42 templates and all 17 workbenches, at any event phase |
| `heist_superadmin` | Challenge vault plus Start, Freeze/settlement, announcements, occupied-lock release, roster/audit view and Reset |

Staff preview copies are personal, unpaid and do not count toward raids, Homes, rankings or completions. They reuse the actual challenge generators/validators and workbench UI, rather than bypassing validation. Staff can observe the city without enrolling for prizes. There are four separate staff network slots in addition to the 40-player cap. Public registration ignores supplied role fields. Every protected endpoint checks the database role, not a client flag.

## Offline migration of the existing saved world

1. Stop the existing server and all backend watchers. Do not run a live SQLite and Mongo writer against the same world.
2. Configure the root `.env` for an **empty** MongoDB target.
3. From the repository root run `npx tsx tools/migrate-mongodb.mts --confirm-stopped-server`.
4. The importer takes consistent SQLite snapshots into a private `bot-runs/before-mongo-*` folder, verifies the ledger, and imports accounts/password hashes, sessions, saved coordinates, full event state and all four history tables in one transaction. It refuses a nonempty target and never overwrites the source SQLite files. Read its `migration-report.json`.
5. Provision staff, then launch the Mongo-backed server. Existing accounts and sessions remain valid. The prior event's phase and timeline are retained; migration does not reset or start it.

Reset is separate from migration: type `RESET` in the super-admin control panel and confirm the dialog. It archives the current event state and retains its append-only ledger/history, starts a fresh lobby with zero operator balances, clears locks/challenge progress, returns players to spawn and reconnects them. Account logins remain valid. Start the new round separately when ready. A stale event confirmation cannot reset a newer round. Old position snapshots cannot overwrite reset positions.

## Persistence and failure behavior

MongoDB is the persistent authority for `players`, `sessions`, `player_state`, `event_current`, `event_records`, `event_archives`, `staff_audit`, `runtime_leases` and migration records. Event state and ledger changes use majority-acknowledged transactions, serialized through one writer with a renewable lease and revision checks. Organizer actions are audited in the same commit. In-memory SQL is only a transactional scratch simulator for the existing rule engine; Mongo mode does not persist to local SQLite databases. See [MongoDB transaction documentation](https://www.mongodb.com/docs/drivers/node/current/crud/transactions/).

Atlas requires internet access even when all players are on the LAN. If durable authority fails, financial actions are rejected rather than acknowledged or paid locally. Restart after restoring connectivity to reacquire authority. Movement is not blocked on Atlas writes; positions are coalesced every ten seconds and on disconnect/shutdown, so an abrupt host crash may lose recent movement, not acknowledged ledger transactions. A second host using the same world is rejected while the first owns its lease. Never change a production database name to work around a lease error.

## Verification

`npm run test:server` covers authorization, unpaid/private previews, public signup escalation, staging rollback, existing economy/queues and a 40-player local smoke. `npx tsx tools/test-mongo-admin.mts --confirm-remote-qa` creates a distinctly named `heist_admin_qa_*` database using the configured Atlas credentials. It checks all 42 previews, a real paid WebSocket solve, archived Reset, staff audit, stale snapshot rejection and recovery from a fresh authority instance. It never targets `heist_zero_hour`; QA databases/reports are retained for inspection rather than silently deleted.

The previous hosting/gameplay bot suites explicitly use isolated SQLite fixtures even if `.env` is configured for Atlas. Their results are **not an Atlas throughput certification**. Run an isolated Mongo workload on the actual host/network before a real prize event; Atlas tier/latency and internet reliability matter in addition to the i5/16 GB specifications. Never load-test a prize event with real users or reset its balances for testing.
