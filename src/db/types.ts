/*
 * TypeScript shapes for the data model.
 *
 * Mirrors the Postgres schema in supabase/migrations/01_tables.sql
 * (canonical: ARCHITECTURE.md §4). Field names use camelCase here and
 * are translated to snake_case at the Supabase boundary via mappers.ts.
 *
 * `caldav_app_password_encrypted` (bytea) is intentionally omitted from
 * Settings — the encrypted password is never read by the client, only
 * the proxy.
 */

export type Category = {
  id: string
  userId: string
  name: 'Work' | 'Personal'
}

export type Subcategory = {
  id: string
  userId: string
  categoryId: string
  name: string
  sortOrder: number
  archivedAt: string | null
}

export type Task = {
  id: string
  userId: string
  subcategoryId: string
  title: string
  notes: string | null
  estimateMinutes: number
  dueAt: string | null
  remindAt: string | null
  notified: boolean
  priority: number | null
  completedAt: string | null
  createdAt: string
  updatedAt: string
}

export type RoutineItem = {
  id: string
  userId: string
  routine: 'morning' | 'night'
  label: string
  sortOrder: number
  archivedAt: string | null
  createdAt: string
}

export type RoutineLog = {
  id: string
  userId: string
  routineItemId: string
  dateKey: string
  completed: boolean
}

export type CaldavStatus = 'unconfigured' | 'ok' | 'auth_failed'

export type Settings = {
  userId: string
  aiApiKey: string | null
  caldavAppleId: string | null
  caldavCalendarUrl: string | null
  caldavStatus: CaldavStatus
  timezone: string
  lastDailyReset: string | null
}

export type PushSubscription = {
  id: string
  userId: string
  endpoint: string
  p256dh: string
  auth: string
  createdAt: string
}

/**
 * A busy time interval (ISO-8601 `start`/`end`) as returned by the CalDAV
 * proxy's `/busy` endpoint (ARCHITECTURE.md §7). Shared by the calendar API
 * client, the slot proposer (§8), the busy strip, and the Dexie busy cache.
 */
export type BusyRange = {
  start: string
  end: string
}

/**
 * Dexie cache entry for one local day's busy ranges. Keyed by `dateKey`
 * (YYYY-MM-DD in the user's timezone) with a short TTL — see `lib/busyCache`.
 * Cache-only (never synced to Supabase); not part of the outbox/realtime set.
 */
export type BusyCacheEntry = {
  dateKey: string
  ranges: BusyRange[]
  fetchedAt: number
}

export type OutboxOp = 'insert' | 'update' | 'delete'

export type OutboxRow = {
  id?: number
  op: OutboxOp
  table: string
  payload: unknown
  createdAt: string
  attempts: number
  lastError: string | null
}

export type SyncState = 'synced' | 'syncing' | 'offline' | 'sync_issues'

/** Table identifiers used by the outbox and realtime layers. */
export const TABLES = {
  categories: 'categories',
  subcategories: 'subcategories',
  tasks: 'tasks',
  routineItems: 'routine_items',
  routineLogs: 'routine_logs',
  settings: 'settings',
  pushSubscriptions: 'push_subscriptions',
} as const
export type TableName = (typeof TABLES)[keyof typeof TABLES]
