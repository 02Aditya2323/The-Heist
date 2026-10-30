# Field HUD

**The map must stay almost completely unobstructed.** The artwork carries the visual quality. The interface frames it, rather than covering it.

The world now fills the viewport. Normal mode uses a 48 px floating mast, compact account widget, low objective strip, utility cluster and collapsed objective tab. Account details expand on click. Nearby interactions use the existing authoritative interaction choices and appear near the player. District entry titles dismiss after 2.6 seconds.

H switches to minimal mode, retaining the district, clock, objective and interaction prompt. Display settings contain the existing zoom, names and audio controls, plus an optional read-only diagnostics view. The existing F3/F4 developer shortcuts remain available.

Server action results and event announcements share a bounded stack of three dismissible notifications. Text comes from existing state; no reward, completion, travel or eligibility is inferred by the presentation layer.

The operations map keeps the existing artwork/projection, region navigation and Find Me controls. Terminals, homes, travel gates, raids and labels have independent visibility controls; region details can collapse. Contract panels reuse existing cards, validation, availability and workbenches with the common glass surface treatment. No speculative rewards or completion-time estimates were added.

Implementation: `field-hud.ts`, `field-hud.css`, `notifications.ts`. Existing element IDs and action handlers are retained. Canvas resizing follows the browser viewport; opening or collapsing HUD cards does not resize the world.

Verification: client production build and TypeScript check; input contract, contract UX and closed-dialog visibility checks. Browser checks cover normal/minimal modes, account expansion, operations-map controls and settings on a disposable SQLite server. Desktop is the current priority; phone polish is deferred.

The HUD geometry audit now checks full-viewport rendering, at least 75% unobstructed area, and a stable canvas through collapse. The overlap audit includes the new utility/objective/notification surfaces. The legacy standalone audit runners require a supported local browser executable; manual in-app browser checks were used on this Mac.
