# Regenerated Veyra City — world build v30

Update, 14 October 2026: the world below is preserved. The final challenge-book gameplay layer, 40-player economy, interactive workbenches and organizer controls are now implemented. See `GAMEPLAY_HANDOFF.md` and `docs/final-challenge-book-audit.json`; the original world-only test counts below describe that earlier milestone.

All six districts and all seven connectors now use newly generated game artwork. The original visual-reference pack is preserved and is not the playable background. Fourteen new native-resolution source images are saved in `docs/generated-world-v2/`: thirteen district/connector images and one fifteen-house residential block reused by six distinct Undercity wards.

## Delivered world

- Six canonical districts, seven canonical connector scenes, six added residential wards.
- Ninety distinct Home sites, H001–H090; fifteen addresses per ward. These are physical sites, not invented player ownership or balances.
- 124 structured interaction locations: 27 district POIs, seven route directories, and 90 Home sites.
- 44 reciprocal travel directions: 28 on the documented seven connector routes, plus 16 on eight residential streets.
- M opens the complete connected city atlas. It uses the same route records and scene coordinates as gameplay. Select a scene to see its POIs; select a POI to inspect its exact location. M returns from detail to overview; M again or Esc closes the map.
- WASD/arrows move; E interacts or travels at a marked entrance. F4 displays the actual shared collision grid. Entrances and Home addresses are rendered from game data, not baked-in image labels.

Central contains the Bank, raid circle, race terminal, checkout and leaderboard. Tech contains the job board, logic terminal, CP lab and debugging lab. Harbor contains its job board, data centre, SQL, OSINT, network tower and information point. Black Grid contains its job board, security hub, CTF arena, challenge terminal and sandbox. NEXUS contains announcements, Golden Hour, event, information and social locations. Undercity contains the information/market center and the linked housing expansion.

## Geometry and OpenCV

The build fingerprints the source image bytes as well as the layout and obstacle review. A changed image invalidates its collision review. Lossless transport files are accepted only when both source and encoded file hashes match the verified packing report. Artwork URLs include a content revision, and the renderer/atlas invalidate changed image references, preventing an older cached picture from being paired with new geometry.

`maps/art-world-v2.plan.json` defines the intended city facilities and layout before generation. `tools/prepare-world-v2.py` creates geometry guides and the staged layout. Image generation follows those guides and the original pack's visual style. Generation is not treated as precise collision geometry: `maps/art-world-v2.review.json` records the actual post-generation building, water and prop footprints, door approaches and corrections.

The offline OpenCV pipeline measures the actual source pixels: median-filtered saturation/value classify readable neutral-grey pavement, morphology removes small artifacts, a 6px standing-foot radius erodes ground, and reviewed solid/water polygons always exclude movement. Human-reviewed lit-pavement patches recover color-classifier false negatives; they never override hard footprints. Only the connected four-direction floor component is approved. Ambiguous surfaces and disconnected fragments remain blocked.

`tools/resolve-v2-entrances.mts` places invalid planned standing markers onto nearby already-approved floor without changing collision. The final review moved only three entrances, by one tile each. Changes are recorded in `maps/art-world-v2.entrance-adjustments.json`. Builds reject stale collision hashes, missing markers or blocked destinations. Tile rows are shared by client and server through `@heist/shared`; no separate renderer-only collision exists.

The grid samples 1664×928 native pixels at 32px per tile, cropping only the spare right/bottom source strips. No source image is stretched into a different aspect ratio or passed through a tiny rendering buffer. The source images themselves are not enlarged. One reviewed foreground layer handles the Black Grid connector's overhead checkpoint arch; its supports are solid, while the road under the arch remains passable.

This is supervised CV-assisted collision authoring, not a claim of perfect automatic semantic understanding. Very small decorative edges may need future refinement. The independently generated scenes form a complete connected world using server-validated entrance transitions; they are not claimed to be one seamless stitched panorama.

## Verification

- 100 shared tests and 17 server tests pass, including every landmark/gate's reachability, reciprocal routes, no four-direction islands, non-overlapping scenes, all reviewed footprints, exact mask agreement and the 90-site housing graph.
- Full workspace build and the client's separate type check pass. Input checks pass for WELCOME gating, quick taps, held-key priority and reset.
- The real HTTP/WebSocket tour visited all 19 scenes, inspected all 124 POIs, walked 3,115 authoritative steps, and performed 26 transitions with **zero movement rejections**. See `screenshots/complete-world-live-report.json`.
- Twelve simultaneously connected test operators passed collision-checked movement, mutual visibility and server-verified raid proximity with zero rejections. See `screenshots/art-multiplayer-report.json`. This is a local smoke test, not an 85-player load certification.
- Browser checks cover the M overview, scene selection, H090 location inspection, returning to the operator, and desktop/narrow layout. The narrow layout has no horizontal page overflow and exposes all 19 scene selectors.
- `docs/world-building-audit.json` confirms the live server map and public client map are identical and inventories all 14 source images by hash. All source/transport pairs have identical decoded pixels.

The generated PNG pack is 42.8 MiB; lossless WebP transport is 33.6 MiB (21% smaller). Six wards reuse one housing texture. Gameplay retains at most three decoded panels, uses a DPR cap of 2, and draws at most 60 frames/sec. The complete map loads small overview thumbnails. OpenCV and generation run offline, not on the game VM.

## Run

```powershell
npm run build:shared
npm run build:art-world
npm run build
npm run dev:server
```

The built game is at `http://localhost:8080`; the development client remains at `http://localhost:5173`. The server loads the generated `maps/art-world.json` unless `MAP_PATH` deliberately overrides it. The running local server was reloaded onto v30.

To reproduce collision authoring after editing the plan/review (not needed just to run): create a Python environment with `tools/world-analysis.requirements.txt`, then run:

```powershell
.venv-world-analysis/Scripts/python.exe tools/prepare-world-v2.py
.venv-world-analysis/Scripts/python.exe tools/analyze-world-collision.py --v2
npx tsx tools/resolve-v2-entrances.mts
.venv-world-analysis/Scripts/python.exe tools/analyze-world-collision.py --v2
.venv-world-analysis/Scripts/python.exe tools/prepare-world-previews.py --v2
npm run build:art-world
```

`npm run audit:world` repeats the real city tour and creates local QA accounts. Image generation used the built-in tool; the complete prompts and reference paths are in `docs/generated-world-v2/generation-prompts.json`, with the housing prompt in `housing-prompt.txt`. Lossless packing is optional and uses `tools/pack-map-art.mjs <path-to-sharp> --v2`.

## Historical world-only scope (superseded by the gameplay handoff)

At the original world-building milestone, the server supported authentication, authoritative movement, shared collision, visibility, reconnect/persistence, validated travel and read-only POI interaction. Economy and challenge systems were outside that milestone. They are now implemented; use `GAMEPLAY_HANDOFF.md` for the current scope and launch instructions. Current label metadata includes Code Review Desk in place of SQL Terminal, without changing its handler ID or geometry.
