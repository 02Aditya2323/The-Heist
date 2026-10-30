# Completed checklist and overlapping travel interactions

## Changes

- Added a right-side read-only Checklist button for players. It lists server-confirmed completions with district and station/Home locations, with challenge/location search and practice labels.
- Solved workbenches are excluded from Active contracts; claimed paid templates leave Available contracts. A collapsed Completed contracts section below each station's board provides compact rows and a full-checklist shortcut. Practice does not conceal an eligible paid job or change economy rules.
- Added compact completion metadata to the server's EventView, derived from durable attempts. It remains after the old five-minute solved-card window and is private to the authenticated operator. Existing completions are supported; no migration/reset or fabricated completion is required. Reset's fresh attempt state yields a new empty checklist.
- Unified nearby interaction selection for the HUD and controller. At Tech's exact shared Logic Terminal / `c07-back-b` position, E now lists both Travel and Open. The server still validates distance, scene, collision, travel restrictions and authoritative teleports.
- Collision diagnostics use small exact-anchor marks instead of giant overlapping interaction-radius circles. No source artwork, gate coordinates, collision masks or map topology were changed.

## Verification

- Full build passed; 123 server tests passed, including history beyond five minutes, persisted-history recovery, per-player privacy and exact-coordinate gate/terminal addressability.
- `tools/check-contract-ux.mts` passed active/available/completed separation, locations, practice eligibility, old-server fallback, reset-empty history, and real coincident Tech interaction candidates.
- Client input checks passed WELCOME gating, quick/held movement and reset behavior.
- Actual browser fixture at Data Centre: acquired and solved paid SD-02 using the visible program; server credited ₹20 in the isolated fixture. Its available card and workbench disappeared, leaving the collapsed completion row. The full checklist showed `Data Harbor · Data Centre`, survived refresh and the five-minute window, and filtered correctly by location. Nested checklist opening/closing and search empty state were checked.
- Actual browser fixture at Tech: E exposed Travel and Logic Terminal separately; travel to Exchange ↔ Tech succeeded, return to Tech succeeded, and Logic Terminal then opened independently. F4 no longer showed large interaction circles.
- Screenshots are in `screenshots/contracts-travel-2026-10-14/`.
- Production Mongo-backed port 8080 was restarted without Reset or Start. Saved accounts and ledger were retained. Vite 5173 continues serving the updated frontend; player LAN URL remains `http://192.168.1.108:8080/`.

The browser test used an isolated in-memory server with disposable accounts, never the saved prize database. Temporary QA server/tabs were closed after verification. Production game and LAN frontend remain running. Use a page refresh to load the new built interface.
