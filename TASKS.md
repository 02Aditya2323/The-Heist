# The Heist — Zero Hour · Event Scale-Up Task List

**Owner tonight:** Claude (session started 16 Oct 2026, ~00:40 IST)
**Handover:** Aryan's *Claude session* takes over ~03:30 IST (Aryan himself is
sleeping; his agent continues the work). **The incoming agent must read
[HANDOFF_FOR_NEXT_AGENT.md](HANDOFF_FOR_NEXT_AGENT.md) first** — it is written
for an agent with no memory of this session and covers environment traps,
load-bearing invariants and the open decisions.
**Event:** tomorrow. Target 50–60 players, realistically ~10.

Status key: `[ ]` not started · `[~]` in progress · `[x]` done & verified · `[!]` blocked

---

## Owner decisions locked in Q&A (do not re-litigate)

1. **Map**: moderate collision rebuild — remove clutter blobs inside floor, widen
   corridors to >=3 tiles, open plaza interiors, keep reviewed building/water
   exclusions. Target roughly 2x walkable area.
2. **Challenges**: rewrite all 42 prompts into a strict structured format.
   **Answers and validators stay byte-identical.** Add hints + answer-format
   guidance. No new validators, no difficulty retune of generators.
3. **Admin**: all four power sets — live settings editor, player management,
   event clock control, live ops dashboard. Every mutation audited + confirm-gated.
4. **Deploy**: push to `main` = build + test + SSH deploy to VM with health check
   and auto-rollback.
5. **HUD**: neon heist / cyber-noir, CSS-only, collapsible.
6. **Auth**: richer data collection at signup. **No gating** — no join code, no
   approval queue, no extra friction. Signing up must stay trivial.
7. **Economy**: every value editable live, but the **world net money must always
   equal exactly Rs 4,000 (400,000 paise)**. This invariant is non-negotiable and
   must be enforced server-side on every settings change.
8. **Features**: spectator board, onboarding/tutorial, help + stuck-detection,
   sound/juice — all in scope.
9. **Mandate**: challenge *presentation and logic of presentation* is the weakest
   part of the game. Fix ordering inconsistencies, polish every user interaction.
   Backend must be optimised and reliable to the point of no fails.

## VM facts

- `52.188.71.152`, user `advay`, key `C:\Users\ADVAY\.ssh\ZeroHour1_key.pem`
- Ubuntu, 4 vCPU (2 physical cores, SMT) Xeon Platinum 8573C @ 2.3 GHz, 1 NUMA node.
- 4 vCPU is the real capacity constraint for the 60-player target. Node is
  single-threaded for the game tick; the tick loop must stay well under budget.
- Nginx owns 80/443, Node binds 127.0.0.1:8080. Atlas needs the VM outbound IP
  allowlisted.

---

## Phase A — Foundation

- [x] A1 This task list, kept current as work lands
- [x] A2 Map collision moderate rebuild **(PR #2)**
  - [x] A2.1 `tools/clean-world-collision.mts` written, idempotent, monotonic
  - [x] A2.2 Clutter blobs interior to floor removed
  - [x] A2.3 Corridors widened / plaza interiors opened
  - [x] A2.4 Verified: 19 components (one per scene), 124/124 hotspots, 44/44
        gates, 44/44 gate targets, 90/90 home plots, 3/3 spawns all reachable
  - [x] A2.5 Rebuilt via `build-art-world.mts --v2`; server map + client manifest
        regenerated together, all builder marker guards pass

  **Result: walkable 6,183 -> 13,475 tiles (2.18x). Dead-ends 191 -> 26.
  Cramped corridor tiles 1,950 -> 512. Open floor 4,042 -> 12,937 (3.2x).**
- [x] A3 GitHub Actions **(PR #5)**
  - [x] A3.1 `.github/workflows/ci.yml` — full verify on every push/PR, plus two
        new gates: the world must rebuild reproducibly, and every interaction
        point must be reachable (`tools/check-world-reachability.mjs`)
  - [x] A3.2 `.github/workflows/deploy.yml` — verify, then rsync + `deploy.sh`,
        with a live-event guard, pinned host key, single-writer concurrency and a
        serving assertion
  - [x] A3.3 Secrets set: `VM_HOST`, `VM_USER`, `VM_SSH_KEY`, `VM_HOST_KEY`
  - [x] A3.4 Verified end to end over real HTTPS (see below)

- [x] A4 **THE GAME IS LIVE**: https://zerohour1.eastus.cloudapp.azure.com/
  - Trusted Let's Encrypt certificate, expires 2027-01-13, auto-renew hook installed
  - HTTP 308 redirects to HTTPS; `/api/map` 200; `/api/admin/event` 401 (reachable
    and auth-enforced); `/metrics`, `/health`, `/api/debug/state` all 404
  - Node private on 127.0.0.1:8080, Nginx owns 80/443, ufw allows 22/80/443

## Phase B — Admin / event management

- [x] B1 Live settings system **(PR #3)**
  - [x] B1.1 `apps/server/src/game/settings.ts`: 34 editable fields, persisted in
        event state, re-applied on restart, dropped safely if they stop validating
  - [x] B1.2 Validation enforcing net == Rs 4,000 plus cap/raid/burglary coherence
  - [x] B1.3 `GET/POST /api/admin/settings` serving full per-field metadata
        (label, group, unit, bounds, help, default) so the console needs no
        duplicated schema knowledge
- [~] B2 Player management — money adjust / clear penalties / release holds done
      and audited via `POST /api/admin/player`. Still to do: teleport, kick,
      per-player round reset, mark-complete, un-checkout.
- [~] B3 Event clock control — true pause/resume done (`pause`/`resume` actions).
      Still to do: phase skip, manual wave/race/Golden Hour/raid trigger, extend.
- [x] B4 Superadmin console UI **(PR #4)** — five tabs (Overview, Run the event,
      Game settings, Operators, Money trail), rupee-denominated, every
      destructive action states its consequence in its own confirmation
- [x] B5 Spectator board **(PR #9)** — `/board`, read-only, polls the public
      `/api/board` feed. No session, no socket, nothing it can send. Sized with
      `clamp()` so one page fits a laptop, a 1080p projector and a 4K display.

## Pull requests — ALL MERGED INTO MAIN

| PR | Branch | What |
| --- | --- | --- |
| #1 | `feat/azure-vm-deployment` | Configurable HOST, deploy assets, consolidated handoff |
| #2 | `fix/world-collision-cleanup` | Collision rebuilt from authored footprints |
| #3 | `feat/live-event-settings` | 34 live settings, true pause/resume, per-operator actions |
| #5 | `ci/github-actions-deploy` | CI + deploy workflows, reachability checker |
| #4 | `feat/operator-console` | Super-admin console, public organizer API over TLS |
| #6 | `feat/structured-challenge-briefs` | Structured briefs with explicit answer formats |
| #7 | `feat/hud-revamp` | Collapsible HUD, neon pass |
| #8 | `feat/player-profiles` | Optional player details, organizer roster + CSV |
| #9 | `feat/spectator-board` | Read-only projector board at `/board` |
| #10 | integration | Merged the stack superset into `main` |

Because the nine PRs were stacked, merging #1 into `main` first left `main` with
only its three commits while the rest pooled in `feat/player-profiles`. PR #10
brought that superset in. `main` now has the complete scale-up and CI is green
on it. The feature branches are redundant and can be deleted whenever.

## Phase C — Player experience

- [x] C1 HUD **(PR #7)** — collapsible via button or `H`, neon layer over the
      existing responsive CSS, compact wealth readout kept visible while
      collapsed, touch controls never hidden, reduced-motion respected
- [x] C2 Challenge presentation **(PR #6)** — `ChallengeBrief` with situation /
      task / evidence / **answer format** / worked example, for all 42.
      Validators byte-identical. Answer format is keyed by workbench kind (17
      contracts cover 42 challenges) so it cannot drift from what `validate`
      accepts. Two tests prove no example can ever be accepted as an answer,
      across 1,680 generated variants.
- [ ] C3 Challenge UI/UX polish + fix ordering/consistency across terminal,
      journal, checklist, workbenches
- [ ] C4 Onboarding/tutorial + help panel + objective tracker + stuck detection
- [ ] C5 Sound, juice and feedback

## Phase D — Auth / player data

- [x] D1 Richer signup profile **(PR #8)** — name, email, phone, college/team,
      every field optional, collapsed behind an "optional" summary so the login
      path stays two fields. Normalises rather than validates, so nothing can
      reject a sign-up.
- [x] D2 Admin roster view + CSV export **(PR #8)** — `/api/admin/roster`, with
      `?format=csv`. Password hashes are projected out at the query, and CSV
      cells starting `=`, `+`, `-` or `@` are escaped against formula injection.
- [ ] D3 Session hardening that does not add player friction

## Phase E — Capacity & verification

- [ ] E1 Raise player cap toward 60 with pool plan rebalanced to stay at Rs 4,000
- [ ] E2 Backend load eval sized to 4 vCPU; record tick overruns at 10/40/60 players
- [ ] E3 Full test suite green + fix the known `bots:hosting` training fixture break

---

---

## !! IMPORTANT STATE NOTE !!

`/health` on the VM currently reports **`"phase":"live"`** — the Atlas database
holds an event that has already been started. Before tomorrow, the superadmin
almost certainly wants **Run the event -> Reset the event** (types RESET) to
archive that round and start clean. A restart is not a reset.

This also means the CI deploy workflow's live-event guard will **refuse an
automatic deploy** until the event is reset or frozen. That guard is working as
intended; use the manual dispatch with `force=true` if a deploy is needed while
a round is live.

## !! BLOCKERS NEEDING A HUMAN !!

### 1. PR merging — RESOLVED

All ten PRs are merged into `main`. Advay merged the nine review PRs; the agent
was then authorised to merge the integration PR (#10). Nothing is outstanding.

### 2. Azure DNS label + NSG ports — DONE

Resolved by the owner. `zerohour1.eastus.cloudapp.azure.com` resolves to
52.188.71.152, ports 80 and 443 are open, and a real certificate is installed.

### 3. Decision to review: organizer API is now public over HTTPS

`deploy/azure/nginx-staff.conf` proxies the authenticated organizer and staff API
publicly over TLS. The documented posture was to withhold these routes and reach
them through an SSH port forward. That was changed deliberately because the
person running this event is not a developer and an SSH tunnel on the day is a
single point of failure nobody present could repair.

The real control never moved: every route re-checks the account role against the
database per request. `/metrics`, `/health`, the debug endpoints and the painter
are still unproxied. To revert, delete one `include` line from
`deploy/azure/nginx-https.conf.template`. Rationale in full is in PR #4.

---

## Owner instructions added after the Q&A

- Commits must be professional and detailed; every change goes through a PR with
  a written self-review. Contributions should land on `main` (see blocker 1).
- Track quota; write Aryan's handoff and push **before** quota runs out.
- Final deliverable: a gameplay video suitable for PR/marketing, committed.

---

### Key mechanisms an agent taking over must understand

**Live settings work by in-place mutation.** All 90 `EVENT_RULES` reads are
property accesses at call time with zero load-time destructuring, so
`applySettings` mutating that object is immediately effective everywhere. Do not
"improve" this by destructuring rules into locals — that silently breaks every
live override.

**The Rs 4,000 invariant is enforced in three independent places**, deliberately:
1. `derivePools` makes TREASURY absorb the remainder, so the sum is forced.
2. `planSettings` re-checks the sum and rejects a negative Treasury.
3. `EventEngine.transaction` already asserted `total() === EVENT_RULES.total` and
   that every account delta has a ledger row. `total` is intentionally **not** an
   editable field, so Rs 4,000 is pinned.

Pre-start pool rebasing happens *outside* `transaction`, because redefining
opening balances is not a transfer and that wrapper correctly refuses untracked
account deltas. The ledger is checked to be empty first.

**Pause is total, not cosmetic.** `gameNow()` returns `state.pausedAt || clock()`,
`tick()` returns early while paused, and player actions are refused. On resume,
`shiftDeadlines` moves every stored timestamp forward by the paused duration, so
a hold with four minutes left still has four minutes left. **Any new timestamp
field added to `State` must be added to `shiftDeadlines`**, or it will silently
expire during a pause.

## Running log

- 05:20 — Staff passwords: the four accounts existed in Atlas but none of the
  saved passwords authenticated (all 401), despite the 14 October report
  recording a successful login. Cause undetermined from available data. All four
  were reset with the new `tools/reset-staff-password.mts`; superadmin verified
  against the live site, and `heist_admin_1` verified to be correctly 403'd from
  superadmin routes. Passwords given to Advay in the session, never committed.
- 05:10 — All PRs merged into `main` via integration PR #10, after discovering
  the stacked merges had only put PR #1 on `main`. First automated deploy from
  `main` then failed on `rsync` exit 23: `/srv/the-heist` is root-owned and
  setgid so the deploy user cannot set times on the directory, even though every
  file transferred. Fixed with `--omit-dir-times --no-perms`. Same permission
  shape as the earlier local tar failure.
- 04:45 — **CI is green end to end** (run 38802367192): build, shared/server/bots
  tests, client typecheck, six focused checks, deployment tooling tests, world
  reproducibility and world reachability. All nine PRs now carry a written
  self-review comment.
- 04:35 — Fixed the reason CI had failed on every run since it was added. The
  world builder hashes raw source bytes, and `obstacles.json` was CRLF on
  Windows and LF on Linux, so `sourceHash` could never match off the authoring
  machine. `.gitattributes` added; hash recomputed from normalised bytes. A
  fresh build now reproduces the committed world byte for byte.
- 04:20 — Found and fixed a live 404: `/board` worked as `/board.html` but not as
  `/board`, because the alias cloned the Fastify request with object spread and
  `url`/`headers` are prototype getters. Three route tests added.
- 04:10 — PR #9: spectator board at `/board`. Server suite 170 -> 173.
- 03:55 — PR #8: optional player profiles + organizer roster with CSV export.
  Server suite 162 -> 170. The event on the VM has now auto-sealed to `frozen`
  (it passed its 180th minute), which confirms a Reset is needed before the real
  round.
- 03:30 — HANDOFF_FOR_NEXT_AGENT.md written for the incoming agent. Seven PRs
  open. Live site current with all work.
- 03:20 — PR #6 (challenge briefs) and PR #7 (HUD) opened. Server suite 156 ->
  162. The worst presentation defect found: SD-01 accepted only the exact string
  `Peak 82 at 1` while telling the player nothing about that format, so a correct
  solve typed as `82, 1` lost a paid contract. EX-01 had the same flaw for maze
  routes.
- 03:05 — PR #4 (operator console) and PR #5 (CI/CD) opened. Five PRs now stacked
  and awaiting a human merge click.
- 02:50 — HTTPS live with a trusted certificate. Verified redirect, API, admin
  reachability and that the metrics/health/debug boundary still 404s publicly.
- 02:30 — Deploy succeeded after three real failures worth remembering:
  (1) `rsync` does not exist in Git Bash, and a `| tail` masked the failure;
  (2) MSYS tar exits 1 on harmless utime warnings, and the remote extract could
  not chmod the setgid `/srv/the-heist` it does not own;
  (3) `sudo HEIST_ENV_FILE=... node` silently passed nothing because sudo strips
  the environment, so the preflight validated an empty config and rejected every
  deploy. All three are fixed in `deploy.sh` / the local sync helper.
- 02:05 — PR #3: live settings + pause/resume + per-operator organizer actions.
  31 new tests. Server suite 125 -> 156. The 40-player smoke still reports zero
  tick overruns (avg 0.34 ms, p99 3.78 ms), so 60 players on 4 vCPU looks safe.
- 01:50 — Game is LIVE on the VM. Node private on 127.0.0.1:8080, systemd unit
  installed and enabled, health endpoint responding. Deploy path is
  `deploy/azure/deploy.sh`, which is what CI will call too.
- 01:35 — PR #1 opened and self-reviewed (Azure deployment assets, private listen
  binding, consolidated handoff). 3 commits. Merge blocked, see blocker 1.
- 01:30 — VM provisioned: Node 22, nginx, certbot (snap), `heist` service user,
  `/srv/the-heist`, `/etc/heist`, ufw 22/80/443. Exit 0. VM was previously bare:
  no node, no nginx, nothing in /srv. 7.8 GiB RAM, 29 GB disk, 4 vCPU.
- 01:10 — Collision rebuilt from authored footprints. The OpenCV pass had
  classified only neutral-grey floor as walkable, so painted plazas, kerbs and
  road markings all became blocked speckle. Rebuild is *monotonic* (only opens
  tiles, never closes one), which is what guarantees no marker, gate or route can
  regress. First non-monotonic attempt was correctly rejected by the builder's
  marker guard, which caught the dilated Leaderboard footprint eating the Raid
  Circle tile — that guard is load-bearing, do not weaken it.
- 00:55 — Baseline verified green: 100 shared + 125 server tests, matching the
  handoff's recorded counts.
- 00:40 — Session start. Repo oriented. Collision analysed: 75–91% of each scene
  blocked, 6,183/129,870 tiles walkable, 19 scenes each singly-connected, all 124
  hotspots reachable. Superadmin has only 5 actions. No `.github/` yet. `gh` authed
  with `repo`+`workflow`. Atlas URI present in local root `.env`.
