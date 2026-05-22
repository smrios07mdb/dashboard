# Chunk 6 — Dashboard read-only + dev sample data

**Goal:** Render the unified dashboard with real data from the repo. Add a dev-only "Load sample data" button.
**Dependencies:** Chunks 3, 4, 5.
**Effort:** ~3h.

> Use `design/Dashboard.tsx` as the visual reference. Use `design/Settings.tsx` for the Developer section. Reference `ARCHITECTURE.md` §13 (chevron affordance).

## What to build

### Dashboard screen

`src/screens/Dashboard.tsx`:
- Reads via `repo.categories.list()`, `repo.subcategories.list()`, `repo.tasks.list()` on mount
- Renders two columns: Work and Personal
- Each category header shows: name, total non-completed task count, total estimate minutes, chevron `›`
- Each subcategory section shows: name, task count, summed minutes, chevron `›`, expanded by default
- Each task row shows: title, minutes, bell icon (if `remindAt` set), three-dot menu (placeholder — full menu in chunk 9)
- Header strip at top shows: today's date, total tasks, total minutes, available-minutes input (numeric, bound to local Zustand UI state, default 30), "What's next?" button (disabled — chunk 11 enables)
- Top-right: sync indicator badge (color + label from `syncStore`) and `<AccountMenu />`
- Tabs at top (Dashboard / Routines / Insights / Settings) — Dashboard is the only filled one; others render stub screens with just a heading

### Stub screens

`src/screens/Routines.tsx`, `src/screens/Insights.tsx`, `src/screens/Settings.tsx` — each renders a heading and "Coming soon" text. Settings has the **Developer section** described below.

### Developer section (Settings)

In `src/screens/Settings.tsx`, render a section only when `import.meta.env.DEV`:
- Heading "Developer"
- "Load sample data" button. On click:
  - For each existing category (Work, Personal), create 3 subcategories via repo
  - Create 12 tasks distributed across them with varied `estimate_minutes` (15–90), some with `due_at`, two with `completed_at` in the last 2 days
  - Create 5 morning routine items, 4 night routine items
  - Create routine_logs for the past 21 days with realistic completion patterns (most days mostly complete, occasional skips)
  - Show toast on completion: "Sample data loaded (N tasks, M routine items)"
- "Wipe my data" button (DEV only): deletes all rows in user-scoped tables. Confirm dialog.

### Routing

Update `App.tsx` so the protected layout uses `<Tabs>` switching between Dashboard / Routines / Insights / Settings via path (`/`, `/routines`, `/insights`, `/settings`).

### Chevron pattern

Implement the chevron-as-primary-affordance per ARCHITECTURE §13:
- Visible `›` on every category and subcategory header
- Tap/click chevron OR double-click header → navigate (drill-down routes built in chunk 9; for now the chevron is wired to a no-op `onDrillDown` prop that's a TODO)
- Do NOT attach long-press handlers

### Sync indicator

`src/components/SyncIndicator.tsx`:
- Reads `syncStore`
- Renders a small colored dot + label: green (Synced), amber (Syncing), gray (Offline), red (Sync issues)
- Click expands a popover showing last sync time and a "Force resync" button (calls `repo.tasks.list()` etc.)

## Files to create/modify

```
src/screens/Dashboard.tsx        (new — replaces stub)
src/screens/Routines.tsx         (new — stub)
src/screens/Insights.tsx         (new — stub)
src/screens/Settings.tsx         (new — Developer section only)
src/components/SyncIndicator.tsx (new)
src/components/Tabs.tsx          (new — top nav)
src/lib/sample-data.ts           (new — sample data generator)
src/App.tsx                      (modify — add tab routing)
```

## Acceptance criteria

- Sign in → Dashboard shows Work and Personal columns
- After clicking "Load sample data" in DEV: dashboard shows 3 subcategories per category, 12 tasks
- Counts and totals are correct at every level (subcategory, category, overall)
- Sync indicator reflects state: green when online + cache fresh; gray when DevTools forced offline
- Switching tabs navigates correctly (other tabs show stubs)
- Chevrons visible on every category and subcategory header

## Do NOT

- Implement task creation, editing, or deletion (chunk 7)
- Implement subcategory CRUD (chunk 8)
- Implement drill-down routes (chunk 9)
- Wire up the "What's next?" button (chunk 11)
- Touch the data layer

## How to test

1. Sign in to a fresh account → see empty Work and Personal columns
2. Open Settings → Developer → click "Load sample data" → toast appears
3. Return to Dashboard → see populated columns
4. DevTools network → Offline → reload → still see data (from Dexie cache), sync indicator shows Offline
5. Verify chevrons visible on every header
