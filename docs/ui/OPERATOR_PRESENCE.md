# Operator presence pass

City artwork, buildings, map data, HUD layout and gameplay timing are unchanged.

## Sprite atlas

Source artwork: `apps/client/public/art/operators/operator-sheet.svg`.
Rebuild with `node tools/build-operator-sheet.mjs`.
The SVG is original vector artwork with no embedded fonts, remote resources or image dependencies.

The transparent atlas is 480 × 256 pixels, with 48 × 64 cells:

| Row | Facing | Columns |
| --- | --- | --- |
| 0 | Front / DOWN | Idle A, idle B, walk 1–8 |
| 1 | Back / UP | Same |
| 2 | Right / RIGHT | Same |
| 3 | Left / LEFT | Same; mirrored side artwork |

Foot anchor: (24, 54). Game scale: 0.8, preserving a compact roughly 40-pixel human silhouette. Dark field suit, outlined hair/head, visible hands/face, cyan comms detail and articulated boots replace the block silhouette. No skin customization or new player-state fields are required.

The browser rasterizes one shared atlas. Each visible operator uses one drawImage call for its body; offscreen actors remain culled and existing depth order/foreground occlusion are preserved. No character textures are generated per frame or per player. A simple fallback keeps the player visible if the sheet cannot load.

An authoritative movement step advances half a gait; alternating tile parity alternates the lead foot. Eight frames show opposite leg lift and arm swing with a small torso bob. Direction selects the existing shared DIR facing immediately. Movement interpolation, prediction, packet codecs, cadence, collision and server state are untouched. Reduced motion suppresses idle breathing and decorative effects; the walking gait remains visible because it communicates locomotion.

Preview all facings and animation loops at `/art/operators/preview.html` on the local server. This is an asset-review page, not part of the gameplay HUD.

## Presence and feedback

- Layered soft ground shadow and a restrained cyan ellipse for the local player.
- Compact rounded nameplate, subtle status dot and local focus chevron; existing names toggle and crowd suppression remain.
- Nearest eligible interaction anchor gets short cyan corner brackets and a faint ground light. Positions and selection come from existing map data and `nearbyInteractions`; no authoritative interaction range changes.
- Highlight fades on entering/leaving range. Prompt entrance uses a 170 ms fade/scale, with reduced-motion support.
- Existing terminal light pulses are restrained to a smaller, slower brightness variation. No new paint or light effects are applied to the city image.
- Terminal panels enter over 180 ms. Existing district entry and bounded notifications remain.
- Positive changes to server-confirmed total wealth briefly display the actual delta beside the account total. Initial state and event-start changes establish a new baseline. Transfers between Home/Bank do not invent a reward.

## Verification

Client production build, TypeScript, input contract, contract UX, closed-dialog visibility and operator visual checks pass. `tools/check-operator-visuals.mts` checks shared direction mapping, all eight gait frames, alternation, idle, frame bounds and the 40-cell atlas. Browser review covers native game scale, side movement, nearby highlight and the enlarged sprite-sheet preview.

This pass does not claim a new multiplayer capacity result; it keeps rendering bounded to one atlas and the existing visible-actor list.

Walk-cycle correction: increased the stride to ±5.5 source pixels (8.8 display pixels between opposite foot extremes), added intermediate poses and brighter sole details, and removed the reduced-motion freeze on walking. A tile-boundary regression check verifies that the second foot continues the gait instead of replaying the first foot.
