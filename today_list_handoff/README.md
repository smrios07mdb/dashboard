# Today List — Engineering Handoff

Everything you need to build the **Today list** feature into the existing Hupomnemata
dashboard. The rest of the app is already shipped — this is an additive feature. Nothing
here changes the data schema or existing screens.

```
today_list_handoff/
├─ PROMPT.md              ← paste into Claude Code (or read top-to-bottom yourself)
├─ README.md             ← this file
├─ prototype/today.jsx    ← the working prototype component (React-via-Babel; port it)
└─ reference/            ← rendered screenshots of each layout
   ├─ today-stacked.png   (default)
   ├─ today-rail.png
   └─ today-banner.png
```

## What "Today" is

A single, always-visible plan of **what actually needs doing today**, rendered on the
dashboard alongside — not hidden away from — the Work / Personal lists. It is part
**automatic** (the app pre-fills it from task signals) and part **manual** (the user pins /
unpins any task with a ☀ sun toggle).

## The one-minute summary

- **Auto-inclusion rule** (highest-precedence reason wins per task):
  1. `Overdue` — has a `remindAt` in the past
  2. `Due today` — `remindAt` falls within today's local-midnight bounds
  3. `Priority` — `priority === 1`
  A user-pinned task with no signal shows the reason `Pinned`.
- **Manual override:** every task row (in Today *and* in the main lists) has a sun toggle.
  Toggling adds/removes it from the plan for the session.
- **One color per row:** each row is keyed to the color of the **list it belongs to**
  (`--work` emerald / `--personal` coral) — on the left edge *and* the status chip. We
  deliberately do **not** color by status; that produced a clashing rainbow. Status is
  conveyed by the chip's *text* (`OVERDUE` / `PRIORITY` / `DUE TODAY` / `PINNED`).
- **Subgroup tag:** each row shows its subcategory as an outlined pill (`● Reviews`) so you
  can see which project a task stems from at a glance.
- **Resizable:** the stacked/rail list has a drag handle at the bottom; height persists to
  `localStorage['hup:todayHeight']`. Double-click the handle resets to default (360px).
- **Three layouts** behind one setting (`todayList`): `stacked` (default), `rail`, `banner`,
  plus `off`. See reference screenshots.

## Data — no schema change

Everything derives from fields the `task` model already has: `remindAt`, `priority`,
`completedAt`, `estimateMinutes`, `subcategoryId`. See `prototype/today.jsx` top block for
the exact derivation (`todayReason`, `autoTodayIds`, `resolveToday`). The membership set is
UI state (a `Set<taskId>`), seeded from `autoTodayIds(tasks)` — **not** a persisted DB field
in the prototype. Decide during build whether the plan should persist server-side (see
PROMPT.md "Decisions for you").

Read **`PROMPT.md`** next.
