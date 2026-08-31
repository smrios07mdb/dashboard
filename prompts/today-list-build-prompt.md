# Build the Today List — Repo-Adapted Claude Code Prompt

Feature branch: `today-list`. The handoff bundle is at repo root: `today_list_handoff/`.
This is a **purely additive** feature — no schema migration, and no changes to existing
screens beyond adding a sun toggle to the shared task row.

This brief layers repo-specific integration and reconciliations on top of the handoff spec.
**Read the handoff files in full first — they are the detailed source of truth:**

1. `today_list_handoff/PROMPT.md` — the feature spec (build-in-three-parts, non-negotiables, decisions).
2. `today_list_handoff/prototype/today.jsx` — source of truth for logic + layout (React-via-Babel; **port to our idioms, don't copy verbatim**).
3. `today_list_handoff/README.md` — one-minute summary.
4. `today_list_handoff/reference/*.png` — the three rendered layouts (stacked = default, rail, banner).

---

## Repo integration map (where each piece lands)

Verified against the current `main` tree. Create/touch exactly these:

**New — pure logic (unit-tested):**
- `src/lib/today.ts` — port `todayReason`, `autoTodayIds`, `resolveToday` from the prototype.
  Use the app's existing `Task` / `Category` / `Subcategory` types (from `src/db` / `src/state`),
  not ad-hoc shapes. The derivation depends only on fields the model already has:
  `id`, `title`, `remindAt`, `priority`, `completedAt`, `estimateMinutes`, `subcategoryId`.
- `src/lib/today.test.ts` — Vitest. Cover: the precedence ladder (overdue > due-today > priority),
  local-midnight bounds, completed → `null`, the synthetic `Pinned` reason (rank 3), and the
  `resolveToday` sort (incomplete-before-complete, then reason rank, then shortest estimate first).

**New — UI:**
- `src/components/TodayPanel.tsx` — `TodayPanel` plus `TodayRow` and `TodayChip` (keep them in
  this file unless they grow). Variants: `stacked` (full-width card) | `rail` (sticky side column)
  | `banner` (top chip strip). `off` renders nothing.

**Touch — integration:**
- `src/screens/Dashboard.tsx` — mount `<TodayPanel>` on the dashboard alongside the Work/Personal
  columns (never behind a tab/route). Placement follows the variant: stacked = full-width above the
  columns; rail = sticky column beside them; banner = strip across the top. Hold the Today-membership
  state here (or in an existing store under `src/state/` if one exists — check first), seed it from
  `autoTodayIds(tasks)`, and re-seed when the task set changes identity (new fetch / data swap).
- `src/components/TaskRow.tsx` — add the sun toggle to the shared row: `inToday: boolean` +
  `onToggleToday(id, force?)` props, mirroring the prototype's addition. The same toggle appears on
  Today rows and on the main-list rows, driving one shared membership set. Add an aria-label.
- `src/components/CategoryColumn.tsx` — thread `inToday` / `onToggleToday` through to its rows. Only
  rearrange columns here if a variant's layout requires it; the mount itself is Dashboard-level.
- `src/components/icons.tsx` — add a sun glyph if one isn't already exported (the prototype uses
  `ISun`); reuse the existing close/X icon for the row's remove (×). Don't fork icons.
- `src/screens/Settings.tsx` — add the `todayList` setting: `stacked | rail | banner | off`,
  default `stacked`, placed **where the existing density/layout options already live**.

**Do not touch:** `src/lib/insights.ts`, `src/lib/streak.ts` (aggregation cores). Today is a new
module; it must not modify — or import and mutate — either.

---

## Reconciliations — honor these (the prototype has a few internal snags)

1. **One color per row = the category color.** Every row is keyed to `--work` / `--personal` via
   the repo's real category-color helper — on the left edge, the subgroup pill, and the status chip.
   **Never color by status.** The prototype's `reason` object has a `color` field that `TodayRow`
   never reads — **drop it**; port only `key`, `label`, `rank`. In particular the prototype's
   `todayReason` references `var(--jewel-rose)` for overdue: that is almost certainly **not** a
   Daylight token (the jewel palette was superseded). Do not introduce it.

2. **`section` (prototype) === `stacked` (setting).** The prototype's default variant is named
   `section` internally; the `todayList` setting value and the spec call it `stacked`. Use `stacked`
   in the setting/key and anywhere user-facing; internally the full-width layout is the prototype's
   `section`.

3. **Verify tokens/classes against the real system.** The prototype uses `--accent`, `--surface`,
   `--surface-2`, `--bg-alt`, `--line-strong`, `--radius`, `--radius-md`, `--shadow-sm`,
   `--shadow-md`, `--font-mono`, and the `.display` / `.label` / `.num` classes. Confirm each against
   `index.html :root` and `index.css`; substitute the Daylight equivalent where a name differs.
   **Check `--accent` specifically** — the token set may expose `--accent-soft` rather than a bare
   `--accent`. Use whichever actually exists for the sun glyph, the "Due today" accent, the rail tint,
   and the progress-bar gradient end.

4. **Wire to the real task system; don't fork it.** The prototype's `onTaskAction({type:'toggle'})`
   must map to the app's existing task-completion action; `onToggleToday(id, force?)` drives the new
   Today-membership state only. Reuse the repo's real equivalents of `catColor`, `fmtMin`, `Check`,
   `IconBtn` — the prototype's names are illustrative. The quickest way to get the real
   imports/signatures right is to crib them from `TaskRow.tsx` and `CategoryColumn.tsx`, which
   already use them. Don't create parallel copies.

---

## Non-negotiables (from the handoff — keep intact)

- Quiet tone: no status-red alarm colors, no confetti, no gradients on chrome. The one intended
  gradient is the header progress bar (work → accent).
- Header: sun glyph + serif "Today" + `.label` date, an `N to do · Hh Mm` summary, and a
  `done / total` count with a thin progress bar.
- Row: checkbox · title · outlined subgroup pill (`● Reviews`, in the list color) · status chip
  (text label, list color) · `.num` estimate · remove (×). Left edge = list color.
- Completion lingers ~1s with strike-through before the row drops (the prototype's `linger` set +
  timeout).
- Resize (stacked + rail only): a drag handle below the list sets `maxHeight`, clamped **120–760px**,
  persisted to `localStorage['hup:todayHeight']`; double-click resets to **360**. Banner has no
  resize. Skip resize on mobile (list flows full-height).
- Empty state: dashed card — "tap the ☀ on any task to plan your day."
- Accessibility: sun toggle and remove need labels; the resize handle is `role="separator"`
  `aria-orientation="horizontal"`.

---

## Decisions to call out in the PR (not blocking this build)

Build the plan as **in-memory UI state, seeded per load** (matches the prototype) — **no schema
migration**. Flag these for a follow-up decision; do not implement them now:

- Whether manual pins should persist server-side (per-user, per-day).
- Whether the plan auto-clears / rolls over at local midnight, and how overdue/pinned carry across days.
- Whether "Due today" should also key off `dueAt` once real due dates exist.

---

## Definition of done

- `todayReason` / `autoTodayIds` / `resolveToday` ported to `src/lib/today.ts` with passing Vitest.
- `TodayPanel` renders all three variants + `off`, matching the reference screenshots.
- The sun toggle works on both Today rows and main-list rows against one shared membership set.
- `todayList` setting added next to the existing density/layout options, default `stacked`.
- Typecheck + build clean; no new hues or tokens beyond the verified Daylight set.
- No changes to `insights.ts` / `streak.ts`, and no changes to other screens beyond the shared task row.
- PR body lists the deferred persistence/rollover decisions above.
