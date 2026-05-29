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
import Dexie, { type EntityTable } from 'dexie'

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
  }
}

export const db = new DashboardCacheDB()
