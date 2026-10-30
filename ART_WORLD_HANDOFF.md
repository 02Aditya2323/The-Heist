# Veyra City original artwork integration

For the complete current game and deployment handoff, read
[PROJECT_HANDOFF.md](PROJECT_HANDOFF.md). This file preserves a much earlier
artwork-integration milestone, not the current gameplay feature checklist.

Historical v22 handoff. Superseded by the fully regenerated v30 world; see `WORLD_BUILD_AUDIT.md` for current assets, commands, checks and limitations. The original reference pack remains unchanged.

The playable client now uses the six district images and seven connector images from the visual reference pack. The original PNGs are preserved. Lossless WebP copies have been checked for identical decoded pixels. The user chose faithful original artwork over AI detail restoration; the separate Central Exchange restoration candidate is not used in gameplay.

## Run and review

From the repository root:

```powershell
npm run build:shared
npm run build:art-world
npm run build
npm run dev:server
```

Open http://localhost:8080 for the built game, artwork, HTTP API and WebSocket on one origin. Development can also use `npm run dev:client` and http://localhost:5173. Vite proxies the API and WebSocket to the same game server. Set `MAP_PATH` only when intentionally loading another map; this overrides the original-art world.

Select **Preview the original city maps** at sign-in, or press **M** during gameplay. The menu has all 13 art scenes. **1:1** displays source pixels at the native world scale; mouse wheel or the zoom controls change camera scale without enlarging the source files. Drag to pan during review. Return to the operator with Esc. Movement uses WASD/arrows, **E** inspects nearby terminals or travels through a marked entrance. **F3** shows rendering/network diagnostics and **F4** shows the actual collision grid and interaction radii.

## How the map works

`maps/art-world.layout.json` is the editable source: original source-file association, panel coordinates, manually traced floor corridors, interaction positions and paired exits. `npm run build:art-world` produces `maps/art-world.json` for the server and `apps/client/public/art/world.json` for the anonymous visual preview. Both are decoded with `loadMap` from `@heist/shared`.

The source pack swaps the contents of `06_NEXUS_Plaza.png` and `11_Central_Exchange_to_NEXUS_Plaza.png`; the layout selects them by their actual content. There are no source-file modifications. Six districts and seven connector panels are part of the same authoritative coordinate atlas. **E at a configured entrance performs a server-validated transition**, including collision checks and area-of-interest enter/leave updates. Independently generated edges are not claimed to form a seamless stitched panorama.

World tiles are 32 source pixels. The authoring grid covers 1664×928 pixels of each 1672×941 image; the unused right/bottom edge strips are cropped during drawing, with no non-uniform stretching. The world is 413×190 tiles, including blocked gaps between panels. Player standing positions, collision and terminal locations use this same transform.

Collision begins blocked and opens conservative manually traced road corridors. These are a first pass, not a semantic collision extraction from the images. Tests prove that all 16 terminals, 28 directed gates and their destinations are walkable and connected within each scene. Secondary alleys, foliage footprints and precise building entrances still need art-by-art calibration. The flattened references cannot correctly occlude a player behind every roof or tree; separate foreground masks are the next map-layer refinement.

## Clarity and resource budget

The replaced renderer used a 480×270 intermediate canvas. The current renderer draws visible portions of the original artwork directly into a screen-sized canvas, capped at DPR 2 and 60 draw frames per second. At most three decoded art panels stay in the renderer cache. Crowd name labels automatically reduce to the local operator when more than eight operators are present; the Names button also controls them. No health bar or invented currency is shown.

`maps/art-transport-report.json` records each lossless asset's dimensions, byte count and decoded-pixel identity. The full pack changed from 38.8 MiB of PNGs to 30.7 MiB of WebP transport files. Only the active district is fetched when first visited, and the server uses ETag and cache headers. Rendering runs on each player's browser; the VM stores collision/state and serves the static art. Actual capacity still depends on the lab PC, client devices and network.

To reproduce the optional lossless packaging, run `node tools/pack-map-art.mjs <path-to-sharp-package>` with Sharp available, then rebuild the art world. It changes encoding only, without resizing or changing any pixels. The generator falls back to the copied original PNG if no WebP is present.

## Mechanics audit

The game bible describes a 180-minute multiplayer technical-challenge event with about 85 operators and a fixed 400,000-paise economy. Player score is Home plus Bank; money must always move between accounts. Jobs belong to Tech Quarter, Data Harbor and Black Grid. Central Exchange contains the Bank, raid circle, race terminal, checkout and leaderboard. Undercity contains player Homes. NEXUS publishes announcements and Golden Hour events.

The existing server implements account authentication, binary movement, shared collision, cadence, spatial visibility, session replacement, ghost reconnection, SQLite position persistence and metrics. This integration adds server-distance-validated terminal information and district travel. Requests do not trust client-supplied positions or balances.

The following game-bible services **are not implemented yet**: conserved money ledger, challenge variants and answer validation, paid slot/lock/queue management, event scheduler, player-owned Homes, bank deposits/withdrawals, burglary and jail, 10-member raids and payouts, races/Golden Hour, checkout/freeze, and organizer administration. Terminal panels explain the published rules and explicitly identify the unavailable transaction/challenge features. They do not grant money or manufacture an active event.

The transport's 30-second ghost window and the bible's 10-minute protected economic disconnect grace are different concepts; the economic grace requires its own service when that layer is built. No rule value was silently changed.

## Verification

Shared and server suites cover protocol and movement plus the art map's connectivity, invalid remote interactions, validated gate travel, pending-move reset and visibility changes. `tools/check-art-multiplayer.mts` also connects 12 real local test accounts through HTTP/WebSocket, moves them using shared pathfinding/codecs, checks mutual visibility and inspects the raid terminal. It saves observed metrics in `screenshots/art-multiplayer-report.json`, keeps the group online briefly for visual review and then closes the test sockets. It is a local smoke test, not an 85-player capacity certification.
