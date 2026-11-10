# Chunk 92 — check off from the menu bar: smoke `0920a`

- **Date:** 2026-11-10
- **Code under test:** `98232a4` + `28e71e9` on branch `chunk-92-menubar-checkoff` (base `7651462`)
- **Driver:** Claude in Chrome, Sergio's Chrome. Popover at `http://localhost:1421/` (`npm run menubar:dev`); Dashboard at the deployed app (main, unchanged by this chunk).
- **Fixture:** one task `Smoke-0920a-P1` created in Personal › General and pinned to Today from the Dashboard, deleted from the Dashboard at the end (confirmed gone after a reload). Today was empty before and after.
- **Result:** every check that ran passed.

## Gates

| Gate | Result |
|---|---|
| `npm run lint` | clean |
| `npm run menubar:typecheck` | clean |
| `npm test`, `TZ=America/New_York` | 121 files, 1461 tests passed |
| `npm test`, `TZ=UTC` | 121 files, 1461 tests passed |
| `npm test`, `TZ=Asia/Tokyo` | 121 files, 1461 tests passed |
| `npm run build` | `assets/index-m-5KO8eY.js` — same name as main; no `dist/` file contains `mb-chk` or `createCheckOff` |
| Files under `src/` changed | none |

New tests: 11 (`checkOff.test.ts` 6, `todayView.test.ts` +5). Suite before: 120 files / 1450.

## Browser

| # | Check | Result |
|---|---|---|
| C1 | Popover lists the fixture with an unchecked circle (`role=checkbox`, `aria-checked=false`), `0 of 1 done` | pass |
| C2 | Click the circle: row struck, circle filled, `1 of 1 done`; the Dashboard's toast `Task completed` + `Undo` appears at the top of the popover | pass |
| C3 | Dashboard after reload: `Plan cleared — every today task done.`, `1 / 1` | pass |
| C4 | Click again (uncheck): row open, `0 of 1 done`, no toast | pass |
| C5 | Check off, then `Undo` on the toast: row open, `0 of 1 done` | pass |
| C6 | Dashboard after reload: fixture open, `0 / 1`, Pinned | pass |

## Not run / unverified

- **Offline check-off** (outbox + replay by `startSyncRunner` in the popover). Not exercised live; the write path is `repo.tasks.markComplete` unchanged, covered by the app's existing repo/outbox tests.
- **Toast inside the native 340 pt window.** In the browser the toast is 356 px (sonner default) at the viewport's top centre; `28e71e9` sets `--width: 316px`, checked only by reading sonner's source (its `style` prop is merged after the default). Not seen in the native app — the app in `~/Applications` was not rebuilt from this unmerged branch.
- **Tray title after a check-off** (shell only).
- **Failed-write message** `Could not save — retry` — unit test only.
