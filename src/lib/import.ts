/*
 * Data import (chunk 16 — Settings → Data). Replace and Merge modes.
 *
 * R4 — the one genuinely dangerous path (Replace bulk-DELETEs real Supabase
 * data). The file is VALIDATED before any delete: a malformed/old-version file
 * aborts with nothing touched (no partial wipe). Only a validated payload
 * proceeds. Categories are stable infrastructure (seeded by the signup trigger,
 * not user-writable) and are NEVER deleted or re-inserted by import.
 */
import { db } from '@/db/dexie'
import { wipeLocalCache } from '@/db/localCache'
import { repo } from '@/db/repo'
import type { TableName } from '@/db/types'

import { CREDENTIAL_SETTINGS_KEYS, type ExportPayload } from './export'

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
 */
const OPTIONAL_TABLE_KEYS = ['scheduled_blocks'] as const

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
  // Full FK / NOT NULL integrity is the Day-7 atomic-replace revision.
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
  }
  return normalized as unknown as ExportPayload
}

export function previewCounts(payload: ExportPayload): Record<string, number> {
  return {
    categories: payload.categories.length,
    subcategories: payload.subcategories.length,
    tasks: payload.tasks.length,
    scheduled_blocks: payload.scheduled_blocks.length,
    routine_items: payload.routine_items.length,
    routine_logs: payload.routine_logs.length,
    settings: payload.settings ? 1 : 0,
  }
}

type RowList = Record<string, unknown>[]

/**
 * Upsert the user-scoped content tables, parents before children. Categories
 * are not touched (stable infra). Settings upserts on `user_id`.
 */
async function upsertContent(payload: ExportPayload): Promise<void> {
  await repo.data.bulkUpsert('subcategories', payload.subcategories as RowList)
  await repo.data.bulkUpsert('tasks', payload.tasks as RowList)
  // Planner blocks after tasks (FK `task_id`), with two chunk-50 rules:
  //
  // 1. `calendar_uid` is forced to NULL on every incoming row. A re-imported uid
  //    points at an iCloud VEVENT this file cannot vouch for — deleted by hand,
  //    a different calendar selected since, or written by another device. Seeded
  //    into the DB it poisons the planner's reconcile: the uid appears in
  //    neither `plannerEvents` nor the mirror's session record, so the drift loop
  //    finds no observation and skips the block forever (mirrored to nothing);
  //    where it does still resolve, drift repair rewrites a real event's times.
  //    Null instead re-uses the mirror's BACKFILL path (chunk 39/46-49): with
  //    `planner_writeout` on, the next load of the block's week creates the event
  //    and stamps the new uid, and the orphan sweep removes whatever stale event
  //    the file's uid used to name. Two consequences, stated so they are not
  //    discovered later: with `planner_writeout` OFF at import time blocks simply
  //    stay uid-less until it is turned on (documented chunk-39 behaviour, not a
  //    bug); and stale events on weeks not visited after the import linger until
  //    that week is loaded, since the sweep is per-week (B3a). Both acceptable.
  //    The export itself is NOT redacted — it stays a faithful dump.
  //
  // 2. Conflict target is `task_id`, not `id`. `scheduled_blocks` is
  //    `unique (task_id)`, so a Merge into a live DB that already holds a
  //    DIFFERENT block for an incoming task would violate that constraint and
  //    fail partway on an id-keyed upsert. Keying on the real invariant makes the
  //    incoming row win and leaves exactly one block per task. (Residual edge: an
  //    imported id that collides with a live block on some other task still
  //    fails the pk — it needs ids reused across tasks, which an export cannot
  //    produce.) Harmless in Replace, where the table was just emptied.
  await repo.data.bulkUpsert(
    'scheduled_blocks',
    (payload.scheduled_blocks as RowList).map((row) => ({
      ...row,
      calendar_uid: null,
    })),
    'task_id',
  )
  await repo.data.bulkUpsert('routine_items', payload.routine_items as RowList)
  await repo.data.bulkUpsert('routine_logs', payload.routine_logs as RowList)
  if (payload.settings) {
    // Strip every credential column so the upsert's ON CONFLICT DO UPDATE never
    // touches them (chunk-16 review fix). The export redacts them to null;
    // writing that null back would zero the LIVE secret (CalDAV password,
    // Anthropic API key) and silently break calendar/AI. Omitting preserves them.
    const settingsRow = { ...(payload.settings as Record<string, unknown>) }
    for (const k of CREDENTIAL_SETTINGS_KEYS) delete settingsRow[k]
    await repo.data.bulkUpsert('settings', [settingsRow], 'user_id')
  }
}

/**
 * Replace: teardown children→parents (never categories), reinsert
 * parents→children, clear the outbox (queued mutations are now invalid), and
 * drop the local cache so it rebuilds from Supabase on next read.
 */
export async function replaceAll(
  payload: ExportPayload,
  userId: string,
): Promise<void> {
  const teardown: TableName[] = [
    // Deleting `tasks` already cascades blocks; listing them first makes the
    // intent explicit rather than depending on a cascade a future migration
    // might change.
    'scheduled_blocks',
    'tasks',
    'routine_logs',
    'subcategories',
    'routine_items',
    'push_subscriptions',
  ]
  for (const table of teardown) {
    await repo.data.bulkDeleteAllForUser(table, userId)
  }
  await upsertContent(payload)
  await db.outbox.clear()
  await wipeLocalCache()
}

/** Merge: upsert by id; existing rows overwritten, new rows added, none deleted. */
export async function mergeAll(payload: ExportPayload): Promise<void> {
  await upsertContent(payload)
  await wipeLocalCache()
}

/**
 * Validate (R4 gate) then apply. The validation throws before any delete, so a
 * bad file can never cause a partial wipe.
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
