# The Heist — Zero Hour: complete project handoff

Prepared **16 October 2026 (Asia/Calcutta)** from the current working tree.
Audience: the next developer, hosting administrator and event organizer.
This document contains no live credentials and can be shared with the team.

## 1. Read this first: release and deployment status

The repository implements a playable, server-authoritative multiplayer technical
challenge event. It is not just a frontend prototype. The city, movement,
challenge workbenches, economy, competition, persistence and staff controls are
implemented. That does **not** mean the intended Azure event is already deployed
or certified at 40-player load.

At this handoff:

- Local branch: `main`.
- Committed HEAD: `839157c3e6229c30fe35212cbf9fb6f7bf325230`.
- Local `origin/main` tracking ref matches that commit; the remote was not freshly
  fetched for this handoff.
- **The Azure/Nginx deployment work, its supporting server changes and this
  handoff are uncommitted local changes.** A GitHub clone of that commit does
  not contain them. Review and commit/push the release, or securely transfer the
  reviewed updated source, before someone follows the new VM instructions.
- No Azure provisioning, DNS/firewall change, public certificate issuance or VM
  service installation has been performed by this preparation work.
- No local listener on 8080 or 5173 was observed during this handoff check. This
  does not establish the status of a VM or a server started elsewhere.
- No saved event was started/reset, no live accounts were modified and no
  production MongoDB load test was run for this handoff.

The deployment direction selected by the owner is **one Ubuntu Azure VM,
Nginx + Certbot, MongoDB Atlas, no ngrok**. The Windows lab/ngrok tools remain
optional alternatives, not requirements for that VM.

## 2. Product and source-of-truth decisions

Players explore Veyra City, find technical challenge terminals, earn limited
prizes into their Homes, protect or move their money, and compete in timed
activities before final settlement. The experience uses Pokémon Emerald-like
four-direction navigation, a following camera, nearby interaction and readable
menus, with the supplied/generated city-art style rather than Pokémon artwork.

Apply requirements in this order when older documents disagree:

1. Current explicit owner decisions and repository `AGENTS.md` engineering rules.
2. The final challenge book/workbook and the approved overrides summarized here.
3. Current implementation, tests, current README and operational guides; report
   discrepancies rather than silently treating a bug as a new design decision.
4. Older milestone handoffs/audits as historical evidence only.

Original requirements/materials retained in the repository:

- `THE_HEIST_ZERO_HOUR_Team_Game_Document_FINAL.md`: original overall design.
- `The Heist Zero Hour Challenge Book (Final).pdf`: final challenge specification.
- `The_Heist_Challenge_Tracker_and_Money_Plan.xlsx`: catalogue and money plan.
- `THE_HEIST_ZERO_HOUR_Visual_Reference_Pack/`: original art references.

The source PDF and workbook hashes were checked again for this handoff and match
`docs/final-challenge-book-audit.json`; neither source document was altered.

**Superseded requirements:** older 85-player assumptions, persistent SQLite as
the deployed authority, player training, anytime voluntary Checkout, fixed
10-person raids, and the old statement that no in-game reset exists. Do not
reintroduce those while following historical notes.

## 3. What has been implemented

| Area | Current implementation |
| --- | --- |
| World | 19 scenes, regenerated artwork, reviewed CV-assisted collision, server-validated travel, 90 Home sites |
| Frontend | Canvas game, camera, keyboard/touch movement, HUD, nearby interaction menus, city atlas, journal, completion checklist |
| Challenges | 42 templates, 17 workbench types, generated variants, private server validators, scratch tools and timing feedback |
| Competition | Starter/Standard/Expert jobs, paid locks/FIFO queues, burglary/custody, raids, races, Golden Hour |
| Economy | Conserved paise ledger, Homes, Bank, transit/withdrawals/reserves, fees, wealth limits, Checkout and final settlement |
| Multiplayer | Password login, authoritative binary movement, prediction/reconciliation, spatial visibility, reconnect/ghost handling |
| Persistence | Atlas accounts, sessions, positions, event state, transaction/history records, archives, staff audit and world lease |
| Administration | Three challenge-review admins and a superadmin with protected event controls/reset |
| Hosting | Single built frontend/API/WebSocket origin; Windows lab launcher; locally prepared Ubuntu/systemd/Nginx deployment |
| Testing | Shared/server/bot regressions, UI model checks, isolated player agents, historical load harness and local encrypted proxy smoke |

"Implemented" is not a claim that every challenge's difficulty, every human
strategy, or the actual Azure/Atlas capacity has been playtested end to end.

## 4. Repository and architecture

```text
Player browser
  └─ HTTPS / WSS → Nginx on the VM (80 redirects; 443 serves players)
       └─ private HTTP / WS → Node on 127.0.0.1:8080
            ├─ built frontend + artwork + public API
            ├─ authoritative movement / spatial replication
            └─ event engine → serialized Mongo authority → MongoDB Atlas

Organizer browser → local SSH port forward → private Node staff endpoints
```

One authoritative backend owns one world. There is no distributed game-state
coordinator. Do not run multiple Node workers/PM2 cluster replicas against the
same world or run the lab backend while the VM owns that database.

| Path | Responsibility / main entry points |
| --- | --- |
| `apps/client/src/main.ts` | Frontend startup and wiring |
| `apps/client/src/net/` | API/WebSocket backend adapter and typed events |
| `apps/client/src/game/` | Store and game systems |
| `apps/client/src/engine/` | Input, movement prediction, camera and nearby choices |
| `apps/client/src/render/` | Canvas artwork rendering and visual layers |
| `apps/client/src/ui/` | HUD, atlas, terminal cards, journal, workbenches, checklist and staff panels |
| `apps/server/src/main.ts` | Environment, persistence, map, HTTP/WS, tick and shutdown wiring |
| `apps/server/src/world/` | Entities, chunks, collision-checked movement and proximity |
| `apps/server/src/net/` | Connections, binary protocol lifecycle and admission |
| `apps/server/src/game/event-engine.ts` | Gameplay rules and transactional event simulation |
| `apps/server/src/game/rules.ts` | Money, limits and schedule constants; paise internally |
| `apps/server/src/game/final-challenges.ts` | Private question generation and answer validation |
| `apps/server/src/game/challenge-catalogue.ts` | Public 42-item metadata; not an answer bank |
| `apps/server/src/game/mongo-authority.ts` | Durable event commits, lease, revisions, archives/reset |
| `apps/server/src/game/runtime.ts` | Scheduling, action execution, broadcasts and resets |
| `apps/server/src/persistence/` | Mongo/SQLite repository implementations and position snapshots |
| `apps/server/src/http/` | Player authentication, map/status, protected staff/organizer routes and static assets |
| `packages/shared/src/` | Sole protocol, map, movement, chunk/path math, role and event-type contract |
| `apps/bots/src/` | Legacy harness, hosting suite, current paid-gameplay agents/solvers |
| `maps/` | Authoring plans/reviews, canonical generated world and collision reports |
| `apps/client/public/art/` | Runtime scene artwork, previews, atlas art and manifest |
| `docs/`, `screenshots/` | Specifications/audits and historical visual/playthrough evidence |
| `tools/` | Authoring, QA, deployment, migration and administration utilities |
| `deploy/azure/` | Safe environment example, systemd service, Nginx templates/snippets and renewal hook |

### Non-negotiable implementation contracts

Read `AGENTS.md` before editing. In particular:

- Only `@heist/shared` supplies packet codecs, map decoding, movement and chunk
  math. No private/custom byte codecs or alternative collision simulation.
- `DIR.UP=0`, `DOWN=1`, `LEFT=2`, `RIGHT=3`; use enum names.
- Movement is disabled before WELCOME. Cadence comes from WELCOME's tick values,
  not fallback constants. At most two predicted moves may be pending.
- Blocked local movement turns the sprite but sends no MOVE/cooldown. ACK,
  rejection, teleport, reconnect and disconnect must follow the documented
  prediction-reset/reconciliation rules. No catch-up bursts.
- PING heartbeat every 2,500 ms through the shared encoder.
- Data flows Network → Store → Systems → Renderer/UI. UI never owns a socket or
  decides rewards, balances, validation results or authoritative positions.
- Keep artwork, collision, spawn, POI and gate metadata inspectable and aligned.

## 5. World, atlas and functional centres

The current canonical manifest is **v30**, 333×390 world tiles, 32 native source
pixels per tile. There are 6 districts, 7 connectors and 6 housing wards; 124
hotspots comprise 27 district POIs, 7 connector kiosks and 90 Home addresses.
There are 44 directed gates and 15 route records. The compact visual atlas has
22 joins, corresponding to the 44 reciprocal gate directions—not 22 route records.

| District | Centres / purpose |
| --- | --- |
| Central Exchange | Central Bank; Race Terminal; Checkout; Leaderboard; Raid Circle |
| Tech Quarter | Tech Job Board; CP Lab; Debugging Lab; Logic Terminal |
| Data Harbor | Harbor Job Board; Data Centre; Network Tower; OSINT Terminal; Code Review Desk; Harbor Information |
| Black Grid | Black Grid Job Board; Security Hub; CTF Arena; Challenge Terminal; Sandbox Station |
| Undercity | Undercity Information/Home directory; Local Market; linked Wards A–F with H001–H090 |
| NEXUS Plaza | NEXUS Announcements; Social Hub; Golden Hour Terminal; Event Terminal; NEXUS Information |

Job boards aggregate that district's job stations. Information, market, security
and social markers are information locations; their presence does **not** imply
an implemented item shop, combat system or private messaging service. Code Review
Desk retains internal handler ID `sql` for compatibility; new challenges are not SQL.

The seven connectors, each with a route information kiosk:

- c07 Exchange ↔ Tech; c08 Exchange ↔ Harbor; c09 Exchange ↔ Black Grid.
- c10 Exchange ↔ Undercity; c11 Exchange ↔ NEXUS.
- c12 Tech ↔ Harbor; c13 Undercity ↔ Black Grid.

Wards A–C provide active assignments for the 40-player plan; D–F remain preserved
reserve streets. Each ward has 15 physical sites. The six wards reuse a housing
texture but have distinct world coordinates, addresses and travel links.

**Atlas versus gameplay:** M shows a compact artwork mosaic with scenery infill,
zoom/pan, native-detail view, Find me, POIs and Homes. It is not a seamless new
walkable overworld: empty server address space is projected out, scenery infill
is decorative, and travel still uses E at authoritative gates. Where a terminal
and gate overlap, the choice menu explicitly offers both actions.

### Artwork/collision authoring

- Current playable artwork is regenerated v2 art, not the untouched original
  reference pack. `docs/generated-world-v2/` retains the generated source images.
- `maps/art-world-v2.plan.json` and the staged layout describe intended geometry;
  `maps/art-world-v2.review.json` holds reviewed actual obstacles/approaches.
- OpenCV runs **offline**: pavement classification, morphology and standing-foot
  erosion are constrained by reviewed solid/water exclusions and connected floor.
- Builds reject stale source/collision fingerprints and blocked critical markers.
  This is supervised CV-assisted authoring, not perfect automatic segmentation.
- `maps/art-world.json` is the server world; `apps/client/public/art/world.json`
  is the client manifest. Use the builder/shared loader to keep them consistent.
- Rendering draws native artwork to the display canvas; it does not reduce the
  scene to the old tiny pixel buffer. Small visual/footprint edges still deserve
  human review. A reviewed overhead arch has a separate foreground layer.
- **Do not run map generators to install the game.** `gen-map`/`gen-city-map`
  are legacy generators and can overwrite other map files. Follow
  `WORLD_BUILD_AUDIT.md` only when intentionally authoring a new world revision.

## 6. Player-facing UX

| Action | Control |
| --- | --- |
| Movement | WASD/arrows or touch pad |
| Nearby terminal/Home/travel | E or interaction button; choose explicitly if several are nearby |
| Complete city atlas | M / City maps |
| Active workbench journal | J / Operator journal |
| Completed challenges with locations | Right-side ✓ Checklist |
| Close menu | Escape / Close |
| Diagnostics / collision overlay | F3 / F4 |

The terminal shows available jobs, not a giant solved card. Completed paid jobs
leave Available contracts and have compact history; the checklist retains their
district/station location for the current round and survives refresh. Reset
begins a fresh checklist. No answers are included in completion history.

There are **17 workbench kinds**: code, debug, cipher, deduction, logs, machine,
portal, maze, tree, ring, order, lights, statements, oracle, circuit, courier and
constraints. Their console layouts provide relevant boards/tools, instructions,
server-time readiness feedback, scratch notes and a safe arithmetic calculator.
Code puzzles are tracing/repair exercises, not an arbitrary remote code runner.

Some notes/interactive drafts use session storage; not every text field survives
reload (some terminal drafts only survive reopening in the same tab). Do not
promise cross-device draft synchronization. The portal is a fictional puzzle:
players must not enter real credentials there. Optional game sound defaults off.

**Player training is disabled in both UI and server validation.** Legacy saved
training history/data can remain, and a few old labels/docs still mention it.
Those references do not make training available. Staff previews are separate,
role-protected and unpaid. Generated variants can repeat across players or
attempts; there is no globally unique, exhaustible question-bank guarantee.

## 7. Approved event/economy behavior

Source constants: `apps/server/src/game/rules.ts`; values are integer **paise**.

| Rule | Current setting |
| --- | --- |
| Event / enrollment | 180 minutes by default; at most 40 enrolled operators |
| Conserved starting pool | ₹4,000; transfers must reconcile, no client minting |
| Starter | ₹10; one paid Starter claim per operator, not one of each Starter |
| Standard | ₹20; 8 slots per wave, 4 each for two specified templates |
| Expert | ₹80; one scheduled paid slot per template release |
| Treasury | Initial ₹300 |
| Bank | Opens minute 10; maximum ₹200; fee 0.1% per real minute, rounded to paise |
| Withdrawals | Five minutes; active-raid 10% reserve retained until raid result; unused reserve returned |
| Voluntary Checkout | Opens minute 150; permanent score sealing, with eligibility/transit checks |
| Raid crew | Fixed at Start: 8 if fewer than 36 enrolled, otherwise 10 |
| Raid qualification | Five prior completions and 60-second circle hold; each crew member gets 5 questions; 2 clears pass that member; 5 passing members succeed |
| Paid locks / offers | Standard 6 min, Expert 10 min; FIFO offer acceptance 30 sec; at most 2 queues/operator |
| Answer guard | Minimum 5 sec; ordinary answers 5 sec apart; 3 wrong causes 60-sec lockout; special keypad/courier rules differ |
| Wealth cap / reactivation | ₹800 / below ₹600, with server-side eligibility checks |
| Economic offline grace | 10 min; separate from network ghost resume |
| Late enrollment cutoff | Minute 120 in normal event schedule |

Initial allocation: Starter ₹400, Standard ₹800, Expert ₹400, races ₹300,
Golden Hour ₹300, raid seeds ₹400/₹400/₹700, Treasury ₹300. Fee vault/PAYOUT
begin at zero. Bank fees are transfers into the raid fee vault, not new money.

Normal schedule (minutes after Start):

| Activity | Releases / windows |
| --- | --- |
| Standard wave 1 | 0: SD-01 + SD-02 |
| Standard wave 2 | 20: SD-04 + SD-06 |
| Standard wave 3 | 50: SD-03 + SD-08 |
| Standard wave 4 | 80: SD-05 + SD-09 |
| Standard wave 5 | 120: SD-07 + SD-10 |
| Expert | 30 EX-01; 60 EX-04; 90 EX-02; 120 EX-05; 140 EX-03 |
| Races | 30, 90, 135 |
| Golden Hour | 70, 115, 165 |
| Raid windows | 45–90; 90–135; 150–175 (final crew deadline 160) |
| Burglary window | 40–175 |
| Checkout / final end | 150 / 180 |

`EVENT_DURATION_MINUTES` can scale milestone dates for rehearsal, but movement,
job locks, answer waits, raid durations, Bank fee cadence and five-minute
withdrawals retain independent real-time durations. A ten-minute bot run is not
a full three-hour timing certification.

### What "0 eligible paid slots" means

Eligibility is computed by the server for the operator, event phase, schedule,
remaining prizes and current locks/completions. A visible catalogue template
does not mean its prize is open. In particular EX-02 is scheduled at minute 90;
a fresh lobby/early round does not make it immediately claimable. Inspect the
organizer status, not just whether a reset happened.

### Concurrent players and queues

There is no global one-player-per-building queue. Operators can use independent
Starters and available paid slots concurrently; races have simultaneous entrants.
An eligible request for a fully held Standard/Expert template can queue FIFO.
Released/expired holds offer the slot to the next eligible waiter. **A successful
solve consumes the prize slot and clears its queue**; the next player does not
get the same prize automatically. Burglary, courier and raid exclusivity are
separate mechanics. Shared player coordinates alone do not lock a terminal.

PAYOUT records software settlement only. The game does **not** send real bank,
UPI or other payments. The organizer must decide and communicate payout method
and minimum, and carry out actual payments outside the game.

## 8. Challenge catalogue (all 42)

| ID | Title | Acquisition location |
| --- | --- | --- |
| ST-01 | Receipt Total | CP Lab |
| ST-02 | Broken Receipt | Debugging Lab |
| ST-03 | Gate Cipher | Logic Terminal |
| SD-01 | Peak Reading | CP Lab |
| SD-02 | Lonely Packet | Data Centre |
| SD-03 | Robot Route | CP Lab |
| SD-04 | Patch the Meter | Debugging Lab |
| SD-05 | Fence Count | Code Review Desk (`sql`) |
| SD-06 | Password Profiler | CTF Arena |
| SD-07 | Log Hunter | Challenge Terminal |
| SD-08 | Decode Chain | Network Tower |
| SD-09 | Fare Gate | Logic Terminal |
| SD-10 | Who Moved the Money | OSINT Terminal |
| EX-01 | Door and Key | CP Lab |
| EX-02 | Chain of Command | Data Centre |
| EX-03 | Ghost in the Counter | Debugging Lab |
| EX-04 | Gatekeeper | Sandbox Station |
| EX-05 | Portal Peek | Sandbox Station |
| BG-01 | Code Oracle | Eligible Home door, level 1 |
| BG-02 | Maze Lock | Eligible Home door, level 2 |
| BG-03 | Circuit Lock | Eligible Home door, level 3 |
| RC-01 | Sprint: Fare Sum | Race Terminal |
| RC-02 | Sprint: Bug Hunt | Race Terminal |
| RC-03 | Sprint: Decode | Race Terminal |
| GH-01 | Key Card | NEXUS Plaza map keycards |
| GH-02 | Courier Interrogation | Moving NEXUS courier |
| GH-03 | Server Sprint | Golden Hour Terminal |
| BR-01 | Tunnel Network | Raid Circle |
| BR-02 | Double Login | Raid Circle |
| BR-03 | Cipher Relay | Raid Circle |
| BR-04 | Ghost Log | Raid Circle |
| BR-05 | Org Chart | Raid Circle |
| BR-06 | Combination Clues | Raid Circle |
| BR-07 | Self-Checking Vault | Raid Circle |
| BR-08 | Broken Tally | Raid Circle |
| BR-09 | Deploy Order | Raid Circle |
| BR-10 | Constraint Vault | Raid Circle |
| BL-01 | Ledger Running Total | Final raid / Black Ledger |
| BL-02 | Triple Cipher | Final raid / Black Ledger |
| BL-03 | Shadow Ring | Final raid / Black Ledger |
| BL-04 | Warden Script | Final raid / Black Ledger |
| BL-05 | Broken Router | Final raid / Black Ledger |

Private generators/expected answers remain on the server. The browser submits
answers or board evidence, which the server validates/replays. Machine probes and
special guesses are bounded by the server. These safeguards are not protection
against screenshots, outside assistance or AI solving.

## 9. Accounts, sessions, positions and database authority

- Public signup creates players only; supplied privilege fields cannot grant staff.
- Passwords are Argon2-hashed. One active session connection per account means a
  second window can replace the first; use separate accounts for multiplayer.
- The browser keeps its session token in session storage. It is private; do not
  share captured WebSocket URLs, HAR exports or raw logs containing it.
- Positions are **global** x/y/dir keyed by player ID, plus map version—not just
  local district coordinates. Tech local (26,14) is global (26,14); Data Harbor
  local (26,14) is global (306,14), given its (280,0) scene origin.
- The 30-second network ghost window can resume the live entity. After that,
  saved Mongo positions are used, subject to map/version/walkability checks.
- Movement snapshots coalesce every 10 sec and on disconnect/shutdown. A sudden
  host crash can lose recent movement; this is different from acknowledged money.

MongoDB persists `players`, `sessions`, `player_state`, `event_current`,
`event_records`, `event_archives`, `staff_audit`, `runtime_leases` and migration
records. Current event mutations use serialized, majority-acknowledged
transactions, revisions and a renewable single-writer lease. In-memory SQL is
transactional scratch for the rule engine, **not durable SQLite** in Mongo mode.
Database failure must reject financial actions rather than acknowledge a local
payment. Restore connectivity and recover/restart deliberately.

Stop the old backend before switching hosts. A crashed writer's lease needs
time to expire (30 seconds); never delete it or change the database name to
bypass a live writer. Atlas needs reliable internet even for LAN clients.

Old SQLite migration is offline, empty-target-only and backed up:
`npx tsx tools/migrate-mongodb.mts --confirm-stopped-server`.
Read [the full migration guide](docs/MONGODB_AND_ADMINS.md) first. Do not rerun
migration over the current Atlas world.

## 10. Staff and event operation

| Account | Rights |
| --- | --- |
| `heist_admin_1`, `heist_admin_2`, `heist_admin_3` | Personal unpaid reviews of all 42 templates / 17 workbenches, via right-side staff button |
| `heist_superadmin` | Reviews plus Start, announcements, Freeze/settlement, occupied-lock release, roster/audit/history and confirmed Reset |

Staff are observers, not prize participants; they have four separate network
slots and do not consume player Homes, paid prizes or raid crews. Public users
cannot activate staff access by changing frontend storage. Every protected API
checks the authenticated account's database role.

Staff provisioner (fresh world only):

```sh
npx tsx tools/provision-admins.mts --create-four-staff-accounts
```

It refuses existing usernames. Random credentials are written to a private
ignored `bot-runs/admin-access-*/credentials.json`; do not send that entire file
to all staff. Give each person only their own login through a secure channel.
For the VM's root-only external environment, use the exact `HEIST_ENV_FILE`
invocation in the Azure guide. No need to provision again when retaining Atlas.

Operational order:

1. Start the host services; check health, private DB connectivity and organizer access.
2. Verify the intended event/roster/phase and backups; a restart is not a reset.
3. If intentionally starting a new round, superadmin Reset requires typed `RESET`
   and current-event confirmation. It archives history, retains logins, clears
   balances/progress/locks, returns operators to spawn and reconnects them.
4. Let participants register/enroll. Start when ready; it fixes the raid crew size.
5. Monitor the event privately. Freeze settles/seals the round; it is **not a pause**.
6. Preserve results/ledger and perform real payouts externally.

Checked-out, checking-out, Home-protected or jailed states can intentionally
block movement. A sealed event with `00:00:00` and Checked out is not necessarily
a collision bug. Inspect state before resetting anyone's round.

## 11. Installation and exact run paths

Requires Node **22.19.0+**, npm, Git and a modern player browser. The host installs
dependencies; players only open its URL. Native npm dependencies may require
compiler/Python build tools. Python/OpenCV is not needed to run an existing world.

From the repository root:

```sh
node --version
npm ci
npm run build
```

Do not use `--ignore-scripts`; do not copy Windows `node_modules` to Linux.
There is no root `npm start`, `test:all` or lint command.

### A. Selected Azure production path

Follow [AZURE_VM_HOSTING.md](docs/AZURE_VM_HOSTING.md) in order, **after ensuring
the transferred revision includes the currently local deployment files**.

- Ubuntu 24.04 x64, preferably a non-preview 2-vCPU/8-GiB size; this is a candidate,
  not verified capacity/free-tier eligibility. Verify subscription credit/quota.
- `/srv/the-heist` holds reviewed source/builds. `heist` is a non-root service user.
- Private `/etc/heist/heist.env`, root-readable only; no checkout `.env` on VM.
  Use `deploy/azure/heist.env.example`, filling actual Atlas settings privately.
- Nginx owns public TCP 80/443. Node binds **127.0.0.1:8080**; 8080/5173 stay closed.
  SSH TCP 22 is restricted to the administrator's source IP.
- Public-IP DNS label/own A record points to the VM. Use the exact hostname shown
  by Azure. Certbot webroot bootstrap exposes ACME only, then the HTTPS template
  enables the game and redirects HTTP. A renewal hook checks/reloads Nginx.
- Public proxy permits player APIs/assets/WS only. Staff HTTP, metrics, health,
  debug, painter and arbitrary files are not publicly proxied. Request logging
  is restricted to avoid leaking query-string session credentials.
- Atlas allowlists the VM's actual outbound IP; never use unrestricted access
  as a shortcut. Stop the lab's world writer before starting the VM service.

After one-time installation/configuration, inside Ubuntu:

```bash
sudo systemctl start heist
sudo systemctl start nginx
sudo systemctl status heist nginx --no-pager
curl --fail http://127.0.0.1:8080/health
```

Players use `https://YOUR_EXACT_DNS_HOSTNAME/`. No Vite, ngrok, separate frontend
process or domain-specific frontend rebuild is needed. The browser uses the same
origin for API and WSS.

Organizer access from Windows uses a second terminal's SSH forward:

```powershell
ssh -i "C:\PRIVATE\YOUR_VM_KEY.pem" -N -L 18080:127.0.0.1:8080 advay@VM_PUBLIC_IP
```

Then sign in at `http://localhost:18080/`. Replace username if the VM administrator
differs. That terminal stays open for the organizer tunnel; game services remain
running independently. Never send the private key or expose admin routes to fix a 404.

### B. Windows LAN hosting alternative

Preserve an existing root `.env`; only on first setup:

```powershell
if (-not (Test-Path -LiteralPath .env)) { Copy-Item .env.example .env }
# Fill Mongo settings privately, then:
npm run build
& .\tools\host-lab.ps1
```

Host: `http://localhost:8080/`; players: `http://HOST_LAN_IP:8080/`, different accounts.
This serves built frontend + art + API + WS. No Vite is required. Keep terminal
open; Ctrl+C saves/stops gracefully. Use a trusted lab network; HTTP does not
encrypt credentials. The launcher does not Start/Reset or change firewall rules.

### C. Developer live reload

```sh
npm run build:shared
# terminal 1
npm run dev:server
# terminal 2
npm run dev:client
```

Open 5173 for live UI; Vite proxies to 8080. Backend dev uses the configured
database, not an automatically isolated rehearsal. Watch restarts interrupt
players; don't use this during the real event. On 8080 you see the **last built**
frontend until rebuilding the client.

### D. Optional old local-PC internet tunnel

`npm run tunnel` exposes an already-running 8080 host using the private
`NGROK_AUTHTOKEN`. It is retained for local tests but is **not part of Azure**.
See `docs/NGROK_PLAYTEST.md`; never tunnel Vite or share an old expired URL.

## 12. Environment and secure transfer

Safe templates: root `.env.example` for lab/dev and
`deploy/azure/heist.env.example` for the VM. Actual secrets are **not in this handoff**.

Essential VM settings:

```dotenv
DATABASE_BACKEND=mongodb
MONGODB_URI=YOUR_PRIVATE_ATLAS_URI
MONGODB_DATABASE=YOUR_INTENDED_WORLD_DATABASE
NODE_ENV=production
DEBUG_ENDPOINTS=false
HOST=127.0.0.1
PORT=8080
MAX_PLAYERS=40
ALLOW_REGISTER=true
EVENT_DURATION_MINUTES=180
```

Use the full template rather than replacing existing settings with this excerpt.
`NODE_ENV=production` alone does not disable debug; set `DEBUG_ENDPOINTS=false`
too. Shell/service values take precedence over root `.env`. VM preflight rejects
duplicate checkout `.env`, unsafe settings, placeholder DB credentials and missing builds.

Transfer separately through secure channels: the intended Mongo URI/DB name,
per-person staff logins, SSH access and required backups. Do not Git-commit them
or put them in command arguments, screenshots, public bots reports or chat.
Rotate previously disclosed credentials/tokens. Never send `.env` with a public
source archive. An event archive is history, not a substitute for tested backups.

## 13. Run scripts and tools

All **21 root npm scripts**, flags, workspace-only commands and warnings are
listed in the README's [complete run-script reference](README.md#complete-run-script-reference).
Use `npm run` to see the source-of-truth script list.

| Category | Commands |
| --- | --- |
| Build | `build`, `build:shared`, `build:server`, `build:client`, `build:bots` |
| Regression | `test` (shared only), `test:shared`, `test:server`, `test:bots` |
| Dev / optional tunnel | `dev:server`, `dev:client`, `tunnel` |
| Bot tooling | `bots`, `bots:replay`, `bots:hosting`, `bots:gameplay`, `benchmark:views` |
| World authoring / live audit | `gen-map`, `gen-city-map`, `build:art-world`, `audit:world` |

Workspace production entry: `npm -w @heist/server run start` (built code, configured
environment, no automatic lab tuning). Client static preview is not a multiplayer
host. Commands importing shared/dist require the shared build first.

New VM helpers (no npm aliases):

- `tools/check-vm-env.mjs`: systemd preflight, Node/build/env checks.
- `tools/render-vm-nginx.mjs --domain=HOSTNAME --stage=bootstrap|https`: safe config
  renderer to stdout; no secret reads or automatic system installation.
- `tools/check-vm-proxy.mjs --nginx=PATH --openssl=PATH`: starts/stops only its own
  isolated loopback game/proxy, using disposable TLS material and SQLite fixture.
- `deploy/azure/renew-nginx.sh`: Certbot deploy hook; validate before reload.

Do not casually run `audit:world`: it registers an account and performs real
travel on the target. Legacy bots can mutate an existing target. Migration and
staff provisioning also write state. Read each tool's guide/confirmation first.

## 14. Verification and bot coverage

### Fresh handoff checks on 16 October

| Check | Result / scope |
| --- | --- |
| Shared tests | 100 passed: codecs, movement, chunks, pathfinding, world/collision |
| Server tests | 125 passed: rules, validation, auth, persistence staging, staff, network and isolated 40-player crowd |
| Bot unit/harness tests | 71 passed, including intentional canary faults being detected |
| Client separate TypeScript check | Passed |
| Input / contract UX / atlas / terminal / design / calculator tools | All six passed |

The workspace total is **296 passed tests**, not `npm test` alone. These checks
do not contact the prize-world Atlas database. See the final handoff check note
below for build/proxy/environment checks recorded with this document.

Reproduction from repository root:

```sh
npm run build
npm run test:shared
npm run test:server
npm run test:bots
npx tsc -p apps/client/tsconfig.json --noEmit
npx tsx tools/check-client-input.mts
npx tsx tools/check-contract-ux.mts
npx tsx tools/check-city-atlas.mts
npx tsx tools/check-terminal-cards.mts
npx tsx tools/check-workbench-design.mts
npx tsx tools/check-workbench-math.mts
node --test tools/check-vm-env.test.mjs tools/render-vm-nginx.test.mjs
```

### Which bots to use

**Current paid-gameplay suite:** `npm run bots:gameplay` creates a new isolated
server, SQLite databases and 40 accounts. Bots use public evidence solvers,
shared navigation/packet codecs, normal proximity and paid acquisition. Coverage
includes queues, travel, paid solving, reconnect, Bank/Home/races/settlement and
training rejection. Default timeline is condensed to ten minutes with a
620-second post-Start ceiling. It cannot accept an arbitrary real-server URL.

```sh
npm run bots:gameplay -- --help
npm run bots:gameplay -- --bots=8 --seconds=150 --seed=43
npm run bots:gameplay
# Full normal clock; budget more than three hours:
npm run bots:gameplay -- --event-minutes=180 --seconds=10820 --seed=43
```

Read [GAMEPLAY_BOT_TESTING.md](docs/GAMEPLAY_BOT_TESTING.md) for exact gates,
reports and retained-authority audit. Short runs can miss required late mechanics
and fail; don't lower gates to hide that. The agents are not human/browser FPS
tests. They do not certify burglary, Golden Hour acquisition or complete raid
crews. Default-save preservation checks described there concern SQLite paths,
not a backup/capacity test of deployed Atlas.

**Known incompatible hosting suite:** `bots:hosting` still seeds old training
workbenches and expects a practice solve. Training removal breaks that fixture:
the documented minimal smoke failed with `Missing mixed workbench state`.
Its old smoke/lab/soak green reports are historical, **not current release
certification**. Update fixture/exercises without re-enabling training or weakening
gates, then run the intended host soak. `benchmark:views` also has a stale
training-payload workload label. Bot unit-test success does not fix these scripts.

**Legacy teammate harness:** `bots` scenarios can register users/inject faults
into `HTTP_URL`/`WS_URL` targets. They require a disposable rehearsal host;
never aim them at the real event. `bots:replay` expects a compatible trace format.

All generated test databases, private fixtures, passwords/tokens and backups
belong in ignored `bot-runs/`. Keep reports private unless carefully sanitized.
Each safe suite owns its own processes; don't reset/delete real accounts for cleanup.

## 15. Remaining work and honest limits

### Before sharing/releasing this working tree

1. Review current dirty files, including HOST binding, admin `HEIST_ENV_FILE`,
   deployment helpers/templates, README and this handoff. Commit meaningful units
   and push the intended release only when authorized. Do not stage private data.
2. Resolve the legacy hosting-suite fixture mismatch; its current failure is a
   real open item, not optional documentation noise.
3. Keep old milestone documents visibly historical. Some `world-labels.ts`
   descriptions still say "training pays ₹0" despite enforced removal; clean
   that copy in a separate scoped change. Legacy training fields are retained
   intentionally for history, not proof of a supported feature.

### Before a real Azure event

1. Confirm VM creation, exact public IP/DNS, subscription credit/quota and
   non-evictable size. No provided specs/free account guarantee availability.
2. Install/runtime-test the Linux systemd service and sandbox permissions.
   Windows proxy tests and prior WSL unit parsing are not Linux deployment proof.
3. Verify Atlas outbound-IP allowlist, durable commits/lease/recovery and
   appropriate backup/restore using the actual tier's available facilities.
4. Verify trusted public certificate issuance, renewal, 80/443 routes, private
   8080/5173 and private staff paths. Never bypass certificate errors.
5. Use at least two real remote browsers with distinct accounts: move/see each
   other, travel, refresh in different districts, acquire/solve concurrently,
   queue/release, view checklist, and confirm organizer access through SSH.
6. Run a long representative **separate-world** workload on actual VM + Atlas
   and network, after fixing the hosting suite. No live prize users/ledger.
7. Conduct human difficulty/accessibility and small/large raid-crew rehearsals.
   Earlier screenshots and seeded validator tests do not establish event fairness.
8. Decide actual payout policy, organizer staffing, event timing, incident and
   maintenance windows. Keep the VM awake and avoid builds/bots during the event.

An i5 12th-gen / 16-GB host is a plausible candidate, not a capacity promise.
The short local 40-player smoke had zero tick overruns; developer-PC/SQLite
results cannot be relabelled Azure/Atlas/three-hour results. Static artwork
bandwidth, client rendering, VM CPU, Atlas latency/tier and network reliability
all matter. There is no automated real-money payout or comprehensive anti-cheat/
penetration-test certification.

## 16. Maintenance, backup and troubleshooting

- **Update:** schedule downtime; gracefully stop `heist`, review/pull the intended
  revision, install changed dependencies, rebuild/test, start and verify privately.
  Do not run a watcher/cluster or rebuild under live prize traffic.
- **Restart:** preserves the stored event, not a fresh clock/round. Do not use
  Reset as a server restart. Freeze is settlement, not a reversible pause.
- **Backups:** protect Atlas data and required private configuration, archives and
  ledger; test restore into a distinctly named separate world. For legacy SQLite,
  use consistent backup facilities or stopped files including WAL-aware handling.
- **Atlas outage/lease failure:** inspect privately, restore connectivity, stop
  duplicate writers, allow crash lease expiry; do not rewrite money or lease rows.
- **Empty/old frontend:** build the client/full release; 8080 serves built assets,
  not Vite source. Check which revision and service working directory are active.
- **Cannot move:** inspect connection/WELCOME, modal focus, authoritative
  collision, jailed/Home/Checkout state and frozen settlement before changing data.
- **Capacity:** distinguish active network cap from event enrollment/late cutoff;
  inspect organizer roster instead of indiscriminately resetting.
- **Admin 404 publicly:** expected proxy boundary. Use SSH forwarding; regular
  admins still cannot perform superadmin mutations.
- **After event:** gracefully stop, preserve required results/backups, then
  deallocate/delete only intended Azure resources. Retained disks/IPs can still
  cost money. Do not delete shared Atlas as VM cleanup.

Useful VM operations:

```bash
sudo systemctl status heist nginx --no-pager
sudo journalctl -u heist -n 50 --no-pager
sudo journalctl -u nginx -n 50 --no-pager
sudo nginx -t
sudo /snap/bin/certbot certificates
sudo ss -ltnp 'sport = :8080'
```

Inspect logs privately; operational/session identifiers can be sensitive.

## 17. Documentation index and recipient checklist

Current operational reading order:

1. This handoff + [README](README.md) + [AGENTS.md](AGENTS.md).
2. [Azure Nginx/Certbot deployment](docs/AZURE_VM_HOSTING.md).
3. [MongoDB, staff, migration and Reset](docs/MONGODB_AND_ADMINS.md).
4. [Paid gameplay agents](docs/GAMEPLAY_BOT_TESTING.md) and
   [hosting suite compatibility warning](docs/BOT_TESTING.md).
5. [Backend changes](docs/BACKEND_CHANGES.md),
   [VM preparation audit](docs/azure-vm-deployment-audit-2026-10-15.md),
   [final catalogue audit](docs/final-challenge-book-audit.json).

Reference/history: `WORLD_BUILD_AUDIT.md`, `GAMEPLAY_HANDOFF.md`,
`ART_WORLD_HANDOFF.md`, `docs/challenge-ui-audit.md`, `docs/terminal-ui-audit.md`,
`docs/contract-checklist-travel-audit-2026-10-14.md`,
`docs/training-removal-audit-2026-10-14.md`, `docs/hosting-performance-audit.md`,
`docs/gameplay-bot-audit-2026-10-14.md` and retained screenshots/reports. Older
claims about training/SQLite/reset/test counts must not override current state.

Give the next person:

- [ ] Reviewed release commit/source including the local VM files and handoff.
- [ ] The intended environment (development, rehearsal or actual prize world).
- [ ] Actual VM public IP/DNS and separately authorized SSH access, when available.
- [ ] Private Mongo access/database identity and backup responsibility, securely.
- [ ] Only their authorized player/admin/superadmin login, securely.
- [ ] Event schedule/payout policy and contact responsible for incidents.
- [ ] Current test evidence and the open certification gates above.

Do **not** send `.env`, SSH keys, all staff credentials, raw auth databases or
private bot-run directories as part of a public code handoff.

### Final handoff verification note

The 296 workspace tests, separate client typecheck and six focused checks above
were freshly run on 16 October 2026. Build, 14 VM/preflight/renderer tests and
the real Nginx HTTPS/WSS proxy smoke are also checked in the handoff turn; the
proxy uses disposable locally trusted TLS, not Azure/public certificate issuance.
No full paid-gameplay/hosting soak, new browser screenshot sweep, real Atlas
integration run or VM deployment is represented as completed by this handoff.
