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

/**
 * A Notebook note (chunk 58, ARCHITECTURE.md §4). Title is optional (`''`).
 * At most one of `taskId` / `subcategoryId` is set; both null = freeform.
 * `detachedLabel` / `detachedAt` are the server-written memo of what the
 * note was attached to when that row was deleted (migration 16 triggers) —
 * the client only ever clears them, on re-attach.
 */
export type Note = {
  id: string
  userId: string
  title: string
  body: string
  pinned: boolean
  taskId: string | null
  subcategoryId: string | null
  detachedLabel: string | null
  detachedAt: string | null
  createdAt: string
  updatedAt: string
}

/**
 * A manual Today mark (chunk 64, ARCHITECTURE.md §4). `id` IS the task's id —
 * one row per task at most, so a toggle is an upsert on `id`. `day` is the
 * browser-local calendar day (YYYY-MM-DD) the mark was made for; a mark for
 * any other day is ignored. `kind` is the user's intent for that day.
 */
export type TodayMark = {
  id: string
  userId: string
  day: string
  kind: 'pin' | 'remove'
  updatedAt: string
}

/**
 * A saved focus phase or breathing session from the menu bar app (chunk 98,
 * ARCHITECTURE.md §4). `id` is derived from `(userId, kind, startedAt)` by
 * `lib/trackedSessions.sessionId`, so the same session written twice lands on
 * one row. `activeSeconds` excludes pauses. `taskId` has no foreign key: the
 * task may be gone, and `taskTitle` keeps its name as it was. Breathing never
 * has a task.
 */
export type TrackedSession = {
  id: string
  userId: string
  kind: 'focus' | 'meditation'
  startedAt: string
  endedAt: string
  plannedSeconds: number
  activeSeconds: number
  /** Focus: completed | skipped | stopped. Breathing: completed | ended. */
  outcome: 'completed' | 'skipped' | 'stopped' | 'ended'
  taskId: string | null
  taskTitle: string | null
  createdAt: string
}

/**
 * A block group (chunk 99, ARCHITECTURE.md §4): a named list of domains the
 * menu bar app keeps out of the active browser tab during focus and/or on a
 * schedule. Domains are normalized (`lib/blockRules.normalizeDomain`).
 * `scheduleDays` uses JS `getDay()` (0 = Sunday); `scheduleFrom` /
 * `scheduleTo` are `HH:MM` in the Mac's own clock, `to <= from` running past
 * midnight.
 */
export type BlockGroup = {
  id: string
  userId: string
  name: string
  domains: string[]
  enabled: boolean
  blockInFocus: boolean
  blockOnSchedule: boolean
  scheduleDays: number[]
  scheduleFrom: string
  scheduleTo: string
  /** Chunk 100: a daily allowance, shared by the group's sites. */
  dailyLimitOn: boolean
  /** Minutes a day, 1–1440; read only while `dailyLimitOn`. */
  dailyLimitMinutes: number
  sortOrder: number
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

export type AiStatus = 'unconfigured' | 'ok' | 'auth_failed'

/** 'unreachable' = feed stopped responding; proxy serves cached busy data
 *  (stale, not lost — amber in the UI, never destructive). */
export type OutlookStatus = 'unconfigured' | 'ok' | 'unreachable'

/**
 * One iCloud event calendar in the READ set (chunk 51). `color` is the
 * calendar's `#rrggbb` from iCloud's `calendar-color` (chunk 51b), absent
 * when iCloud reported none — `lib/calendarColors` assigns a palette color
 * then, so every calendar still renders distinctly.
 */
export type ReadCalendar = {
  url: string
  name: string
  enabled: boolean
  color?: string
}

export type Settings = {
  userId: string
  /**
   * Whether the proxy holds a working Anthropic key (chunk 55). Proxy-written;
   * the key itself (`ai_api_key_encrypted`) is never in this type.
   */
  aiStatus: AiStatus
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
  /**
   * The user signed in when the op was queued (chunk 84). Only that user's
   * session replays it; rows without one predate chunk 84 and are dropped.
   */
  uid?: string
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
  notes: 'notes',
  todayMarks: 'today_marks',
  trackedSessions: 'tracked_sessions',
  blockGroups: 'block_groups',
} as const
export type TableName = (typeof TABLES)[keyof typeof TABLES]
