# Chunk 37 — Week Planner: scheduling (persistence + placement)

**Repo:** `smrios07mdb/dashboard` · **branch:** `redesign` (HEAD `b61052e`) · **Prerequisite (met):** proxy busy fix `d9ca515` on `dashboard-caldav-proxy/main`, deployed.

Run this chunk per `CLAUDE.md` and `prompts/README.md` (apply the README's substitutions and conventions before anything else). Authority order: `ARCHITECTURE.md` → `prompts/README.md` → this prompt. If this prompt and `ARCHITECTURE.md` disagree, stop and surface it.

Read the committed source before writing anything — never work from this prompt's paraphrase alone. This prompt was written against `b61052e`; if a file differs from what's described here, the file wins and you say so in the completion report.

---

## Why this chunk exists

Chunk 36 shipped the planner as a read-only grid: busy overlays from both calendar sources, an unscheduled tray, capacity figures computed with `scheduled = []`. This chunk makes the planner do its job — a task gets a time slot, the slot persists, the capacity math becomes true. It is the first of three scheduling chunks (see D1); it deliberately stops before proposals, carryover, and Apple Calendar write-out.

## Files to read first (in this order)

Design authority:
- `hupomnemata_handoff/planner/README.md` — §"Data model", §"Interactions & behavior", §"Algorithms", §"State"
- `hupomnemata_handoff/planner/DESIGN_NOTES.md` — geometry table, "Interaction decisions", "Live mechanics"
- `hupomnemata_handoff/planner/prototype/planner/planner-primitives.jsx` — `SchedBlock`, `DropSlot`, `TrayCard` (ghost/floating), `findOpenSlots`, `overlapBusy`, `dayOcc`, `snap15`
- `hupomnemata_handoff/planner/prototype/planner/WeekPlannerDesktop.jsx` — `posFromEvent`, `startTray/startMove/startResize`, the `pointermove`/`pointerup` effect, drop toasts, empty-week copy, floating card
- `hupomnemata_handoff/planner/prototype/planner/WeekPlannerMobile.jsx` — `WPMScheduleSheet` (copy, slot cards, custom time row, footer), tap-to-schedule flow, toasts

Shipped planner (chunk 36) — extend, don't rewrite:
- `src/screens/Planner.tsx`, `src/components/planner/{WeekGrid,PlannerTray,DayTimeline,DayStrip,BusyBlock,BusyPopover,WindowRail}.tsx`
- `src/lib/plannerGeometry.ts`, `src/lib/plannerCapacity.ts` (+ tests) — note the existing full signatures: `computeCapacity(busy, scheduled)`, `computeDayFree(day, busy, scheduled, today, nowMin)`, `hiddenCounts(blocks)`, `expandedWindow(blocks)`, `blockPos(...)`, `busyToWeekBlocks(...)`

Data layer conventions:
- `src/db/types.ts` (`TABLES`, `Task`), `src/db/mappers.ts`, `src/db/dexie.ts` (versioning rules in the header comment), `src/db/repo.ts` (`writeRow`, `readWithFallback`, `applyServerEcho`, `tasksRepo.create/update/delete` as the template), `src/db/outbox.ts` (`SPECS` registry), `src/db/realtime.ts` (`makeHandler`, `startRealtime`), `src/db/localCache.ts` (`wipeLocalCache`)
- `supabase/migrations/01_tables.sql`, `02_updated_at_trigger.sql`, `03_rls.sql`, `05_realtime.sql`, `09_outlook_ics.sql` (style + the out-of-band application note)
- `ARCHITECTURE.md` §4 (data model), §6 (sync), §13 (UI rules)

Existing pieces you must NOT reuse for the planner (different windows/timezone model — see D9): `src/lib/slots.ts` (`proposeSlots`), `src/components/BlockTimeSheet.tsx`, `src/lib/busyCache.ts`.

---

## Task 0 — docs catch-up (own commit, before any chunk-37 code)

1. `PROGRESS.md` row 36 review notes: append the smoke result — `verification/chunk-36-smoke.md` ran 10 checks, 9/10 PASS, checks 2 and 6 half-BLOCKED pending a live Outlook ICS feed in Settings; the upstream finding (iCloud wall-clock stamped as UTC, series masters instead of occurrences, spurious all-day blocks) was fixed in the proxy at `dashboard-caldav-proxy` `d9ca515` (deployed 2026-07-31; pushed to `origin/main` 2026-08-29).
2. Decisions log, two rows dated 2026-08-29:
   - "Proxy busy correctness (pre-chunk-37, `dashboard-caldav-proxy` `d9ca515`): both calendar sources expand through one shared node-ical path (`api/_lib/busyExpand.ts`); tsdav `expand: true` dropped because calendar-multiget returns unexpanded masters. **All-day events are excluded from busy for both sources** — a birthday or 'Rent Due' doesn't consume schedulable time, and including it would zero out a day's free capacity. Floating date-times parse as UTC. Planner consumers can trust busy instants as-is."
   - "Chunk 37 scope split: 37 = `scheduled_blocks` persistence + placement (desktop drag/move/resize, Schedule sheet on mobile + keyboard), done/unschedule, real capacity; 38 = Fill-my-week proposals + carryover; 39 = Apple Calendar write-out (proxy update/delete endpoints + app propagation). Rationale: 37 alone is the largest client chunk in the series and each later piece has its own failure surface (algorithmic, then network)."
3. Save this prompt as `prompts/chunk-37-planner-scheduling.md` (chunk-33 precedent).
4. Update "Last updated" at the top. Commit: `Chunk 36 closeout: smoke record + proxy-fix decisions; chunk-37 prompt`.

---

## Locked decisions (flag conflicts, don't relitigate)

**D1 — Scope.** This chunk: persistence, placement (tray→grid drag, block move, block resize on desktop; Schedule sheet on mobile and as the keyboard/click path on desktop), done toggle, unschedule, real capacity/rails, empty-week copy. **Not this chunk:** Fill my week / proposals / `autoFill`, carryover (`nextOpenSlot`, hollow blocks, "move to next open slot"), Apple Calendar write-out, `settings.timezone` in any planner math.

**D2 — Storage: new table `scheduled_blocks`, one block per task.**
```sql
id uuid pk default gen_random_uuid()
user_id uuid not null references auth.users(id) on delete cascade
task_id uuid not null unique references public.tasks(id) on delete cascade
start_at timestamptz not null
end_at timestamptz not null
done boolean not null default false
created_at / updated_at timestamptz not null default now()
check (end_at > start_at)
```
`unique (task_id)` encodes "tray = tasks with no block" server-side. Deleting a task cascades its block. `updated_at` via the existing `public.set_updated_at()` trigger function. RLS: `select/update/delete using (auth.uid() = user_id)`; `insert`/`update` `with check (auth.uid() = user_id and exists (select 1 from public.tasks t where t.id = task_id and t.user_id = auth.uid()))` — FK checks bypass RLS, so the with-check is what stops a block being attached to someone else's task id. Realtime publication + `replica identity full` in the same migration (ARCH §4 rule). Index `(user_id, start_at)`.

**D3 — Client model.** `ScheduledBlock { id, userId, taskId, startAt, endAt, done, createdAt, updatedAt }`, ISO instants (camelCase, snake_case at the boundary via mappers — same as every other table). All grid math stays browser-local (chunk-36 D6): instants → local `day/startMin/endMin` via a `scheduledToWeekBlocks` sibling of `busyToWeekBlocks` (same midnight-split behavior); placement converts local `(weekStart, day, minute)` → instant with `new Date(y, m, d + day, 0, minute).toISOString()`.

**D4 — Duration on placement.** `blockDurationMin(estimateMinutes) = estimateMinutes > 0 ? max(15, ceil15(estimateMinutes)) : 30`. Real data has `estimate_minutes = 0` (schema default); the prototype's mock never did. Resize minimum 15m. All snapping 15m (`snap15` = round-to-nearest; `ceil15` stays as-is for "from now").

**D5 — Done ⇔ task completion.** The block's done-check is the task's completion: toggling calls `repo.scheduledBlocks.update(id, { done })` then `repo.tasks.markComplete(taskId, done)` (two writes, block first; on failure of either, toast the normalized error and re-read). Rendering treats a block as done when `block.done || task.completedAt != null`, so completing a task on the Dashboard shows as done on the planner without any extra sync. The tray already excludes completed tasks; it now also excludes tasks that have a block.

**D6 — Unschedule.** Deletes the block; the task reappears in the tray. Desktop: an `×` beside the done-check in the hover action row (prototype pattern, one more control). Mobile + keyboard: the block action sheet (D7). Toast: `Returned to tray.`

**D7 — Drag is native pointer events, not `@dnd-kit`.** The grid is a continuous time axis with pixel→minute hit-testing and a resize strip; `@dnd-kit`'s droppable model fits neither, and the prototype's `posFromEvent` math is the tested spec. Rules: `pointerdown` on a tray card / block body / resize strip → `setPointerCapture`; a drag activates after ≥5px of travel (before that, `pointerup` is a click); window-level `pointermove`/`pointerup` while active; `document.body` gets `user-select: none` and `cursor: grabbing` (`ns-resize` for resize) only while a drag is live; `Escape` cancels. **Click (no drag) on a tray card opens the Schedule sheet** — that is the keyboard path on desktop, so the sheet is one component shared with mobile. Tray cards and task blocks are `<button>`s (chunk-36 `BusyBlock` precedent); `Enter`/`Space` on a block opens the block action sheet (Mark done / Mark not done · Unschedule · Cancel), which is also what a tap on mobile does. No keyboard drag; the sheet is the accessible equivalent. Touch devices never start a drag (`useIsTouchDevice`).

**D8 — Overlap is advisory, never blocked.** Against busy: preview flips destructive with `OVERLAPS {TITLE} · {m}M` (`CONFLICTS WITH BUSY` when the busy block has no title), the drop lands, the toast says so (copy in §Toasts). Against other task blocks: allowed, no check, no warning (prototype behavior — keep it).

**D9 — Windows.** Drops and moves clamp into the currently visible grid window `[h0, h1]` (prototype). Schedule-sheet slots come from the ported `findOpenSlots` (08:00–20:00, ≤3, today from `now + 10m` ceil-15) computed around busy + already-scheduled blocks for the chosen day; the custom-time row accepts any `HH:MM`, end = start + duration clamped to 24:00. Capacity stays Mon–Fri 09:00–18:00 (existing libs). Do not reuse `lib/slots.ts` — different window and timezone model.

**D10 — Rails and expanded window count task blocks too.** `hiddenCounts([...busy, ...scheduled])`, `expandedWindow([...busy, ...scheduled])` — the prototype's `all`. Same on the mobile timeline.

**D11 — Realtime touch is additive only.** `src/db/realtime.ts` is a locked subsystem; this chunk is authorized to add exactly one `makeHandler` entry and one `.on(...)` registration for `scheduled_blocks`, following the existing shape byte-for-byte. The debounce, the settings handler, and every existing registration stay untouched. Say "realtime.ts: additive registration for scheduled_blocks (authorized by chunk-37 prompt D11)" in the review notes.

**D12 — Export/import/wipe.** `scheduled_blocks` is **not** added to the export payload this chunk (format version stays). Replace-import teardown and "Wipe my data" rely on the `tasks` FK cascade. `wipeLocalCache` must clear the new Dexie store. Log "blocks in export/import" as a deferred item in the row-37 review notes.

**D13 — Conflict policy.** Last write wins on `updated_at`; no optimistic locking. A server `unique(task_id)` violation on insert surfaces as a 4xx → the normalized `Could not save — retry` toast and a tray re-read.

**D14 — Week fetch.** Blocks load per visible week (`listByRange(weekStart, weekStart+7d)`), cached in the same per-week in-memory map pattern as busy and invalidated by `dashboardRefreshKey`. Realtime block events bump the key through the existing `scheduleDashboardRefresh` path.

**D15 — Tokens.** No new raw color values. Task blocks, drop previews, and the floating card use the prototype's `color-mix(...)` on existing tokens (`--work`/`--personal` via `catColor`, `--destructive`, `--surface`, `--line`, `--line-strong`, `--shadow-sm/lg`, `--radius`). The five `--busy-*` vars from chunk 36 stay the only planner-specific raw values.

---

## What to build

### 1. Migration — `supabase/migrations/10_scheduled_blocks.sql`

Header comment in the 08/09 style (chunk, ARCH §4, purpose, application note). Contents per D2, idempotent where the project's style already is (`create table if not exists`, `drop trigger if exists`, `drop policy if exists`, `create index if not exists`). Guard the publication add so re-running is a no-op:

```sql
do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'scheduled_blocks'
  ) then
    alter publication supabase_realtime add table public.scheduled_blocks;
  end if;
end $$;
alter table public.scheduled_blocks replica identity full;
```

**Apply it via the established surgical path** — raw SQL through the Supabase MCP `execute_sql` against the dev project (chunk-33/35 precedent; `db push` stays blocked by divergent migration tracking). Verify with `information_schema.columns` + `pg_publication_tables` + `pg_policies` and quote the results in the report. If the MCP isn't available in your session: stop after writing the file, print the SQL for the operator, and continue with the app work — the unit suite mocks Supabase, only the live smoke needs the table.

### 2. Data layer

- `src/db/types.ts`: `ScheduledBlock` type (D3); `TABLES.scheduledBlocks = 'scheduled_blocks'`.
- `src/db/mappers.ts`: `ScheduledBlockRow`, `scheduledBlockFromRow`, `scheduledBlockToRow` (partial-friendly like `taskToRow`).
- `src/db/dexie.ts`: **v4** — `scheduled_blocks: '&id, taskId, startAt, endAt'` (taskId indexed, not unique — uniqueness is server-side; a realtime echo racing an optimistic put must not throw). New store only → no `.upgrade()`; keep the v2/v3 comment convention.
- `src/db/repo.ts`: `scheduledBlocksRepo` with
  - `listByRange(fromIso, toIso): Promise<ScheduledBlock[]>` — `readWithFallback`; online: `start_at < to and end_at > from`, mirror into Dexie (delete-then-bulkPut for the range, `routineLogs.listByRange` pattern); fallback: Dexie filter on `startAt`/`endAt`.
  - `create({ userId, taskId, startAt, endAt })` — `crypto.randomUUID()` id, `writeRow` insert (`tasksRepo.create` template).
  - `update(id, { startAt?, endAt?, done? })` — `writeRow` update with `updatedAt` stamping (`tasksRepo.update` template).
  - `delete(id)` — `tasksRepo.delete` template (outbox delete offline).
  - `applyServerEcho` case for the table. Export under `repo.scheduledBlocks`.
- `src/db/outbox.ts`: `SPECS.scheduled_blocks` (byId keys, `cachePut` via mapper, `cacheDelete`).
- `src/db/realtime.ts`: per D11.
- `src/db/localCache.ts`: add the store to the transaction list and clear it.

### 3. Pure libs — `src/lib/plannerSchedule.ts` (new) + tests

Keep `plannerGeometry.ts` / `plannerCapacity.ts` untouched (their signatures already take scheduled blocks). New module, all pure:

- `export type WeekScheduledBlock = { id: string; taskId: string; day: number; startMin: number; endMin: number; done: boolean }`
- `scheduledToWeekBlocks(blocks: ScheduledBlock[], weekStart: Date): WeekScheduledBlock[]` — mirrors `busyToWeekBlocks` incl. midnight split; invalid/empty ranges drop.
- `toInstant(weekStart: Date, day: number, minute: number): string` — local → ISO.
- `snap15`, `blockDurationMin` (D4).
- `findOpenSlots(day, dur, busy, scheduled, isToday, nowMin): Array<{ startMin; endMin; until }>` — exact port of the prototype (`dayOcc` merge sorted by start, `cur` advancing with `ceil15(max(cur, e))`, 08:00–20:00, the `+ max(dur,60) + 60` stride for trailing slots, max 3).
- `overlapBusy(day, s, e, busy): { title: string | null; mins: number } | null` — largest overlap wins; `title` null when the busy block has none.
- `gridPointToSlot({ x, y, width, gutter, hourH, h0, h1 }): { day: number; minute: number } | null` — exact port of `posFromEvent` (column units `[1,1,1,1,1,.55,.55]`, the `x > width + 40` / `y ± 20` tolerances, `snap15`, null when outside). Pure so it's unit-testable without a DOM.
- `splitTray(tasks: Task[], blocks: ScheduledBlock[]): Task[]` — open tasks with no block.

Tests (`src/lib/plannerSchedule.test.ts`), minimum:
- `findOpenSlots`: gap before first occupancy; gap between two; trailing slots use the stride; today starts at `ceil15(now+10)`; nothing fits → `[]`; never more than 3; `until` = next occupancy start or 1200.
- `overlapBusy`: none → null; two overlaps → the larger; untitled busy → `title: null`.
- `blockDurationMin`: 0 → 30; 10 → 15; 47 → 60; 60 → 60.
- `scheduledToWeekBlocks`: single-day; crosses local midnight → two segments; outside week → dropped; `done` carried.
- `toInstant` ↔ `scheduledToWeekBlocks` round-trip for a Wednesday 13:15 block.
- `gridPointToSlot`: weekday column boundaries; a point inside the SAT column (0.55 units); y snaps to 15m; gutter → null; below grid + 21px → null.
- `splitTray`: excludes completed and blocked tasks.

### 4. Desktop — `WeekGrid.tsx`, new `TaskBlock.tsx`, `DropSlot.tsx`, `usePlannerDrag.ts`, tray changes

- **`src/components/planner/TaskBlock.tsx`** — port `SchedBlock` minus carryover: white `--surface` card, `1px solid var(--line)`, 3px left edge `catColor(catName)` (45% mix when done), `--radius`, `--shadow-sm` (none when done), padding `5px 8px` / `3px 7px` under 40px, title (11.5px/500, strikethrough `--ink-3` when done, ellipsis), P1 chip when `priority === 1 && !tight && !done` (reuse `PriorityChip`), mono range 9.5px `--ink-3` when not tight, `↓ HH:MM` clip stamp (reuse chunk-36's stamp), 72% opacity when done, 30% when it is the block being moved. Hover (or `touch` + done) reveals the 16px action row: done-check (1.4px border, category fill when done) and `×` unschedule. 7px bottom resize strip (`cursor: ns-resize`, hidden when done). Root is a `<button>` with `aria-label` `"{title}, {range}{done ? ', done' : ''}"`; the action controls stop propagation and are their own buttons. Props: `block`, `task`, `catName`, `hourH`, `windowStartMin`, `windowEndMin`, `done`, `dimmed`, `onBodyPointerDown`, `onResizePointerDown`, `onToggleDone`, `onUnschedule`, `onOpenActions` (keyboard).
- **`src/components/planner/DropSlot.tsx`** — port `DropSlot`: z4, `pointer-events: none`, `1.5px dashed color-mix(c 55%)` + `color-mix(c 7%)` fill, mono range 10px/600 in `c`, conflict variant uses `--destructive` and the note label (8.5px `.label`, `.12em`).
- **`src/components/planner/usePlannerDrag.ts`** — one hook owning drag state for the three kinds (`tray` | `move` | `resize`), the activation threshold, capture, window listeners, `Escape`, and the body cursor/select side effects (D7). It takes a `gridRef` + window bounds getter and calls `gridPointToSlot`. Returns `{ dragState, startTray, startMove, startResize }`, where `dragState.over` is `{ day, startMin, endMin } | null` and the live preview for a resize is applied to the rendered block (prototype `displaySched`). On drop it invokes `onDrop(kind, task/block, over)` — the hook does no I/O.
- **`WeekGrid.tsx`** — new props: `scheduled: WeekScheduledBlock[]` (+ a `tasksById`/`catByTask` lookup or a pre-joined render model — your call, keep it typed), `dragPreview`, `draggingBlockId`, the block callbacks, `onGridRef`. Render order per DESIGN_NOTES z-order: busy (z1) → now-line (z2) → task blocks (z3) → drop slot (z4). Rails/expanded window per D10. Empty week (no busy, no blocks, not loading, no drag): centered serif 17px `--ink-2` "Nothing planned yet." + 12px `--ink-3` "Drag a task from the tray onto a time." at `gridH × .38`, z5, `pointer-events: none`.
- **Floating card** (desktop, during a tray drag): `position: fixed`, `left: px+10, top: py+8`, width 210, `rotate(-2deg)`, `--shadow-lg`, z100, `pointer-events: none`, rendering the same `TrayCard`. The tray's source card goes ghost (dashed `--line-strong` border, 45% opacity, no shadow) while dragging.
- **`PlannerTray.tsx`** — `TrayCard` becomes a `<button>` (`cursor: grab` on non-touch, `touch-action: none`, `user-select: none`); `onPointerDown` → `startTray`; click-without-drag → `onSchedule(task)` opens the Schedule sheet. Empty-tray copy (prototype): dashed card "No unscheduled tasks." / "New tasks wait here until you place them." `MobileUnscheduledList` rows become `<button>`s that call `onSchedule(task)`; drop the "inert" comment.

### 5. Schedule sheet — `src/components/planner/ScheduleSheet.tsx` (shared mobile + desktop)

Built on `src/components/ui/sheet.tsx` (bottom side on mobile; on desktop the same component — `side="bottom"` is fine, don't build a second variant). Port `WPMScheduleSheet` copy exactly:
- Header "Schedule" + close; task summary card (`--bg-alt`, radius): priority chip + title, category dot + `{fmtMin(est)} estimate` + `OVERDUE` label when overdue.
- `.label` "Open slots — {DAY} {date}" (day = selected mobile day; on desktop default to today when the visible week contains it, else Monday — add a compact day selector row (7 `.label` chips, reuse `DayStrip` styling) so desktop users can pick the day).
- Up to 3 slot buttons: mono 15px/600 `HH:MM–HH:MM`, `free until HH:MM`, selected = `--accent` border + `--accent-soft` + `Selected` pill. Zero slots: "No open slot fits {fmtMin(est)} today. Pick a time below." (use "that day" when the chosen day isn't today).
- "Custom" row: `<input type="time">` mono, `+ {fmtMin(est)}`; selecting it deselects slots.
- Footer: Cancel · primary `Add to {Weekday}`.
- `onAdd(day, startMin)` — the screen does the write.

Test (`ScheduleSheet.test.tsx`): renders three slots from given busy/scheduled; selecting the second and pressing Add calls `onAdd` with its start; custom time path; zero-slot copy.

### 6. Block action sheet — `src/components/planner/BlockActionSheet.tsx`

Small bottom sheet: block title + range, buttons `Mark done` / `Mark not done`, `Unschedule` (destructive tone), Cancel. Opened by tapping a block on mobile or pressing `Enter`/`Space` on a block anywhere. Test: renders the right done label and fires both callbacks.

### 7. Mobile — `DayTimeline.tsx`

Add `scheduled` (selected day only) rendering `TaskBlock` with `touch` behavior (no drag handlers; tap → `onOpenActions`). Rails per D10. Empty-day copy under the strip when nothing is on the day and nothing is loading: "Tap an unscheduled task to give it a time." (12px `--ink-3`).

### 8. Screen orchestration — `Planner.tsx`

- Load blocks per D14 alongside busy; derive `weekBlocks = scheduledToWeekBlocks(blocks, weekStartDate)`, the tray via `splitTray`, `scheduledIntervals` for capacity.
- Wire `computeCapacity(busyBlocks, scheduledIntervals)` and `computeDayFree(..., scheduledIntervals, ...)` — `planned` becomes real; `weekFree` stays Σ per-day (chunk-36 fix).
- Handlers (all optimistic via local state + repo, error → normalized toast + re-read):
  - `place(task, day, startMin, durationMin)` → `repo.scheduledBlocks.create`; toast per §Toasts (overlap-aware via `overlapBusy`).
  - `move(block, day, startMin)` → `update(startAt, endAt)` (duration preserved).
  - `resize(block, endMin)` → `update(endAt)`.
  - `toggleDone(block)` per D5. · `unschedule(block)` per D6.
- Mount `ScheduleSheet` and `BlockActionSheet` once at screen level; both breakpoints share them.
- Keep the header untouched except that `planned` is now real.

### 9. Docs (same pass, per `CLAUDE.md` "Routine doc edits")

- `ARCHITECTURE.md` §4: add the `scheduled_blocks` table block (D2 shape) under the tables list; bump the realtime sentence to "all eight user-scoped tables" and list it; add a short "Scheduled blocks (chunk 37)" paragraph: one block per task, `done` ⇔ task completion, browser-local planner math, advisory overlap, export exclusion (deferred). §14: add the deferred items (blocks in export/import; Apple Calendar write-out lands in chunk 39).
- `PROGRESS.md`: add row 37 to the Redesign chunks table (`☑`, Claude Code, SHA, review notes incl. deviations, the D11 realtime note, the export deferral), decisions log rows for any decision you had to make that isn't already above, "Last updated".
- `verification/chunk-37-smoke-spec.md`: author the Cowork smoke (Chrome MCP) — ≥10 checks: place via drag (use the synthesized-pointer sequence from `CLAUDE.md`'s harness notes — `left_click_drag` won't activate), move, resize to 15m minimum, overlap toast against a known busy block, done toggle reflected on the Dashboard, unschedule returns to tray, persistence across reload and across a second tab (realtime), capacity header = Σ per-day with a placed block, mobile Schedule sheet at 570px (3 slots, custom time), block action sheet, keyboard path (Tab to tray card → Enter → sheet), console clean.

---

## Toasts (copy is final)

- Place, no overlap: `Placed {DAY} {HH:MM}.` · with overlap: `Placed {DAY} {HH:MM} — overlaps {title} by {m}m.`
- Sheet add: `Scheduled {HH:MM}.` / `Scheduled {HH:MM} — overlaps {title} by {m}m.`
- Unschedule: `Returned to tray.`
- Done: none (the block restyles). Errors: `Could not save — retry` (README validation rule; never leak Supabase text).

`{DAY}` = `DAY_LABELS[day]` (`WED`), `{title}` = busy title, `{m}` = overlap minutes.

---

## Tests to add (beyond §3, §5, §6)

- `src/db/repo.test.ts`: `scheduledBlocks.create/update/delete` offline → Dexie row + outbox rows (`insert`/`update`/`delete`, table `scheduled_blocks`); online create returns the server echo. Follow the file's existing mocking pattern.
- `src/db/outbox.test.ts`: replay of a queued `scheduled_blocks` insert and delete hits the right table/key and reconciles Dexie.
- `src/db/dexie` (wherever v3 is tested): v4 opens with the new store and existing stores intact.
- `src/components/planner/WeekGrid.test.tsx` (extend): task block renders title/range/P1 chip; done styling (strikethrough + no P1 chip); rails count includes a scheduled block past 19:00; `onUnschedule` fires from the hover `×`; empty-week copy appears only when both busy and scheduled are empty.
- `usePlannerDrag`: a `renderHook` test that a 3px move then `pointerup` is a click (no drop, `onClick` path) and a 6px move then `pointerup` over the grid calls `onDrop` with a snapped `over`. Mock `getBoundingClientRect`.

Target: existing 347 + ≥35 new, all green; `npm run lint`, `tsc -b`, `npm run build` clean.

---

## Acceptance criteria

- ☐ `10_scheduled_blocks.sql` committed and applied to the dev project (or printed for the operator) — table, check, unique(task_id), trigger, 4 policies with the task-ownership with-check, publication membership, replica identity full, index — all verified by query and quoted in the report.
- ☐ Placing a task from the tray persists a `scheduled_blocks` row; reload shows it; a second tab shows it within ~1s (realtime); the task is gone from the tray.
- ☐ Move and resize persist; resize can't go under 15m; both snap to 15m; drops clamp to the visible window.
- ☐ Overlap with busy is allowed and surfaced (preview + toast) — never blocked.
- ☐ Done-check on a block completes the task (Dashboard agrees); completing a task on the Dashboard renders the block as done; un-done reverses both.
- ☐ Unschedule deletes the row and returns the task to the tray.
- ☐ Header `planned` equals Σ scheduled minutes on the visible week; per-day `free` subtracts scheduled blocks inside 09–18; `weekFree` = Σ per-day.
- ☐ Rails count and the expanded window include task blocks.
- ☐ Mobile: tap a row → Schedule sheet → Add places the block on the selected day; tap a block → action sheet. Desktop: click (no drag) on a tray card opens the same sheet with a day selector; `Enter` on a block opens the action sheet.
- ☐ Offline: place/move/done/unschedule apply to Dexie + outbox and replay on reconnect (unit-proven; one manual check in the smoke spec).
- ☐ `realtime.ts` diff is exactly one handler + one `.on()`; `lib/slots.ts`, `BlockTimeSheet.tsx`, `busyCache.ts`, `BusyStrip`, `plannerGeometry.ts`, `plannerCapacity.ts`, `lib/streak.ts`, `lib/insights.ts`, `vite.config.ts` untouched (diff-verifiable).
- ☐ No `@dnd-kit` import in `src/components/planner/**` or `Planner.tsx`.
- ☐ Docs per §9; Task 0 landed as its own commit before the chunk commit.

---

## Do NOT

- Build Fill my week, proposals, `autoFill`, carryover, `nextOpenSlot`, hollow blocks, or "move to next open slot" — chunk 38.
- Call `createEvent` / write anything to Apple Calendar or the proxy — chunk 39.
- Use `@dnd-kit` for the grid, add a keyboard-drag mode, or introduce a second sheet variant per breakpoint.
- Reuse `lib/slots.ts` `proposeSlots`, `BlockTimeSheet`, or `busyCache` in the planner; use `settings.timezone` anywhere in planner math.
- Change `plannerGeometry.ts` / `plannerCapacity.ts` signatures or behavior (add new pure functions in `plannerSchedule.ts` instead).
- Modify `realtime.ts` beyond D11, or touch `vite.config.ts`, `05_realtime.sql`, `lib/streak.ts`, `lib/insights.ts`.
- Add `scheduled_blocks` to export/import or seed blocks in `sample-data.ts`.
- Add new raw color values; add dark-theme scaffolding of any kind.
- Attempt `supabase db push` / `apply_migration` tracking.
- Skip the source read — if `WeekGrid.tsx`, `PlannerTray.tsx`, or `repo.ts` differ from this prompt's description, follow the file and report the difference.

---

## Commit + report

1. Task 0 commit (docs) → 2. chunk commit `Chunk 37: Week Planner scheduling — scheduled_blocks + placement` (code, tests, migration, ARCH, PROGRESS row 37, smoke spec) → 3. if the SHA can't be known before the row is written, the chunk-36 pattern applies: a follow-up `PROGRESS: fill chunk-37 commit SHA (<sha>)`.
2. Push `redesign`. The deploy workflow only fires on `main` — "no runs found" is expected.
3. Report back: the three SHAs; `npm test` / `tsc -b` / `npm run build` / `npm run lint` output tails; the migration verification queries + results; the `git diff --stat b61052e..<chunk-sha>` file list; every deviation from this prompt with the reason; anything in the locked decisions you found to conflict with `ARCHITECTURE.md` or the committed source.

The orchestrator verifies the committed source at the exact SHA before the smoke runs; the smoke runs before chunk 38's prompt is written.
