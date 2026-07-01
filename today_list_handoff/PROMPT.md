# Claude Code Prompt — Build the "Today" list

> Paste everything below the line into Claude Code from the root of the Hupomnemata app
> repo, with this `today_list_handoff/` folder copied in. The dashboard, task model, and
> design system already exist — this is a purely **additive** feature. Claude Code should
> read the referenced files itself.

---

You are adding a **Today list** to the existing Hupomnemata dashboard (React + TypeScript +
Tailwind + shadcn/ui). It is a calm, always-visible plan of what needs doing today, shown on
the same screen as the Work / Personal lists — never hidden behind a tab or route. A working
prototype of the exact behavior and visuals lives in `today_list_handoff/prototype/today.jsx`
(written as React-via-Babel — **port it to our idioms, don't copy verbatim**). Rendered
references are in `today_list_handoff/reference/`.

## Read first
1. `today_list_handoff/README.md` — the feature in one minute.
2. `today_list_handoff/prototype/today.jsx` — the source of truth for logic + layout.
3. `today_list_handoff/reference/*.png` — the three layouts.

## Build it in three parts

### 1. Derivation (pure functions — unit-test these)
Port `todayReason`, `autoTodayIds`, and `resolveToday` exactly.
- `todayReason(task)` → the single highest-precedence reason, or `null`:
  `Overdue` (remindAt in past) → `Due today` (remindAt within local-midnight bounds) →
  `Priority` (`priority === 1`). Completed tasks return `null`.
- `autoTodayIds(tasks)` → `Set<id>` of every task with a non-null reason. This seeds the plan.
- `resolveToday(data, todaySet)` → ordered rows `{ task, reason, subName, catName }`.
  Sort: incomplete-before-complete, then reason rank, then shortest estimate first. A pinned
  task with no signal gets the synthetic `Pinned` reason (rank 3).

### 2. State
- Membership is a `Set<taskId>`, initialized from `autoTodayIds(tasks)`.
- `toggleToday(id, force?)` adds/removes. Wire the sun toggle on **both** the Today rows and
  the existing dashboard task rows (the prototype adds an `onToggleToday`/`inToday` prop to
  `TaskRow` — mirror that on our task-row component).
- Re-seed when the underlying task set changes identity (new fetch / data swap).

### 3. Presentation — `<TodayPanel variant>` with `stacked | rail | banner`
Match the references precisely:
- **Header:** sun glyph + serif "Today" title + `.label` date, a `N to do · Hh Mm` summary,
  and a `done / total` count with a thin progress bar (work→accent gradient).
- **Row:** checkbox · title · **subgroup pill** (`● Reviews`, outlined, in the list color) ·
  status chip (text label, list color) · `.num` estimate · remove (×). Left edge = list color.
- **One color per row = the category color** (`--work` / `--personal`). Never color by status.
- **Completion:** let a just-checked row linger ~1s with a strike-through before it drops
  (prototype does this with a `linger` set + timeout).
- **Resizable** (stacked & rail): a drag handle below the list sets `maxHeight`, clamped
  120–760px, persisted to `localStorage['hup:todayHeight']`; double-click resets to 360.
  Banner has no resize. Skip resize on mobile (list flows full-height).
- **Empty state:** dashed card prompting "tap the ☀ on any task to plan your day."
- **`off`** renders nothing.

Place the setting where the density/layout options already live. `stacked` is the default.

## Non-negotiables
- Reuse existing primitives (`Check`, `IconBtn`, `catColor`, `fmtMin`, icons). Don't fork them.
- Match the type/token system exactly — `.label`, `.num`, radii, shadows, the two category
  colors. No new hues introduced by this feature.
- Tone stays quiet: no status-red alarm colors, no confetti, no gradients on chrome.
- Accessibility: sun toggle and remove need labels; resize handle is `role="separator"`
  `aria-orientation="horizontal"`; keyboard-resizable is a nice-to-have.

## Decisions for you (call them out in your PR)
- **Persistence of the plan.** The prototype keeps membership in memory, re-seeded each load.
  Decide whether manual pins should persist (per-user, per-day) server-side, and whether the
  plan should auto-clear/roll over at local midnight.
- **Rollover of overdue/pinned** across days.
- Whether `Due today` should key off `dueAt` as well as `remindAt` once real due dates exist.

## Out of scope
No schema migration is required for the core feature. Don't touch other screens beyond adding
the sun toggle to the shared task row.
