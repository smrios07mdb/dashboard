/*
 * Offline outbox replay engine (chunk 15 — ARCHITECTURE.md §6).
 *
 * Drains the Dexie outbox FIFO on reconnect: each queued mutation is re-issued
 * against Supabase, with exponential backoff on failure and a failed bucket
 * (`attempts >= MAX_ATTEMPTS`) surfaced as `sync_issues`. Chunk 5 is the
 * *writer* (repo.ts enqueues camelCase payloads); this is the *replayer*.
 *
 * Idempotency: `drainOutbox()` holds a single module-level in-flight promise so
 * the four triggers (load / window.online / auth-refresh / 60s safety net in
 * syncRunner.ts) can never apply the same row twice concurrently.
 */
import { isOnline } from '@/lib/network'
import { supabase } from '@/lib/supabase'

import { db } from './dexie'
import {
  pushSubscriptionFromRow,
  pushSubscriptionToRow,
  routineItemFromRow,
  routineItemToRow,
  routineLogFromRow,
  routineLogToRow,
  settingsFromRow,
  settingsToRow,
  subcategoryFromRow,
  subcategoryToRow,
  taskFromRow,
  taskToRow,
} from './mappers'
import { syncStore } from './syncStore'
import type { OutboxRow } from './types'

export type DrainResult = {
  /** Rows successfully applied + removed this drain. */
  processed: number
  /** Rows currently in the failed bucket (attempts >= MAX_ATTEMPTS). */
  failed: number
  /** Rows still in the outbox after this drain. */
  remaining: number
}

/** A row is moved to the failed bucket once it has failed this many times. */
export const MAX_ATTEMPTS = 5

// ---------- in-flight guard ----------

let inFlight: Promise<DrainResult> | null = null

/**
 * Drain the outbox. Concurrent calls share one in-flight promise — the entire
 * exactly-once correctness lever (resolution 4). Reset on settle.
 */
export function drainOutbox(): Promise<DrainResult> {
  if (inFlight) return inFlight
  inFlight = doDrain().finally(() => {
    inFlight = null
  })
  return inFlight
}

async function doDrain(): Promise<DrainResult> {
  // Offline guard FIRST: attempting Supabase calls while offline would fail
  // every row and burn `attempts`, eventually pushing rows into a false
  // failed bucket. So short-circuit before touching anything (resolution 6).
  if (!isOnline()) {
    syncStore.getState().setState('offline')
    return { processed: 0, failed: 0, remaining: await db.outbox.count() }
  }

  // FIFO by createdAt, with the auto-increment id as a deterministic tiebreak
  // for rows enqueued in the same millisecond (e.g. a bulkDelete loop).
  const rows = (await db.outbox.toArray()).sort(byCreatedAtThenId)

  if (rows.length === 0) return finalize(0)

  syncStore.getState().setState('syncing')

  const now = Date.now()
  let processed = 0
  for (const row of rows) {
    if (row.attempts >= MAX_ATTEMPTS) continue // failed bucket — skip
    if (inBackoff(row, now)) continue // still cooling down — try next drain
    try {
      await applyRow(row)
      await db.outbox.delete(row.id as number)
      processed++
    } catch (e) {
      await recordFailure(row, e)
    }
  }

  return finalize(processed)
}

function byCreatedAtThenId(a: OutboxRow, b: OutboxRow): number {
  if (a.createdAt < b.createdAt) return -1
  if (a.createdAt > b.createdAt) return 1
  return (a.id ?? 0) - (b.id ?? 0)
}

/** Backoff cap: 5 minutes (ARCH §6). */
const BACKOFF_CAP_S = 300

/** Next retry after `attempts` failures waits `min(2^attempts, 300)` seconds. */
function backoffMs(attempts: number): number {
  return Math.min(2 ** attempts, BACKOFF_CAP_S) * 1000
}

/**
 * True while a previously-failed row is still inside its backoff window.
 * Handles legacy rows where `lastAttemptAt` is null/undefined (never attempted).
 * Applies to 4xx and 5xx alike (resolution 6) — no hammering on permanent 4xx.
 */
function inBackoff(row: OutboxRow, now: number): boolean {
  if (!row.lastAttemptAt || row.attempts <= 0) return false
  const last = Date.parse(row.lastAttemptAt)
  if (Number.isNaN(last)) return false
  return last + backoffMs(row.attempts) > now
}

/** Record a failed replay: bump attempts, capture error + timestamp. */
async function recordFailure(row: OutboxRow, e: unknown): Promise<void> {
  await db.outbox.update(row.id as number, {
    attempts: row.attempts + 1,
    lastError: e instanceof Error ? e.message : String(e),
    lastAttemptAt: new Date().toISOString(),
  })
}

/** Read the post-drain outbox and set the end state per ARCH §6 / resolution 6. */
async function finalize(processed: number): Promise<DrainResult> {
  const { remaining, failed } = setStateFromOutbox(await db.outbox.toArray())
  return { processed, failed, remaining }
}

/**
 * Map the current outbox contents to a sync state (ARCH §6 table): `offline`
 * if no network; else `synced` (outbox empty) / `sync_issues` (any failed row)
 * / `syncing` (rows remain, possibly mid-backoff). Shared by the drain's
 * finalize step and the retry/discard helpers.
 */
function setStateFromOutbox(rows: OutboxRow[]): {
  remaining: number
  failed: number
} {
  const remaining = rows.length
  const failed = rows.filter((r) => r.attempts >= MAX_ATTEMPTS).length
  const s = syncStore.getState()
  if (!isOnline()) {
    s.setState('offline')
  } else if (remaining === 0) {
    s.setState('synced')
    s.setLastSyncAt(new Date().toISOString())
  } else if (failed > 0) {
    s.setState('sync_issues')
  } else {
    // Rows remain (some may merely be in backoff) — the 60s runner re-attempts.
    s.setState('syncing')
  }
  return { remaining, failed }
}

// ---------- per-table replay registry ----------
//
// The outbox stores camelCase payloads (chunk-5 `optimistic` objects), so each
// replay runs the payload back through the same `*ToRow` mapper the repo uses.
// Keys are irregular: settings → user_id, push delete → endpoint, routine_logs
// → server-side upsert. See chunk-5 contract notes.

type AnyRow = Record<string, unknown>

type TableSpec = {
  toRow: (payload: never) => AnyRow
  cachePut: (serverRow: never) => Promise<unknown>
  updateKeyColumn: string
  updateKeyValue: (payload: AnyRow) => unknown
  deleteKeyColumn: string
  deleteKeyValue: (payload: AnyRow) => unknown
  cacheDelete: (payload: AnyRow) => Promise<unknown>
  /** When set, insert/update replay via `.upsert(row, { onConflict })`. */
  upsertOnConflict?: string
}

const byId = (p: AnyRow) => p.id

const SPECS: Record<string, TableSpec> = {
  subcategories: {
    toRow: subcategoryToRow,
    cachePut: (r) => db.subcategories.put(subcategoryFromRow(r)),
    updateKeyColumn: 'id',
    updateKeyValue: byId,
    deleteKeyColumn: 'id',
    deleteKeyValue: byId,
    cacheDelete: (p) => db.subcategories.delete(p.id as string),
  },
  tasks: {
    toRow: taskToRow,
    cachePut: (r) => db.tasks.put(taskFromRow(r)),
    updateKeyColumn: 'id',
    updateKeyValue: byId,
    deleteKeyColumn: 'id',
    deleteKeyValue: byId,
    cacheDelete: (p) => db.tasks.delete(p.id as string),
  },
  routine_items: {
    toRow: routineItemToRow,
    cachePut: (r) => db.routine_items.put(routineItemFromRow(r)),
    updateKeyColumn: 'id',
    updateKeyValue: byId,
    deleteKeyColumn: 'id',
    deleteKeyValue: byId,
    cacheDelete: (p) => db.routine_items.delete(p.id as string),
  },
  routine_logs: {
    toRow: routineLogToRow,
    cachePut: (r) => db.routine_logs.put(routineLogFromRow(r)),
    updateKeyColumn: 'id',
    updateKeyValue: byId,
    deleteKeyColumn: 'id',
    deleteKeyValue: byId,
    cacheDelete: (p) => db.routine_logs.delete(p.id as string),
    upsertOnConflict: 'user_id,routine_item_id,date_key',
  },
  settings: {
    toRow: settingsToRow,
    cachePut: (r) => db.settings.put(settingsFromRow(r)),
    updateKeyColumn: 'user_id',
    updateKeyValue: (p) => p.userId,
    deleteKeyColumn: 'user_id',
    deleteKeyValue: (p) => p.userId,
    cacheDelete: (p) => db.settings.delete(p.userId as string),
  },
  push_subscriptions: {
    toRow: pushSubscriptionToRow,
    cachePut: (r) => db.push_subscriptions.put(pushSubscriptionFromRow(r)),
    updateKeyColumn: 'id',
    updateKeyValue: byId,
    deleteKeyColumn: 'endpoint',
    deleteKeyValue: (p) => p.endpoint,
    cacheDelete: (p) =>
      db.push_subscriptions
        .where('endpoint')
        .equals(p.endpoint as string)
        .delete(),
  },
}

/**
 * Re-issue one queued mutation against Supabase and reconcile the cache.
 * Throws (with `.status` when known) on any Supabase error — the drain loop
 * turns that into an attempts-increment + backoff.
 */
async function applyRow(row: OutboxRow): Promise<void> {
  const spec = SPECS[row.table]
  if (!spec) throw new Error(`No outbox replay spec for table "${row.table}"`)
  const payload = row.payload as AnyRow

  if (row.op === 'delete') {
    const { error } = await supabase
      .from(row.table)
      .delete()
      .eq(spec.deleteKeyColumn, spec.deleteKeyValue(payload))
    throwOnError(error)
    await spec.cacheDelete(payload)
    return
  }

  const rowData = spec.toRow(payload as never)
  let res: { data: unknown; error: unknown }
  if (spec.upsertOnConflict) {
    res = await supabase
      .from(row.table)
      .upsert(rowData, { onConflict: spec.upsertOnConflict })
      .select()
      .single()
  } else if (row.op === 'insert') {
    res = await supabase.from(row.table).insert(rowData).select().single()
  } else {
    res = await supabase
      .from(row.table)
      .update(rowData)
      .eq(spec.updateKeyColumn, spec.updateKeyValue(payload))
      .select()
      .single()
  }

  throwOnError(res.error)
  if (res.data) await spec.cachePut(res.data as never)
}

function throwOnError(error: unknown): void {
  if (!error) return
  const e = error as { message?: string; status?: number }
  const err = new Error(e.message || 'Sync replay failed') as Error & {
    status?: number
  }
  err.status = e.status
  throw err
}

// ---------- failed-bucket management (Settings → Sync issues) ----------

const RETRY_RESET = { attempts: 0, lastError: null, lastAttemptAt: null }

/** Rows in the failed bucket — surfaced in Settings → Sync issues. */
export async function getSyncIssues(): Promise<OutboxRow[]> {
  return db.outbox
    .where('attempts')
    .aboveOrEqual(MAX_ATTEMPTS)
    .toArray()
    .then((rows) => rows.sort(byCreatedAtThenId))
}

/** Drop a single queued mutation without applying it (user's decision). */
export async function discardOutboxRow(id: number): Promise<void> {
  await db.outbox.delete(id)
  await refreshSyncState()
}

/** Drop every failed-bucket row; healthy queued rows are left alone. */
export async function discardAllFailed(): Promise<void> {
  await db.outbox.where('attempts').aboveOrEqual(MAX_ATTEMPTS).delete()
  await refreshSyncState()
}

/** Reset one failed row's backoff/attempts and re-run the drain. */
export async function retryOutboxRow(id: number): Promise<DrainResult> {
  await db.outbox.update(id, RETRY_RESET)
  return drainOutbox()
}

/** Reset every failed row's backoff/attempts and re-run the drain. */
export async function retryAllFailed(): Promise<DrainResult> {
  await db.outbox
    .where('attempts')
    .aboveOrEqual(MAX_ATTEMPTS)
    .modify(RETRY_RESET)
  return drainOutbox()
}

/** Recompute the sync state from the current outbox (used after discards). */
async function refreshSyncState(): Promise<void> {
  setStateFromOutbox(await db.outbox.toArray())
}
