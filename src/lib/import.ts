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

import { type ExportPayload } from './export'

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
  if (
    p.settings !== null &&
    (typeof p.settings !== 'object' || Array.isArray(p.settings))
  ) {
    throw new ImportValidationError('Export "settings" block is malformed.')
  }
  return parsed as ExportPayload
}

export function previewCounts(payload: ExportPayload): Record<string, number> {
  return {
    categories: payload.categories.length,
    subcategories: payload.subcategories.length,
    tasks: payload.tasks.length,
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
  await repo.data.bulkUpsert('routine_items', payload.routine_items as RowList)
  await repo.data.bulkUpsert('routine_logs', payload.routine_logs as RowList)
  if (payload.settings) {
    await repo.data.bulkUpsert('settings', [payload.settings], 'user_id')
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
