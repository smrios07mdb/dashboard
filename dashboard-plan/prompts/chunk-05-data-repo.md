# Chunk 5 — Data repo (Supabase + Dexie cache)

**Goal:** Typed repo functions wrapping Supabase, with Dexie offline cache and realtime subscriptions.
**Dependencies:** Chunks 2, 3.
**Effort:** ~5h.

> Reference `ARCHITECTURE.md` §4 (Data model), §6 (Sync model). Match the data interfaces in `design/types.ts` if present.

## What to build

### Types

`src/db/types.ts` — TypeScript interfaces matching Supabase schema exactly:

```ts
export type Category = { id: string; userId: string; name: 'Work' | 'Personal' };
export type Subcategory = { id: string; userId: string; categoryId: string; name: string; sortOrder: number; archivedAt: string | null };
export type Task = { id: string; userId: string; subcategoryId: string; title: string; notes: string | null; estimateMinutes: number; dueAt: string | null; remindAt: string | null; notified: boolean; priority: number | null; completedAt: string | null; createdAt: string; updatedAt: string };
export type RoutineItem = { id: string; userId: string; routine: 'morning' | 'night'; label: string; sortOrder: number; archivedAt: string | null; createdAt: string };
export type RoutineLog = { id: string; userId: string; routineItemId: string; dateKey: string; completed: boolean };
export type Settings = { userId: string; aiApiKey: string | null; caldavAppleId: string | null; caldavCalendarUrl: string | null; caldavStatus: 'unconfigured' | 'ok' | 'auth_failed'; timezone: string; lastDailyReset: string | null };
export type PushSubscription = { id: string; userId: string; endpoint: string; p256dh: string; auth: string; createdAt: string };
export type OutboxRow = { id?: number; op: 'insert' | 'update' | 'delete'; table: string; payload: unknown; createdAt: string; attempts: number; lastError: string | null };
export type SyncState = 'synced' | 'syncing' | 'offline' | 'sync_issues';
```

Also `src/db/mappers.ts` — converters between Supabase snake_case rows and TS camelCase types.

### Dexie database

`src/db/dexie.ts`:
- Define a Dexie database `dashboard-cache` with tables for `categories`, `subcategories`, `tasks`, `routine_items`, `routine_logs`, `settings`, `push_subscriptions`, and `outbox`
- Index `subcategoryId` on tasks, `categoryId` on subcategories, `dateKey` on routine_logs, etc.

### Repo

`src/db/repo.ts` — one module exporting typed CRUD per entity:

```ts
export const repo = {
  categories: { list(): Promise<Category[]>, /* ... */ },
  subcategories: { list, listByCategory, create, update, archive, reorder, ... },
  tasks: { list, listBySubcategory, listIncomplete, create, update, delete, markComplete, ... },
  routineItems: { list, listByRoutine, create, update, archive, reorder, ... },
  routineLogs: { listByRange, toggle, ... },
  settings: { get, update, ... },
  pushSubscriptions: { listMine, add, removeByEndpoint },
};
```

**Read pattern (every function):**
```
1. Try Supabase query.
2. On success: update Dexie cache to match (insert/update/delete cached rows for this query).
3. On network failure: return Dexie cache.
4. Set sync state via syncStore.
```

**Write pattern (every function):**
```
Online:
  1. Write to Supabase.
  2. On success: mirror to Dexie cache, return result.
  3. On 4xx error: throw.
Offline (detected by failed fetch or navigator.onLine === false):
  1. Apply optimistically to Dexie cache.
  2. Enqueue in Dexie outbox with op/table/payload.
  3. Return the optimistic result.
  4. Set sync state to 'offline'.
```

**Note:** outbox **replay logic lives in chunk 15.** This chunk only **writes** to the outbox.

### Sync state store

`src/db/syncStore.ts` — Zustand store with `{ state: SyncState, lastSyncAt: string | null }` and setters. Read by the sync indicator UI in later chunks.

### Realtime

`src/db/realtime.ts`:
- `startRealtime(userId)` — subscribes to Postgres changes on each user-scoped table; on each event, apply the change to the Dexie cache via the mappers
- `stopRealtime()` — unsubscribes all channels
- Called from `App.tsx` on auth state change: start on sign-in, stop on sign-out

### Network status

`src/lib/network.ts`:
- Listens to `window.online` and `window.offline`
- Updates `syncStore.state` accordingly
- Exposes `isOnline()` helper

### Tests

`src/db/repo.test.ts`:
- Mock Supabase client (return canned responses, simulate offline via thrown error)
- Cover CRUD success path for at least 3 entities
- Cover offline fallback: read returns cache, write goes to outbox
- Cover mapper round-trips
- All tests must pass

### Docs

`docs/sync.md`:
- Explain the sync model from ARCHITECTURE.md §6 in prose
- Document that realtime only flows while connected
- Document that cross-device awareness of unsynced peers is NOT modeled in v1
- Note that outbox replay is built in chunk 15; writes accumulate but don't replay yet after this chunk

## Files to create

```
src/db/types.ts
src/db/mappers.ts
src/db/dexie.ts
src/db/repo.ts
src/db/syncStore.ts
src/db/realtime.ts
src/db/repo.test.ts
src/lib/network.ts
docs/sync.md
```

## Acceptance criteria

- All Vitest tests pass
- Manual smoke test: with DevTools online, write a row via repo → appears in Supabase → realtime echoes it back → Dexie cache contains it
- Manual smoke test: with DevTools offline, write a row via repo → Dexie cache contains it → Dexie outbox contains the queued mutation
- Sync state transitions visible via `syncStore.getState()` in console

## Do NOT

- Build any UI (chunk 6 starts that)
- Implement outbox replay (chunk 15)
- Add features beyond CRUD + cache + realtime

## How to test

1. `npm test` — all repo tests green
2. Open dev tools console, import the repo, write a category subrow, check Supabase dashboard
3. Set Network → Offline in DevTools, write again, inspect IndexedDB → see the outbox row
4. Set Network → back online, run `await repo.tasks.list()` again — confirms cache hydration from Supabase
