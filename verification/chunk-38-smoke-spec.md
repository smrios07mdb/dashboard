# Chunk 38 smoke spec — Fill my week + carryover (for Cowork / Chrome MCP)

Target: **local dev server** on the `redesign` branch at the chunk-38 commit or
later (see PROGRESS row 38) — the branch is not deployed, so do NOT test
against the Pages URL. Operator starts `npm run dev` and signs in first; the
app URL is whatever Vite prints (usually `http://localhost:5173`). A second
signed-in tab is needed for check 3's realtime line.

Surface under test: the **Planner** tab — desktop grid (`[data-branch="desktop"]`,
≥640px) for checks 1–7, 9, 10; the mobile branch (`[data-branch="mobile"]`,
<640px) for check 8.

Harness caveats — all from CLAUDE.md "Smoke harness notes"; read that section
first:

- **Drag.** Synthesize the pointer sequence (`pointerdown` → ≥10
  `pointermove`s on `window` → a **separate** `execute_javascript` call for
  `pointerup`). Assert `window.scrollY === 0` and re-read
  `getBoundingClientRect()` immediately before dispatching coordinates (a
  prior `.focus()` scrolls the page). The drop preview
  `[data-testid="drop-slot"]` appears one tick after the moves — read it in
  the next call. Grid hit-testing: `[data-testid="week-grid"]`, gutter 56px,
  weekday columns 1fr, weekend .55fr, 52px/hour, window 08:00–19:00 collapsed.
- **Both branches are always mounted.** Scope every selector with
  `[data-branch="desktop"]` / `[data-branch="mobile"]`; `display:none`
  elements still fire `.click()`.
- **Mobile branch.** Use a 570px-wide same-origin `<iframe>` pointed at the
  app URL (authenticates from shared `localStorage`; scriptable from the
  parent). `window.open` is popup-blocked and there is no `resize_window`.
- **Console clean.** Chrome MCP's `execute_javascript` runs in an isolated
  world. Install the `console.error` wrapper by appending a `<script>` element
  to the document (page world) that counts calls into a `data-*` attribute on
  `<body>`; read the attribute after each check. Install it in the iframe's
  document too for check 8.
- **Busy fixture.** Create `Smoke Busy` through the app's `createEvent`
  (`POST /api/calendar/events` via the Block Time sheet on the Dashboard), not
  Calendar.app. There is no delete path until chunk 39 — the operator deletes
  it by hand in Calendar.app afterwards; **record the uid in the results**.
- Screenshots are inline in the Cowork transcript only.

Data setup (current week; today must be Mon–Thu so tomorrow is a weekday):

- Four open tasks with **no** scheduled block, all Work, created on the
  Dashboard in this order: `Smoke P1a` (P1, 45m, due today), `Smoke P1b`
  (P1, 30m, no due), `Smoke P2` (P2, 60m), `Smoke P3` (P3, 30m). No other
  P1/P2 tasks should be in the tray — complete or reprioritize any strays
  first, or the proposal counts below shift.
- `Smoke Busy` tomorrow 09:00–10:00 local, via `createEvent`. Wait for the
  planner to show it (Force resync from the sync pill if needed).
- Dev project: `dctfspcbkqvvyptddtif`. Note
  `select count(*) from public.scheduled_blocks` before starting.
- Clean up: unschedule/delete the smoke tasks; confirm the count returns to
  its pre-smoke value; delete `Smoke Busy` in Calendar.app and record its uid.

Record results as `verification/chunk-38-smoke.md` in the chunk-33 table
format (check / PASS-FAIL / note), and commit it.

## Checks

| # | Check | Expect |
|---|---|---|
| 1 | **Fill my week.** On the current week, click `Fill my week` (desktop header, `Sparkles` icon). Note the header `planned`/`free` figures and the day-header `free` figures before clicking. | Button disappears; the accent bar `[data-testid="proposals-bar"]` reads `3 proposals · 2h 15m` + `P1–P2 tasks into the earliest open weekday slots.` with `Place all` / `Clear`. Three `[data-testid="proposal-block"]` dashed previews, packed sequentially from the earliest open weekday slot: `Smoke P1a` first (P1, due today), then `Smoke P1b` (P1), then `Smoke P2` (P2); the first slot is today at `ceil15(now+10)` when that leaves room before 18:00 (else tomorrow), each next proposal starts where the previous ends, and none overlaps `Smoke Busy` (a proposal that would cross 09:00–10:00 tomorrow lands at 10:00). Each preview shows `HH:MM–HH:MM · proposed` (a 30m preview is 24px tall and shows the title only). `Smoke P3` has no proposal. Tray: the three cards dim to 60% and their meta row reads `→ DAY HH:MM` instead of the due text; the P3 card is unchanged. **Capacity unchanged:** header `planned`/`free` and every day-header `free` are identical to before. `select count(*) from scheduled_blocks` unchanged. |
| 2 | **Clear.** Click `Clear`. | Bar and previews gone; tray cards back to full opacity with due text; `Fill my week` button back. No DB change. |
| 3 | **Place all.** Click `Fill my week` again, then `Place all`. Have a second signed-in tab on the Planner. | Toast `3 tasks placed.`; bar gone; three real task blocks at exactly the proposed slots (`[data-testid="task-block"]`, accessible names `Smoke P1a, HH:MM–HH:MM` …); the three cards leave the tray (`Smoke P3` remains). `scheduled_blocks` count +3 with `start_at`/`end_at` matching the local slots. Header `planned` = previous + `2h 15m`; the affected day-header `free` figures dropped accordingly. Tab B shows the three blocks within ~1s. |
| 4 | **Proposals cleared by a manual drag.** Unschedule the three blocks (hover → `×`), click `Fill my week`, then synthesize a drag of the `Smoke P3` tray card onto a free slot. | The moment the drag activates (≥5px travel, before the drop), the bar and previews disappear and the tray cards un-dim. The drop lands `Smoke P3` normally (toast `Placed DAY HH:MM.`). Unschedule it afterwards. |
| 5 | **Button disabled states.** (a) Navigate to the previous week. (b) Back on the current week, complete `Smoke P1a`, `Smoke P1b`, `Smoke P2` on the Dashboard (leaving only `Smoke P3` open), return to the Planner. | (a) `Fill my week` renders disabled (`disabled` attribute, 50% opacity). (b) Disabled too — no P1/P2 in the tray. Un-complete the three tasks afterwards (Dashboard row selection: walk to the **nearest** ancestor holding exactly one `button[aria-label^="Mark task"]`). |
| 6 | **Carry on the current week.** Schedule `Smoke P1b` via the Schedule sheet at a custom time that ended before now today (e.g. now − 45m, 30m long — expand the top rail if needed). | Within a minute (the planner ticks `now` every 60s; reload to force it) the block goes hollow: dashed border, 55% surface wash, `--ink-2` title, range suffix ` · unfinished`, accessible name `Smoke P1b, HH:MM–HH:MM, unfinished`. Hover → action row `[→][✓][×]`; the `→` button has `title="Move to next open slot"`. Click `→` → toast `Moved to DAY n, HH:MM.` where the slot is the earliest 15m-snapped gap ≥ `now+10` today (else the next day from 09:00, weekends allowed) that avoids busy + other blocks; the block re-renders solid at that slot; DB `start_at`/`end_at` updated. |
| 7 | **Carry from a past week.** Using SQL, move `Smoke P1b`'s block to last Friday 10:00–10:30 (`update scheduled_blocks set start_at = …, end_at = … where task_id = …`), then Force resync / reload and navigate to the previous week. | The block renders hollow with ` · unfinished` on FRI. Click `→`: toast `Moved to DAY n, HH:MM.` naming a day of the **current** week; the block disappears from the past week's grid (not re-rendered there); DB row updated to the current-week instant. Navigate to the current week (`Today`): the block is there at the toasted slot. Network: exactly one `/api/calendar/busy` request for the current week if its busy entry was older than 5 minutes, else none. |
| 8 | **Mobile action sheet on a carry block (570px iframe).** With `Smoke P1b` scheduled at a time that has already ended today (repeat check 6's setup), open the mobile branch in the iframe, select today on the strip, tap the hollow block. | Block on the timeline is hollow with ` · unfinished`. Sheet shows, in order: `Move to next open slot`, `Mark done`, `Unschedule`, `Cancel`. Tap `Move to next open slot` → sheet closes, toast `Moved to DAY n, HH:MM.`, block re-renders at the new slot. |
| 9 | **Done beats carry.** Schedule `Smoke P2` at a time that ended earlier today; hover → click the done-check. | Block: strikethrough `--ink-3` title, 72% opacity, filled category check, **no** ` · unfinished` suffix, **no** `→` button on hover; accessible name ends `, done`. Mobile sheet (iframe) on the same block shows `Mark not done` first — no `Move to next open slot`. Un-complete afterwards → the block goes hollow again with `→` back. |
| 10 | **Console clean.** Read the page-world `console.error` counter after every check above, including check 4's drag start and drop (the chunk-37 residual) and the plain → carry → done transitions of checks 6/9. | Counter stays at 0 throughout; no React conflicting-style warning, no `validateDOMNesting`; no Supabase error text in any toast. |
