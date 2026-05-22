# Chunk 7 — Task CRUD

**Goal:** Create, inline-edit, and delete tasks. Time totals update everywhere correctly.
**Dependencies:** Chunks 5, 6.
**Effort:** ~4h.

> Use `design/Dashboard.tsx` interactive states as the visual reference.

## What to build

### Create task

- "+ Add task" button at the bottom of each subcategory section (and as a primary action in subcategory drill-down — wired in chunk 9)
- Click opens an inline row with a title input and a minutes input (default 30)
- Enter or click "Add" → calls `repo.tasks.create({ subcategoryId, title, estimateMinutes })`
- On success: toast "Task added", focus moves to title for next task entry
- Empty title is rejected
- Escape cancels

### Inline edit title

- Click on a task title → it becomes an input prefilled with current value
- Enter or blur → calls `repo.tasks.update(id, { title })`
- Escape reverts and exits edit mode
- Empty value is rejected and reverts

### Inline edit minutes

- Click on the minutes pill → numeric input prefilled with current value
- Same Enter/blur/Escape behavior
- Validates: integer, ≥0, ≤24*60 (one day). Reject otherwise.
- Calls `repo.tasks.update(id, { estimateMinutes })`

### Complete task

- Checkbox to the left of each task row. Toggling sets/clears `completed_at` via `repo.tasks.update(id, { completedAt: now | null })`
- Completed tasks render with strikethrough title and faded styling
- By default, the dashboard shows incomplete tasks. Add a small "Show N completed" expander per subcategory.

### Delete task

- Trash icon on each task row → opens a shadcn `Dialog` "Delete this task? This cannot be undone." with Cancel / Delete buttons
- Confirm → `repo.tasks.delete(id)` → toast "Task deleted"
- After delete, re-render the subcategory (totals update)

### Totals

After every mutation, recompute and re-render:
- Subcategory totals (task count, sum of `estimateMinutes` of incomplete tasks)
- Category totals (sum across subcategories)
- Overall totals (header strip)

These are derived in the component from the data the repo returns; do not store them.

### Toast pattern

Use shadcn Toast for all confirmations. Success = neutral, error = destructive. Keep messages short.

## Files to create/modify

```
src/components/TaskRow.tsx          (new — title, minutes, checkbox, bell placeholder, menu placeholder, trash)
src/components/AddTaskInline.tsx    (new — the inline add affordance)
src/components/DeleteConfirm.tsx    (new — reusable confirm dialog)
src/screens/Dashboard.tsx           (modify — wire create/edit/delete)
src/db/repo.ts                      (modify if needed — add `markComplete` helper if not already there)
```

## Acceptance criteria

- Create, edit (title and minutes), complete/uncomplete, delete — all work
- Each mutation reflects immediately in totals across all levels
- Changes persist across reload
- Open the same account on a second device: changes appear within a few seconds (realtime)
- Delete confirm dialog appears every time; Cancel aborts; Delete proceeds
- DevTools offline → mutations still apply optimistically to UI; reload while still offline → changes are gone from UI (because they're only in Dexie + outbox, and the in-memory state was rebuilt from cache + outbox → confirm cache reflects them; the outbox replay isn't built yet but the cache mirror should hold)

## Do NOT

- Implement reminders / bell icon functionality (chunk 14 wires alerts, but Settings setup is in chunk 9 with the menu — for now bell is a static icon if `remindAt` is set, no interaction)
- Implement task move / three-dot menu (chunk 9)
- Touch subcategory CRUD (chunk 8)

## How to test

1. Add a task → appears, totals update
2. Edit title → persists
3. Edit minutes to 45 → subcategory total += 15 (if was 30 before)
4. Complete the task → moves to "Show N completed", incomplete total drops
5. Delete → confirm dialog → confirm → gone, totals update
6. Reload — every state persists
7. Open in a second browser/device → mutations appear within ~3s
8. Offline test: write while offline → see optimistic UI update → reload while still offline → cached state reflects the write
