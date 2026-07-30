# Claude Code Prompt — Chunk 33: Priority system (chips, picker, sort)

## Shared Foundation

You are building **Hupomnemata**, a calm, dignified personal task manager — React + TypeScript + Tailwind + shadcn/ui, Supabase, Dexie cache, PWA. The Daylight design system is live (redesign chunks 21–29). Design references for this feature series live in `hupomnemata_handoff/planner/`.

**This chunk adds a small feature onto shipped UI.** The data layer, repo pattern, Supabase realtime, Dexie mirror/outbox, TaskRow/TaskMenu, and drill-down routing are all shipped. Do not rebuild them; extend them.

**Token source of truth:** `src/index.css`. Use existing CSS variables; never hardcode hexes.

**⚠ Token trap — read this.** `--destructive` in this codebase is a **space-separated HSL triplet** (shadcn convention), not a hex. Consume it as `hsl(var(--destructive))` or `hsl(var(--destructive) / 0.13)`. The raw soft wash `--destructive-soft` is available as a plain rgba value. The design prototype uses `--destructive` as hex — do not copy that usage verbatim. (`--warn`, `--bg-alt`, `--ink-3` are raw values and can be used bare.)

**Tone:** Quiet, unhurried. No exclamation marks, no confetti, no gradients on UI chrome.

**Reading order:** `hupomnemata_handoff/planner/DESIGN_NOTES.md` (§ Priority system) → `hupomnemata_handoff/planner/prototype/planner/PriorityRows.jsx` (visual reference) → `src/components/TaskRow.tsx` + `src/components/TaskMenu.tsx` (integration points).

**Guardrail:** Recreate only what's in the handoff. Ask before adding anything that isn't there.

---

## Chunk 33 — Priority: constraint, chips, picker, sort

**Branch:** continue on `redesign`. Do not branch.

**Goal:** every task can be assigned P1/P2/P3 from the row; lists can sort by Priority / Due date / Estimate.

**Depends on:** shipped chunks through 29. `tasks.priority int` already exists in the schema (nullable, unconstrained) and TaskRow already renders the P1 destructive left edge — do not re-add either.

**Effort:** ~3h.

---

## What to build

### 1. Migration — `supabase/migrations/08_priority_check.sql`

```sql
alter table public.tasks
  add constraint tasks_priority_check
  check (priority is null or priority in (1, 2, 3));
```

- Follow the header-comment style of the existing migrations.
- No backfill: existing rows are `null` or already `1` from earlier manual use; both pass.
- **Semantics (canonical for the whole planner series):** `null` = no priority set. Renders no chip. Sorts after P3 in priority sort. Never coerce null to 3.

### 2. `PriorityChip` component — `src/components/PriorityChip.tsx`

Per DESIGN_NOTES.md exactly:
- IBM Plex Mono, 9.5px, `.1em` tracking, `--radius-sm` (4px), padding 2px 6px
- **P1**: `hsl(var(--destructive) / 0.13)` background (or `var(--destructive-soft)`), `hsl(var(--destructive))` text
- **P2**: `color-mix(in srgb, var(--warn) 16%, transparent)` background, `color-mix(in srgb, var(--warn) 62%, var(--ink))` text
- **P3**: `var(--bg-alt)` background, `var(--ink-3)` text
- Text: `P1` / `P2` / `P3`
- Props: `priority: 1 | 2 | 3`, optional `onClick`, `className`. When `onClick` is provided render as a `<button>` with a visible focus ring (`focus-visible:ring-2 focus-visible:ring-ring`) and an `aria-label` like "Priority 1 — change priority"; otherwise a `<span>`.

### 3. Priority picker

- New `PriorityPicker` (popover or the existing Menu primitive pattern — match `SetReminderPopover`'s architecture: open state owned by TaskRow, two entry points).
- Options: `P1 — Urgent`, `P2 — Soon`, `P3 — Whenever`, plus `Clear priority` (→ null) shown only when a priority is set.
- Entry points: (a) tapping the chip on the row, (b) `TaskMenu` → new "Set priority…" item, placed adjacent to "Set reminder…". When no priority is set, the chip is absent, so the menu is the only entry point — that's fine.
- Selecting an option calls a new `onSetPriority(id, priority | null)` row prop, threaded exactly like `onSetReminder` through every TaskRow consumer (Dashboard, CategoryView, SubcategoryView, and the Today list if present on this branch).

### 4. TaskRow integration

- Render the chip in the row grid between title and minutes (`auto` column). Reserve nothing when absent — unlike the left edge, chip presence may shift layout; that matches the prototype.
- Chips hide on completed rows (DESIGN_NOTES.md).
- The existing P1 left-edge logic stays untouched.

### 5. Repo + types

- `src/db/types.ts` `Task.priority`: type as `1 | 2 | 3 | null` if currently `number | null` — tighten, don't widen.
- Repo task-update path: confirm it passes `priority` through (it's generic column update in the existing pattern; add explicitly only if the update payload is whitelisted).
- Outbox/Dexie: no schema change needed (cache mirrors columns as-is) — verify, don't assume.

### 6. Sort control + comparator

- `src/lib/taskSort.ts` (new):
  - `type TaskSortKey = 'priority' | 'due' | 'estimate'`
  - `compareTasks(key)(a, b)`:
    - `priority`: 1 → 2 → 3 → null; ties broken by `due_at` asc (nulls last), then `created_at` asc
    - `due`: `due_at` asc, nulls last; ties by priority then `created_at`
    - `estimate`: `estimate_minutes` asc; ties by priority then `created_at`
  - Completed tasks keep their existing placement behavior (whatever the current lists do with completed rows — sort applies within the open set only; do not change completed-row handling).
- `src/lib/taskSort.test.ts`: cover each key, null handling, and tie-breaks.
- **Sort UI:** a compact control on the Dashboard column headers (one control per category column, next to the existing header actions) and on the Category/Subcategory drill-down list headers. Visual: a small `.label`-style trigger showing the active key (e.g. `SORT · PRIORITY`) opening a 3-option menu — match the tray sort control in `PriorityRows.jsx` / `planner-primitives.jsx`.
- **Persistence:** localStorage key `hupo.taskSort` (single global preference, applies to all lists). Default `'priority'`.

### 7. Docs

- Append the priority semantics (values, null meaning, sort tie-breaks) to `ARCHITECTURE.md` §4 notes or a short §14 if that's cleaner. Keep it to ~6 lines.

## Files to create/modify

```
supabase/migrations/08_priority_check.sql   (new)
src/components/PriorityChip.tsx             (new)
src/components/PriorityPicker.tsx           (new)
src/lib/taskSort.ts                         (new)
src/lib/taskSort.test.ts                    (new)
src/components/TaskRow.tsx                  (modify — chip, picker wiring, onSetPriority prop)
src/components/TaskMenu.tsx                 (modify — "Set priority…" item)
src/db/types.ts                             (modify — tighten priority type)
src/screens/Dashboard.tsx                   (modify — sort control + apply comparator + thread prop)
src/screens/CategoryView.tsx                (modify — same)
src/screens/SubcategoryView.tsx             (modify — same)
ARCHITECTURE.md                             (modify — priority semantics)
```

(If actual filenames differ, follow the codebase — read before writing.)

## Acceptance criteria

- ☐ Migration applies clean on a fresh DB and on the existing DB.
- ☐ TaskMenu → "Set priority…" → pick P2 → chip appears with warm tint; realtime mirrors it to a second tab.
- ☐ Tap chip → picker opens → "Clear priority" → chip gone, DB `priority = null`.
- ☐ P1 task shows both the chip and the existing destructive left edge; completing it hides the chip and the edge (existing behavior).
- ☐ Sort control on Dashboard flips between Priority/Due/Estimate; order matches the comparator; choice survives reload (localStorage).
- ☐ `taskSort.test.ts` passes; `npm test` clean; `npm run build` clean.
- ☐ No hardcoded hexes; `--destructive` consumed only via `hsl()`.
- ☐ Chip renders correctly on touch: tap target ≥ 44pt via the existing `before:` hit-area pattern or wrapper sizing.

## Do NOT

- Build any part of the week planner grid, tray, or scheduling (chunks 35–36).
- Touch the CalDAV proxy, ICS anything (chunk 34).
- Touch `lib/insights.ts`, `lib/streak.ts`, or their tests.
- Add an Eisenhower/urgency second dimension.
- Reorder or restyle existing row columns beyond inserting the chip.
- Modify completed-row sorting/placement behavior.

## How to test

1. `npx supabase db reset` locally (or apply migration 08 to the dev project) → confirm constraint exists.
2. `npm run dev` → sign in on the local auth-gated server.
3. Set priorities on 5 tasks across both categories (mix of P1/P2/P3/none).
4. Flip sort to each key; verify order incl. null-last and tie-breaks.
5. Second browser tab: change a priority in tab A, watch tab B update via realtime.
6. Toggle a P1 task complete/incomplete; verify chip + edge behavior.
7. Mobile viewport (≤640px): chip tap opens picker; targets comfortable.
8. `npm test` && `npm run build`.
