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
  }
}

export const db = new DashboardCacheDB()
