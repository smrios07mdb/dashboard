# Chunk 38 — Week Planner: Fill my week (proposals) + carryover

**Repo:** `smrios07mdb/dashboard` · **branch:** `redesign` (HEAD `8219fba` = chunk-37 revisions `a9493f4` + PROGRESS fill) · **Prerequisite (met):** chunk-37 revisions re-run 8/8 PASS (`5r 11r 15r 16r 17r 1 6 13`), migration 11 applied.

Run this chunk per `CLAUDE.md` and `prompts/README.md` (apply the README's substitutions and conventions before anything else). Authority order: `ARCHITECTURE.md` → `prompts/README.md` → this prompt. If this prompt and `ARCHITECTURE.md` disagree, stop and surface it.

Read the committed source before writing anything — never work from this prompt's paraphrase alone. This prompt was written against `8219fba`; if a file differs from what's described here, the file wins and you say so in the completion report.

---

## Operator pre-step (before Claude Code runs)

The Cowork re-run report is not in the repo yet. Save it and commit it as its own commit so Task 0 can reference it:

```bash
cd ~/path/to/dashboard          # your local clone, on `redesign`, clean tree
git status --short              # must be empty
cp ~/Downloads/claude_chunk-37-smoke-revisions-2026-08-29.md verification/chunk-37-smoke-revisions.md
git add verification/chunk-37-smoke-revisions.md
git commit -m "Chunk 37: Cowork revisions smoke results (8/8 PASS)"
git push origin redesign
git log --oneline -1            # note this SHA — Task 0 cites it
```

Also delete the leftover `Smoke Busy` event (WED Sep 2 2026 10:00–11:00, uid `25d58a32-2ea6-4cec-9fab-46a5beeee1f6`) by hand in Calendar.app — there is no delete path until chunk 39.

---

## Why this chunk exists

Chunk 37 made the planner real: blocks persist, drag/move/resize/sheet placement work, done derives from `tasks.completed_at`, capacity is true. This chunk adds the two mechanics the handoff calls "Live mechanics" that were explicitly carved out of 37 (chunk-37 D1): **Fill my week** (proposed slots for every P1/P2 tray task, accept or clear) and **carryover** (a past, unfinished block goes hollow and can jump to the next open slot). It stops before Apple Calendar write-out (chunk 39).

## Files to read first (in this order)

Design authority:
- `hupomnemata_handoff/planner/README.md` — §"Interactions & behavior" (Fill my week, Carryover), §"Algorithms" (`nextOpenSlot`, `autoFill`)
- `hupomnemata_handoff/planner/DESIGN_NOTES.md` — "Live mechanics (v2 additions)": Fill my week, Carryover, Done state
- `hupomnemata_handoff/planner/prototype/planner/planner-primitives.jsx` — `isPastBlock` (l.59), `SchedBlock` carry branch (l.190–262), `ProposalBlock` (l.277–296), `TrayCard` `proposedLabel` (l.327–360), `dayOcc` with `extra` (l.400), `nextOpenSlot` (l.424–436), `autoFill` (l.439–457)
- `hupomnemata_handoff/planner/prototype/planner/WeekPlannerDesktop.jsx` — `proposedMap` (l.94), `carryMove` / `fill` / `acceptFill` (l.186–202), header `Fill my week` button (l.227–230), the accent proposals bar (l.236–249), `ProposalBlock` render per column (l.288), `fillable` (l.212)
- `hupomnemata_handoff/planner/prototype/planner/WeekPlannerMobile.jsx` — `carryMove` (l.119–124), `onCarryMove` wiring (l.181). Note: the mobile prototype has **no** Fill my week.

Shipped planner (chunk 37) — extend, don't rewrite:
- `src/screens/Planner.tsx` (885 lines) — state layout: busy fetch + `busyCacheRef` (l.202–298), blocks + `blocksCacheRef` + `patchBlocks` (l.307–363), `gridBlocks` (l.465–480), mutations `place/move/resize/toggleDone/unschedule` (l.483–609), sheets (l.612–620), `header` (l.693–729), render (l.743–883)
- `src/lib/plannerSchedule.ts` — `dayOcc` (private, l.112), `findOpenSlots`, `overlapBusy`, `blockDurationMin`, `blockIsDone`, `splitTray`, `WeekScheduledBlock`, `DayInterval`
- `src/lib/plannerGeometry.ts` — `PLANNER.workStart/workEnd`, `ceil15`, `fmtClock`, `fmtRange`, `DAY_LABELS`, `todayIndex` (may be <0 or >6), `minutesOfDay`, `addDays`, `weekStart`
- `src/lib/plannerCapacity.ts` — untouched; `computeCapacity`/`computeDayFree` signatures
- `src/components/planner/TaskBlock.tsx` — header comment says "minus carryover — hollow past-blocks and 'move to next open slot' are chunk 38"; `showActions` (l.85), action row (l.146–188), style object (l.117–128)
- `src/components/planner/WeekGrid.tsx` — `GridTaskBlock` (l.49), `WeekGridProps` (l.128–167), `displayed`/`emptyWeek` (l.220–243), per-column `TaskBlock` map (l.350–370), empty-week copy (l.399–410)
- `src/components/planner/DayTimeline.tsx` — `scheduled`/`onToggleDone`/`onOpenActions` (l.24–52), `emptyDay` (l.78), block map (l.172–185)
- `src/components/planner/PlannerTray.tsx` — `TrayCard` style object (l.112–121, **the object with the open style-warning bug**), `PlannerTrayProps` (l.145–156), `MobileUnscheduledList`
- `src/components/planner/BlockActionSheet.tsx` — the 3-button sheet
- `src/lib/taskSort.ts` — `compareTasks('priority')`: priority → `due_at` asc nulls last → `created_at` (this **is** `autoFill`'s sort, see D3)
- `src/components/icons.tsx` — `Sparkles`, `ArrowRight`, `Check`, `X` already exported
- `src/components/ui/button.tsx` — variants/sizes
- Tests to extend: `src/lib/plannerSchedule.test.ts` (22 cases), `src/components/planner/WeekGrid.test.tsx` (20), `BlockActionSheet.test.tsx`
- `verification/chunk-37-smoke-spec.md`, `verification/chunk-37-smoke-revisions.md` (committed by the operator pre-step), `CLAUDE.md` "Smoke harness notes"

---

## Task 0 — chunk 37 closeout (own commit, before any chunk-38 code)

This closes chunk 37: records the re-run, fixes the one residual finding, and folds the harness lessons into the docs.

1. **Fix the `PlannerTray` conflicting-style warning** (`src/components/planner/PlannerTray.tsx:112–121`). The re-run reproduced 2 `console.error` hits on every drag start and 2 more on drag end: React's *"Updating a style property during rerender (border) when a conflicting property is set (borderLeft)"*. Cause: the style object sets the `border` **shorthand** (ghost) alongside the `borderLeft` longhand (overdue) and both flip in the same commit. Fix by moving the ghost border to class names and leaving `borderLeft` as the only border key inline:
   - Remove the `border:` key from the style object.
   - Build the class string conditionally: base `w-full rounded border bg-surface text-left transition-colors` + (`ghost ? 'border-dashed border-line-strong' : 'border-line shadow-sm hover:border-line-strong'`). `border-dashed`/`border-line-strong` are already used in this file (l.197).
   - Keep `boxShadow: ghost ? 'none' : undefined` as is (or drop it — `shadow-sm` is now class-gated; either way the ghost must render with no shadow).
   - Rule going forward (also add as a one-line comment where the style object is built): **never put a CSS shorthand and one of its longhands in the same inline style object** (`border`/`borderLeft`, `textDecoration`/`textDecorationColor`, `background`/`backgroundColor`, `padding`/`paddingLeft`…). Variant borders go through class names; longhands stay inline.
   - Verify visually in the dev server: drag a tray card — ghost source card still dashed/45%/no shadow; an overdue card keeps its 3px destructive left edge when not ghost.
2. **Smoke spec corrections** (`verification/chunk-37-smoke-spec.md`):
   - Check 1 "Expect": replace "with the P1 chip and mono range" with "title only — a 45m block is 37px at the 52px hour and `TaskBlock` suppresses the chip and range under 40px (`tight`); the range is exposed via the accessible name `Smoke P1, 14:00–14:45`". Do not raise the fixture estimate — 45m is deliberate.
   - Data setup, `Smoke Busy`: replace "(create in Apple Calendar; delete at the end)" with "(create through the app's `createEvent` / `POST /api/calendar/events` per CLAUDE.md; **cannot be deleted from the app until chunk 39** — delete it by hand in Calendar.app afterwards and record the uid in the results)".
   - Under "Revisions re-run", add one line: results in `verification/chunk-37-smoke-revisions.md` — 8/8 PASS; residual `PlannerTray` style warning fixed in the chunk-37 closeout commit.
3. **`CLAUDE.md` "Smoke harness notes"** — add these paragraphs (same voice as the four chunk-37 paragraphs):
   - **Mobile branch via a same-origin iframe.** A 570px-wide same-origin `<iframe>` gives a real media-query layout (564px inner), authenticates from the shared origin's `localStorage`, and its document is scriptable from the parent, including page-world `<script>` injection into the iframe's own document. `window.open` with a size hint is popup-blocked without a user gesture and Chrome MCP exposes no `resize_window`; use the iframe.
   - **`.focus()` scrolls the page and silently breaks the next synthesized drag.** After focusing a tray card the page can sit at `scrollY ≈ 1900` with the grid off-screen; the drag then starts (ghost + floating card) but never produces `[data-testid="drop-slot"]`. Assert `window.scrollY === 0` and re-read `getBoundingClientRect()` immediately before dispatching pointer coordinates.
   - **The drop preview lands one tick late.** `[data-testid="drop-slot"]` is `null` inside the same script that dispatched the `pointermove`s and present on the next call. Don't read that as a failed drag.
   - **Dashboard row selection.** To reach a task's checkbox, walk up from the title leaf to the **nearest** ancestor holding exactly one `button[aria-label^="Mark task"]`. Walking a fixed number of levels can escape the row and toggle a sibling task (the chunk-37 re-run completed and reverted a real task this way).
   - **Busy fixtures leave an iCloud event behind.** `createEvent` has no delete counterpart until chunk 39; every smoke that follows the busy-fixture rule must end with the operator deleting the event in Calendar.app. Record the uid in the results file.
4. **`PROGRESS.md`**:
   - Row 37 review notes, append: "**Revisions re-run (2026-08-29, `verification/chunk-37-smoke-revisions.md`, `<operator-pre-step SHA>`):** 8/8 PASS — 5r both directions incl. the Dashboard-uncheck trigger mirror, 11r sheet opens on the strip's day with no selector, 15r done toggle console-clean, 16r zero busy requests / zero dims per drop (1 request + 1 dim on a cold week, 1 request + 0 dims on Force resync), 17r empty-week copy over busy, regressions 1/6/13 PASS. Residual finding: the same conflicting-style warning class fired from `PlannerTray` on drag start/end — fixed in the closeout commit (`<this SHA>`, class-gated ghost border). Spec check-1 wording corrected (title-only under 40px). Smoke busy fixture cleanup needs Calendar.app until chunk 39."
   - Decisions log, one row dated 2026-08-30: "Inline styles never mix a CSS shorthand with one of its longhands (React 19 logs a conflicting-style `console.error` when both change in one commit — hit twice in the planner: `TaskBlock` `textDecoration`, `PlannerTray` `border`). Variant borders/decorations go through class names or longhands only. 'Console clean' smoke checks are page-world-injected, so this now fails loudly."
   - Save this prompt as `prompts/chunk-38-planner-fill-carryover.md`.
   - Update "Last updated" at the top (2026-08-30).
5. `npm test` (406 → 406, or +1 if you add a `PlannerTray` render test for the ghost class — optional) / `tsc -b` / `npm run build` green. Commit: `Chunk 37 closeout: revisions smoke record, PlannerTray style warning, harness notes; chunk-38 prompt`. Push.

---

## Locked decisions (flag conflicts, don't relitigate)

**D1 — Scope.** This chunk: `nextOpenSlot`, `autoFill`, `isPastBlock` (pure, tested); Fill my week button + proposals bar + `ProposalBlock` on the desktop grid + dimmed `→ WED 11:45` tray cards; Place all / Clear; carryover styling on `TaskBlock` (both breakpoints); "Move to next open slot" on the desktop hover row and in the block action sheet. **Not this chunk:** Fill my week on mobile (prototype has none — see D12), Apple Calendar write-out, proxy changes, `settings.timezone` in planner math, persisting proposals, any change to `plannerGeometry.ts` / `plannerCapacity.ts` signatures, any `realtime.ts` change.

**D2 — Proposals are local, ephemeral UI state.** `useState<Proposal[]>` in `Planner.tsx`, scoped to the visible week. Cleared on: week change (adjust-state-during-render alongside `selectedDay`, README pattern — not an effect), `Clear`, `Place all` (after the writes), and **any other block/tray mutation** — `place`, `move`, `resize`, `unschedule`, `carryMove`, and tray drag activation (`onCardPointerDown` when the drag hook activates, not on pointerdown). Rationale: proposals were computed against a snapshot of occupancy; any change to it invalidates them, and re-validating is more machinery than the feature is worth. Nothing about proposals is written to Supabase/Dexie, and they never count toward `planned`/`free`.

**D3 — `autoFill` port.** Add to `src/lib/plannerSchedule.ts` (export `dayOcc` with the prototype's `extra` param, or add a private overload — your call, report it):

```ts
export type Proposal = { taskId: string; day: number; startMin: number; endMin: number }
export function autoFill(
  tray: Task[],            // the unscheduled open tasks (splitTray output)
  busy: DayInterval[],
  scheduled: DayInterval[],
  todayIdx: number,        // todayIndex(weekStart, now) — may be <0 or >6
  nowMin: number,
): Proposal[]
```
- Candidates: `tray.filter(t => t.priority === 1 || t.priority === 2)` sorted with **`compareTasks('priority')` from `lib/taskSort.ts`** — that is exactly the prototype's `a.p - b.p || (a.due ?? 99) - (b.due ?? 99)` plus the chunk-33 `created_at` tie-break. Do not write a second sort.
- Duration per task = `blockDurationMin(t.estimateMinutes)` (chunk-37 D4; the prototype uses raw `est` but never has a 0 estimate — real data does). Report this as the one intentional deviation from "port exactly".
- Day scan: `for (d = max(todayIdx, 0); d < 5; d++)` — weekdays only; a future week starts at Monday; if `todayIdx >= 5` (weekend of the current week) or `todayIdx > 6` (past week) the loop body never runs and the result is `[]`.
- Per day: occupancy = `dayOcc(d, busy, scheduled, placedSoFar)`; cursor = `d === todayIdx ? max(workStart, ceil15(nowMin + 10)) : workStart`; first gap ≥ dur wins; trailing gap check `workEnd - cur >= dur`. Window = `PLANNER.workStart/workEnd` (09:00–18:00), not the sheet's 08:00–20:00.
- Earlier proposals occupy as placed (the `placed` accumulator) — the prototype's key property.

**D4 — `nextOpenSlot` port.**
```ts
export function nextOpenSlot(
  dur: number, busy: DayInterval[], scheduled: DayInterval[],
  todayIdx: number, nowMin: number,
): { day: number; startMin: number } | null
```
Scans `d = todayIdx … 6` (today → Sunday; **includes weekends**, as the prototype does) in the 09:00–18:00 window, same cursor rule as D3. Returns null when `todayIdx > 6` or nothing fits.

**D5 — Carryover across weeks (product decision, recorded in the Decisions log).** A carry block in a **past week** is the common case (Friday's unfinished task seen on Monday). "Move to next open slot" therefore always scans the **current week** (today → Sunday), never the visible week:
- If the visible week is the current week: use `busyBlocks` + `weekBlocks` as loaded, exclude the moving block from `scheduled`.
- If the visible week is a past week: fetch the current week's data on demand — busy via `busyCacheRef` when fresh else `withSessionRetry(() => getBusy({from, to}))` (store the result in `busyCacheRef` so the later navigation is warm; `not_configured` ⇒ `busy = []`; other `CalendarError` ⇒ `toast.error('Could not load busy times — retry')` and abort), blocks via `repo.scheduledBlocks.listByRange` for the current week. Map both with `busyToWeekBlocks` / `scheduledToWeekBlocks` against **the current week's** `weekStart`.
- Write: `repo.scheduledBlocks.update(id, { startAt, endAt })` with `toInstant(currentWeekStart, day, startMin)` and `endAt = startAt + duration` (duration = the block's full instant duration, chunk-37 move semantics). Optimistically remove the block from the visible past week (`patchBlocks` filter) — it now belongs to another week; if the visible week is the current week, patch it in place instead. On failure: `fail(e)` (toast + `reloadBlocks`).
- Toast: `Moved to {DAY} {n}, {HH:MM}.` — `{DAY}` = `DAY_LABELS[day]`, `{n}` = date-of-month, e.g. `Moved to WED 2, 11:00.` (prototype `Moved to ${d} ${n}, ${clock}`). No slot: `No open slot left this week.`
- Future weeks have no carry blocks by definition (`isPastBlock` is false for `day > todayIdx`).

**D6 — `isPastBlock`.** `export function isPastBlock(b: {day:number; endMin:number}, todayIdx: number, nowMin: number): boolean` = `b.day < todayIdx || (b.day === todayIdx && b.endMin <= nowMin)`. For a midnight-split block the **last segment's** `endMin` decides; the screen computes `carry` per `GridTaskBlock` (add `carry: boolean` next to `done`) as `isPastBlock(segment…) && !done`, and `Planner` ticks `now` every minute already, so a block goes hollow within a minute of ending.

**D7 — `TaskBlock` carry rendering** (port `SchedBlock` l.197–262 exactly, with the style rule from Task 0):
- Root: `background: color-mix(in srgb, var(--surface) 55%, transparent)`; dashed border via **class** (`border-dashed border-line-strong` replacing `border-line`, not an inline `border` key); `borderLeft: 3px solid color-mix(in srgb, ${c} 45%, transparent)` (same as done); `boxShadow: 'none'`; opacity 1 (carry is not done).
- Title color `var(--ink-2)` (done wins: `--ink-3` + strikethrough).
- Mono range gets the suffix ` · unfinished` when `!tight`.
- Action row when `showActions`: **[→ move][✓ done][× unschedule]** — the → button is 16px, `border 1px solid var(--line-strong)`, `bg surface`, `color ink-2`, `ArrowRight size={10}`, `title`/`aria-label` `Move to next open slot`, `onPointerDown` stop-propagation + `onClick` → `onCarryMove(block)`. Only when `carry && onCarryMove`.
- `showActions = pos.height >= 24 && (touch ? (done || carry) : (hover || done))` — the prototype's line, which chunk 37 shipped without `carry`.
- A carry block is still draggable/resizable (`canDrag = !touch && !done`), keyboard-openable, P1 chip rule unchanged.
- New props: `carry: boolean`, `onCarryMove?: (block) => void`. `aria-label` becomes `${title}, ${range}${done ? ', done' : carry ? ', unfinished' : ''}`.

**D8 — `BlockActionSheet`** gains `carry: boolean` + `onCarryMove`. When `carry`, a **first** button `Move to next open slot` (variant `outline`) above `Mark done`; the other three unchanged. `Planner` passes `actionEntry.carry`.

**D9 — Fill my week UI (desktop only).** In `header`, between `{stale && <StaleChip/>}` and the capacity span, render `proposals.length === 0 && <Button variant="outline" size="sm" onClick={fill} disabled={!fillable}><Sparkles size={13}/> Fill my week</Button>` where `fillable = trayItems.some(i => i.task.priority === 1 || i.task.priority === 2) && todayIdx <= 4` (nothing to fill on a past week or a weekend; disabled renders at the Button's `disabled:opacity-50`, not the prototype's `.45`). Because `header` is shared by both branches, gate the button on the desktop branch: render it only inside the `data-branch="desktop"` tree (simplest: give `header` a `fill` slot rendered only by the desktop caller, or render two headers — your call, report it). `fill()` = `autoFill(trayTasks, busyBlocks, weekBlocks, todayIdx, nowMin)`; empty ⇒ `toast('No open weekday slots for P1–P2 tasks.')`, else `setProposals`.

**D10 — Proposals bar** (desktop, directly under the header, above `WeekGrid`): `flex items-center gap-[10px] px-3 py-2 mb-3 rounded bg-accent-soft` with `border: 1px solid color-mix(in srgb, var(--accent) 22%, transparent)` — note `--accent` in this repo is an HSL triple (`hsl(var(--accent))`); check `index.css` and use whichever expression the other accent borders in the codebase use. Content: `Sparkles size={13}` in `text-accent-ink`; `num mono text-[11.5px] font-semibold text-accent-ink` `{n} proposals · {fmtMin(Σ durations)}`; `text-[12px] text-ink-2` `P1–P2 tasks into the earliest open weekday slots.`; `ml-auto`; `Button size="sm"` (default/primary variant) `Place all`; `Button variant="ghost" size="sm"` `Clear`. Σ = Σ `endMin − startMin` over proposals (equals Σ `blockDurationMin`, see D3).

**D11 — `ProposalBlock`** — new `src/components/planner/ProposalBlock.tsx`, port l.277–296: absolute `inset-x-[3px]`, `top/height` from `blockPos`, `zIndex: 3`, `rounded`, `border: 1.5px dashed color-mix(in srgb, ${c} 50%, transparent)` (the only border key — fine), `background: color-mix(in srgb, ${c} 6%, var(--surface))`, padding `3px 7px` under 40px else `5px 8px`, title 11.5/500 `--ink-2` ellipsis, and when `height >= 40` a mono 9.5px line in the category color: `{range} · proposed`. `data-testid="proposal-block"`, `aria-hidden` (proposals are a preview, not a control; the bar is the control). `WeekGrid` gets `proposals?: Array<Proposal & { task: Task; catName: string }>` and renders them per column after the task blocks. `emptyWeek` additionally requires `proposals.length === 0`.

**D12 — Tray card `proposedLabel`.** `PlannerTrayProps` gets `proposedByTask?: Map<string, string>` (`taskId → 'WED 11:45'`, built like the prototype's `proposedMap` with `DAY_LABELS[day] + ' ' + fmtClock(startMin)`). `TrayCard` gets `proposedLabel?: string`: opacity `0.6` when set (ghost `0.45` wins), and the meta row shows `→ {label}` (`num mono text-[10.5px] font-semibold text-accent-ink`) **instead of** the due text. Proposed cards remain draggable and clickable (dragging clears proposals per D2). `MobileUnscheduledList` is untouched (no mobile proposals).

**D13 — `Place all`.** Sequential `await repo.scheduledBlocks.create({...})` per proposal in proposal order (no batch API; sequential keeps outbox ordering deterministic). `patchBlocks` after each success. On the first failure: `fail(e)` (toast `Could not save — retry` + `reloadBlocks`), stop, clear proposals — blocks already created stay. On full success: `toast('{n} tasks placed.')` (`1 task placed.` for one), clear proposals. Overlap with busy cannot occur for proposals (they are computed around busy), so no overlap suffix.

**D14 — Capacity and rails ignore proposals.** `computeCapacity`, `computeDayFree`, `hiddenCounts`, `expandedWindow` receive exactly what they receive today. Proposals live inside 09–18 so they are always in the collapsed window anyway.

**D15 — Style rule (from Task 0).** No inline style object anywhere in `src/components/planner/**` may contain a CSS shorthand and one of its longhands. `ProposalBlock` uses only the `border` shorthand; `TaskBlock` uses only `borderLeft`; `TrayCard` uses only `borderLeft`. Add a `WeekGrid.test.tsx` case that spies on `console.error` while toggling a block between plain → carry → done and asserts zero calls (jsdom + React 19 logs the same warning as the browser).

---

## Component / screen changes (summary — the source read governs)

- `src/lib/plannerSchedule.ts`: `isPastBlock`, `nextOpenSlot`, `autoFill`, `Proposal`; `dayOcc` gains the `extra` param. Nothing existing changes signature.
- `src/components/planner/TaskBlock.tsx`: D7. Update the header comment (drop "minus carryover").
- `src/components/planner/ProposalBlock.tsx`: new, D11.
- `src/components/planner/WeekGrid.tsx`: `GridTaskBlock.carry`, `proposals` prop, `onCarryMove` prop passed to `TaskBlock`, `emptyWeek` gate. `data-testid="proposals-bar"` is on the bar in `Planner`, not here.
- `src/components/planner/DayTimeline.tsx`: `onCarryMove` pass-through; carry styling comes from `TaskBlock` for free. No proposals.
- `src/components/planner/PlannerTray.tsx`: Task-0 fix + D12.
- `src/components/planner/BlockActionSheet.tsx`: D8.
- `src/screens/Planner.tsx`: `proposals` state + clearing (D2), `fill`/`acceptFill`/`clearProposals`, `carryMove` (D5), `gridBlocks[].carry` (D6), header button (D9), bar (D10), props wiring. The current-week fetch in D5 is the only new network path; put it in a small `loadWeekOccupancy(weekStart)` helper inside `Planner.tsx` (or a `usePlannerWeekData`-style extraction if it keeps the file readable — report which).

## Copy (final)

- Header button: `Fill my week` · disabled when not fillable.
- Bar: `{n} proposals · {Nh Nm}` · `P1–P2 tasks into the earliest open weekday slots.` · `Place all` · `Clear`.
- Proposal block: `{HH:MM–HH:MM} · proposed`. Tray: `→ {DAY} {HH:MM}`.
- Toasts: `No open weekday slots for P1–P2 tasks.` · `{n} tasks placed.` / `1 task placed.` · `Moved to {DAY} {n}, {HH:MM}.` · `No open slot left this week.` · `Could not load busy times — retry` · errors `Could not save — retry`.
- Block: `… · unfinished` range suffix; `Move to next open slot` (button title/aria + sheet button).

## Tests to add

- `plannerSchedule.test.ts`: `isPastBlock` (past day, today ended, today running, future, `todayIdx` out of range); `nextOpenSlot` (today from now+10 snapped, skips busy and scheduled, falls to next day, weekend allowed, null when `todayIdx > 6`, null when nothing fits); `autoFill` (P1 before P2, due tie-break via `compareTasks`, P3/null excluded, 0-estimate → 30m, proposals occupy for later candidates, future week starts Monday, weekend/past week → `[]`, today-from-now rule, honors busy + scheduled).
- `WeekGrid.test.tsx`: proposal block renders title + `· proposed` at ≥40px and title only below; empty-week copy hidden when only proposals exist; carry block has `· unfinished`, dashed class, `Move to next open slot` button on hover (`fireEvent.mouseEnter`) and fires `onCarryMove`; done beats carry (no → button, strikethrough); the D15 `console.error` spy.
- `BlockActionSheet.test.tsx`: `carry` shows the extra button first; `onCarryMove` fires.
- A `PlannerTray` test: `proposedByTask` → `→ WED 11:45` shown, due text hidden, opacity `0.6`.
- Target: 406 + ≥25, all green; `npm run lint` (3 pre-existing errors outside scope, unchanged), `tsc -b`, `npm run build` clean.

## Smoke spec

Author `verification/chunk-38-smoke-spec.md` for Cowork, chunk-37 format, reusing the CLAUDE.md harness notes (page-world console wrapper, iframe for mobile, `[data-branch]` scoping, `createEvent` busy fixture + manual cleanup, `scrollY === 0` before drags). Checks at minimum: (1) Fill my week on the current week with 2 P1 + 1 P2 + 1 P3 fixtures around a `Smoke Busy` — proposals count/Σ, blocks in the right slots (P1 first, busy skipped, sequential packing), tray cards dimmed with `→`, capacity unchanged; (2) `Clear`; (3) `Place all` → N rows in `scheduled_blocks`, toast, bar gone, capacity updated; (4) proposals cleared by a manual drag; (5) button disabled on a past week / with no P1–P2; (6) carry: a block ending before now goes hollow with `· unfinished`, → moves it (toast, DB row updated, block re-renders at the slot); (7) carry from a **past week** moves into the current week and disappears from the past week; (8) mobile action sheet shows `Move to next open slot` on a carry block; (9) done beats carry; (10) console clean across all checks with the page-world wrapper — including drag start/end (the chunk-37 residual).

---

## Acceptance criteria

- ☐ Task 0 landed as its own commit; drag start/end are console-clean in the dev server (verify with the page-world wrapper technique or a jsdom spy).
- ☐ `autoFill` / `nextOpenSlot` / `isPastBlock` are pure, exported from `plannerSchedule.ts`, and match the prototype except the two recorded deviations (D3 duration, D3 sort via `compareTasks`).
- ☐ Fill my week proposes only P1/P2 tray tasks, weekdays only, earliest-first, packed sequentially around busy + scheduled + earlier proposals; nothing is written until `Place all`; `Clear` and every mutation drop the proposals; capacity ignores them.
- ☐ `Place all` creates one `scheduled_blocks` row per proposal; the tray empties of those tasks; a second tab sees them (existing realtime).
- ☐ Past + not-done blocks render hollow with `· unfinished` on both breakpoints; → / sheet button moves the block to the next open slot in the **current** week, including from a past week.
- ☐ Done styling wins over carry; a done block never shows the → control.
- ☐ `plannerGeometry.ts`, `plannerCapacity.ts`, `realtime.ts`, `vite.config.ts`, `05_realtime.sql`, `lib/streak.ts`, `lib/insights.ts`, `lib/slots.ts`, `BlockTimeSheet.tsx`, `busyCache.ts` untouched (diff-verifiable). No migration in this chunk.
- ☐ No inline shorthand/longhand style conflicts in `src/components/planner/**` (D15 test green).
- ☐ Docs: `ARCHITECTURE.md` scheduled-blocks paragraph gains two sentences (proposals are client-only and ephemeral; carryover moves scan the current week); §13 planner bullet updated; `PROGRESS.md` row 38 + Decisions log (D2, D5, D13); smoke spec authored.

## Do NOT

- Persist proposals anywhere, or recompute them on data changes — they are a snapshot (D2).
- Put Fill my week on the mobile branch, or add a mobile proposals bar.
- Call `createEvent` or any proxy write; touch `dashboard-caldav-proxy` — chunk 39.
- Scan the visible past week for `nextOpenSlot` (D5), or use `settings.timezone` anywhere.
- Change `findOpenSlots`, the Schedule sheet, or the 08:00–20:00 sheet window.
- Reintroduce an inline `border`/`textDecoration`/`background` shorthand next to its longhand anywhere in the planner (D15).
- Add `scheduled_blocks` to export/import; add raw colors; add dark-theme scaffolding; use `@dnd-kit`.
- Skip the source read — `Planner.tsx` is 885 lines and this prompt paraphrases it; follow the file.

## Commit + report

1. Task 0 commit → 2. chunk commit `Chunk 38: Week Planner — Fill my week proposals + carryover` (code, tests, ARCH, PROGRESS row 38, smoke spec) → 3. `PROGRESS: fill chunk-38 commit SHA (<sha>)` if needed.
2. Push `redesign` (deploy fires on `main` only — "no runs found" is expected).
3. Report: the SHAs; `npm test` / `tsc -b` / `npm run build` / `npm run lint` tails; `git diff --stat 8219fba..<chunk-sha>`; every deviation with reason; the D9 header approach and the D5 helper shape you chose; anything in the locked decisions that conflicts with `ARCHITECTURE.md` or the committed source.

The orchestrator verifies the committed source at the exact SHA before the smoke runs; the smoke runs before chunk 39's prompt is written.
