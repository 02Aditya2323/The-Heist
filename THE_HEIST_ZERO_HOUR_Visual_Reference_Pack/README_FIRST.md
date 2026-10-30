# THE HEIST: ZERO HOUR — Visual Reference Pack

This pack organizes the generated visual references for the shared multiplayer city.

## Contents
- `00_Master_Layout/`: the whole-city layout reference.
- `01_Districts/`: six district references. The Tech Quarter alternate is included as an optional design alternative; choose one visual direction before building final geometry.
- `02_Connectors/`: seven connector reference illustrations, numbered 07–13.
- `03_Asset_Sheets/`: building, street-prop, interactive-object, and operator-character concept atlases.
- `04_Antigravity_Handoff/`: the finalized team game document and initial Antigravity task prompt. Read the game document as the source of truth for gameplay/economy rules.

## Critical implementation caveats
1. These are AI-generated **visual references**, not production-ready tilemaps, collision maps, or transparent sprite atlases. Most images contain baked-in labels, decorative grids, lighting, and non-uniform scale. Do not display a whole district image as the playable world's background and call it a finished map.
2. Do not assume that roads line up exactly at district/connector edges. The pictures were generated independently. Build a canonical tile grid and align all exits on that grid in Tiled (or the chosen level editor).
3. Use a **32×32 px tile as the initial scale reference**, not an immutable promise that every sprite is exactly 32 pixels. Test at the target viewport, and normalize player sprite frames and interaction offsets before shipping.
4. Build separate, inspectable map layers: ground, decoration, buildings/foreground, solid collision, walkable/navigation metadata, spawn points, exits, and interaction objects. Keep gameplay coordinates and rules out of image pixels.
5. Target 50–60 simultaneous players in one world. Validate crowd flow around hubs and terminals; use broad primary routes, alternate paths, small interaction footprints, and avoid rigid player-vs-player collision that creates permanent door blockages.
6. The server must remain authoritative for money, burglary, bank transfers, jail, raids, jobs, caps and cooldowns. Client-side visuals or prompts must not decide financial outcomes.
7. Before slicing these atlas sheets into in-game sprites, inspect them. Since backgrounds and text are baked in, extraction may need cropping, cleanup, or redraw; do not use the whole sheet as a sprite texture in the game.

## Recommended workflow
1. Use these images as art direction only; produce a grid-based playable blockout with primitive tiles.
2. Confirm district positions, entrances, exits, route widths, and the camera scale in the actual running game.
3. Create a Tiled map (or a documented equivalent) with explicit collision and object layers.
4. Add clean, separately exported sprites after the blockout works.
5. Test with local simulated clients/bots and then a real 50–60-client load test before calling multiplayer ready.

## Folder is reference material
`README_FIRST.md` and `04_Antigravity_Handoff/ANTIGRAVITY_FIRST_TASK.md` are the task guidance to give Antigravity. The reference images do not imply that these implementation steps have already been completed.
