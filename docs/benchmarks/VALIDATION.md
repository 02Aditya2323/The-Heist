# Benchmark implementation validation

Validated on 29 October 2026 using Node 22.19.0.

- `npm run build`: passed all four workspaces.
- Client TypeScript check: passed (`tsc --noEmit --incremental false --composite false -p apps/client/tsconfig.json`).
- `npm run test:server`: 197 passed.
- `npm run test:bots`: 72 passed with the repository's explicit serial integration-file configuration.
- `npm run test:shared`: 100 passed.
- `git diff --check` and both benchmark-tool syntax checks: passed.
- Rebuilt CLI smoke: two active players, ten measured seconds, exact accounting of all 202 ticks, successful reconnects, and zero players/ghosts after 32-second cleanup. This smoke is excluded from capacity claims.
- Publisher: deterministic/idempotent output, exact raw tick-population reconciliation, all 19 campaign results retained, and no fixture credential fields in published JSON.
- Landing page: verified all five measured cards, environment disclosure, full-game scope note, and report navigation at `http://127.0.0.1:8095/#tech`.

The first combined regression run exhausted timing headroom: the collision-mask test timed out and the legacy bot traffic gate failed. The bot gate also failed while its integration files ran concurrently. Serial integration files passed twice; the normal bot command now explicitly uses that configuration. No timing, correctness, or benchmark gates were relaxed. The shared collision check passed independently in 596 ms. Campaign load measurements ran sequentially, before regression builds/tests.

After measurement, the core fixture startup guard was made portable across path separators and the CLI summary was corrected to include its final ACK-drain tick sample. The publisher independently reconstructed each campaign's full tick population from raw observations, so the published headline includes that interval. Per-run build and runner hashes identify the measured artifacts; source formatting and these reporting/startup corrections do not change the simulated workload or game rules.

Raw databases and fixture credentials remain in Git-ignored `bot-runs/`. Public evidence contains summaries only. No public deployment or Render WSS/wake-up smoke was performed. All changes remain local and unpushed.

See [measured results and resume wording](RESULTS.md), [machine-readable results](results.json), and the [verified landing screenshot](landing-results.png).
