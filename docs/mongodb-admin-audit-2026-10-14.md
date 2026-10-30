# MongoDB and staff deployment audit — 14 October 2026

## Deployed

- Whole persistent world moved to Atlas database `heist_zero_hour`: 85 original accounts/password hashes, 97 original sessions, 85 positions, existing event state, nine ledger transfers and complete answers/requests/notices history.
- Original SQLite files retained; consistent pre-migration snapshots and report are in private `bot-runs/before-mongo-C8hg8e/`.
- Migration and a post-deployment comparison verified the original ledger rows byte-for-field equivalent. The ₹4,000 pool remains balanced. Existing event was already frozen; no production Reset or Start was performed.
- Provisioned one super-admin and three challenge-review admins, with distinct random Argon2-hashed passwords. Credentials are in an ignored private file, not source or frontend assets.
- Production HTTP/WebSocket/frontend listens on `0.0.0.0:8080`; Vite listens on `0.0.0.0:5173`. Host-LAN requests succeeded at `192.168.1.108` on both ports. Firewall settings were not changed; another physical PC has not been tested.

## Evidence

- Build: shared, server, client and bots passed.
- Unit/integration suites: 121 server tests, 100 shared tests, 71 bot tests passed.
- Isolated real Atlas QA report: `bot-runs/mongo-admin-qa-yM5zeA/report.json`. Passed role boundaries/public signup escalation protection; all 42 challenge templates and 17 workbenches; private unpaid staff solve; real paid WebSocket contract with 93 acknowledged moves; immutable archive/reset; surviving accounts/sessions; stale-reset rejection; atomic organizer audit; stale snapshot rejection; new-authority recovery and balanced ledger.
- Post-deployment audit: `bot-runs/admin-access-PO2lzB/deployment-report.json`. All four real staff logins and 42-template access passed. Three regular admins were denied world controls. Original account hashes and ledger contents matched the retained source.
- Browser QA: super-admin right-side button, staff observer HUD, typed reset safeguard, regular-admin vault without reset controls, catalogue search, code solution, debugging repair/simulation/solution, machine probe counter/solution, LAN Vite proxy and actual staff movement verified.
- Screenshots: `screenshots/admin-mongodb-2026-10-14/` contains actual browser captures of the city control button, vault, reset safeguard and server-verified code challenge.
- `npm audit --omit=dev`: zero vulnerabilities. Existing development-tool audit findings were not forcibly upgraded across a major version.
- `.env` and private credential artifacts are Git-ignored. Private database URI absent from built frontend output.
- LAN Vite file access is restricted to the client, shared package and dependencies; private environment files, bot credentials, data directories and database files are explicitly denied. Actual LAN requests for private files returned 403.

## Boundaries

This is LAN deployment, not internet publication. Atlas depends on outbound internet connectivity and its configured access list. The old 40-player smoke/hosting suites use isolated SQLite fixtures; they do not certify Atlas throughput or a three-hour lab session. Reset was exercised only on the explicitly isolated Atlas QA database, never on the saved production game. Rotate the database password disclosed in chat and update the private `.env` before an event.

Follow [setup, roles, migration, Reset and persistence details](MONGODB_AND_ADMINS.md) and [LAN hosting instructions](LAB_HOSTING.md).
