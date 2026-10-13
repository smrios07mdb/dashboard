/*
 * Data import (chunk 16 — Settings → Data). Replace and Merge modes.
 *
 * R4 — the one genuinely dangerous path (Replace bulk-DELETEs real Supabase
 * data). The file is VALIDATED before any delete: a malformed/old-version file
 * aborts with nothing touched (no partial wipe). Only a validated payload
 * proceeds. Categories are stable infrastructure (seeded by the signup trigger,
 * not user-writable) and are NEVER deleted or re-inserted by import.
 *
 * Replace is atomic (chunk 62): the whole payload is built in memory and sent
 * to `import_replace` (migration 19), which tears down and reinserts in one
 * transaction — every table is replaced or nothing changed. Merge stays a
 * sequence of upserts (non-destructive).
 */
import { db } from '@/db/dexie'
import { wipeLocalCache } from '@/db/localCache'
import { repo } from '@/db/repo'

import {
  CREDENTIAL_SETTINGS_KEYS,
  type ExportPayload,
  IMPORT_STRIPPED_SETTINGS_KEYS,
} from './export'

export class ImportValidationError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'ImportValidationError'
  }
}

/** Tables the file must carry as arrays (categories included for reference). */
const REQUIRED_TABLE_KEYS = [
  'categories',
  'subcategories',
  'tasks',
  'routine_items',
  'routine_logs',
] as const

/**
 * Tables a file MAY carry (chunk 50). `scheduled_blocks` joined the payload
 * WITHOUT an EXPORT_VERSION bump, deliberately: every export already on disk is
 * a v1 file this app must keep reading, and `validateImport` hard-rejects
 * `version !== 1`, so a v2 would have to accept `1 | 2` anyway. An additive
 * optional key is compatible in both directions and needs no version machinery.
 * Absent (or null) → normalized to `[]`; present → validated exactly like a
 * required table (array + the row-level id gate below), so a malformed block row
 * still aborts BEFORE Replace's teardown deletes anything (R4).
 *
 * `notes` joined the same way in chunk 58: optional on read, absent → `[]`,
 * version unchanged.
 */
const OPTIONAL_TABLE_KEYS = ['scheduled_blocks', 'notes'] as const

export type ImportMode = 'replace' | 'merge'

/** Parse-and-validate. Throws ImportValidationError before any write happens. */
export function validateImport(parsed: unknown): ExportPayload {
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new ImportValidationError('That file is not a valid dashboard export.')
  }
  const p = parsed as Record<string, unknown>
  if (p.version !== 1) {
    throw new ImportValidationError(
      `Unsupported export version: ${String(p.version)}. This app reads version 1.`,
    )
  }
  for (const key of REQUIRED_TABLE_KEYS) {
    if (!Array.isArray(p[key])) {
      throw new ImportValidationError(
        `Export is missing or malformed table: "${key}".`,
      )
    }
  }
  for (const key of OPTIONAL_TABLE_KEYS) {
    if (p[key] != null && !Array.isArray(p[key])) {
      throw new ImportValidationError(
        `Export table "${key}" is malformed (expected an array).`,
      )
    }
  }
  if (
    p.settings !== null &&
    (typeof p.settings !== 'object' || Array.isArray(p.settings))
  ) {
    throw new ImportValidationError('Export "settings" block is malformed.')
  }
  // Row-level gate (chunk-16 review): every content row must be an object with
  // a non-empty string id. This catches malformed rows BEFORE the Replace
  // teardown deletes anything (extends R4's validate-before-delete guarantee).
  // FK / NOT NULL integrity is not checked here and no longer needs to be
  // (chunk 62): a file that violates either fails inside `import_replace` and
  // changes nothing.
  for (const key of [...REQUIRED_TABLE_KEYS, ...OPTIONAL_TABLE_KEYS]) {
    if (!Array.isArray(p[key])) continue // optional key absent; required ones checked above
    for (const row of p[key] as unknown[]) {
      if (
        !row ||
        typeof row !== 'object' ||
        Array.isArray(row) ||
        typeof (row as { id?: unknown }).id !== 'string' ||
        !(row as { id: string }).id
      ) {
        throw new ImportValidationError(
          `Export table "${key}" has a malformed row (each row needs a string id).`,
        )
      }
    }
  }
  // Normalize the optional keys so every consumer downstream (previewCounts,
  // upsertContent) reads a plain array. Non-mutating — the caller keeps its own
  // parsed object (Settings holds it for the confirm step).
  const normalized: Record<string, unknown> = {
    ...p,
    scheduled_blocks: Array.isArray(p.scheduled_blocks)
      ? p.scheduled_blocks
      : [],
    notes: Array.isArray(p.notes) ? p.notes : [],
  }
  return normalized as unknown as ExportPayload
}

export function previewCounts(payload: ExportPayload): Record<string, number> {
  return {
    categories: payload.categories.length,
    subcategories: payload.subcategories.length,
    tasks: payload.tasks.length,
    scheduled_blocks: payload.scheduled_blocks.length,
    notes: payload.notes.length,
    routine_items: payload.routine_items.length,
    routine_logs: payload.routine_logs.length,
    settings: payload.settings ? 1 : 0,
  }
}

type RowList = Record<string, unknown>[]

/**
 * Task rows WITHOUT `notes` (chunk 59, D3): the app no longer reads or writes
 * `tasks.notes`. Omitting the key leaves an existing column value alone on
 * Merge and null on Replace; the text itself is carried over as a note by
 * `legacyNotes` below.
 */
function taskRows(payload: ExportPayload): RowList {
  return (payload.tasks as RowList).map((row) => {
    const next = { ...row }
    delete next.notes
    return next
  })
}

/**
 * Planner blocks with `calendar_uid` forced to NULL (chunk 50). A re-imported
 * uid points at an iCloud VEVENT this file cannot vouch for — deleted by hand,
 * a different calendar selected since, or written by another device. Seeded
 * into the DB it poisons the planner's reconcile: the uid appears in neither
 * `plannerEvents` nor the mirror's session record, so the drift loop finds no
 * observation and skips the block forever (mirrored to nothing); where it does
 * still resolve, drift repair rewrites a real event's times. Null instead
 * re-uses the mirror's BACKFILL path (chunk 39/46-49): with `planner_writeout`
 * on, the next load of the block's week creates the event and stamps the new
 * uid, and the orphan sweep removes whatever stale event the file's uid used to
 * name. Two consequences, stated so they are not discovered later: with
 * `planner_writeout` OFF at import time blocks simply stay uid-less until it is
 * turned on (documented chunk-39 behaviour, not a bug); and stale events on
 * weeks not visited after the import linger until that week is loaded, since
 * the sweep is per-week (B3a). Both acceptable. The export itself is NOT
 * redacted — it stays a faithful dump.
 */
function blockRows(payload: ExportPayload): RowList {
  return (payload.scheduled_blocks as RowList).map((row) => ({
    ...row,
    calendar_uid: null,
  }))
}

/**
 * The settings row minus every key an import never writes, or null when the
 * file has none. Credentials are stripped so the write never touches them
 * (chunk-16 review fix): the export redacts them to null, and writing that null
 * back would zero the LIVE secret (CalDAV password, Anthropic API key) and
 * silently break calendar/AI. Omitting preserves them. Server-held state goes
 * the same way (chunk 56 D2): the dropped legacy `ai_api_key` column, and the
 * three statuses, which describe secrets this file does not carry — the live
 * row's value is the only truthful one.
 */
function settingsRow(payload: ExportPayload): Record<string, unknown> | null {
  if (!payload.settings) return null
  const row = { ...(payload.settings as Record<string, unknown>) }
  for (const k of CREDENTIAL_SETTINGS_KEYS) delete row[k]
  for (const k of IMPORT_STRIPPED_SETTINGS_KEYS) delete row[k]
  return row
}

type KnownIds = { task_id: Set<string>; subcategory_id: Set<string> }

/** The task / subcategory ids the file itself carries. */
function fileIds(payload: ExportPayload): KnownIds {
  return {
    task_id: new Set((payload.tasks as RowList).map((r) => r.id as string)),
    subcategory_id: new Set(
      (payload.subcategories as RowList).map((r) => r.id as string),
    ),
  }
}

/**
 * Notes ready to write (chunk 58): a `task_id` / `subcategory_id` not in
 * `known` is written `null`, so the note arrives freeform instead of failing
 * its FK. `detached_label` / `detached_at` are left exactly as the file has
 * them — the file's memo is the only record of what the note used to sit
 * beside.
 */
function linkNotes(payload: ExportPayload, known: KnownIds): RowList {
  return (payload.notes as RowList).map((n) => ({
    ...n,
    task_id:
      typeof n.task_id === 'string' && known.task_id.has(n.task_id)
        ? n.task_id
        : null,
    subcategory_id:
      typeof n.subcategory_id === 'string' &&
      known.subcategory_id.has(n.subcategory_id)
        ? n.subcategory_id
        : null,
  }))
}

const bodyKey = (taskId: unknown, body: unknown) =>
  `${String(taskId)}\n${typeof body === 'string' ? body.trim() : ''}`

/** Incoming task rows that still carry a non-blank legacy `notes` string. */
function legacyTasks(payload: ExportPayload): RowList {
  return (payload.tasks as RowList).filter(
    (row) => typeof row.notes === 'string' && row.notes.trim() !== '',
  )
}

/**
 * Legacy `tasks.notes` → notes (chunk 59, D3). Every row of `legacy` becomes
 * one untitled note on that task, carrying the task's own timestamps so it
 * does not jump to the top of RECENT — the same shape migration 17 writes.
 *
 * Skipped when a note with the same `task_id` and the same trimmed body is in
 * `existing`: the file's own notes (a chunk-59 export carries both the column
 * and the copied note) and, on Merge, the live ones (the file was imported
 * before). So a pre-58 file imports into notes, and importing anything twice
 * adds nothing.
 */
function legacyNotes(
  legacy: RowList,
  existing: { task_id?: unknown; body?: unknown }[],
): RowList {
  const seen = new Set(existing.map((n) => bodyKey(n.task_id, n.body)))
  const out: RowList = []
  for (const row of legacy) {
    const key = bodyKey(row.id, row.notes)
    if (seen.has(key)) continue
    seen.add(key)
    out.push({
      id: crypto.randomUUID(),
      user_id: row.user_id,
      title: '',
      body: row.notes,
      task_id: row.id,
      subcategory_id: null,
      pinned: false,
      detached_label: null,
      detached_at: null,
      created_at: row.created_at,
      updated_at: row.updated_at,
    })
  }
  return out
}

/**
 * Everything Replace writes, built from the file alone (chunk 62) — no
 * network, no Dexie, and the caller's object is not mutated. Note links and
 * the legacy-note dedupe resolve against the file only: `import_replace`
 * empties the account before it inserts, so the file's own rows are the only
 * ones a link could name.
 */
export function buildReplacePayload(
  payload: ExportPayload,
): Record<string, unknown> {
  const fileNotes = linkNotes(payload, fileIds(payload))
  return {
    subcategories: payload.subcategories,
    tasks: taskRows(payload),
    scheduled_blocks: blockRows(payload),
    notes: [...fileNotes, ...legacyNotes(legacyTasks(payload), fileNotes)],
    routine_items: payload.routine_items,
    routine_logs: payload.routine_logs,
    settings: settingsRow(payload),
  }
}

/**
 * Merge: upsert the user-scoped content tables, parents before children.
 * Categories are not touched (stable infra). Settings upserts on `user_id`.
 */
async function upsertContent(payload: ExportPayload): Promise<void> {
  await repo.data.bulkUpsert('subcategories', payload.subcategories as RowList)
  await repo.data.bulkUpsert('tasks', taskRows(payload))
  // Planner blocks after tasks (FK `task_id`). Conflict target is `task_id`,
  // not `id`: `scheduled_blocks` is `unique (task_id)`, so a Merge into a live
  // DB that already holds a DIFFERENT block for an incoming task would violate
  // that constraint and fail partway on an id-keyed upsert. Keying on the real
  // invariant makes the incoming row win and leaves exactly one block per task.
  // (Residual edge: an imported id that collides with a live block on some
  // other task still fails the pk — it needs ids reused across tasks, which an
  // export cannot produce.)
  await repo.data.bulkUpsert('scheduled_blocks', blockRows(payload), 'task_id')
  // Notes after tasks (FK `task_id` / `subcategory_id`, chunk 58). Upsert on
  // `id` — a task or a subcategory may hold many notes, so `id` is the only
  // invariant.
  const fileNotes = await withLiveLinks(payload)
  await repo.data.bulkUpsert('notes', [
    ...fileNotes,
    ...(await legacyTaskNotes(payload, fileNotes)),
  ])
  await repo.data.bulkUpsert('routine_items', payload.routine_items as RowList)
  await repo.data.bulkUpsert('routine_logs', payload.routine_logs as RowList)
  const settings = settingsRow(payload)
  if (settings) await repo.data.bulkUpsert('settings', [settings], 'user_id')
}

/**
 * Merge's note links: an id counts as known when it is in the file or live.
 * Runs after `subcategories` and `tasks` are upserted. Only ids the file does
 * not itself carry cost a lookup, so a self-consistent export makes none.
 */
async function withLiveLinks(payload: ExportPayload): Promise<RowList> {
  const notes = payload.notes as RowList
  if (notes.length === 0) return []
  const known = fileIds(payload)
  const tables = { task_id: 'tasks', subcategory_id: 'subcategories' } as const
  for (const column of ['task_id', 'subcategory_id'] as const) {
    const unknown = [
      ...new Set(
        notes
          .map((n) => n[column])
          .filter(
            (id): id is string =>
              typeof id === 'string' && !known[column].has(id),
          ),
      ),
    ]
    if (unknown.length === 0) continue
    for (const id of await repo.data.existingIds(tables[column], unknown)) {
      known[column].add(id)
    }
  }
  return linkNotes(payload, known)
}

/**
 * Merge's legacy notes: deduped against the file's notes and the live ones.
 * Runs after `tasks` is upserted, and its rows go out in the same `notes`
 * upsert as the file's own.
 */
async function legacyTaskNotes(
  payload: ExportPayload,
  fileNotes: RowList,
): Promise<RowList> {
  const legacy = legacyTasks(payload)
  if (legacy.length === 0) return []
  const live = await repo.data.noteBodiesForTasks(
    legacy.map((row) => row.id as string),
  )
  return legacyNotes(legacy, [...fileNotes, ...live])
}

/**
 * Replace: one `import_replace` call (teardown children→parents, never
 * categories; reinsert parents→children; settings overlay) in one transaction.
 * Only once it has landed is the outbox cleared (queued mutations are now
 * invalid) and the local cache dropped so it rebuilds from Supabase on next
 * read. If the call throws, the account is as it was and both are left alone.
 * `userId` is unused — the server scopes to `auth.uid()`.
 */
export async function replaceAll(
  payload: ExportPayload,
  userId: string,
): Promise<void> {
  void userId
  await repo.data.importReplace(buildReplacePayload(payload))
  await db.outbox.clear()
  await wipeLocalCache()
}

/** Merge: upsert by id; existing rows overwritten, new rows added, none deleted. */
export async function mergeAll(payload: ExportPayload): Promise<void> {
  await upsertContent(payload)
  await wipeLocalCache()
}

/**
 * Validate (R4 gate) then apply. The validation throws before any network
 * call, so a bad file never reaches the server.
 */
export async function importData(
  parsed: unknown,
  mode: ImportMode,
  userId: string,
): Promise<{ mode: ImportMode; counts: Record<string, number> }> {
  const payload = validateImport(parsed)
  if (mode === 'replace') await replaceAll(payload, userId)
  else await mergeAll(payload)
  return { mode, counts: previewCounts(payload) }
}
