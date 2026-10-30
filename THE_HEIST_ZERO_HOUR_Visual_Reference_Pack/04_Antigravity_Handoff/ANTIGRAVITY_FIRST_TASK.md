# Antigravity — first implementation task for THE HEIST: ZERO HOUR

Read the entire existing repository and the game design/bible documents before editing code. Also inspect `THE_HEIST_ZERO_HOUR_Visual_Reference_Pack/README_FIRST.md` and use the images in this pack as visual art direction only.

## Goal
Build the playable, grid-aligned 2D top-down multiplayer city foundation for THE HEIST: ZERO HOUR, designed for 50–60 concurrent players sharing one continuous world. Do not create a landing page or dashboard pretending to be the game. Do not use a generated district image as one giant background and do not claim AI images supply valid collision geometry.

## Required approach
1. Audit the repository first. Report the current framework, what already works, what is missing, and a safe implementation plan. Preserve working code and the project's existing design-bible rules.
2. Keep all critical gameplay/economy logic on the authoritative server. The client must never decide money movement, robbery rewards, bank transfers, caps, jail, cooldowns, raid payouts, or other balance-affecting outcomes. Do not silently invent or change rule values from the game bible.
3. Establish a canonical top-down orthographic grid; use 32×32 px as an initial tile-scale reference. Use the master layout and six district images to decide approximate district arrangement, but reconcile all entrance/exit coordinates explicitly. Independently generated connector art may not line up exactly.
4. Create a real playable blockout using a tilemap (prefer Tiled if compatible with the repository) or a clearly documented structured map representation. At minimum, separate ground, decorative props, buildings/foreground, solid collision, walkable/navigation metadata, spawn points, district exits, and interaction objects.
5. Prioritize correct player movement, camera follow, world bounds, building/water collisions, district exits and clear movement routes over decorative detail. Use a smaller foot-centered player collision body than the visual sprite. Avoid rigid player-to-player collision that can seal doorways; use soft separation or overlap handling if needed.
6. Design the world so 50–60 players can spread among six districts while crowds can form at hubs. Use broad primary routes and alternate paths; don't assign a fixed player quota per district. Ensure every key terminal has a clear approach/standing zone and does not block through-traffic.
7. Add meaningful interaction-object coordinates and action identifiers as structured data, but initially use placeholder panels/indicators rather than faking game systems. Connect each interaction to the real server API only when that API and the game rule are verified.
8. Keep image files under a dedicated reference directory (for example `docs/art-reference/`) and do not import labels, legend panels, or whole atlas sheets as normal in-game sprites. Propose a sprite extraction pipeline; any asset slicing or cleanup should be inspectable and repeatable.
9. Add loading/error states, resize handling, reconnect handling where applicable, and developer diagnostics. Avoid unnecessary advanced libraries or a large rewrite before the first slice works.

## Build in vertical slices
**Slice A (first deliverable):** one small playable section with grid movement, camera follow, world bounds, tested wall collision, one exit, one interaction point, and a visible collision/debug overlay. It should run locally. Include exact commands.

**Slice B:** expand to six districts and the seven connectors, with route continuity and named interaction placeholders, using the canonical grid.

**Slice C:** multiplayer state sync and server-authoritative movement/interaction validation; test 2–5 clients, then load-test 50–60 concurrent clients. Do not declare capacity from code inspection alone.

**Slice D:** replace blockout tiles with cleaned, normalized assets and add ambience, animation and UI polish without shrinking walkable space.

## Acceptance criteria for Slice A
- I can start the app by following the README commands.
- The player moves in all four directions, camera follows, resizing does not break the canvas, and world boundaries work.
- Collision is based on structured map data, not visual guessing from the illustration.
- A visible dev toggle shows grid, collision bodies, spawn/exit objects and interaction radius.
- The interaction only fires within a validated radius and cannot grant money or rewards from client-side code.
- No unrelated systems are broken, and the handoff lists files changed, commands run, tests run, and known limitations.

## Output before coding
First present a brief repository audit and planned Slice A file changes. Then implement Slice A completely, run the relevant checks, fix issues, and provide a concise report. Do not stop at a plan or leave TODO-only stubs as the deliverable.
