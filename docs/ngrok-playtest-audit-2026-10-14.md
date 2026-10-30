# ngrok public playtest verification — 2026-10-14

The current production game on `0.0.0.0:8080` was tunneled without restarting
the game process or modifying the event/players/database. The official
`@ngrok/ngrok` SDK loads the credential from the ignored root `.env`; no real
credential is in tracked code, npm script arguments or the client bundle.

Verified against the actual public HTTPS endpoint:

- `/` returns the current built game HTML (200).
- Referenced JavaScript and CSS assets return 200.
- `/api/map` returns the game map (200).
- `/api/event` returns the same live phase (200).
- `wss://.../ws` completes the WebSocket upgrade; an intentionally invalid
  token is rejected with the correct 4001 code. This verifies secure transport
  and server authentication without creating a test player or changing scores;
  it is not a claim that two remote players have been playtested.
- Public `/metrics`, `/debug/entities`, `/admin.html`, `/painter.html`,
  `/api/admin/event`, `/api/staff/challenges`, `/api/staff/challenges/open`,
  `/.env`, and `/bot-runs/organizer-private.json` return 404 at the ngrok edge.
  Query-string and encoded-path probes of metrics also return 404.
- An additional Windows encoded-separator probe initially reached a built staff
  HTML page through the asset route (not its authenticated API). The tunnel
  filter was tightened before handoff to permit only literal safe asset paths,
  rejecting encoded separators and parent segments. Re-tested public
  `/assets/..%5cadmin.html`, `/assets/..%2fadmin.html`, and
  `/art/..%5cpainter.html` now return 404; real world manifest/artwork/JS/CSS still
  return 200. Only the tunnel was restarted, not the game.
- The live local server remains healthy with its existing connections.
- A fresh browser tab, after the standard ngrok welcome page, visibly renders
  the operator login and Central Exchange preview over the public HTTPS URL.

The reusable `npm run tunnel` prints the currently assigned URL; do not assume
an old address stays assigned across restarts. Staff HTTP controls deliberately
remain local. Admission remains subject to the live event's normal capacity and
late-registration rules. Token rotation and actual friend gameplay are left to
the user; this task does not reset the live round or weaken its rules.
