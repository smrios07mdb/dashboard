# Chunk 37 smoke spec — Week Planner scheduling (for Cowork / Chrome MCP)

Target: **local dev server** on the `redesign` branch at the chunk-37 commit or
later — the branch is not deployed, so do NOT test against the Pages URL.
Operator starts `npm run dev` and signs in first; the app URL is whatever Vite
prints (usually `http://localhost:5173`). A second signed-in tab is needed for
check 8.

Surface under test: the **Planner** tab (desktop grid ≥640px; mobile branch
below 640px).

Harness caveats (see CLAUDE.md "Smoke harness notes"):

- **Drag.** `left_click_drag` fires one instantaneous jump and will NOT
  activate the planner's drag (5px-travel threshold on accumulated
  `pointermove`s). Synthesize the sequence in JS on the page instead:
  `pointerdown` (button 0, `pointerId: 1`, `isPrimary: true`) on the tray
  card / block body / resize strip → ≥10 `pointermove` events dispatched on
  `window` walking to the target grid point → `pointerup` on `window`. Use
  `new PointerEvent(type, { bubbles: true, clientX, clientY, button: 0,
  pointerId: 1 })`. Grid hit-testing is relative to the element with
  `data-testid="week-grid"`: gutter 56px, weekday columns 1fr each, weekend
  .55fr, 52px per hour, window 08:00–19:00 collapsed. The drop preview is
  `[data-testid="drop-slot"]`; task blocks are `[data-testid="task-block"]`;
  the resize strip is `[data-testid="resize-strip"]` inside a block.
- **Mobile branch.** `resize_window` to ~570px width works only when Chrome is
  NOT in macOS full-screen. `useIsTouchDevice` is NOT patched for these checks
  — the mobile branch is the `<sm` breakpoint, and tap-to-schedule rows /
  block tap work with a mouse there too. (Patch `matchMedia('(hover: none)')`
  + remount only if a check specifically needs touch semantics on the
  desktop grid.)
- Screenshots are inline in the Cowork transcript only.

Data setup:

- At least two open tasks with **no** scheduled block and a known category:
  `Smoke P1` (priority P1, estimate 45m, Work) and `Smoke zero` (no priority,
  estimate 0, Personal). Create them on the Dashboard first.
- One known timed busy block in the visible week on the dev iCloud calendar:
  `Smoke Busy` WED 10:00–11:00 local (create through the app's `createEvent` /
  `POST /api/calendar/events` per CLAUDE.md; **cannot be deleted from the app
  until chunk 39** — delete it by hand in Calendar.app afterwards and record
  the uid in the results). All-day items no longer appear as busy (proxy `d9ca515`).
- Clean up: unschedule/delete the smoke tasks at the end; confirm
  `select count(*) from public.scheduled_blocks` on dev project
  `dctfspcbkqvvyptddtif` returns to its pre-smoke value.

Record results as `verification/chunk-37-smoke.md` in the chunk-33 table
format (check / PASS-FAIL / note), and commit it.

## Checks

| # | Check | Expect |
|---|---|---|
| 1 | **Place via drag.** Synthesized drag of the `Smoke P1` tray card onto WED 14:00. | While dragging: floating tilted card follows the pointer, source card goes ghost (dashed, 45%), dashed category-colored preview shows `14:00–14:45`. On drop: block renders at WED 14:00–14:45, title only — a 45m block is 37px at the 52px hour and `TaskBlock` suppresses the chip and range under 40px (`tight`); the range is exposed via the accessible name `Smoke P1, 14:00–14:45`; toast `Placed WED 14:00.`; card gone from the tray; `select task_id, start_at, end_at from scheduled_blocks` shows the row with the local-14:00 instant. |
| 2 | **Move.** Synthesized drag of the block body from WED 14:00 to THU 09:15 (grab 10 minutes into the block). | Original block dims to 30% during the drag; preview follows; on drop the block is THU 09:15–10:00 (duration preserved, 15m snap); DB `start_at`/`end_at` updated; `updated_at` advanced. |
| 3 | **Resize to the 15m minimum.** Synthesized drag of the block's bottom resize strip upward past the block start. | Cursor `ns-resize`; range label updates live; block ends at 09:30 (start + 15) — never shorter; DB `end_at` updated. Then resize down to 10:30 and confirm it snaps to 15m. |
| 4 | **Overlap is advisory.** Drag `Smoke zero` onto WED 10:15. | Preview flips destructive with `OVERLAPS SMOKE BUSY · 30M`; the drop lands anyway (block 10:15–10:45 — 0-estimate ⇒ 30m); toast `Placed WED 10:15 — overlaps Smoke Busy by 30m.` |
| 5 | **Done ⇔ task completion.** Hover a block → click the done-check. Open the Dashboard in the same tab. | Block: strikethrough title, no P1 chip, 72% opacity, filled category check. Dashboard shows the task completed. Back on Planner: still done (no refetch needed). Uncheck on the Dashboard → block returns to not-done on Planner. DB: `scheduled_blocks.done` and `tasks.completed_at` agree at each step. |
| 6 | **Unschedule.** Hover a block → click `×`. | Toast `Returned to tray.`; block disappears; task reappears in the tray under its priority group; DB row deleted. |
| 7 | **Persistence across reload.** Reload the page on the same week. | Remaining block(s) render exactly where they were; header `planned` matches. |
| 8 | **Realtime to a second tab.** With a second signed-in tab on the Planner, place a block in tab A. | Tab B shows the block within ~1s without reload (the `scheduled_blocks` realtime event bumps `dashboardRefreshKey`). Unschedule in A → gone in B. |
| 9 | **Capacity math.** With one 45m block placed on a future weekday inside 09–18, read the header and the day headers. | Header `planned` = Σ scheduled minutes on the visible week (`45m planned` with only that block). That day's `free` dropped by 45m vs. before placement; header `free` = Σ of the per-day figures (add them up). A block placed at 19:30 on a weekday adds to `planned` but not to any day's `free` deduction. |
| 10 | **Rails include task blocks.** Place a block at 19:30–20:00 (drag while the bottom rail is expanded, or via the sheet's custom time). Collapse the bottom rail. | Bottom rail reads `SHOW 19:00 – 21:00 · 1 HIDDEN` (plus any busy already counted); expanding reveals the block. |
| 11 | **Mobile Schedule sheet (570px).** Resize to ~570px wide, pick THU on the day strip, tap an unscheduled row. | Bottom sheet "Schedule": summary card (chip, title, dot, `Nm estimate`), `Open slots — THU n`, 3 slot cards with `free until HH:MM`, first selected. Pick a custom time `16:15` → slot deselects; tap `Add to Thursday` → toast `Scheduled 16:15.`; block appears on THU's timeline; row leaves the list. Empty-day copy (`Tap an unscheduled task to give it a time.`) shows on a day with nothing on it. |
| 12 | **Mobile block action sheet.** Tap the THU block. | Sheet with title + range, `Mark done`, `Unschedule` (destructive tone), `Cancel`. `Mark done` restyles the block and completes the task; reopen → `Mark not done`. `Unschedule` returns the task to the list. |
| 13 | **Desktop keyboard path.** Back at desktop width: Tab to a tray card → Enter. | Same Schedule sheet opens with a 7-chip day selector (today selected when in the visible week, else MON); pick a day + slot → Add places the block. Then Tab to a task block → Enter → block action sheet opens; Escape closes. |
| 14 | **Offline (one manual check).** DevTools → Network → Offline (or `window.dispatchEvent(new Event('offline'))` + `navigator.onLine` patch per chunk-15 methodology). Place a block via the sheet, then go back online. | Placed block renders immediately (Dexie + outbox); sync pill shows Offline; on reconnect the outbox drains (pill → Synced) and the DB has the row. |
| 15 | **Console clean.** Review the console across all checks. | No errors; no React `validateDOMNesting` warnings; no Supabase error text surfaced in any toast (errors, if any, read `Could not save — retry`). |

## Revisions re-run (chunk 37 revisions — done semantics, refetch dimming, empty-week copy, style warning)

Results: `verification/chunk-37-smoke-revisions.md` — 8/8 PASS; residual `PlannerTray` style warning fixed in the chunk-37 closeout commit.

Run against the revisions commit (see PROGRESS row 37). Prerequisites: migration
`11_scheduled_blocks_done_sync.sql` applied (verify `select tgname from
pg_trigger where tgname in ('tasks_sync_scheduled_block_done',
'scheduled_blocks_done_from_task')` returns 2 rows).

Harness notes for this pass (details in CLAUDE.md "Smoke harness notes"):
- **Check 15's console observer must be page-world-injected** (a `<script>`
  element that wraps `console.error` and writes hits into a DOM attribute);
  `execute_javascript` runs in an isolated world and will not see React's
  warnings otherwise.
- Scope all planner selectors with `[data-branch="desktop"]` /
  `[data-branch="mobile"]` — both branches are mounted at every width.

| # | Check | Expect |
|---|---|---|
| 5r | **Done, both directions.** (a) Planner: hover a block → done-check. (b) Dashboard: uncheck the same task. Return to the Planner **without any Planner action** (the realtime echo refetches). (c) Complete on the Dashboard → Planner shows done. | (a) block strikethrough/72%; Dashboard shows completed. (b) block back to not-done with no Planner click. (c) done. After **each** step: `select b.done, (t.completed_at is not null) as task_done from scheduled_blocks b join tasks t on t.id=b.task_id` agree on every row. |
| 11r | **Mobile sheet opens on the strip's day.** ~570px wide; select THU on the day strip; page-world click on `[data-branch="mobile"] button` for an unscheduled row. | Sheet header `Open slots — THU n`, **no 7-chip day selector**. If a page-world click on the mobile row still opens MON with a selector, that is a real bug — stop and report. |
| 15r | **Console clean on done toggle.** With the page-world `console.error` wrapper installed, toggle done on a block twice. | Zero `console.error` hits (previously one "conflicting style" warning per toggle). |
| 16r | **Zero proxy requests after a drop; no dimming.** Clear the network log; drag a tray card onto the grid. | Block appears at once; grid stays at full opacity (root `[data-testid="week-grid-root"]` never gets `opacity-50`); network log shows **zero** requests to `/api/calendar/busy`. Then: change week with a cold cache → one dim + one busy request; Force-resync from the sync pill → one busy request. |
| 17r | **Empty-week copy with busy present.** Navigate to a week that has busy blocks and no scheduled blocks. | `Nothing planned yet. / Drag a task from the tray onto a time.` renders over the overlays; hidden once a block is placed. Mobile: `Tap an unscheduled task to give it a time.` on a day with busy but no blocks. |
| 1/6/13 | **Regression.** Re-run checks 1 (place via drag), 6 (unschedule), 13 (desktop keyboard path). | As specified above. |
