/*
 * Snake_case ↔ camelCase converters between Postgres rows (Supabase) and
 * the TypeScript types in ./types.ts.
 *
 * Convention: each entity gets `xFromRow(row)` and `xToRow(value, partial?)`
 * functions. `toRow` is written to accept partial input for update payloads
 * — the keys that come out are only the keys you passed in.
 */
import type {
  Category,
  PushSubscription,
  RoutineItem,
  RoutineLog,
  ScheduledBlock,
  Settings,
  Subcategory,
  Task,
} from './types'

// ---------- categories ----------

export type CategoryRow = {
  id: string
  user_id: string
  name: 'Work' | 'Personal'
}

export function categoryFromRow(row: CategoryRow): Category {
  return { id: row.id, userId: row.user_id, name: row.name }
}

export function categoryToRow(value: Category): CategoryRow {
  return { id: value.id, user_id: value.userId, name: value.name }
}

// ---------- subcategories ----------

export type SubcategoryRow = {
  id: string
  user_id: string
  category_id: string
  name: string
  sort_order: number
  archived_at: string | null
}

export function subcategoryFromRow(row: SubcategoryRow): Subcategory {
  return {
    id: row.id,
    userId: row.user_id,
    categoryId: row.category_id,
    name: row.name,
    sortOrder: row.sort_order,
    archivedAt: row.archived_at,
  }
}

export function subcategoryToRow(
  value: Partial<Subcategory> & { id?: string },
): Partial<SubcategoryRow> {
  const row: Partial<SubcategoryRow> = {}
  if (value.id !== undefined) row.id = value.id
  if (value.userId !== undefined) row.user_id = value.userId
  if (value.categoryId !== undefined) row.category_id = value.categoryId
  if (value.name !== undefined) row.name = value.name
  if (value.sortOrder !== undefined) row.sort_order = value.sortOrder
  if (value.archivedAt !== undefined) row.archived_at = value.archivedAt
  return row
}

// ---------- tasks ----------

export type TaskRow = {
  id: string
  user_id: string
  subcategory_id: string
  title: string
  notes: string | null
  estimate_minutes: number
  due_at: string | null
  remind_at: string | null
  notified: boolean
  priority: number | null
  completed_at: string | null
  created_at: string
  updated_at: string
}

export function taskFromRow(row: TaskRow): Task {
  return {
    id: row.id,
    userId: row.user_id,
    subcategoryId: row.subcategory_id,
    title: row.title,
    notes: row.notes,
    estimateMinutes: row.estimate_minutes,
    dueAt: row.due_at,
    remindAt: row.remind_at,
    notified: row.notified,
    // DB says int; the 08_priority_check constraint pins it to {1,2,3,null}.
    priority: row.priority as Task['priority'],
    completedAt: row.completed_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }
}

export function taskToRow(
  value: Partial<Task> & { id?: string },
): Partial<TaskRow> {
  const row: Partial<TaskRow> = {}
  if (value.id !== undefined) row.id = value.id
  if (value.userId !== undefined) row.user_id = value.userId
  if (value.subcategoryId !== undefined) row.subcategory_id = value.subcategoryId
  if (value.title !== undefined) row.title = value.title
  if (value.notes !== undefined) row.notes = value.notes
  if (value.estimateMinutes !== undefined)
    row.estimate_minutes = value.estimateMinutes
  if (value.dueAt !== undefined) row.due_at = value.dueAt
  if (value.remindAt !== undefined) row.remind_at = value.remindAt
  if (value.notified !== undefined) row.notified = value.notified
  if (value.priority !== undefined) row.priority = value.priority
  if (value.completedAt !== undefined) row.completed_at = value.completedAt
  if (value.createdAt !== undefined) row.created_at = value.createdAt
  if (value.updatedAt !== undefined) row.updated_at = value.updatedAt
  return row
}

// ---------- scheduled_blocks ----------

export type ScheduledBlockRow = {
  id: string
  user_id: string
  task_id: string
  start_at: string
  end_at: string
  calendar_uid: string | null
  created_at: string
  updated_at: string
}

export function scheduledBlockFromRow(row: ScheduledBlockRow): ScheduledBlock {
  return {
    id: row.id,
    userId: row.user_id,
    taskId: row.task_id,
    startAt: row.start_at,
    endAt: row.end_at,
    // Rows cached before migration 12 predate the column.
    calendarUid: row.calendar_uid ?? null,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }
}

export function scheduledBlockToRow(
  value: Partial<ScheduledBlock> & { id?: string },
): Partial<ScheduledBlockRow> {
  const row: Partial<ScheduledBlockRow> = {}
  if (value.id !== undefined) row.id = value.id
  if (value.userId !== undefined) row.user_id = value.userId
  if (value.taskId !== undefined) row.task_id = value.taskId
  if (value.startAt !== undefined) row.start_at = value.startAt
  if (value.endAt !== undefined) row.end_at = value.endAt
  if (value.calendarUid !== undefined) row.calendar_uid = value.calendarUid
  if (value.createdAt !== undefined) row.created_at = value.createdAt
  if (value.updatedAt !== undefined) row.updated_at = value.updatedAt
  return row
}

// ---------- routine_items ----------

export type RoutineItemRow = {
  id: string
  user_id: string
  routine: 'morning' | 'night'
  label: string
  sort_order: number
  archived_at: string | null
  created_at: string
}

export function routineItemFromRow(row: RoutineItemRow): RoutineItem {
  return {
    id: row.id,
    userId: row.user_id,
    routine: row.routine,
    label: row.label,
    sortOrder: row.sort_order,
    archivedAt: row.archived_at,
    createdAt: row.created_at,
  }
}

export function routineItemToRow(
  value: Partial<RoutineItem> & { id?: string },
): Partial<RoutineItemRow> {
  const row: Partial<RoutineItemRow> = {}
  if (value.id !== undefined) row.id = value.id
  if (value.userId !== undefined) row.user_id = value.userId
  if (value.routine !== undefined) row.routine = value.routine
  if (value.label !== undefined) row.label = value.label
  if (value.sortOrder !== undefined) row.sort_order = value.sortOrder
  if (value.archivedAt !== undefined) row.archived_at = value.archivedAt
  if (value.createdAt !== undefined) row.created_at = value.createdAt
  return row
}

// ---------- routine_logs ----------

export type RoutineLogRow = {
  id: string
  user_id: string
  routine_item_id: string
  date_key: string
  completed: boolean
}

export function routineLogFromRow(row: RoutineLogRow): RoutineLog {
  return {
    id: row.id,
    userId: row.user_id,
    routineItemId: row.routine_item_id,
    dateKey: row.date_key,
    completed: row.completed,
  }
}

export function routineLogToRow(
  value: Partial<RoutineLog> & { id?: string },
): Partial<RoutineLogRow> {
  const row: Partial<RoutineLogRow> = {}
  if (value.id !== undefined) row.id = value.id
  if (value.userId !== undefined) row.user_id = value.userId
  if (value.routineItemId !== undefined)
    row.routine_item_id = value.routineItemId
  if (value.dateKey !== undefined) row.date_key = value.dateKey
  if (value.completed !== undefined) row.completed = value.completed
  return row
}

// ---------- settings ----------

// `outlook_ics_url_encrypted` and `outlook_cached_busy` are intentionally
// absent (write-only secrets, proxy-owned — see db/types.ts).
export type SettingsRow = {
  user_id: string
  ai_api_key: string | null
  caldav_apple_id: string | null
  caldav_calendar_url: string | null
  caldav_status: Settings['caldavStatus']
  outlook_status: Settings['outlookStatus']
  outlook_feed_name: string | null
  outlook_fetched_at: string | null
  planner_writeout?: boolean
  timezone: string
  last_daily_reset: string | null
}

export function settingsFromRow(row: SettingsRow): Settings {
  return {
    userId: row.user_id,
    aiApiKey: row.ai_api_key,
    caldavAppleId: row.caldav_apple_id,
    caldavCalendarUrl: row.caldav_calendar_url,
    caldavStatus: row.caldav_status,
    // Rows cached before migration 09 may predate the column; default to the
    // DB default rather than persisting `undefined` into the Settings shape.
    outlookStatus: row.outlook_status ?? 'unconfigured',
    outlookFeedName: row.outlook_feed_name ?? null,
    outlookFetchedAt: row.outlook_fetched_at ?? null,
    // Same for migration 12's column.
    plannerWriteout: row.planner_writeout ?? false,
    timezone: row.timezone,
    lastDailyReset: row.last_daily_reset,
  }
}

/**
 * The two online-only secrets must never persist in the Dexie cache at rest
 * (chunk 18, PRIV-02): `aiApiKey` is only used to call api.anthropic.com and
 * `caldavAppleId` only for proxy/CalDAV ops — both require the network, so the
 * live Supabase fetch supplies them and the cache mirror omits them entirely
 * (mirroring how the encrypted CalDAV password is never in the `Settings` type
 * or cache at all). Apply at EVERY `db.settings` cache-write site; the live
 * return value of `settingsFromRow` is left intact for online callers.
 *
 * Distinct from export's `CREDENTIAL_SETTINGS_KEYS` redaction (lib/export.ts):
 * that list targets credentials in the user-initiated export FILE. This targets
 * online-only fields in the silent, indefinitely-persisted at-rest cache. The
 * Apple ID is online-only (stripped here) but, as identifying-not-secret config
 * that's inert without the server-only encrypted password, it's intentionally
 * retained in exports (which already carry task notes in plaintext by design).
 */
export function toCachedSettings(settings: Settings): Settings {
  const cached = { ...settings }
  delete (cached as Partial<Settings>).aiApiKey
  delete (cached as Partial<Settings>).caldavAppleId
  return cached as Settings
}

export function settingsToRow(
  value: Partial<Settings> & { userId?: string },
): Partial<SettingsRow> {
  const row: Partial<SettingsRow> = {}
  if (value.userId !== undefined) row.user_id = value.userId
  if (value.aiApiKey !== undefined) row.ai_api_key = value.aiApiKey
  if (value.caldavAppleId !== undefined)
    row.caldav_apple_id = value.caldavAppleId
  if (value.caldavCalendarUrl !== undefined)
    row.caldav_calendar_url = value.caldavCalendarUrl
  if (value.caldavStatus !== undefined) row.caldav_status = value.caldavStatus
  if (value.outlookStatus !== undefined)
    row.outlook_status = value.outlookStatus
  if (value.outlookFeedName !== undefined)
    row.outlook_feed_name = value.outlookFeedName
  if (value.outlookFetchedAt !== undefined)
    row.outlook_fetched_at = value.outlookFetchedAt
  if (value.plannerWriteout !== undefined)
    row.planner_writeout = value.plannerWriteout
  if (value.timezone !== undefined) row.timezone = value.timezone
  if (value.lastDailyReset !== undefined)
    row.last_daily_reset = value.lastDailyReset
  return row
}

// ---------- push_subscriptions ----------

export type PushSubscriptionRow = {
  id: string
  user_id: string
  endpoint: string
  p256dh: string
  auth: string
  created_at: string
}

export function pushSubscriptionFromRow(
  row: PushSubscriptionRow,
): PushSubscription {
  return {
    id: row.id,
    userId: row.user_id,
    endpoint: row.endpoint,
    p256dh: row.p256dh,
    auth: row.auth,
    createdAt: row.created_at,
  }
}

export function pushSubscriptionToRow(
  value: Partial<PushSubscription> & { id?: string },
): Partial<PushSubscriptionRow> {
  const row: Partial<PushSubscriptionRow> = {}
  if (value.id !== undefined) row.id = value.id
  if (value.userId !== undefined) row.user_id = value.userId
  if (value.endpoint !== undefined) row.endpoint = value.endpoint
  if (value.p256dh !== undefined) row.p256dh = value.p256dh
  if (value.auth !== undefined) row.auth = value.auth
  if (value.createdAt !== undefined) row.created_at = value.createdAt
  return row
}
