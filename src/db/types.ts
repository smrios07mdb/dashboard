/*
 * TypeScript shapes for the data model.
 *
 * Mirrors the Postgres schema in supabase/migrations/01_tables.sql
 * (canonical: ARCHITECTURE.md §4). Field names use camelCase here and
 * are translated to snake_case at the Supabase boundary via mappers.ts.
 *
 * `caldav_app_password_encrypted` (bytea) is intentionally omitted from
 * Settings — the encrypted password is never read by the client, only
 * the proxy. `outlook_ics_url_encrypted` and `outlook_cached_busy` get the
 * same treatment (chunk 35): the ICS URL is entered, sent to the proxy,
 * and never read back; the cached busy JSON is proxy-internal.
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
  /** 1 (Urgent) / 2 (Soon) / 3 (Whenever); null = no priority set (chunk 33). */
  priority: 1 | 2 | 3 | null
  completedAt: string | null
  createdAt: string
  updatedAt: string
}

/**
 * A task's slot on the Week Planner (chunk 37, ARCHITECTURE.md §4). One
 * block per task (server-side `unique (task_id)`); done derives from
 * `tasks.completed_at` (the `done` mirror column was dropped in chunk 39).
 * `calendarUid` is the iCloud VEVENT this block is mirrored to (chunk 39,
 * `hupo-block-…`); null = not written yet — the planner's per-week
 * reconcile backfills it. ISO instants — all grid math is browser-local.
 */
export type ScheduledBlock = {
  id: string
  userId: string
  taskId: string
  startAt: string
  endAt: string
  calendarUid: string | null
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

/** 'unreachable' = feed stopped responding; proxy serves cached busy data
 *  (stale, not lost — amber in the UI, never destructive). */
export type OutlookStatus = 'unconfigured' | 'ok' | 'unreachable'

/** One iCloud event calendar in the READ set (chunk 51). */
export type ReadCalendar = { url: string; name: string; enabled: boolean }

export type Settings = {
  userId: string
  aiApiKey: string | null
  caldavAppleId: string | null
  /** The single WRITE target for planner mirrors (chunk 39). */
  caldavCalendarUrl: string | null
  /**
   * Which iCloud calendars `/busy` reads (chunk 51). `null` = not
   * initialized: the proxy reads the write target only until the Planner
   * initializes the set to all-discovered / all-enabled on first mount.
   */
  caldavReadCalendars: ReadCalendar[] | null
  caldavStatus: CaldavStatus
  outlookStatus: OutlookStatus
  outlookFeedName: string | null
  outlookFetchedAt: string | null
  /** Opt-in: mirror planner blocks to the selected Apple calendar (chunk 39). */
  plannerWriteout: boolean
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
  /**
   * ISO timestamp of the last replay attempt, or `null` if never attempted
   * (chunk 15). Drives the exponential-backoff skip in the replay engine.
   * Rows queued before the chunk-15 Dexie v3 migration are backfilled to
   * `null` (see `upgradeToV3` in dexie.ts).
   */
  lastAttemptAt: string | null
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
  scheduledBlocks: 'scheduled_blocks',
} as const
export type TableName = (typeof TABLES)[keyof typeof TABLES]
