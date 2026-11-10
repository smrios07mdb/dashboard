# Chunk 93 — menu bar scratchpad: smoke `0930a`

- **Date:** 2026-11-10
- **Code under test:** `e1fc506` on branch `chunk-93-menubar-scratchpad` (base `5cfef04`)
- **Driver:** Claude in Chrome, Sergio's Chrome. Popover at `http://localhost:1421/` (`npm run menubar:dev`), already signed in. One run owner (confirmed with the operator before starting).
- **DB reads/cleanup:** through the popover's own Supabase client (`/@fs/…/src/lib/supabase.ts` imported in the dev page), RLS-scoped to the signed-in user. The Supabase MCP had no permission on the project.
- **Fixtures:** `Smoke-0930a-A`, `Smoke-0930a-B`, `Smoke-0930a-C`. Deleted at the end with `title like 'Smoke-0930a-%'`; a re-read returned 0 rows. The draft key was cleared and the tab key reset to `today`; theme back to Auto.
- **Result:** every check that ran passed.

## Gates

| Gate | Result |
|---|---|
| `npm ci` · `npm run lint` · `npm run menubar:typecheck` | clean |
| `npm test`, `TZ=America/New_York` / `UTC` / `Asia/Tokyo` | 124 files, 1499 tests passed in each (was 121 / 1461) |
| `npm run build`, base `5cfef04` and head | `assets/index-m-5KO8eY.js` both; no menubar/scratchpad file in `dist/` |
| `npm run menubar:build` | `Hupomnemata.app` built; menubar JS 639 → 716 KB (Radix Popover via `SetDuePopover`'s module) |
| Files under `src/` changed | none |

## Browser

| # | Check | Result |
|---|---|---|
| S1 | Signed in: tablist `Today 0/0` · `Scratchpad`; Today selected on first open | pass |
| S2 | Typed `Smoke-0930a-A` / `Smoke-0930a-B p1 #personal` / `p2 15m`: footer `3 lines → 2 tasks` (lists differ, token-only line not counted as a task) | pass |
| S3 | Reload: pad holds all three lines, Scratchpad tab still selected, `hup:mb:scratch` matches | pass |
| S4 | `⌘↵`: pad keeps only `p2 15m`; footer `Sent 2 · 1 not sent, still here`; Today tab `0/1`, row `Smoke-0930a-B` with `P1` | pass |
| S5 | DB: A in **Work › General**, priority null, 30 min, no due; B in **Personal › General**, priority 1, 30 min | pass |
| S6 | Light: Scratchpad and Today read correctly (ruled pad, green Send, P1 chip). Dark: Today correct; Scratchpad seen in dark (Auto, system dark) at S2 | pass |
| S7 | Reload with console armed from load, send `Smoke-0930a-C`: `Sent 1 task to Work › General`, pad empty, DB row in Work › General; no console errors or exceptions | pass |

## Not run / unverified

- **The hotkey itself** (⌥H registers, shows the popover, hides it on a second press), **focus landing in the pad** after a hotkey show, and **the popover's position when opened by hotkey** (tray rect / last click / top-right fallback). The shell cannot press a global hotkey or see the menu bar. Covered by unit tests at the web-view seam only (`hotkeys.test.ts`, `ScratchpadTab.test.tsx`).
- **`⌥H is taken by another app`** live: whether macOS reports a conflict to `RegisterEventHotKey` depends on the other app; unit test only.
- **Window resize on tab switch** in the native window (the ResizeObserver path is unchanged from chunk 91).
- **Offline send** (outbox): not exercised live; `repo.tasks.create`'s offline path is unchanged.
- The branch build was **not** installed over `~/Applications`.
