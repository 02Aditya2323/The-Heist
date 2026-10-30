# Challenge windows / UI and UX audit

14 October 2026. This continues the terminal-card redesign without replacing map art, challenges, rules or the saved event.

## Coverage

All 42 final-book templates use a themed mission brief and action panel. All 17 interactive workbench kinds have purpose-specific headers, icons, three-step workflows and a responsive tool layout. Legacy text-only contracts retain the same briefing/answer shell.

| Workbench | UI upgrade | Browser interaction checked |
| --- | --- | --- |
| Code | Read-only editor chrome, safe syntax colour, selected lines, trace rows | Highlight, trace entry, calculator and a server-accepted practice answer |
| Debug | Repair controls, source preview, simulation output | Chosen repair produced server output 154 |
| Cipher | Larger decoded preview, transform controls, undo, substitution grid | Shift, reverse and undo restored the original preview |
| Deduction | Clue cards, elimination board, digit slots | Candidate elimination; numeric boards collect their answer without a second text box |
| Logs | Filter toolbar, signal counts, pinned evidence and empty states | FAIL filtering and row pinning |
| Machine | Target readout, transformation stages, test-run counter | Five probes completed; sixth-run control disabled |
| Portal | Clearly fictional sandbox, notice cards, remembered mock fields | Mock credentials collected into the answer; no real password used |
| Maze | Token board, legend, direction pad, route readout | Movement/undo; teleport disabled away from a numbered pad |
| Tree | Interactive arrow diagram, highlighted nodes, contained mobile scrolling | Two nodes collected into the answer |
| Ring | Directed payment diagram and selected nodes | Node selection collected |
| Order | Numbered task rows, drag and keyboard-friendly earlier/later controls | Reordering worked and retained keyboard focus |
| Lights | Lit/unlit panel states and clear reset | Press sequence collected; focus retained; reset worked |
| Statements | Witness clue cards and visibly selected suspect | Suspect selection retained its pressed state |
| Oracle | Large three-digit input, native format checks, server response panel | Valid guess received exact/misplaced feedback |
| Circuit | Switch board, four live logic-stage cards, local output preview | Switch state updated the matching gate; verification remains server-side |
| Courier | Number input, native range checks, response panel | Server Higher reply; Enter submitted a guess |
| Constraints | Labelled assignment cards | A chosen value collected into the answer |

## Surrounding player windows

The existing common terminal shell covers Bank, Raid, job centres, Home sites, race/event terminals, Checkout, leaderboard, announcements and the journal. This pass additionally styles login, safehouse panels, private/broadcast message cards, map inspector, toasts, connection banners, location errors, release confirmation and solved/locked/expired challenge states. The stitched M atlas is preserved, not rebuilt. Organizer admin and map-painter tools are outside this player-window pass.

Login has keyboard submission, initial focus and a focus loop. Checkout's existing minute-150 eligibility and acknowledgement remain intact; no Checkout was executed for visual QA. All UI actions still delegate intent to the application controller.

Non-challenge centres keep their own controls first instead of placing a long workbench above them. Active contracts are reached through a journal shortcut. The Home fixture verified entering protection, the protected badge, and leaving when the dialog closes. Verification/probe/release controls become read-only while disconnected; shutting down the disposable fixture confirmed the reconnecting badge and disabled verification. Returning to authentication closes an old terminal so it cannot obscure login.

## Verification

- Initial browser sweep: 42/42 templates rendered one selected card and three workflow steps, with no dialog horizontal overflow at desktop 1280 × 720 and phone 375 × 812.
- After a practice completion, a further final-build sweep covered all 41 remaining templates and every workbench kind; zero horizontal overflow. Code/trace and network regions may scroll internally on small screens intentionally.
- The release sweep was repeated on a fresh fixture after the timer/context changes: all 42 templates, all 17 kinds, one selected card and three workflow steps each; zero desktop or mobile overflow and no browser errors.
- Private notes, a trace value and a highlighted source line survived reload. Typed answer drafts survived card switching. Text-answer drafts remain in-memory; full refresh retention is not claimed.
- Calculator, source highlighting, repair simulation, cipher undo, filtering/pinning, board selections, route undo, reorder focus, guesses and probe exhaustion were exercised through visible browser controls on in-memory fixtures.
- Answer cooldown and three-answer lockout use server timestamps, not browser-generated deadlines. During a cooldown, verification is disabled while local tools remain usable. Published timer regression verifies the existing five-second rule without exposing an answer.
- Shared tests: 100 passed. Server tests: 103 passed, including the new public-timer regression, all validators, network gameplay and the 40-operator smoke.
- Latest crowd smoke: no tick overruns, rate-limit drops, malformed messages or backpressure; movement tick P99 2.582ms. This is local evidence, not a full lab-VM certification.
- Client TypeScript check, production build, client-input check, calculator check, raid-card model check and workbench-design check passed.
- All workspace build stages (shared, server, client and bots) passed. Subsequent frontend-only refinements were typechecked and rebuilt again.
- Browser error logs at the inspected checkpoints were empty. Deliberate incorrect practice submissions were used to exercise feedback; no paid main-event action or organizer Start was issued.

## Safety and performance

The only backend behavior addition is optional public `answerReadyAt` metadata derived from the existing `lastAnswer` and `EVENT_RULES.answerInterval`. Timing rules, validators, ledger mutations, payout amounts, packet codecs, movement and map/collision data are unchanged. New graphics are CSS/native SVG, with no extra raster maps, dependency, continuous animation or network feed. Source decoration uses text nodes, never HTML execution. Reduced motion and visible focus states are supported.

Disposable fixture tabs and processes were closed. The main preview was found offline and restarted with the existing saved database, after a read-only check confirmed lobby phase. HTTP checks returned 200 at ports 5173 and 8080; a second read-only check confirmed the same three-player roster, lobby phase and `startedAt: 0`. No event reset or Start was issued. The existing browser tab still needs a manual refresh: its old internal network-error page could not be inspected through browser automation, and that restriction was not bypassed.

Screenshots are in `screenshots/challenge-*` and `screenshots/game-*`. Repeat the isolated preview using `npx tsx tools/workbench-qa-server.mts --all`; optionally use `--station home-h001`, `--station checkout`, or `--empty`. This helper is not a production startup command. Its database is in memory, and its port is printed at launch.
