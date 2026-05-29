/*
 * Dexie database: `dashboard-cache`.
 *
 * Stores per-device mirrors of the user-scoped Postgres tables (see
 * ARCHITECTURE.md §6 — source of truth is Supabase, this is a cache)
 * plus the outbox of mutations queued during offline windows.
 *
 * Records are stored in camelCase TS shape (see ./types.ts). Snake_case
 * conversion happens at the Supabase boundary via ./mappers.ts.
 *
 * Schema versioning: future chunks that change the cache shape bump the
 * `.version(N)` and add a `.upgrade()` block. Don't reuse version 1 — new
 * fields → new version + upgrade migration.
 */
import Dexie, { type EntityTable, type Transaction } from 'dexie'

import type {
  BusyCacheEntry,
  Category,
  OutboxRow,
  PushSubscription,
  RoutineItem,
  RoutineLog,
  Settings,
  Subcategory,
  Task,
} from './types'

export class DashboardCacheDB extends Dexie {
  // Snake_case table names mirror Postgres so the outbox `table` field and
  // realtime channel names line up across the layers.
  categories!: EntityTable<Category, 'id'>
  subcategories!: EntityTable<Subcategory, 'id'>
  tasks!: EntityTable<Task, 'id'>
  routine_items!: EntityTable<RoutineItem, 'id'>
  routine_logs!: EntityTable<RoutineLog, 'id'>
  settings!: EntityTable<Settings, 'userId'>
  push_subscriptions!: EntityTable<PushSubscription, 'id'>
  outbox!: EntityTable<OutboxRow, 'id'>
  // Cache-only (not a Postgres mirror): one local day's busy ranges keyed by
  // dateKey, with a short TTL applied in lib/busyCache. camelCase name since
  // it's never referenced by the outbox `table` field or a realtime channel.
  busyCache!: EntityTable<BusyCacheEntry, 'dateKey'>

  constructor() {
    super('dashboard-cache')
    this.version(1).stores({
      categories: '&id, name',
      subcategories: '&id, categoryId, sortOrder, archivedAt',
      tasks:
        '&id, subcategoryId, completedAt, dueAt, remindAt, priority, updatedAt',
      routine_items: '&id, routine, sortOrder, archivedAt',
      routine_logs: '&id, routineItemId, dateKey, [routineItemId+dateKey]',
      settings: '&userId',
      push_subscriptions: '&id, endpoint',
      outbox: '++id, createdAt, table, attempts',
    })
    // v2: add the client-only busy-range cache (chunk 13). New table only —
    // unchanged stores are inherited from v1, so no .upgrade() migration is
    // needed (the comment above governs schema-shape changes to existing rows).
    this.version(2).stores({
      busyCache: '&dateKey',
    })
    // v3: chunk 15 adds `lastAttemptAt` to outbox rows. The field isn't an
    // index (the replay engine filters in JS), so the outbox `.stores()`
    // string is unchanged — but we still bump the version + run an upgrade so
    // rows queued on existing installs are backfilled to `lastAttemptAt: null`
    // rather than left `undefined`. Unmentioned stores (the cache mirrors,
    // busyCache) inherit unchanged, so this preserves all existing data.
    this.version(3)
      .stores({ outbox: '++id, createdAt, table, attempts' })
      .upgrade(upgradeToV3)
  }
}

/**
 * Dexie v2→v3 upgrade (chunk 15). Backfills `lastAttemptAt = null` on outbox
 * rows that predate the field. Idempotent and only touches rows missing the
 * field, so cache mirrors and queued outbox rows are otherwise untouched.
 * Exported so the migration can be exercised against a populated DB in tests.
 */
export async function upgradeToV3(tx: Transaction): Promise<void> {
  await tx
    .table('outbox')
    .toCollection()
    .modify((row: { lastAttemptAt?: string | null }) => {
      if (row.lastAttemptAt === undefined) row.lastAttemptAt = null
    })
}

export const db = new DashboardCacheDB()
