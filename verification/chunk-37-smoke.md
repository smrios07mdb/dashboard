# Chunk 37 smoke — results (Cowork / Chrome MCP, 2026-08-29 ~19:10–20:00 ET)

Run against local dev `http://localhost:5173/dashboard/`, `redesign` @ `8306f10`
(includes `0fbf7bb`), clean tree, signed in as smrios07@gmail.com. Dev DB
`dctfspcbkqvvyptddtif`, single user `9b5ce57c-8b69-42b5-ba0c-d3e21b269f85`.
Pre-smoke `select count(*) from public.scheduled_blocks` = **0**.

**Week under test: Aug 31 – Sep 6 (WED = Sep 2, THU = Sep 3), not the current
week.** The run date is Saturday Aug 29, so the current week's WED/THU are in
the past and render `—` instead of a `free` figure — check 9's capacity math is
untestable there. All day/column references below are on that week.

| # | Check | Result | Note |
|---|-------|--------|------|
| 1 | Place via drag | PASS | Synthesized drag of the `Smoke P1` card to WED 14:00. During: floating card `position:fixed`, `pointer-events-none`, transform matrix = −2.0° tilt, tracking the pointer (757,617 vs pointer 748,613); source card `opacity: 0.45` + `border-style: dashed`; `[data-testid="drop-slot"]` read `14:00–14:45`, dashed, category-colored (border `srgb(.0196 .588 .412 / .55)`, fill same @ .07); `body` cursor `grabbing`, `user-select: none`. On drop: block at WED x=332 (WED column starts 327.8), y=314 → 14:00, h=37 ≈ 45m, with `P1` chip + mono `09:15–10:30`-style range; card gone from tray. DB row `start_at 2026-09-02T18:00:00Z` / `end_at 18:45Z` = local 14:00–14:45. Toast not captured live here (observer installed after); the identical `via==='drag'` branch was confirmed verbatim in check 10 as `Placed MON 19:30.` |
| 2 | Move | PASS | Grabbed 10m into the block, dropped at THU 09:30 pointer. Source verified first: `offsetMin = p.minute - block.startMin` at pointerdown, so the grab offset is preserved (pointer snaps to 09:30, offset 15 ⇒ start 09:15). During: original `opacity: 0.3`; preview `09:15–10:00` at x=468 (THU), y=67. DB `start_at 2026-09-03T13:15:00Z` / `end_at 14:00Z` (45m preserved), `updated_at` advanced 23:23:07.827 → 23:26:56.773. |
| 3 | Resize to 15m minimum | PASS | Bottom strip dragged up past the block start: `body` cursor `ns-resize`; block clamped to h=14px and the live accessible name read `Smoke P1, 09:15–09:30` — never shorter. DB `end_at 13:30Z` = 09:30 (start + 15). Then dragged down deliberately targeting **10:33**: live label updated to `09:15–10:30` mid-drag and DB `end_at 14:30Z` = 10:30 — 15m snap proven, not assumed. *Note: at the 15m height the visible mono range is suppressed; the live range is still exposed via the block's accessible name.* |
| 4 | Overlap is advisory | PASS | `Smoke zero` dropped on WED 10:15 over `Smoke Busy` (10:00–11:00). Preview text `10:15–10:45` + `OVERLAPS SMOKE BUSY · 30M`; styling flipped destructive — border/fill `srgb(.72 .27 .18)` vs the green of check 1. Drop landed anyway: block 10:15–10:45 (h=24 ≈ 30m, 0-estimate ⇒ 30m). Toast verbatim: `Placed WED 10:15 — overlaps Smoke Busy by 30m.` DB `14:15Z–14:45Z`. |
| 5 | Done ⇔ task completion | **FAIL** | Forward direction PASS: block done → `opacity: 0.72`, title `text-decoration-line: line-through`, `P1` chip gone, check filled `rgb(5,150,105)` and relabelled `Mark not done`; `scheduled_blocks.done = true` and `tasks.completed_at` set at the same instant; Dashboard Work count went 77/94 → 78/95; state survived a Planner→Dashboard→Planner round trip. **Reverse direction fails:** unchecking the task on the Dashboard cleared `tasks.completed_at` but left `scheduled_blocks.done = true` with `updated_at` untouched, and the block still rendered done on a freshly remounted Planner. Root cause: `Planner.tsx:415` derives `done: b.done \|\| task.completedAt !== null` — an **OR** — while the two sides are written asymmetrically (the Planner's own Mark done writes both columns; the Dashboard's uncheck writes only the task). Once `scheduled_blocks.done` is true no Dashboard action can clear it. Recoverable only from the Planner: `Mark not done` there set `done = false` and the two agreed again. |
| 6 | Unschedule | PASS | Hover → `×`: toast `Returned to tray.`, block removed, DB row deleted (only the other block remained), and `Smoke zero` reappeared in the tray under `NO PRIORITY`. |
| 7 | Persistence across reload | PASS | Pre-reload `Smoke P1` at x=468 / y=67 / h=63, header `1h 15m planned · 41h 45m free`. After a full reload (+ re-navigating to the week, which is not URL-persisted): byte-identical x=468 / y=67 / h=63 and the same header. |
| 8 | Realtime to a second tab | PASS | Second signed-in tab on the same week. Place in A → B showed `Smoke zero, 15:00–15:30` and header `1h 45m planned` with no reload. Unschedule in A → B dropped to one block in **796ms** (measured: click ts 1788046543567 → interval-observer ts 1788046544363). |
| 9 | Capacity math | PASS | With one 45m block on THU: header `45m planned`; THU `8h 15m free`, exactly 45m below its 9h baseline; header `42h 15m free` = Σ day figures (9 + 8 + 8 + 8¼ + 9; TUE carries `Rent Due`, WED carries `Smoke Busy`). Then a 19:30–20:00 block on MON: `planned` rose to `1h 15m` while MON stayed `9h free` and header free stayed `42h 15m` — outside 09–18 it adds to planned and deducts from nothing. |
| 10 | Rails include task blocks | PASS | With the 19:30–20:00 block placed and the bottom rail collapsed: `SHOW 19:00 – 21:00 · 1 HIDDEN`, grid back to 573px, block absent from the grid; it was visible while the rail was expanded. Placement toast verbatim: `Placed MON 19:30.` |
| 11 | Mobile Schedule sheet (570px) | **FAIL** | Run in a same-origin 570px iframe (566px inner) per the chunk-33 method — real media-query layout; desktop `[data-testid="week-grid"]` measured 0-width, mobile branch live, nav read `Tasks`, rails hour-only (`SHOW 07 – 08`). **The failure:** with `THU 3` selected on the day strip (`aria-pressed=true`, summary `Thursday · 9h free 09–18`), tapping an unscheduled row opened the sheet on `Open slots — MON 31` / `Add to Monday` — the sheet's own selector had `MON 31 aria-pressed=true`. The sheet does not inherit the day strip's day; spec expects `Open slots — THU n`. Everything else PASS: summary card (`P1` chip, title, category dot, `45m estimate`), 3 slot cards with `free until 20:00`, first `Selected`; custom `16:15` deselected the slot; `Add to Thursday` → toast `Scheduled 16:15.`, block on THU's timeline, row left the list, THU free 9h → `8h 15m`. Empty-day copy `Tap an unscheduled task to give it a time.` rendered on an empty day. |
| 12 | Mobile block action sheet | PASS | Tap the THU block → sheet with title `Smoke P1`, range `16:15–17:00`, `Mark done`, `Unschedule` in the destructive token `rgb(184,69,46)` (vs `rgb(34,31,40)` on the others), `Cancel`. `Mark done` restyled the block (`, done`, `opacity 0.72`) and set `tasks.completed_at`; reopening read `Mark not done`. `Unschedule` → toast `Returned to tray.`, block gone. *Nuance: the task only reappears in the unscheduled list once it is not completed — `splitTray` filters `completedAt`, so unscheduling a still-done block correctly leaves it out; clearing completion brought the row straight back.* |
| 13 | Desktop keyboard path | PASS | Tray card is a native `<button>`, `tabIndex 0`, takes focus. Sheet opened with the 7-chip day selector MON 31 … SUN 6, defaulting to **MON** — correct per spec, since today (Aug 29) is outside the visible week. Picking `WED 2` re-scoped it to `Open slots — WED 2` with 3 slots (`08:00–08:45 free until 10:00` correctly bounded by `Smoke Busy`); selecting the 11:00 slot + `Add to Wednesday` → toast `Scheduled 11:00.` and a block at WED 11:00–11:45. Then the task block (`div[tabindex=0]`) took focus and a synthetic `Enter` opened the block action sheet (`Mark done` / `Unschedule` / `Cancel`); `Escape` closed it (`data-state="closed"`, confirmed visually clear). *Method: on the native button, activation was emulated with a click — a synthetic `keydown` cannot trigger the browser's Enter→click, which only fires for trusted events. The block's Enter is the app's own handler and was exercised synthetically as-is.* |
| 14 | Offline | PASS | `navigator.onLine` patched to false **in the page's own world** (see harness note) + `offline` event. Pill → `Sync status: Offline`; sheet placement rendered the block immediately with toast `Scheduled 08:00.`; Dexie `outbox` held exactly one row (`op: insert`, `table: scheduled_blocks`, `attempts: 0`) and Supabase did **not** have it. On restore + `online` event: outbox drained to 0, pill → `Synced`, row present (`2026-08-31T12:00:00Z` = MON 08:00). |
| 15 | Console clean | **FAIL** | One React `console.error` per done-toggle, reproduced in isolation (log cleared, week-nav alone clean, hover alone clean, the toggle alone produced it): *"Updating a style property during rerender (textDecoration) when a conflicting property is set (textDecorationColor)"*. Source: `TaskBlock.tsx:134–135` sets the shorthand `textDecoration` (which flips with `done`) alongside the longhand `textDecorationColor` in one style object; `textDecorationLine` would resolve it. Cosmetic only — the strikethrough renders correctly (check 5). No `validateDOMNesting` warnings, no Supabase error text in any toast, no other errors across place / move / resize / done / unschedule / sheet / week-nav / offline cycle. |
| 16 | *Observation — post-drop refetch* | — | **Yes, and it is measurable.** The grid dims to 50% after every write: `WeekGrid.tsx:236` is `className={loading ? 'opacity-50' : undefined}` with `loading = busyState.phase === 'loading' \|\| blocksLoading` (`Planner.tsx:613`). Measured dim windows (40ms sampler): **745ms** (check 1 drop), **722ms** (check 2 drop), **919ms** (check 4 drop) — so ~0.7–0.9s, at the low end of the predicted 0.5–1.5s. Network: **exactly one** request to `dashboard-caldav-proxy.vercel.app/api/calendar/busy` per write (check 1 drop → 1, at +1.17s; check 2 → 1; check 4 → 1), confirming the source read — both the busy effect and the blocks effect key their cache on `${dashboardRefreshKey}:${weekKey}`, so the realtime echo bumps the key, both miss, both re-enter loading, and a fresh `getBusy` goes out. Re-fetching iCloud busy on a `scheduled_blocks` write is avoidable: only the blocks cache actually needs the bump. |
| 17 | *Observation — empty-week copy* | — | **Confirmed, both directions.** Sep 7–13 (one busy block `Taylor's Bday`, zero scheduled): `Nothing planned yet.` does **not** render. Sep 14–20 (no busy, no blocks) and Aug 24–30 (same): it renders. Matches `WeekGrid.tsx:233` — `emptyWeek = busy.length === 0 && scheduled.length === 0 && !loading && !drag`. The copy is gated on both, so a week with only busy blocks shows an unexplained empty grid. |

## Harness finding — Chrome MCP runs JS in an isolated world

`execute_javascript` shares the **DOM** with the page but not the **JS globals**.
Proved by injecting a `<script>` (which does run in the page's world) that
reported back through a DOM attribute: the page saw `navigator.onLine === true`
and none of the helper globals, while the calling context saw `false`.

This invalidated two first attempts and both were redone by injecting into the
page's world:

- A `console.error` wrapper set from the calling context never wraps the app's
  console. The initial "zero errors" reading was meaningless — the only entry it
  ever caught was an exception thrown by the harness itself.
- A `navigator.onLine` patch set from the calling context never reaches
  `isOnline()`, so `writeRow` keeps taking its online branch: the first offline
  attempt looked like a pass but wrote straight through to Supabase with an
  empty outbox. The real check 14 result above used page-world injection.

Everything DOM-mediated is unaffected — the synthesized pointer drags, computed
styles, geometry, accessible names and clicks in checks 1–13 all cross the world
boundary correctly. Future smokes should inject a `<script>` element for
anything that must patch or observe page-world JS.

Two smaller harness notes: `left_click_drag` remains unusable (as CLAUDE.md
says), and the synthesized drag additionally needs its `pointerup` dispatched in
a **separate** call from the `pointermove`s — firing the whole sequence in one
tick leaves the hook's state stale and the drop is silently dropped. Also,
`document.querySelectorAll('[data-testid="task-block"]')` returns both branches:
the `sm:hidden` mobile DOM is always mounted, so a block on the mobile-selected
day appears twice at desktop width.

## Environment finding — Calendar.app fixtures do not reach the proxy

`Smoke Busy` was first created in Calendar.app on the green primary iCloud
calendar (the same calendar `Rent Due` lives on, verified by colour). It never
appeared in `/api/calendar/busy` — not after 30 minutes, not after a forced
`Cmd+R` refresh, and not 40 minutes later when the run ended. The same event
created through the app's own `POST /api/calendar/events` appeared in the busy
payload **immediately**, and once iCloud synced it back down it landed on that
same green calendar (both copies visible side by side in Calendar.app, both
green — while the proxy still returned only one).

So the read path and the calendar choice are both fine; the local Calendar.app
event simply never pushed to iCloud's CalDAV server. **Future smokes should
create busy fixtures via `createEvent` rather than Calendar.app** — it is
immediate and verifiable. Worth re-reading chunk-36's iCloud observations with
this in mind.

Unrelated to this chunk, but the chunk-36 "proxy serves local wall-clock as UTC"
finding appears **fixed** for timed events: `Rent Due` at 10:00 ET arrived as
`2026-09-01T14:00:00.000Z` and rendered at 10:00, not 06:00.

## Deviations from the spec

1. **Week.** Ran on Aug 31 – Sep 6 rather than the current week (reason at top).
2. **Fixtures.** `Smoke P1` / `Smoke zero` were created via PostgREST with the
   same field shape the Dashboard writes (`Work/General` and `Personal/General`
   subcategories taken from existing open tasks), not through the Dashboard UI.
   Both appeared correctly in the tray under `P1 — URGENT` / `NO PRIORITY`, so
   the fixture contract held; task *creation* itself was not exercised.
3. **`Smoke Busy`.** Created via the app's `createEvent` after the Calendar.app
   copy failed to sync (see above). Same calendar, same 10:00–11:00 local slot.
4. **Mobile width.** Reached with a same-origin 570px iframe (chunk-33's
   method), not a window resize — Chrome is read-only to computer use in this
   session and `window.open` was popup-blocked.
5. **Check 1 toast** was verified through the identical code path in checks 4
   and 10 rather than captured live at the moment of check 1's drop.

## End state

`scheduled_blocks` = **0 rows**, matching the pre-smoke baseline. `Smoke P1` and
`Smoke zero` deleted (blocks cascaded). Both `Smoke Busy` events deleted from
Calendar.app and confirmed gone from the busy payload (only `Rent Due` remains
that week). No real tasks, settings or calendar entries were modified; the
second tab was closed and the page reloaded to discard all injected patches.
