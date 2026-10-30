# The Heist landing page

The public root is now the cinematic game website. The existing client, HUD and authentication fallback live at `/game.html`. Vite builds both HTML entries; the same Node server serves both routes. The landing page does not initialize the renderer, world, database connection or gameplay WebSocket.

## Experience

The hero uses a new text-free skyline inspired by the supplied cyber-noir reference, with real HTML typography and controls. The generated artwork is marketing art only; original in-game city assets remain unchanged. Its optimized WebP is stored in `apps/client/public/art/landing/veyra-hero.webp`.

The page progresses through game pitch, six original-art district cards, an interactive seven-step gameplay guide, actual interface captures, the authoritative-server architecture, and benchmark placeholders. The final call to action links to play, source, architecture and world sections.

District navigation scrolls horizontally, the gameplay guide supports arrow keys/Home/End, and the gallery changes between actual field HUD, operations-map and contract-board screenshots. Navigation collapses on narrow screens. Scroll reveals are observed once; district images load lazily, and reduced-motion preferences disable decorative motion. The city broadcast rotates editorial gameplay tips; it is not a claim of a live event or server health.

## Login

Play buttons open a native modal dialog with labelled username/password inputs, keyboard focus return, validation, pending states and readable server errors. Login and registration reuse the existing `apiLogin` / `apiRegister` functions. Successful authentication stores the same session keys as the game store and opens `/game.html`, where the existing server-authoritative connection flow resumes. The existing game access screen still supports optional organizer profile fields and city preview.

## Engineering claims

Benchmark cards deliberately contain em dashes. There are no fabricated player counts, latency readings, fan-out percentages or live metric requests. Add measured results only with the test environment and methodology. The source link points to the current configured repository and should change when the portfolio repository is established.

## Validation

Client build and TypeScript check pass. Server regression suite: 196 tests pass. Input, contract UX and dialog-visibility checks pass. UI audit entry paths now target `/game.html`; closed-dialog checks also include the game HTML after the split.

Browser review verified login from the landing dialog into the game, real contract/map captures, gallery image loading and gameplay-guide changes. Desktop geometry has no document-wide horizontal overflow. A 390-pixel review frame exposed a gameplay-grid intrinsic-width overflow, which was corrected with shrinkable tracks and stacked headings. The temporary review fixture is not part of the shipped source.

The page uses Barlow / Barlow Condensed from Google Fonts with system fallbacks. Core interactions and artwork are local; browser connectivity to the font CDN is optional. No external deployment or push was performed.
