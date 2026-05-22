# Chunk 9 — Task reassignment + drill-down routing

**Goal:** Move tasks between subcategories. Drill into category and subcategory views. Bulk actions in subcategory view.
**Dependencies:** Chunks 6, 7, 8.
**Effort:** ~5h.

> Reference `ARCHITECTURE.md` §13 (drag and drill-down rules). Use `design/CategoryView.tsx` and `design/SubcategoryView.tsx`.

## What to build

### Routes

Add routes (router already exists from chunk 3):
- `/category/:categoryId` → `<CategoryView />`
- `/subcategory/:subcategoryId` → `<SubcategoryView />`
- Both protected and wrapped in the same Tabs/AccountMenu shell as Dashboard

### Drill-down navigation

- Click chevron `›` on category header → navigate to `/category/:categoryId`
- Double-click on category header (desktop only) → same
- Click chevron `›` on subcategory header → navigate to `/subcategory/:subcategoryId`
- Double-click on subcategory header (desktop only) → same
- Do NOT use long-press (conflicts with iOS Safari)
- Detect desktop via `matchMedia('(hover: hover)').matches`

### Breadcrumbs

`src/components/Breadcrumbs.tsx`:
- Renders above the main content
- Dashboard: no breadcrumbs
- `/category/:id`: "All › Work"
- `/subcategory/:id`: "All › Work › Project A"
- Each segment except the last is a link

### Category view

`src/screens/CategoryView.tsx`:
- Shows all non-archived subcategories of the category, all expanded
- Each subcategory uses the same `SubcategoryHeader` and task rows as the dashboard
- "Add subcategory" button at the bottom
- Cross-subcategory drag enabled (desktop) — drop a task onto another subcategory header within this view
- Mobile: three-dot menu on each task has "Move to..."

### Subcategory view

`src/screens/SubcategoryView.tsx`:
- Shows the full task list for one subcategory
- Each task row has a leading checkbox for **bulk select** (separate from the completion checkbox — visually distinct: maybe a square selector vs a circle)
- When ≥1 task selected, a toolbar appears at the top with: "Move to..." (cascading picker), "Delete N tasks" (confirm), "Clear selection"
- "Add task" button at the top
- No cross-view drag in this screen — bulk-select + Move-to is the pattern

### Move to picker

`src/components/MoveToPicker.tsx`:
- Cascading menu: Categories at the top level → Subcategories beneath
- Excludes the current subcategory (no-op)
- Excludes archived
- On select: `repo.tasks.bulkUpdate([...selectedIds].map(id => ({ id, patch: { subcategoryId: targetId } })))`
- Used by:
  - Three-dot menu on individual task rows
  - Bulk action toolbar in subcategory view

### Drag (desktop, dashboard + category view)

- Use `@dnd-kit/core`
- Each task is draggable; each subcategory header is a drop target
- Conditional: only attach drag handlers when `matchMedia('(hover: hover) and (pointer: fine)').matches`
- On drop: `repo.tasks.update(id, { subcategoryId: targetId })`
- Visual: dragged task lifts; valid drop targets highlight

### Three-dot menu on tasks

Build out the previously-stubbed three-dot menu:
- "Move to..." → opens MoveToPicker (cascading)
- "Set reminder..." → opens time picker (writes `remindAt`; client-side notification logic is chunk 14, but the data is set here)
- "Edit notes" → opens a Dialog with a textarea bound to `task.notes`
- "Delete" → opens DeleteConfirm

### Repo

If not present, add `repo.tasks.listBySubcategory(subcategoryId)`.

## Files to create/modify

```
src/screens/CategoryView.tsx        (new)
src/screens/SubcategoryView.tsx     (new)
src/components/Breadcrumbs.tsx      (new)
src/components/MoveToPicker.tsx     (new)
src/components/TaskMenu.tsx         (new — three-dot menu)
src/components/SetReminderPopover.tsx (new — date+time picker)
src/components/EditNotesDialog.tsx  (new)
src/components/TaskRow.tsx          (modify — wire menu and selection)
src/screens/Dashboard.tsx           (modify — wire chevron navigation, drag, menu)
src/App.tsx                         (modify — add routes)
src/db/repo.ts                      (modify if needed)
```

## Acceptance criteria

- Chevron on category header → `/category/:id` renders correctly
- Chevron on subcategory header → `/subcategory/:id` renders correctly
- Browser back/forward work
- Deep-linking to `/subcategory/:id` on cold load renders correctly after auth
- Desktop drag works on Dashboard and Category view; not on Subcategory view; not on touch
- Three-dot Move-to works everywhere on every device
- Bulk-select in Subcategory view: select 3 tasks, move them, delete them — both work
- Setting a reminder persists `remindAt` (no notification yet — chunk 14)
- Editing notes persists

## Do NOT

- Implement the actual reminder firing logic (chunk 14)
- Build the Routines tab (chunk 10)
- Implement AI triage (chunk 11)

## How to test

1. Navigate dashboard → click subcategory chevron → see subcategory view with full task list
2. Bulk select 3 tasks → "Move to" Personal > Errands → confirm move
3. Bulk select 2 tasks → Delete → confirm → gone
4. Back to dashboard → drag a task between Work columns → confirm move (desktop)
5. On iPhone PWA: use three-dot menu Move-to → confirm
6. Set a reminder for tomorrow 9am → check Supabase, `remindAt` populated
7. Reload at `/subcategory/:id` cold → renders correctly after login
