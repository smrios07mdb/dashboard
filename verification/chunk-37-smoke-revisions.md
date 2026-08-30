# Chunk 37 revisions — smoke re-run (Cowork / Chrome MCP, 2026-08-29 ~20:22–20:45 ET)

Run against local dev `http://localhost:5173/dashboard/`, `redesign` @ `8219fba`
(revisions `a9493f4` + PROGRESS fill), clean tree, signed in as
smrios07@gmail.com. Dev DB `dctfspcbkqvvyptddtif`, single user
`9b5ce57c-8b69-42b5-ba0c-d3e21b269f85`. Pre-smoke
`select count(*) from public.scheduled_blocks` = **0**; post-cleanup = **0**.

Migration 11 taken as applied per the operator note (triggers verified in Claude
Code's report); `pg_trigger` is not reachable over PostgREST, but both trigger
directions were proven behaviourally in 5r below.

**Week under test: Aug 31 – Sep 6 (WEEK 36; WED = Sep 2, THU = Sep 3).** The run
date is Sat Aug 29, so the current week's weekdays are all in the past and carry
no `free` figure.

**Fixtures** (per the two lessons from the first run): `Smoke Busy` WED Sep 2
10:00–11:00 EDT created through the app's own `POST /api/calendar/events`
(uid `25d58a32-…`) — it appeared in `/api/calendar/busy` after one Force resync
and dropped week `free` 44h → 43h. `Smoke P1` (P1, 45m, Work/General) and
`Smoke zero` (no priority, 0m, Personal/General) created via PostgREST.

## Results

| # | Check | Result | Note |
|---|-------|--------|------|
| 5r | Done, both directions | **PASS** | (a) Planner done-check → `aria-label` `Smoke P1, 14:00–14:45, done`, `opacity 0.72`, `text-decoration-line: line-through`, `box-shadow: none`, control relabelled `Mark not done`; DB `scheduled_blocks.done = true` + `tasks.completed_at = 00:32:59.132Z` (block `updated_at` 00:32:59.249Z) — agree. Dashboard row read `aria-checked=true` / `Mark task incomplete` / line-through. (b) Unchecked **on the Dashboard**: `tasks.completed_at → null` and `scheduled_blocks.done → false` in the same write (block `updated_at` 00:34:05.911Z) — the trigger mirror the first run was missing. Returning to the Planner with **no action on the block**, it rendered not-done (`opacity 1`, `text-decoration-line: none`, aria without `, done`). (c) Completed on the Dashboard → `completed_at 00:35:43.845Z`, `done true` (block `updated_at` 00:35:43.973Z); Planner showed done with no Planner action on the block. Every step: `b.done` and `t.completed_at is not null` agreed on every row. |
| 11r | Mobile sheet opens on the strip's day | **PASS** | Run in a same-origin 570px iframe (564px inner) — real media-query layout: `[data-branch="mobile"]` measured non-zero, `[data-branch="desktop"]` measured 0-width. With `THU 3` selected on the strip (`aria-pressed=true`), a **page-world** click on `[data-branch="mobile"] button[aria-label="Smoke P1 — schedule"]` opened the sheet on `Open slots — THU 3` with CTA `Add to Thursday`, three slot cards (`08:00–08:45 free until 20:00` Selected, `10:00`, `12:00`), summary card `P1 / Smoke P1 / 45m estimate`, and **zero** day-selector chips. The first run's MON-with-selector failure does not reproduce. Sheet cancelled — no block written. |
| 15r | Console clean on done toggle | **PASS** | Page-world `console.error` wrapper (injected `<script>`, hits written to a DOM attribute), self-tested live: a page-world `console.error('SMOKE-WRAPPER-SELFTEST')` incremented the counter, so the observer is proven to be wrapping the app's console. Counter reset, then done toggled twice on the block (`Mark not done` → `Mark done`): **0** hits. Repeated for a second pair earlier in the run: also 0. The `TaskBlock` conflicting-style warning is gone. **But see the new finding below — the same warning class still fires from `PlannerTray`, 2 per drag start.** |
| 16r | Zero proxy requests after a drop; no dimming | **PASS** | Network log cleared (page-world `fetch` + `XMLHttpRequest.open` wrapper) and a class MutationObserver armed on `[data-testid="week-grid-root"]`. Drop 1 (`Smoke P1` → WED 14:00): **0** requests to `/api/calendar/busy`, **0** `opacity-50` transitions, root `className` stayed empty and computed `opacity` stayed `1`. Drop 2 (`Smoke zero` → THU 09:00): **0** and **0** again. Then: week change to a never-visited week (Sep 7–13, cold cache) → exactly **1** busy request (`?from=2026-09-07T04:00:00.000Z&to=2026-09-14T04:00:00.000Z`) + exactly **1** dim. Force resync from the sync pill → exactly **1** busy request, **0** dims. |
| 17r | Empty-week copy with busy present | **PASS** | Week 36 with `Smoke Busy` and no scheduled blocks: `Nothing planned yet.` / `Drag a task from the tray onto a time.` rendered, `position: absolute`, `z-index: 5`, `pointer-events: none`, i.e. **over** the busy overlay (`z-index: 1`, WED 10:00–11:00 at y 407–457). It disappeared the moment the first block landed. Mobile (570px iframe), `WED 2` selected — busy present, no blocks: `Tap an unscheduled task to give it a time.` rendered above the timeline (which showed `Smoke Busy` / `ICLOUD`). |
| 1 | Regression — place via drag | **PASS** | Synthesized drag of the `Smoke P1` tray card to WED 14:00. During: floating card `position: fixed`, `pointer-events: none`, transform `matrix(0.999391, -0.0348995, …)` = −2.0° tilt, tracking the pointer; source card `opacity: 0.45`; `[data-testid="drop-slot"]` read `14:00–14:45`, `border-style: dashed`, category-coloured (`color(srgb 0.0196 0.588 0.412 / 0.55)`). On drop: block at WED 14:00–14:45 (y 615.078 = the 14:00 line, h 37), tray card gone, header `0m planned · 43h free` → `45m planned · 42h 15m free`. DB `start_at 2026-09-02T18:00:00Z` / `end_at 18:45Z` = local 14:00–14:45. Toast wording confirmed on the second drop, verbatim `Placed THU 09:00.` **Spec correction:** the block shows the title only — no `P1` chip and no mono range. That is correct behaviour, not a regression: `TaskBlock.tsx:84` sets `tight = pos.height < 40` and a 45m block at the default 52px hour is 37px, so both are suppressed (the component comment says "title only under 40px"). `tight` is byte-identical at `8306f10` and `a9493f4`, so the first run's check-1 note ("with the `P1` chip + mono range") was inaccurate; the live range is still exposed via the accessible name `Smoke P1, 14:00–14:45`. The spec's expectation for check 1 should be relaxed or the fixture estimate raised above 45m. |
| 6 | Regression — unschedule | **PASS** | Hover → `×` on the `Smoke zero` block: toast `Returned to tray.`, block removed from the grid, `Smoke zero` reappeared in the tray under `No priority`, header back to `45m planned · 42h 15m free`, and the DB row was deleted (only `Smoke P1`'s block remained). |
| 13 | Regression — desktop keyboard path | **PASS** | Tray card is a native `<button>`, `tabIndex 0`, took focus. Sheet opened with the **7-chip** day selector `MON31 … SUN6`, `MON 31` `aria-pressed=true` — correct, since today (Aug 29) is outside the visible week, and the exact contrast with 11r's no-selector mobile sheet. Picking `WED2` re-scoped to `Open slots — WED 2` with slots correctly bounded by both fixtures: `08:00–08:30 free until 10:00` (Smoke Busy), `11:00–11:30 free until 14:00` and `14:45–15:15 free until 20:00` (the Smoke P1 block). Selecting 11:00 + `Add to Wednesday` → toast `Scheduled 11:00.` and a block at WED 11:00–11:30. Then the task block (`div[role=button][tabindex=0]`) took focus and a synthetic `Enter` opened the block action sheet (`Smoke P1` / `14:00–14:45` / `Mark done` / `Unschedule` / `Cancel`, `data-state="open"`); `Escape` closed it (0 dialogs). *Method, unchanged from the first run: on the native tray button, activation is emulated with `click()` — an untrusted `keydown` cannot trigger the browser's Enter→click. The block's `Enter` is the app's own handler and was exercised synthetically as-is.* |

## New finding — the conflicting-style warning survives in `PlannerTray`

The revision fixed `TaskBlock.tsx` (shorthand `textDecoration` → longhand
`textDecorationLine`), and 15r confirms the done toggle is now silent. A second
instance of the same bug class is still live and fires on **drag start**:

```
Updating a style property during rerender (border) when a conflicting property
is set (borderLeft) …
  at setValueForStyles (react-dom_client.js)
  at setProp → updateProperties → commitUpdate
```

Source: `src/components/planner/PlannerTray.tsx:113–114` — the card's style
object sets the `border` shorthand (`ghost ? '1px dashed var(--line-strong)' :
undefined`) alongside `borderLeft` (`overdue && !ghost ? '3px solid …' :
undefined`). When `ghost` flips at drag start both keys update in the same
commit and React logs the conflict. Reproduced in isolation: counter reset →
`pointerdown` + `pointermove`s on a tray card → **2** `console.error` hits, with
the ghost/floating card confirmed live; the rest of the flow (unschedule, sheet
open, day chip, slot select, Add) produced **0**. Two more fire when the drag
ends. Cosmetic only — the ghost renders correctly. Fix is the same shape as the
`TaskBlock` one: replace `border` with the longhands, or drop `borderLeft` in
favour of `borderLeftWidth`/`Style`/`Color`.

So **15r passes as written** (the done-toggle path is clean) while the broader
check-15 "console clean across all checks" does **not** yet hold.

## Cleanup

- `Smoke P1` and `Smoke zero` blocks and tasks deleted;
  `select count(*) from public.scheduled_blocks` back to **0** (baseline).
- Harness patches cleared by a page reload (the injected `fetch` /
  `XMLHttpRequest.open` / `console.error` wrappers and the `#__smoke_out` node
  live only until reload).
- **`Smoke Busy` could not be deleted "via the app".** There is no delete path:
  `ARCHITECTURE.md`'s runtime endpoint table and `src/lib/calendarApi.ts` expose
  only `POST /api/calendar/events`, and a `DELETE` to that route fails at the
  CORS preflight. The event (`Smoke Busy`, WED Sep 2 2026 10:00–11:00 EDT,
  uid `25d58a32-2ea6-4cec-9fab-46a5beeee1f6`) is still on the iCloud calendar and
  **needs deleting by hand in Calendar.app**. Either the spec's cleanup step
  needs rewording or the proxy needs a delete endpoint — worth a chunk-38 note,
  since every future smoke that follows the CLAUDE.md busy-fixture rule will
  leave one of these behind.

## Operator note — an unrelated task was completed and reverted

While reaching for the `Smoke P1` row on the Dashboard, a loose ancestor-text
selector matched the wrong checkbox and completed the real task
**"Mother's day frame gift"** (`ed16d182-…`, 00:34:45.981Z). It was reverted
within ~40s (`completed_at` back to `null`, 00:35:24.414Z) and re-verified at the
end of the run; no other row was touched (checked by
`tasks?updated_at=gte.…&order=updated_at.desc`). The corrected method — walk up
from the title leaf to the **nearest** ancestor holding exactly one
`button[aria-label^="Mark task"]` — is what the rest of the run used, and is
what future smokes on the real Dashboard should use. Walking a fixed number of
levels up from a leaf can escape the row and hit a sibling task.

## Harness notes for the next pass

- **The 570px same-origin iframe works and is the way to test the mobile
  branch.** `window.open` with a size hint is blocked (no user gesture) and this
  Chrome MCP exposes no `resize_window`; an iframe at `width:570px` gives a real
  564px layout viewport, the app authenticates from the shared origin's
  `localStorage`, and its document is scriptable from the parent (including
  page-world `<script>` injection into the iframe's own document).
- **`.focus()` scrolls the page, and that silently breaks the next synthesized
  drag.** After check 13 focused a tray card the page sat at `scrollY 1901`, the
  grid was at `top: -1600`, and two drags started (ghost + floating card + the
  `border` warnings all present) with no `[data-testid="drop-slot"]` and no drop.
  Assert `window.scrollY === 0` and re-read `getBoundingClientRect()` immediately
  before dispatching pointer coordinates.
- **The drop preview lands a tick late.** `[data-testid="drop-slot"]` is still
  `null` when read inside the same script that dispatched the `pointermove`s; it
  is present on the next call. Don't read that as a failed drag.
- Capturing the Supabase `apikey` by wrapping page-world `fetch` and stashing it
  in a DOM attribute avoids putting the anon key in the transcript; week
  navigation is enough to trigger a request that carries it.
