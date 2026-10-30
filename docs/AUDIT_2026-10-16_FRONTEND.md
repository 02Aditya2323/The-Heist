# Frontend audit — 16 Oct 2026

Written for the next agent (Aryan's session) and Advay. Kept in its own file so
it cannot conflict with parallel edits to `HANDOFF_FOR_NEXT_AGENT.md`.

## Log

- **11:00** Advay: Rs 20 contracts look locked. Cause: intended wave release
  (Standard slots open at set minutes, one claim per slot, one contract per
  operator per wave), but the card only said "0 eligible paid slots". Fixed:
  the server sends `lockedReason` and the card shows it, e.g. "Not released
  yet. Next paid slot opens in about 80 min." No claim rule changed.
- **11:05** Found: with the operator briefing open, arrow keys still move the
  player underneath it. Aryan's `help.ts`; reported in PR #20, not changed.
- **11:10** Verified end to end in a browser: two gates, Harbor Job Board,
  take contract, structured brief, wrong answer gets "Answer rejected",
  console tabs, staff preview. 0 server errors, 0 browser exceptions.
- **11:20** PR #20 open and CI green. Merge needs a human click.

## How it was tested

A disposable local server (sqlite in a temp dir, event started with a one-shot
`HEIST_ADMIN_TOKEN`), driven by headless Edge over CDP:

- **Player**: register → world → walk through two district gates to the Harbor
  Job Board → take a contract → read the brief → submit a wrong answer → close
  → journal (J) → city atlas (M) → collapse HUD (H).
- **Superadmin**: world → Event Control, all five tabs → close → staff dock →
  open a challenge preview.

Plus: build, shared/server/bots suites (100 / 175 / 71 pass), client `tsc`,
`check-world-reachability`, `check-challenge-logic` (42 × 24 variants), and
`ui-audit-suite` (21 viewports, 0 collisions, 0 offscreen). 0 server errors,
0 browser exceptions.

## Broken, and fixed on branch `fix/frontend-audit` (not pushed)

1. **Opaque black panel over the game for every player.** `.oc-dialog {
   display: flex }` overrode the UA rule that hides a closed `<dialog>`, so the
   operator console painted at 1180×900 in the top-left from page load. Already
   on `main` in `3dab3ab`; this branch adds `tools/check-dialog-visibility.mjs`
   (proved to fail on the original bug) and runs it in CI and deploy.
2. **Staff dialogs pinned to the left edge, not centred.** The `* { margin: 0 }`
   reset in `index.html` zeroed the UA's `margin: auto` for modal dialogs. Fixed
   with `dialog:modal { margin: auto }`.
3. **EVENT CONTROL button covered the latency readout, nearby count and City
   maps button.** It was `position: fixed` over the status bar. It now lives
   inside `.world-status` and flows with it. The HUD audits only log in as a
   player, so they could not see this.
4. **Staff challenge preview showed the raw prompt**, not the structured brief
   players see, so organizers could not review the answer-format block. The
   brief renderer moved to `apps/client/src/ui/challenge-brief.ts` and both the
   terminal and the staff preview use it.

## Not done — honest status against the original asks

- **No new challenges were added.** Still the original 42. The locked Q&A
  decision was "rewrite prompts + add structure, validators unchanged", so new
  challenges were never in scope. Ask Advay before adding any.
- **Prompts were not rewritten.** PR #6 added structure and an explicit answer
  format per workbench kind, but `scenario` is the old prompt text and `task` is
  the old objective verbatim. `TASKS.md` C2 is ticked, but this half is open.
- **No hints exist.** The card renders a "Stuck? Open a hint" section, but no
  challenge supplies `hints` or `data` (`final-challenges.ts` never passes brief
  overrides), so those sections never appear.
- **Situation and task can disagree.** Example, SD-02: situation says "report
  the first packet seen exactly once", task says "Read the program and type
  exactly what it prints". The task is a generic per-workbench default. This is
  the vagueness the owner complained about; fixing it means per-challenge `task`
  text.
- **Wrong-answer feedback unverified.** After submitting `definitely-wrong` the
  status line still read "Contract accepted…". Possibly the minimum solve time
  refused it silently, possibly the form path differs. Needs a manual check.
- Still open from `TASKS.md`: B2 remainder (teleport, kick, per-player reset),
  B3 remainder (phase skip, manual triggers), C4 onboarding/stuck detection,
  C5 sound/juice, D3, E2 60-player load test on the VM, gameplay video.
- `TASKS.md` is stale: C3, E1, E3 were done in PRs #13–#15 but are unticked.

## Reproduce

The walkthrough script lives outside the repo; the pattern is the same as
`tools/ui-audit-suite.mjs` (spawn `apps/server/dist/main.js` with sqlite env,
start the event with the admin token, flip a user to `superadmin` in the
sqlite `players` table, drive Edge with CDP).
