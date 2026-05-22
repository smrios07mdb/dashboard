# Chunk 15 — Offline outbox replay

**Goal:** Drain the Dexie outbox in order on reconnect. Exponential backoff on transient errors. Surface persistent failures.
**Dependencies:** Chunk 5.
**Effort:** ~3h.

> Reference `ARCHITECTURE.md` §6 (sync model). Chunk 5 already writes to the outbox; this chunk replays it.

## What to build

### Replay engine

`src/db/outbox.ts`:
- `drainOutbox(): Promise<DrainResult>` where `DrainResult = { processed: number, failed: number, remaining: number }`
- Algorithm:
  1. Set `syncStore.state = 'syncing'`
  2. Read all outbox rows from Dexie ordered by `createdAt` ascending
  3. For each row in order:
     a. If `attempts >= 5`: skip (it's in the failed bucket; visible in UI)
     b. If `lastError` indicates a transient error and `lastAttemptAt + backoff > now`: skip until backoff elapses
     c. Apply the mutation against Supabase (insert/update/delete on the target table with the payload)
     d. On success: delete the outbox row; refetch the affected row from Supabase and write it to the Dexie cache (server is source of truth)
     e. On 4xx (non-network, non-5xx): increment `attempts`, set `lastError` to the message, set `lastAttemptAt = now`. If `attempts >= 5`: leave in outbox, status will show as failed in UI
     f. On 5xx / network failure: increment `attempts`, set `lastError`, set `lastAttemptAt`. Exponential backoff: next retry waits `min(2^attempts seconds, 300 seconds)` (capped at 5min)
  4. After the loop:
     - If any rows have `attempts >= 5`: set `syncStore.state = 'sync_issues'`
     - Else if any rows remain (e.g., still in backoff): keep `syncing` or transition to `synced` if all settled
     - Else: `synced`, update `lastSyncAt`

### Triggers

`src/lib/syncRunner.ts`:
- `startSyncRunner()`:
  - Calls `drainOutbox()` on app load (after auth ready)
  - Subscribes to `window.online` event → call `drainOutbox()`
  - Subscribes to Supabase `auth.onAuthStateChange` → on successful refresh, call `drainOutbox()`
  - Also runs `drainOutbox()` every 60 seconds if outbox is non-empty (cheap safety net)
- Idempotent — concurrent calls share an in-flight promise

### Schema migration in Dexie

Update Dexie outbox table schema if needed:
- Add `lastAttemptAt: string | null` if not present
- Add a Dexie version bump and migration

### UI surface for failures

`src/screens/Settings.tsx` — add a section "Sync issues" rendered only when `syncStore.state === 'sync_issues'`:
- Lists each failed outbox row with: table, op, last error message, attempts count, age
- "Retry now" button per row → resets `attempts = 0`, `lastError = null`, calls `drainOutbox()`
- "Discard" button per row → deletes the outbox row without applying (user decision)
- "Retry all" / "Discard all" at the bottom

### Sync indicator updates

`src/components/SyncIndicator.tsx` already exists from chunk 6. Update it to:
- 'syncing' state shows a small spinner
- 'sync_issues' state shows red dot, clicking opens Settings → Sync issues

### Tests

`src/db/outbox.test.ts` (mock Supabase client, mock time):
- 3 mutations replay in order on `drainOutbox()` after reconnect
- A failing 5xx mutation increments attempts and stays in outbox; subsequent mutations still process
- Exponential backoff respected (mock `Date.now`)
- `attempts >= 5` moves a row to the failed bucket; `sync_issues` state set
- Discarding a row removes it; doesn't affect Supabase
- Manual retry resets attempts and re-runs

## Files to create/modify

```
src/db/outbox.ts              (new — replay engine)
src/db/outbox.test.ts         (new — tests)
src/lib/syncRunner.ts         (new — orchestration)
src/db/dexie.ts               (modify — schema bump if needed)
src/components/SyncIndicator.tsx (modify — syncing + sync_issues states)
src/screens/Settings.tsx      (modify — Sync issues section)
src/App.tsx                   (modify — call startSyncRunner after auth)
```

## Acceptance criteria

- All Vitest outbox tests pass
- Airplane mode test:
  1. Online → DevTools Network → Offline (simulates airplane mode)
  2. Create a task, edit a task, delete a subcategory (with task migration)
  3. Verify outbox has the 3 rows; UI shows optimistic state
  4. DevTools Network → Online
  5. Within a few seconds: outbox is empty; sync indicator goes to 'synced'; Supabase reflects all 3 changes
- Persistent failure test: induce a 4xx (e.g., update a deleted row), confirm row hits `attempts = 5` and surfaces in Settings → Sync issues
- Retry/Discard UI works
- No data corruption: refresh after replay shows the same state as Supabase

## Do NOT

- Build Insights, export/import, or polish (chunk 16)
- Optimize replay performance for thousands of rows (single user)
- Touch the calendar or AI code

## How to test

1. `npm test` — outbox tests green
2. Open the app, sign in, ensure online state shows 'synced'
3. DevTools → Network → Offline
4. Add a task, edit another, delete a subcategory with migration
5. Inspect Dexie outbox in DevTools → 3+ rows
6. Network → Online
7. Watch sync indicator: syncing → synced
8. Refresh page — state matches what was made offline; Supabase rows match
9. Force a failure: in DevTools console, run `await repo.tasks.update('nonexistent-id', { title: 'x' })` while online → confirm it ends up in Sync issues
10. Retry button works; Discard button works
