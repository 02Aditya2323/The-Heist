# Zero Hour: final challenge-book implementation

**Historical milestone, not the current operations runbook.** Read
[PROJECT_HANDOFF.md](PROJECT_HANDOFF.md), the current README and
`docs/MONGODB_AND_ADMINS.md` first. Player training has since been removed,
MongoDB replaced deployed SQLite persistence, and the superadmin now has a
protected archival Reset. Old training/reset/startup instructions and test counts
below describe that earlier build; do not use them to operate the current event.

Updated 14 October 2026. The supplied final challenge book and workbook replace the earlier challenge mix and economy. Neither source file was modified. Their hashes, the 42-item station catalogue, and a saved-ledger reconciliation are recorded in `docs/final-challenge-book-audit.json`.

## What is playable

The existing city remains intact: 19 scenes, six main districts, seven connectors, six residential wards, 90 physical Home sites, 124 interaction points and 44 directed travel gates. Collision remains the reviewed, shared OpenCV-derived grid. This upgrade changes centre labels and adds lightweight status overlays; it does not repaint, enlarge or downsample the artwork.

The complete event loop is server-authoritative: Home ownership, paid jobs, unpaid training, reservations and queues, deposits and delayed withdrawals, burglary, custody, raids, races, Golden Hour, wealth caps, offline recovery, permanent Checkout and final freeze. M opens the complete connected atlas. E operates nearby centres. J opens the contract journal. WASD/arrows and the touch pad move the operator. Optional sound remains off by default.

The M atlas now stitches all 19 native artwork panels into a compact visual city instead of presenting thumbnail cards and dashed route links. Empty server address-space is removed by a client-only projection; every panel's local coordinates and aspect ratio stay unchanged. The 22 atlas connections come from the 44 reciprocal authoritative gates. A generated scenery backplate fills the unused areas underneath the original art; it is decorative, not walkable game space. Travel still uses E at existing gates. Native 1:1 zoom, cursor-anchored zoom, region focus, Find me, labels and POI/Home markers use this same projection. See `docs/stitched-atlas-audit.json` and `docs/atlas-infill-prompt.md`.

All 42 final-book templates are implemented: 8 Code, 7 Debug, 14 CTF and 13 Puzzle. The displayed languages are C, Python and Java; RC-02 offers all three equivalent language views. New contracts contain no SQL or C++ tasks. The old generator is retained only to finish saved legacy rehearsals without changing their questions.

The workbenches include numbered/highlightable code and editable trace tables; selectable code repairs with deterministic server simulations; live Caesar, Atbash, reverse and substitution tools; elimination boards; searchable, filterable and pinnable logs; five-run number machines; an explicitly fake staff portal; key-and-door mazes and teleport puzzles; reporting trees and payment rings; task ordering; lights-out panels; suspect statements; nine-guess door keypads; fuse-box circuits; eight-guess courier dialogue; and constraint boards. Every active workbench has a scratchpad and safe arithmetic calculator. Notes and interactive drafts survive a tab refresh through session storage. No submitted source code or calculator input is executed as JavaScript.

The journal presents one selected workbench at a time, with contract tabs for switching raid questions or training copies. Pure board solutions are collected from actual selections/routes rather than requiring students to type internal answer encodings. The server replays or validates that evidence before paying.

Terminal cards now use a responsive field-console layout: district-art headers, topic icons and colour accents, explicit practice/paid modes, Bank balance panels and a raid crew manifest with server-time hold progress. Typed answers and Bank amounts stay intact while switching or reopening cards in the same tab; they are cleared for a different operator or changed question. These text-field drafts are in memory, not refresh-persistent. See `docs/terminal-ui-audit.md` for this upgrade's verification.

The challenge UI now extends that visual system through all 42 templates and 17 workbench kinds. Each tool has its own labelled console, three-step instructions, responsive controls and a private toolkit. Code is safely syntax-coloured; ciphers have undo; evidence filters/pins and puzzle selections are clearer; release requires confirmation. The server publishes `answerReadyAt` so the existing answer interval and lockout are shown accurately, with no change to rewards or timing rules. See `docs/challenge-ui-audit.md` for the full browser and regression matrix.

## Decisions you approved

- Maximum 40 event operators. All 90 Home sites remain in the artwork, but assignments use wards A–C. Wards D–F are preserved reserve streets.
- Starter: one ₹10 claim per operator. Standard: ₹20 per slot, eight slots per wave, four for each of two specified templates. Expert: ₹80 per slot.
- Initial pools: Starter ₹400; Standard ₹800; Expert ₹400; Races ₹300; Golden Hour ₹300; raid seeds ₹400/₹400/₹700; Treasury ₹300; fee vault ₹0. Total remains exactly ₹4,000.
- Bank holding fee: 0.1% per real minute after Bank opening, rounded to the nearest paisa. Transit is exempt. Fees move into a dedicated vault and contribute to the next raid prize; no interest is minted.
- Voluntary Checkout opens at minute 150. Disconnect grace and automatic settlement are separate and remain protected.
- At event start, fewer than 36 enrolled operators fixes raid crews at eight; 36–40 fixes them at ten. This size stays fixed throughout that event. Five operators must still pass the two-answer gate.
- The previously approved withdrawal reserve remains: normal funds arrive after five minutes, while the raid's 10% reserve stays in transit until its result. Unused reserve is returned afterwards.

## Exact routing and schedule

| Station | Final-book contracts |
| --- | --- |
| CP Lab | ST-01, SD-01, SD-03, EX-01 |
| Debugging Lab | ST-02, SD-04, EX-03 |
| Logic Terminal | ST-03, SD-09 |
| Data Centre | SD-02, EX-02 |
| Code Review Desk, handler `sql` | SD-05 |
| Network Tower | SD-08 |
| OSINT Terminal | SD-10 |
| CTF Arena | SD-06 |
| Challenge Terminal | SD-07 |
| Sandbox Station | EX-04, EX-05 |
| Race Terminal | RC-01–RC-03 |
| Home doors | BG-01–BG-03 |
| Raid Circle | BR-01–BR-10; BL-01–BL-05 in window 3 |
| NEXUS map and Golden Hour Terminal | GH-01–GH-03 |

District boards aggregate their stations. Labels are generated by `apps/server/src/game/world-labels.ts`, including the Code Review Desk rename, while geometry and handler IDs stay stable.

Standard waves: minute 0 SD-01/SD-02; 20 SD-04/SD-06; 50 SD-03/SD-08; 80 SD-05/SD-09; 120 SD-07/SD-10. Each template gets four slots. Experts: EX-01 at 30, EX-04 at 60, EX-02 at 90, EX-05 at 120 and EX-03 at 140.

Normal raids deal 2 tier-A, 2 tier-B and 1 tier-C question per operator. Black Ledger deals all five BL templates. Races use personal variants of equal construction and unlock simultaneously. GH-01 places five distinct glowing keycards on approved open NEXUS Plaza tiles. GH-02 uses the moving NEXUS courier. GH-03 is acquired at the Golden Hour Terminal. The existing race, raid and Golden Hour times remain unchanged.

## Authority and anti-forgery

The book proposes browser-only checking. This implementation intentionally keeps browser interaction but retains server validation, as required by AGENTS.md. Neither expected answers, private generators nor event secrets are included in client packets or the built client bundle. The browser cannot decide a payment by sending a `solved` flag.

Paid challenges have a configurable five-second minimum from actual question availability, including race reveal time. Ordinary wrong answers retain the five-second answer cadence; three wrong attempts impose a 60-second challenge lockout. Keypad and courier puzzles use their specified nine/eight-guess feedback rules instead. Machine probes are server-counted and stop at five. Claims, denied requests, answer outcomes, elapsed solve times and money transfers are inspectable in the organizer history.

The five-second minimum is a baseline abuse guard, not proof of human work. Accessible code remains text. There is no claim that the game can block AI tools, screenshots or outside assistance.

## Preservation and persistence

The existing local lobby was backed up to `apps/server/data/heist.db.event.db.before-final-book.db`. Its approved pool rebalance is recorded as two ledger transfers; no account, Home, source image or original reference was deleted. Existing legacy rehearsals keep their original generator and answer validation. A legacy event that has already started is not silently rebalanced: startup requires finishing it under its old build or choosing a fresh event database.

The ordinary authentication/position database and event database remain separate. By default the event database is the configured SQLite path plus `.event.db`. Ledger rows are append-only with a hash chain; every transaction checks account deltas against its ledger transfers, and the periodic audit reconciles every account, not only the world total. Back up both databases together while the server is stopped, or use SQLite's consistent backup facilities. Do not copy only an active database file while ignoring its WAL.

## Run and start the actual event

The tested runtime is Node 22.19.0; package metadata now requires at least that version because the event engine uses `node:sqlite`. Its experimental-feature warning on that runtime is expected.

```powershell
npm run build
npm run dev:server
```

The built game is served at `http://localhost:8080/`. The retained development preview is `http://localhost:5173/`. The local event is deliberately still in **rehearsal/lobby**: no actual prize event was started during implementation.

Before the real event, the organizer must configure a private `HEIST_ADMIN_TOKEN` in the server environment and restart it. Open `http://localhost:8080/admin.html`, enter that key, confirm the pool audit and enrolled roster, then choose Start Great Reset. Do not put the key in a URL, a tracked file or the client bundle. The console provides Start, Freeze, Announce, lock release, pools, operators, queues, raids, ledger and operator history. It has no arbitrary money-gift endpoint.

For a new event, use a fresh, explicitly named `EVENT_DB_PATH`; retain the previous event database and backup. The event is single-run by design and has no destructive reset button. `EVENT_DURATION_MINUTES` defaults to 180. Timeline points scale with duration, while reservations, challenge durations and fees retain their independent real-time cadence.

## Verification

- Full workspace build and separate client type check pass.
- 102 server tests and 100 shared tests pass. Coverage includes all 42 validators over 60 seeded variants each, independent printed-output checks, layered cipher decoding, puzzle replay, ledger rollback/reconciliation, duplicate payments, Bank fee rounding, approved crew-size boundaries, tier-balanced raids, legacy migration/backup, protected offline settlement and the complete 180-minute scheduler.
- Real HTTP/shared-WebSocket tests cover enrollment, terminal proximity, a paid claim, ten duplicate submissions with one payment, Checkout, rejected old answers, simultaneous tab replacement, protected organizer Start/Announce/Freeze/history and unauthenticated rejection.
- The 40-connection crowded-city smoke includes five real workbench payloads per operator, not empty journals. Movement, event streaming and heartbeat traffic pass with no rejections, malformed packets, input-rate drops or backpressure. A longer soak can be reproduced by setting `HEIST_QA_SOAK_MS` before the crowd test. This is local evidence, not a full three-hour VM certification.
- A sustained run also passed: 40 connections and five active workbenches each, 380.5 seconds, 50,520 incoming messages and 312.6 MB sent. There were zero movement rejections, tick overruns, malformed packets, input-rate drops or backpressure events. Measured movement-tick P99 was 1.311 ms; the test process, including simulated clients, used 129.8 MB RSS. See `docs/final-book-crowd-soak.json`.
- Browser QA inspected all 17 workbench kinds on an isolated in-memory server. Live controls verified code highlighting/trace rows, repaired-code output, cipher preview and calculator, log filtering/pinning, machine feedback, lights-out completion, shortest key-door maze replay and payment-ring selection. All practice completions paid ₹0.
- The source PDF and XLSX hashes remain unchanged. The world audit confirms identical live-server/client manifests, all 14 original generated source assets and the existing native collision review.

Reproduction commands:

```powershell
npm run test:server
npm run test:shared
npx tsc -p apps/client/tsconfig.json --noEmit
npx tsx tools/check-client-input.mts
npx tsx tools/check-workbench-math.mts
npx tsx tools/audit-world-assets.mts
npx tsx tools/audit-final-book.mts
```

## Remaining organizer work

The documents leave the minimum real-money payout and payout method undecided. The software records final scores in PAYOUT but does not send real payments. A human first-year rehearsal is still needed to calibrate difficulty, clarity and the eight-person raid pass rate. A full-length 40-player soak on the actual lab VM remains a deployment check. HTTPS/network access controls and event-day administrator access must be configured for the intended lab environment before using real credentials or prize money.
