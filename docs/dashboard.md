# Dashboard

Quick reference for the screens chunk 6 shipped, the tab navigation,
and the dev-only sample-data utilities. The canonical product spec
lives in `ARCHITECTURE.md`; this doc is a developer pointer, not a
replacement.

## Screens

| Path          | Component                  | State        |
|---------------|----------------------------|--------------|
| `/`           | `src/screens/Dashboard.tsx`| Read-only — chunk 6 |
| `/routines`   | `src/screens/Routines.tsx` | Stub         |
| `/insights`   | `src/screens/Insights.tsx` | Stub         |
| `/settings`   | `src/screens/Settings.tsx` | Stub + Developer section (DEV only) |

All four sit behind `ProtectedLayout`, which wraps `<Protected>` +
`<AppShell>` with the `InstallHint` topBanner and `SyncIndicator` in
the header's right slot. Child routes render inside an `<Outlet />`
below the tab row, so we only mount the shell once.

## Tabs

URL-driven via `NavLink` (`src/components/Tabs.tsx`) — deliberately
not shadcn `<Tabs>`. Active state comes from `NavLink`'s render prop;
`aria-current="page"` is stamped automatically on the active link.

> TODO chunk 16: swap to a bottom-nav under 640px per ARCHITECTURE §13.
> Top tabs are used at every breakpoint in chunk 6.

## SyncIndicator

`src/components/SyncIndicator.tsx` reads `syncStore` and renders a
dot + label.

| State          | Dot color (token)        | Reachable in chunk 6 |
|----------------|--------------------------|----------------------|
| `synced`       | `--good` (green)         | yes                  |
| `syncing`      | `--warn` (amber)         | yes                  |
| `offline`      | `--offline` (gray)       | yes                  |
| `sync_issues`  | `--destructive` (red)    | **no — see caveat**  |

Clicking the indicator opens a popover with the last-sync timestamp
and a "Force resync" button. Force resync re-reads
`repo.categories.list()` / `subcategories.list()` / `tasks.list()` /
`routineItems.list()`; the repo's online-first read path refreshes
the Dexie cache and stamps `lastSyncAt`, which the Dashboard
subscribes to in order to reload its in-memory state.

**Caveat:** `sync_issues` is unreachable until chunk 15 wires the
outbox failed bucket. The UI renders the state so the dashboard is
ready when that lands, but no code path currently transitions into
it.

## Sample data (dev only)

`src/lib/sample-data.ts` exposes two functions, used by Settings →
Developer when `import.meta.env.DEV` is true.

### `loadSampleData(userId)`

Creates 3 subcategories per category (Work: Inbox / Projects / Admin;
Personal: Errands / Home / Health), 12 tasks distributed across them,
5 morning + 4 night routine items, and seeded routine logs for the
past 21 days at ~85% completion.

Generation is seeded with a fixed PRNG so reload-after-wipe produces
the same dataset; nice for visual iteration.

**Idempotency:** the first thing `loadSampleData` does is call
`repo.subcategories.list()` and filter by `!archivedAt`. If any live
subcategory exists for the current user, it bails with the toast
`Sample data already loaded — wipe first to reload.` rather than
duplicating.

### `wipeMyData(userId)`

Resets the user's data to a clean state suitable for reloading sample
data. Categories (`Work`, `Personal`) are never touched — they're
seeded by the signup trigger.

**Wipe scope:**

- `tasks` — hard deleted via `repo.tasks.delete()` (real delete).
- `subcategories` — archived via `repo.subcategories.archive()`. (See
  deviation note below.)
- `routine_items` — archived via `repo.routineItems.archive()`. (See
  deviation note.)
- `routine_logs` — left in place. They reference archived items and
  never surface in the UI.
- `push_subscriptions` — removed per endpoint via
  `repo.pushSubscriptions.removeByEndpoint()`.
- `settings` — reset to defaults via `repo.settings.update`:
  `aiApiKey: null`, `caldavAppleId: null`, `caldavCalendarUrl: null`,
  `caldavStatus: 'unconfigured'`, `lastDailyReset: null`.
  `timezone` is preserved (it was answered at signup; we don't want
  to resurface the prompt).

**Deviation flagged for review:** the chunk-06 prompt asked for hard
deletes on `subcategories`, `routine_items`, and `routine_logs`, but
the chunk-5 data layer only exposes `archive()` on those tables.
Adding hard-delete repo methods would touch the data layer, which the
chunk explicitly puts out of scope. We use `archive()` instead and
make the user-visible behavior equivalent — the Dashboard filters
`!archivedAt` subcategories, and the sample-data idempotency check
does too. Reloading after a wipe yields a clean dashboard.
