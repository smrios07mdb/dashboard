# Chunk 10 — Routines tab

**Goal:** Morning + Night routines with editable lists, daily check-offs, streak counters, 14-day history.
**Dependencies:** Chunks 5, 6.
**Effort:** ~5h.

> Reference `ARCHITECTURE.md` §11 (streak rule). Use `design/Routines.tsx`.

## What to build

### Clock injection

`src/lib/clock.ts`:
- Exports `today(): string` returning `YYYY-MM-DD` in the user's timezone (from `settings.timezone`)
- Exports `startOfDayIso(dateKey: string): string` returning the ISO start of that day in the user's timezone
- In tests, the clock module is mocked via Vitest's module mocking
- Internally uses `date-fns-tz` (add to deps) for timezone handling

### Routines screen

`src/screens/Routines.tsx`:
- Two panels: Morning Routine, Night Routine
- Side-by-side ≥768px, stacked below
- Each panel:
  - Header: routine name, streak badge ("5 day streak" — text, no emoji), "Edit list" toggle
  - **Check-off mode** (default): list of today's `routine_items` (non-archived) as Checkbox + label; tapping toggles via `repo.routineLogs.toggle(routineItemId, today())`
  - **Edit mode** (when toggle is on): same list with drag handles, inline rename, X to remove, "+ Add item" at bottom
  - Below the list: **14-day dot grid** — 14 small circles, one per day going backward from today. Filled if all items existing at start-of-day were completed for that day; empty otherwise; faded if no items existed yet on that day.

### Streak calculation

`src/lib/streak.ts`:
- `calcStreak(routine: 'morning' | 'night', items: RoutineItem[], logs: RoutineLog[], today: string): number`
- Returns the consecutive-days count ending today (or yesterday if today not yet completed)
- **Items created today (`createdAt`'s date_key >= today) are not required for today's completion** (per ARCHITECTURE §11)
- Algorithm:
  1. Build `requiredItemsByDay`: for each date in the last 60 days going back from today, the set of `routine_items` where `createdAt < startOfDay(date)` and (`archivedAt is null` or `archivedAt > startOfDay(date)`)
  2. For each date, compute `completedItemsThatDay`: routine_logs with that date_key where the item is in `requiredItemsByDay`
  3. A day is "complete" if for every required item, a log exists with `completed = true`
  4. Streak: count back from today (or yesterday if today isn't complete) while days are complete; stop at first incomplete

### Tests

`src/lib/streak.test.ts` — required passing tests:
- 0-day streak (today not started, yesterday incomplete)
- 5-day streak (5 consecutive complete days ending yesterday, today not yet checked)
- 5-day streak including today (today fully complete)
- Broken streak (gap in the middle resets)
- Partial completion does not count (4 of 5 items checked = incomplete day)
- **Items created today don't block today's completion** (add item at 10am, leave it unchecked, other items checked → today still counts)
- Archived item: streak should not require it for days after archival

### Repo additions

If not present in chunk 5:
- `repo.routineItems.list()`, `listByRoutine(routine)`, `create({ routine, label })`, `update(id, patch)`, `archive(id)`, `reorder([{ id, sortOrder }])`
- `repo.routineLogs.listByRange(from, to)`, `toggle(routineItemId, dateKey)` — upserts on unique constraint

### Daily reset awareness

- The "today" used by the screen is derived from `clock.today()`, which uses `settings.timezone`
- No destructive daily reset is needed; today's logs simply don't exist until checked
- Optional: on first mount of the day, update `settings.last_daily_reset = today()` — useful for analytics later but not required for functionality

## Files to create/modify

```
src/screens/Routines.tsx           (replaces stub)
src/components/RoutinePanel.tsx     (new — one panel of the two)
src/components/RoutineDotGrid.tsx   (new — 14-day grid)
src/components/StreakBadge.tsx      (new)
src/lib/clock.ts                    (new)
src/lib/streak.ts                   (new)
src/lib/streak.test.ts              (new)
src/db/repo.ts                      (modify — routine_items and routine_logs repos)
```

## Acceptance criteria

- All Vitest streak tests pass
- Toggle a routine item: persists immediately, syncs to other devices
- Edit list mode: rename, delete, reorder, add — all work
- Streak displays correctly for sample data (use the Developer "Load sample data" pattern from chunk 6 with 21 days of logs)
- 14-day dot grid renders correctly
- New routine items created today don't break today's "complete" state

## Do NOT

- Touch tasks or subcategories
- Implement push notifications for routines (out of scope for v1)
- Implement Insights (chunk 16)

## How to test

1. Add 3 morning items: "Drink water", "Stretch", "Read"
2. Check all 3 → today's dot fills, streak shows "1 day streak"
3. Manipulate `clock.today()` in browser console (or wait until tomorrow) → check items again → streak = 2
4. Skip one item one day → streak resets
5. Add a new item mid-day → today's completion status unchanged (still all 3 prior items checked = still complete)
6. Switch to edit mode → reorder, rename, add, delete — all persist
7. Check streak against the sample data generator's 21-day history
