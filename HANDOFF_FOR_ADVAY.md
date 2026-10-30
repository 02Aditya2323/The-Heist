# Handoff — Advay

**From:** Aryan's Claude session, 16 October 2026, ~05:30 IST
**Covers:** everything merged to `main` since your last commit (`3dab3ab`), what is
left, and how we split the remaining work so we are not editing the same files.

Read `TASKS.md` for the full task list. This file is the delta and the plan.

---

## 1. The one thing only you can do

**The live event is frozen and nobody can join.**

`https://zerohour1.eastus.cloudapp.azure.com/` reports `phase: "frozen"` at
minute 486. `ensurePlayer` refuses anyone new with *"Late registration has
closed"* once the round is past its late-join cutoff, so every new player is
turned away.

Sign in as `heist_superadmin` → **Event Control → Run the event → Reset the
event** → type `RESET`. A restart is **not** a reset. I could not do this: the
organizer token can call `start`/`freeze`/`pause`/`resume`/`announce`/`release`
but `reset` is superadmin-only, and the password you were given in the previous
session was deliberately never committed.

That player who messaged you "Server at capacity, retry later" was hitting this.
The server was not at capacity — 3 connections against 60 places. See §3.

---

## 2. The session before mine (~00:40–05:20 IST)

Context, because this file is the second half of a story. That session's own
notes are `HANDOFF_FOR_NEXT_AGENT.md` and the running log at the bottom of
`TASKS.md`; both are still accurate. Summary:

It took the project from "runs on a laptop" to "live on the internet". The VM
was bare — no Node, no nginx, nothing in `/srv` — and ended the session serving
`https://zerohour1.eastus.cloudapp.azure.com/` on a real Let's Encrypt
certificate, with Node private on `127.0.0.1:8080`, nginx owning 80/443, Atlas
for persistence and GitHub Actions deploying `main` automatically.

Ten PRs landed (#1–#10): Azure deployment assets and a configurable listen
address, the collision rebuild, 34 live-editable settings with true
pause/resume, CI and deploy workflows, the super-admin operator console,
structured challenge briefs, the collapsible neon HUD, optional player profiles
with an organizer roster and CSV, and the spectator board at `/board`. They were
*stacked*, which is why the history looks odd: merging #1 first put only its
three commits on `main` while the rest pooled in `feat/player-profiles`, and
#10 brought the superset in.

**The map rescue is the big one.** The OpenCV pass had classified only
neutral-grey floor as walkable, so painted plazas, kerbs and road markings all
became blocked speckle — 75–91% of every scene was blocked. The rebuild is
*monotonic*: it only ever opens a tile, never closes one, which is what
guarantees no marker, gate or route can regress.

| | Before | After |
| --- | --- | --- |
| Walkable tiles | 6,183 | **13,475** (2.18×) |
| Open floor | 4,042 | **12,937** (3.2×) |
| Dead-end tiles | 191 | **26** |
| Cramped (2-neighbour) | 1,950 | **512** |

**Staff credentials.** The four accounts exist in Atlas, but the passwords in
`bot-runs/admin-access-PO2lzB/credentials.json` all returned 401 despite an
earlier report recording a successful login; the cause was never established.
All four were reset with `tools/reset-staff-password.mts` and the new passwords
were given to you directly in that session, deliberately never committed. If
they are lost, reset again — the tool is idempotent, only touches
`admin`/`superadmin` accounts, and refuses a player account.

### Invariants that look like style and are not

These are the easiest things in the codebase to break with a well-meaning edit.

- **Live settings work by in-place mutation.** All 90 `EVENT_RULES` reads are
  property accesses at call time with zero load-time destructuring, which is
  why `applySettings` mutating that object takes effect everywhere. Write
  `const { cap } = EVENT_RULES` anywhere and every live override silently stops
  working.
- **₹4,000 is enforced in three independent places on purpose** —
  `derivePools` makes TREASURY absorb the remainder, `planSettings` re-checks
  the sum and rejects a negative Treasury, and `EventEngine.transaction`
  asserts the total and that every account delta has a ledger row. `total` is
  deliberately not an editable setting.
- **Pause is total, not cosmetic.** `gameNow()` returns `state.pausedAt ||
  clock()`, `tick()` returns early, player actions are refused, and
  `shiftDeadlines` moves every stored timestamp forward on resume. **Any new
  timestamp field on `State` must be added to `shiftDeadlines`** or it expires
  during a pause.
- **The world builder's marker guard is load-bearing.** It caught a dilated
  building footprint swallowing the Raid Circle tile. Do not weaken it.

### Decisions already taken — please do not re-litigate

Keep default economy values and make everything editable instead. Rewrite
challenge *presentation* only: answers and validators stay byte-identical so
the printed Challenge Book still matches. No signup gating of any kind — no
join code, no approval queue. `hud-revamp.css` layers over `event.css` rather
than replacing it, to preserve four already-tuned breakpoints.

One decision was flagged for your review and still stands: **the organizer API
is public over HTTPS** (`deploy/azure/nginx-staff.conf`), rather than reachable
only through an SSH tunnel. The reasoning was that the person running the event
is not a developer and a tunnel on the day is a single point of failure nobody
present could repair. Every route still re-checks the account role against the
database per request, and `/metrics`, `/health`, the debug endpoints and the
painter remain unproxied. To revert, delete one `include` line from
`nginx-https.conf.template`.

### Environment traps that have already cost hours

Each of these produced a real, confusing failure. Full list in
`HANDOFF_FOR_NEXT_AGENT.md` §4; the ones most likely to hit you again:

- `| tail` hides a non-zero exit code — a deploy "succeeded" twice because of it.
- `sudo VAR=x cmd` passes nothing; sudo strips the environment.
- `/srv/the-heist` is root-owned and setgid, so any sync tool that copies
  directory attributes fails on the destination root while transferring every
  file correctly. Fixed in both paths. **Do not chown it** — the service
  account needs group access.
- Stale `dist` + `tsconfig.tsbuildinfo` from Windows silently break the Linux
  build: `tsc` believes it is up to date, emits nothing, and the build
  "succeeds" with missing `.d.ts`. `deploy.sh` always cleans first; keep it.
- Heredocs break on apostrophes in Git Bash here, and `rsync` does not exist in
  it.

---

## 3. What is merged to `main`

Six PRs, all CI-green, all deployed to the VM automatically.

| PR | What |
| --- | --- |
| #11 | Viewport sized from the HUD's real height; gate labels no longer clipped |
| #12 | Every HUD overlap cleared across 21 viewports; CI now renders the client in a browser |
| #13 | **E1** — economy funded for 60 operators; challenge logic audit; two validator fixes |
| #14 | **E3** — hosting load fixture repaired |
| #15 | **C3 (part)** — contracts ordered by soonest expiry instead of hash-map order |
| #16 | Enrollment refusals report the real reason instead of "server at capacity" |

### The bug that made the game look broken

Your `3dab3ab` scoped `.oc-dialog` to `[open]` and added
`tools/check-dialog-visibility.mjs`. That fix was **correct and never reached
production**: its deploy failed on the live-event guard, so the VM kept serving
the unscoped rule. An opaque 1180×900 operator console was painted over the game
canvas for every player, staff or not — that is the navy block in the
screenshots, `#070b14`. Merging the PRs above carried it out. Verified live:
`.oc-dialog[open]{display:flex}` present, unscoped rule gone.

### Things worth knowing about

**60 players needed more than a number.** `EVENT_RULES.maxPlayers` sizes the
Starter pool (`starterPay × maxPlayers`), so the VM's `MAX_PLAYERS=60` was
seating operators the economy did not fund. Raising it exposed that Homes were
restricted to wards A–C — **45 plots** — so the 46th operator would have been
refused claiming all 90 addresses were taken. Funding came from the Black Ledger
seed (₹700 → ₹500), not the Treasury, which stays at ₹300 because it backs your
live corrections to players. Total still exactly ₹4,000.

**Two challenges were quietly eating paid contracts.** BG-03 and BR-10 rejected
their own correct answer if it carried a trailing space, because splitting
untrimmed input produced empty tokens. Pasting an answer is the obvious way to
pick one up. Found by `tools/check-challenge-logic.mts`, which now runs in CI
over all 42 templates.

**The CRLF trap is real and will bite you again.** The world builder hashes raw
bytes of `maps/art-world-v2.layout.json` and `.obstacles.json`. If your checkout
has them as CRLF you get `Stale collision review` and the build refuses.
`.gitattributes` pins them to LF; the fix is `rm` then `git checkout --` on the
two files, **not** touching the builder.

---

## 4. New tooling you can lean on

```sh
node tools/ui-audit-suite.mjs            # both UI audits against a disposable server
node tools/ui-hud-audit.mjs <out> <url>  # HUD geometry at 21 widths + collapse
node tools/ui-overlap-audit.mjs <out> <url>   # panel collisions and clipping
npx tsx tools/check-challenge-logic.mts  # all 42 templates x N variants
```

`ui-audit-suite` and `check-challenge-logic` are wired into CI. The UI audits
start their own sqlite world in a temp directory and force
`DATABASE_BACKEND=sqlite`, so they cannot reach Atlas — `process.loadEnvFile`
does not overwrite variables already set, which I verified rather than assumed.

`SHOT_ALL=1` on the overlap audit screenshots every viewport, which is the
fastest way to eyeball a visual change across sizes.

---

## 5. What remains

Nothing below is started unless noted.

| Task | Notes |
| --- | --- |
| **C3** rest | Challenge/workbench interaction polish. Ordering is done; the presentation pass is not. |
| **C4** rest | Operator briefing is done (PR open). Stuck detection and onboarding beyond first-run are not. |
| **C5** | Sound, juice, feedback. Nothing exists. |
| **D3** | Session hardening without adding player friction. |
| **B2/B3** rest | Teleport, kick, per-player round reset, mark-complete, un-checkout; phase skip and manual wave/race/Golden Hour/raid triggers. |
| **E2** | Load eval on the real 4 vCPU VM. Cannot be done from a laptop — see below. |

### E2 specifically

The hosting suite's functional checks pass now, but its performance gates
(`tick p99 ≤ 10ms`, `loop p99 < 75ms`) fail on a loaded development machine. My
run: `spread` tick 6.5ms (pass), `crowd` 14.8ms (fail), loop p99 ~104ms. Those
numbers are meaningless as a capacity result. Run on the VM, or a VM of the same
shape, with nothing else on it:

```sh
npm run bots:hosting -- --profile=lab
npm run bots:hosting -- --profile=soak
```

---

## 6. Working in tandem — the split

We will collide if we both edit the HUD. Proposed division, by file:

**Mine (do not edit without telling me):**

- `apps/client/src/main.ts` — viewport sync, HUD measurement
- `apps/client/src/ui/hud-revamp.css`, `event.css` — HUD layout and the briefing
- `apps/client/src/ui/help.ts`
- `apps/client/src/render/art-world.ts`
- `tools/ui-*.mjs`, `tools/check-challenge-logic.mts`

**Yours — high value, low collision:**

1. **C5 sound and juice.** Entirely new files. Nothing I am touching produces
   audio. Highest perceived-quality return for the effort, and completely
   parallel.
2. **B2/B3 operator actions.** `apps/server/src/http/staff-routes.ts`,
   `game/event-engine.ts` action switch, `ui/operator-console.ts`. I am not in
   the console at all.
3. **C3 workbench interiors.** `ui/challenge-workbench.css` and the workbench
   renderers — the *inside* of a terminal. I am working on the HUD *around* it.
   Agree the boundary before starting: I will stay out of
   `challenge-workbench.css` except for the `.activity-banner` rule I already
   changed.
4. **D3 session hardening.** Server-side, no overlap.

**Both of us:** branch from `main`, one PR per concern, written self-review
comment, `--merge` not squash so the individual commits survive. Rebase on
`main` before opening — I am merging several times an hour.

### Before you start anything visual

Run `node tools/ui-audit-suite.mjs` first and keep the baseline. It is 0
collisions and 0 clipped panels across 21 viewports right now, and it is very
easy to regress that by moving one fixed-position panel.

---

## 7. Current verification state

```
shared 100 · server 175 · bots 71      all passing
client typecheck                        clean
world reachability                      124 hotspots, 44 gates, 90 plots, 3 spawns
world reproducible from sources         yes
challenge logic, 42 x 40 variants       1,680 generated, no findings
HUD geometry + overlap, 21 viewports    0 and 0
dialog visibility                       31 rules, none can paint while closed
```

The map was checked for swaps after it looked wrong in a screenshot: all 19
scenes sit on their authored grid positions, all 44 gates resolve with no
self-loops, every connector's gates lead only to the districts in its title, and
every scene renders its own artwork. The six wards deliberately share one source
image but hold distinct plots H001–H090. **No swaps.**
