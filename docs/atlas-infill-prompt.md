# Atlas scenery infill v1

Generated with the built-in image generation tool on 14 October 2026. Saved asset: `apps/client/public/art/atlas/veyra-infill-v1.png`.

This is a decorative **atlas-only** backplate, not a new playable map. Existing native artwork is composited above it without replacement, and all collision, coordinates and server travel gates remain unchanged. Generated details do not define POIs, Home sites or walkable space.

Inputs: `screenshots/atlas-assembly-guide.png` (layout), `docs/generated-world-v2/central.png` and `docs/generated-world-v2/c07.png` (art style).

## Final prompt

+Use case: compositing / stylized-concept.
Asset type: a non-interactive connective scenery backplate for the full city atlas of The Heist: Zero Hour.
Input image 1: exact 5-column by 7-row assembly layout guide (not finished art). Input image 2: detailed Central Exchange art style. Input image 3: detailed connector art style.
Primary request: transform the dark unused spaces of the first guide into a cohesive top-down night city landscape that visually connects all its existing map pieces into ONE complete continuous city, not postcards or a node-link diagram. Match the strict top-down orthographic game-map view, building scale, grey stone pavement, rooftop details, warm streetlamps, cyan/amber/purple/red lighting and dark canals of images 2 and 3. Add only connective streets, non-landmark city blocks, small landscaping, canal edges and bridges that extend the existing pieces' street edges naturally. No new gameplay centres, icons or objectives.
Layout invariants: keep the exact guide bounds and its 5x7 cell geometry. Each existing artwork cell is 20% of the width and 1/7 of the height. Row1: Tech at column1, connector12 at column3, Harbor at column5. Row2: connector07 at column2 and connector08 at column4. Row3: NEXUS at column1, connector11 at column2, Central at column3, connector09 at column4, Black Grid at column5. Row4: connector10 at column3, connector13 at column4. Row5: Undercity at column3. Row6: housing A/B/C at columns2/3/4. Row7: housing D/E/F at columns2/3/4. Fill the blank cells and connect the occupied cells while preserving their exact placement, camera and proportions. The original detailed occupied panels will be composited over this backplate by code, so focus on coherent material/street continuation in blank cells and edge seams.
Remove ALL text labels, player dots, selection outlines, UI, borders, grids and diagram-like grey pipes from the guide. Streets must look like real lit paved streets with pavements and trees, not narrow abstract route strokes. No typography, legend, watermark, people, arrows, map pins or added logos anywhere.
Frame: a complete rectangular city-landscape plate matching the guide aspect ratio 260:203 (roughly 1.28:1), edge to edge, no surrounding margins. Please render with crisp high-resolution architectural detail, approximately 2560 by 2000 pixels. City scenery only.
