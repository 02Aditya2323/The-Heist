# Terminal-card UI audit

Verified 14 October 2026. This is a frontend presentation upgrade, not a new event or economy migration.

## Implemented

- Responsive terminal shell with sticky Close control, district-art header, operator/address metadata and actual connection state.
- Code, Debug, CTF and Puzzle card accents, native SVG icons, reward/mode headers, readable action states and focused workbenches.
- Raid crew manifest supporting the authoritative 8/10-player requirement, seven operation states, 60-second server-time hold ring and qualification/breach steps. Repeated hold requests are disabled while holding or already joined.
- Bank Home/secured/in-transit balance cards; existing deposit, fee, withdrawal and raid-reserve text preserved.
- Answer and Bank-amount drafts retained across card switching/reopening in the same tab. Changed prompts and operator identities clear stale drafts. Timer decoration updates without replacing focused forms.
- Reduced-motion support, keyboard focus outlines and a stacked mobile layout. No new artwork or constant background animation is required.

## Verification performed

- Client TypeScript check and production build passed.
- All 100 shared tests passed.
- Terminal model regression passed: seven raid states, 8/10-person crew counts, hold-progress bounds and no source-state mutation.
- Existing client input and workbench calculator checks passed.
- Browser inspected all 17 workbench types on an isolated, in-memory fixture. A code practice answer passed server validation and paid nothing. Typed answers survived switching between contracts.
- Bank amount `12.5` survived closing/reopening without any Deposit/Withdraw request.
- Bank and Raid modals at 375 × 812 had equal client and scroll widths (347px), with no horizontal overflow. Temporary viewport overrides were reset.
- Main game at localhost:5173 displayed the redesigned Logic Terminal and both job cards; no browser error logs were observed at this checkpoint.
- `git diff --check` passed.

## Preserved and limitations

Map artwork, collision, movement protocol, challenge validators, money calculations and the saved prize event remain untouched. No organizer Start was issued and no paid transaction was used for UI testing. Backend end-to-end results in the gameplay handoff are historical; this UI pass did not rerun the full server suite or start a real raid. The seven raid states were verified by pure model tests; live holding was not simulated on the saved event. Typed text drafts do not survive a full page refresh.

Screenshots in `screenshots/`:

- `terminal-raid-redesign-desktop.png`
- `terminal-raid-redesign-mobile.png`
- `terminal-bank-redesign-desktop.png`
- `terminal-bank-redesign-mobile.png`
- `terminal-contract-redesign-desktop.png`
- `terminal-job-board-redesign.png`

Repeat the focused check with `npx tsx tools/check-terminal-cards.mts`. The disposable browser fixture can be started using `npx tsx tools/workbench-qa-server.mts --station raid --empty` or `--station bank --empty`; it uses in-memory databases and a random loopback port. Without `--empty`, it seeds the 17 workbench types. These are QA helpers, not production startup commands.
