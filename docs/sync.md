# Sync notes

See `ARCHITECTURE.md` §4 (data model) and §6 (sync model) for the canonical
contract. This file is the engineering-side commentary on how chunk 5
implements it.

## Layers in play

```
React UI  ──▶  repo.ts  ──▶  Supabase (source of truth)
                  │  ┌──────────────────────┐
                  ├─▶│ Dexie cache          │
                  │  │  (dashboard-cache)   │
                  │  └──────────────────────┘
                  └─▶  outbox (Dexie table) ─── replayed later (chunk 15)
                                              ▲
realtime ── Postgres changes ─────────────────┘
```

- **Supabase** is the only source of truth. The browser cache is a derived
  view that may lag.
- **Dexie** (`src/db/dexie.ts`) holds per-device mirrors of every
  user-scoped table plus the outbox of queued mutations. Table names match
  Postgres (snake_case) so the outbox `table` field and realtime channel
  bindings line up across the layers.
- **Repo** (`src/db/repo.ts`) is the only thing UI calls. Every read/write
  routes through it; the UI never touches the Supabase client or Dexie
  directly.
- **Realtime** (`src/db/realtime.ts`) opens one channel per signed-in user
  with seven `postgres_changes` listeners (one per user-scoped table). The
  bridge component (`src/components/RealtimeBridge.tsx`) starts it on
  sign-in and stops it on sign-out.
- **Sync store** (`src/db/syncStore.ts`) is a tiny Zustand store holding
  `{ state, lastSyncAt }`. The repo, network watcher, and (later) the
  outbox replay all flip the state; the SyncBadge UI (later chunk) reads
  it.

## Read pattern

Every `repo.<entity>.list*()` function follows the same shape:

1. If `isOnline()` is false → skip Supabase entirely, return the cache
   snapshot, flip sync state to `offline`.
2. Otherwise, query Supabase.
3. On 4xx error → throw. RLS denials, schema errors, etc. should not be
   swallowed by a cache fallback — they indicate a bug, not a network
   problem.
4. On network failure or 5xx → return the cache snapshot, flip sync state
   to `offline`.
5. On success → mirror the result into the cache (clear-and-bulkPut for
   list queries, scoped to the query's filter; per-row upsert for `get`
   queries), then return the mapped result.

The mirror is scoped: `tasks.listBySubcategory(subId)` only refreshes
cached tasks with that `subcategoryId`, so it doesn't wipe out unrelated
cache rows. `tasks.listIncomplete()` deliberately uses a per-row upsert
(no clear), because the query result is a subset of the full table and
we don't want to delete cached completed rows.

## Write pattern

Each `repo.<entity>.create/update/delete()` runs:

1. If `isOnline()` is false → apply to cache, enqueue an outbox row, flip
   sync state to `offline`, return the optimistic value.
2. Otherwise, write to Supabase.
3. On 4xx error → throw. The UI is responsible for surfacing it (typically
   a Sonner toast); no cache change, no outbox entry.
4. On network failure or 5xx → take the offline path. The optimistic
   change persists; replay (chunk 15) will retry against Supabase.
5. On success → mirror the server's returned row back into the cache
   (overwrites the optimistic row in case Supabase stamped `updated_at`
   or filled defaults), flip sync state to `synced`, stamp `lastSyncAt`.

## What this chunk does NOT do

- **No outbox replay.** Writes accumulate in `db.outbox` while offline,
  but chunk 5 has no logic to drain them. Chunk 15 owns the replay engine
  (FIFO drain on app load / `window.online` / auth refresh, exponential
  backoff, failed-bucket surfacing in Settings → Sync issues).
- **No cross-device awareness of unsynced peers.** Device A holds queued
  mutations in its outbox; device B has no way to know they exist. Per
  ARCHITECTURE §6, this is intentional for v1 — devices only see each
  other's changes when both are online.
- **No UI.** The repo, realtime, network, and sync-store layers are
  consumed by chunks 6 through 11.

## Realtime constraints

- Realtime only flows while the WebSocket is connected. Offline windows
  are reconciled by the next read going through the repo's read pattern
  (Supabase first → cache mirror).
- Each Postgres change applies via the same mappers the repo uses, so
  cache rows from realtime are indistinguishable from cache rows from
  repo writes.
- `startRealtime(userId)` is idempotent — calling it twice with the same
  user is a no-op; with a different user it tears down the old channel
  first. `stopRealtime()` removes the channel cleanly.

## Detection: online vs offline

The repo treats a request as "offline" in three cases:

1. `navigator.onLine === false` at request time (skip Supabase entirely).
2. Supabase returns an error with `status === 0` or `status === undefined`
   (fetch failed before reaching the server).
3. Supabase returns a 5xx error (server reachable but failing; we route to
   the outbox so the user doesn't lose work).

`navigator.onLine` is famously unreliable — it can be `true` while the
device is on a captive portal, or `false` while still functional. The
fetch-level failure check catches the real-world failure modes that
`navigator.onLine` misses.

## The SW must be transparent for Supabase

Dexie is the **only** offline cache for Supabase data. The Workbox
runtime handler for `*.supabase.co/rest/v1/*` and `/graphql/v1/*` is
`NetworkOnly` (see `docs/pwa.md` + `vite.config.ts`) — it does not
cache responses and does not serve stale data when the network is
unreachable.

Why this matters: a NetworkFirst-style SW cache for Supabase will
serve a stale 200 GET response during reload-while-offline. The repo's
read path can't tell that response is stale, so its `online` arm runs
to completion: it clears the relevant Dexie rows and bulkPuts the
stale list. Any task written via the offline path (which lives only
in Dexie + the outbox until chunk 15's replay ships) gets evicted
from the cache mirror. The chunk-7 smoke run that surfaced this is
documented as Bug B in the PROGRESS.md Revisions log.

If a future change adds a runtime caching rule for Supabase, it must
not let the SW return a cached response during a network failure —
otherwise this bug returns.

## Dexie schema versioning

Current version is **1** (baseline). Future cache-shape changes follow
the standard Dexie pattern: bump `.version(N)` and add a `.upgrade()`
block in `src/db/dexie.ts`. Never reuse version 1 — older installs need
the upgrade path to migrate without losing data.
