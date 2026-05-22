# Chunk 16 — Insights + export/import + a11y polish

**Goal:** Insights chart with completion data. Full data export/import. Accessibility pass. Ship-it polish.
**Dependencies:** Chunks 5, 6, 7, 8, 10.
**Effort:** ~4h.

> Reference `ARCHITECTURE.md` §12 (Insights rule). Use `design/Insights.tsx` and `design/Settings.tsx`.

## What to build

### Insights screen

`src/screens/Insights.tsx`:
- Filter bar at top: range buttons (7 / 30 / 90 days), category toggles (All / Work / Personal)
- Query: completed tasks where `completed_at` is within the selected range. Use `repo.tasks.listCompletedInRange(from, to)` (add to repo).
- **Stacked bar chart (recharts):** one bar per day, stacked by subcategory.
  - Y axis: completed estimated minutes
  - X axis: date (day labels)
  - Each subcategory gets a color derived from its category — Work uses green shades (`#3a5a40`, lighter variants); Personal uses warm neutral shades (`#a85a3c` lighter variants)
- **"Other" grouping rule** (per ARCHITECTURE §12):
  - Compute total minutes per subcategory over the filtered range
  - If more than 8 subcategories present, group all but the top 7 (by total minutes) into a single "Other" segment with a neutral gray
  - Tooltip on hover shows full breakdown including grouped items (so the user sees what's inside "Other")
- **Summary table below the chart:**
  - Columns: subcategory, total tasks completed, total minutes, % of total
  - Sorted descending by total minutes
  - Shows individual subcategories (not the "Other" grouping — the table is exhaustive)
- Loading skeleton while fetching
- Empty state: "No completed tasks in this range" + small illustration or icon

`src/lib/insights.ts`:
- `aggregateForChart(tasks, subcategories, categories): ChartData`
- `applyOtherGrouping(byDay, threshold = 8): { bars: ChartData, groupedNames: string[] }`
- `summaryTable(tasks, subcategories): Row[]`
- All pure, unit-tested in `src/lib/insights.test.ts`

### Export/import (Settings → Data)

In `src/screens/Settings.tsx`, fill out the Data section:

**Export:**
- "Export all data" button
- Pulls **from Supabase** (source of truth), not from Dexie
- Format:
  ```json
  {
    "version": 1,
    "exported_at": "<iso>",
    "user_id": "<uuid>",
    "categories": [...],
    "subcategories": [...],
    "tasks": [...],
    "routine_items": [...],
    "routine_logs": [...],
    "settings": { ...all fields, with caldav_app_password_encrypted REDACTED to null }
  }
  ```
- Triggers a JSON file download: `dashboard-export-YYYY-MM-DD.json`

**Import:**
- "Import data" file picker (accepts `.json`)
- After file selected, show a dialog:
  - Mode selector: **Replace all** or **Merge**
  - Schema preview (number of items per table)
  - If Replace: typed-confirmation input ("type REPLACE to confirm")
- **Replace mode:**
  - Bulk-delete all rows in user-scoped tables via repo (in dependency order: tasks → subcategories → categories; routine_logs → routine_items; push_subscriptions; settings reset to defaults)
  - Bulk-insert all rows from the import file
  - Reload Dexie cache from Supabase
- **Merge mode:**
  - Upsert by id (Supabase `upsert` with `onConflict: 'id'`)
  - Existing rows get overwritten; new rows get added
- Toast on completion with counts

**Wipe local cache:**
- "Wipe local cache" button
- Confirms with typed-confirmation
- Clears Dexie only (does not touch Supabase)
- After wipe: cache is rebuilt from Supabase on next read

### A11y pass

Sweep every screen for:
- **Keyboard reach:** every interactive element reachable via Tab; logical tab order
- **Focus ring:** 2px solid `--primary` (`#3a5a40`) outline with 2px offset, always visible (don't suppress `:focus-visible`)
- **ARIA:**
  - Icon-only buttons have `aria-label` (e.g., bell, trash, three-dot menu, drag handle)
  - Dialogs use shadcn's built-in focus trap; verify it works
  - Live regions for sync indicator changes (`aria-live="polite"`)
- **Contrast:** verify all text on `#faf8f3` background is ≥4.5:1 (charcoal is fine; muted grays need checking)
- **Hit targets:** confirm all interactive elements are ≥44pt on mobile (use Chrome DevTools device mode + element inspector)
- **Screen reader walkthrough:** use VoiceOver on Mac/iOS to navigate the app top to bottom; confirm content order is sensible and labels are clear
- **Reduced motion:** respect `@media (prefers-reduced-motion: reduce)` — disable transition animations

### Build / deploy polish

- Update `README.md` at the root of `dashboard` repo with: project description, link to ARCHITECTURE.md, install/dev/deploy instructions, link to `dashboard-caldav-proxy`
- Add a `version.json` written at build time with the git SHA and date; surface in Settings → About
- Confirm Lighthouse audit on production URL: Performance ≥80, Accessibility ≥95, Best Practices ≥95, PWA ≥90

## Files to create/modify

```
src/screens/Insights.tsx       (replaces stub)
src/lib/insights.ts            (new)
src/lib/insights.test.ts       (new)
src/screens/Settings.tsx       (modify — Data section fully implemented; About section)
src/lib/export.ts              (new — pulls from Supabase, builds JSON)
src/lib/import.ts              (new — Replace and Merge modes)
src/db/repo.ts                 (modify — listCompletedInRange, bulkDelete by user, bulkUpsert)
src/index.css                  (modify — focus ring polish, prefers-reduced-motion)
README.md                      (modify — full project README)
src/components/About.tsx       (new — version info)
vite.config.ts                 (modify — write version.json at build time)
```

## Acceptance criteria

- Insights chart renders with sample data; sums match what Supabase says (verify with a manual query)
- "Other" grouping kicks in correctly at 9+ subcategories; tooltip shows full breakdown
- 7/30/90 day filters and Work/Personal toggles update the chart correctly
- Export → wipe local cache → import (Replace mode) → all data restored exactly (except `caldav_app_password_encrypted`, which is null after import; user must reconnect)
- Merge mode upserts correctly (verify by editing a task, then importing the original export — it gets overwritten back)
- Keyboard-only walkthrough: can complete every primary action (create task, edit, complete, navigate, settings, AI triage, block time) without a mouse
- VoiceOver walkthrough: all interactive elements announced with meaningful labels
- Lighthouse: Accessibility ≥95
- `version.json` is served and visible in Settings → About

## Do NOT

- Refactor the data layer
- Add new features beyond Insights and Data tools
- Skip the a11y pass — this is the polish chunk

## How to test

1. Load sample data (DEV button) so 21 days of routine_logs + ~12 completed tasks exist
2. Open Insights → 7 days: see bars for the last 7 days, segmented by subcategory
3. Switch to 30, 90: ranges adjust
4. Toggle to Work only → only Work subcategory segments
5. Add 5 more subcategories via the dashboard to get 11 total → confirm "Other" segment appears with neutral color; hover tooltip shows full breakdown
6. Summary table totals match the chart
7. Settings → Data → Export → download `dashboard-export-YYYY-MM-DD.json`; open and inspect
8. Confirm `caldav_app_password_encrypted` is `null` in the export
9. Settings → Wipe local cache → confirm → Dexie is empty, app re-fetches from Supabase
10. Settings → Import → pick the export → Replace → type REPLACE → confirm → all data identical to before
11. Tab through the entire app — every action reachable
12. Open with VoiceOver on Mac — narrate the dashboard, settings, routines
13. Run Lighthouse on the deployed URL — scores hit thresholds

---

After this chunk: stop. Do a 7-day lived-use review on your three devices. Log friction in PROGRESS.md → Revisions. Each fix is its own mini-prompt and PR.
