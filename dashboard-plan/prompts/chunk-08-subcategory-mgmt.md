# Chunk 8 — Subcategory management

**Goal:** Full CRUD for subcategories: add, rename, delete with task migration, merge, reorder.
**Dependencies:** Chunks 5, 6, 7.
**Effort:** ~4h.

## What to build

### Add subcategory

- "+ Add subcategory" button at the bottom of each category column
- Click opens inline input → Enter creates via `repo.subcategories.create({ categoryId, name })`
- New subcategory appears at the bottom (highest `sort_order` + 1)
- Toast confirmation

### Rename subcategory

- Click on subcategory name → inline input (same UX as task title edit)
- Enter or blur → `repo.subcategories.update(id, { name })`
- Empty name rejected

### Delete subcategory

- Three-dot menu on subcategory header → "Delete subcategory"
- Behavior depends on whether subcategory has tasks:
  - **No tasks:** Confirm dialog "Delete this subcategory?" → confirm → `repo.subcategories.archive(id)` (sets `archived_at`, does not hard delete)
  - **Has tasks:** Dialog asks "What should happen to the N tasks?" with two options:
    1. "Move them to..." → dropdown of other non-archived subcategories in the **same category** → on confirm, bulk-update those tasks' `subcategoryId`, then archive the source
    2. "Delete the tasks too" (destructive) → bulk-delete the tasks, then archive the source
- After delete, the subcategory no longer appears in the dashboard or in any move-to dropdown

### Merge subcategory

- Three-dot menu → "Merge into..."
- Dropdown of other non-archived subcategories in the same category
- Confirm dialog: "Move N tasks from 'A' to 'B' and archive 'A'?"
- On confirm: bulk-update task `subcategoryId`s, then archive the source
- Toast: "Merged into B"

### Reorder

- Drag handle visible on the left of each subcategory header (desktop only — detect via `matchMedia('(hover: none)')`)
- Use `@dnd-kit/core` with a vertical list per category
- On drop, recompute `sort_order` for all subcategories in that category and batch-update via the repo
- Mobile: omit drag; provide "Move up / Move down" items in the three-dot menu instead

### Filter rules

- All queries and selectors must exclude `archived_at != null` subcategories
- Dropdowns (move-to, merge-into) exclude archived
- Tasks belonging to an archived subcategory shouldn't appear; ensure cascade is correct (since we archive instead of delete, tasks stay attached — if a subcategory is archived, also hide its tasks; do this via filter, not delete)

### Repo additions

`repo.subcategories.archive(id)`, `repo.subcategories.reorder([{ id, sortOrder }])`, `repo.tasks.bulkUpdate([{ id, patch }])`, `repo.tasks.bulkDelete([id, ...])` — add to repo if not present.

## Files to create/modify

```
src/components/SubcategoryHeader.tsx (new — name, count, minutes, chevron, drag handle, three-dot menu)
src/components/AddSubcategoryInline.tsx (new)
src/components/DeleteSubcategoryDialog.tsx (new — handles both "no tasks" and "has tasks" cases)
src/components/MergeSubcategoryDialog.tsx (new)
src/screens/Dashboard.tsx           (modify — wire all of the above)
src/db/repo.ts                      (modify — add archive, reorder, bulkUpdate, bulkDelete)
```

## Acceptance criteria

- Add, rename, archive (empty), archive-with-migration, archive-with-cascade-delete, merge — all work
- Archived subcategories never appear in UI
- Reorder works on desktop (drag) and mobile (menu items)
- All operations enforce: no orphaned tasks (tasks always belong to a non-archived subcategory after any operation)
- Realtime sync: rename on device A appears on device B within seconds
- Totals at category and overall level update correctly after every operation

## Do NOT

- Touch routines, drill-down routing, AI, calendar, notifications
- Implement task reassignment via drag (chunk 9 — between subcategories)

## How to test

1. Add three subcategories under Work
2. Create 2 tasks under each
3. Rename one
4. Delete an empty subcategory → archived
5. Delete a subcategory with 2 tasks → choose "Move to" → confirm tasks moved
6. Delete another → choose "Delete tasks too" → confirm tasks gone
7. Merge two subcategories → tasks coalesce, source archived
8. Desktop: drag to reorder → persists. Mobile: use Move up/down → persists.
9. On a second device: every change appears within seconds
