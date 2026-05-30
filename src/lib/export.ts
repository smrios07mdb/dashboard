/*
 * Data export (chunk 16 — Settings → Data).
 *
 * Pulls RAW rows from Supabase (the source of truth, not Dexie) so the export
 * round-trips exactly via import. The one redaction: settings'
 * `caldav_app_password_encrypted` is forced to null — the encrypted CalDAV
 * password must never leave the device. push_subscriptions are device-specific
 * and intentionally excluded (R4/R5).
 */
import { supabase } from '@/lib/supabase'

export const EXPORT_VERSION = 1

type Row = Record<string, unknown>

/**
 * Device-local credentials on the settings row. Single source of truth shared
 * by export (redacted → null so they never leave the device) and import
 * (omitted from the settings upsert so a redacted-null never overwrites the
 * live secret). Add any future secret/token column here — not whack-a-mole.
 */
export const CREDENTIAL_SETTINGS_KEYS = [
  'caldav_app_password_encrypted',
  'ai_api_key',
] as const

/** User-scoped tables included in the export, in dependency-friendly order. */
const EXPORT_TABLES = [
  'categories',
  'subcategories',
  'tasks',
  'routine_items',
  'routine_logs',
] as const

export type ExportPayload = {
  version: number
  exported_at: string
  user_id: string
  categories: Row[]
  subcategories: Row[]
  tasks: Row[]
  routine_items: Row[]
  routine_logs: Row[]
  settings: Row | null
}

/** Null every device-local credential (R5); preserve all config fields. */
export function redactSettings(row: Row | null): Row | null {
  if (!row) return null
  const out = { ...row }
  for (const k of CREDENTIAL_SETTINGS_KEYS) out[k] = null
  return out
}

/** Pure assembly — keeps the redaction unit-testable without network. */
export function buildExportPayload(args: {
  userId: string
  exportedAt: string
  tables: Partial<Record<(typeof EXPORT_TABLES)[number], Row[]>>
  settings: Row | null
}): ExportPayload {
  return {
    version: EXPORT_VERSION,
    exported_at: args.exportedAt,
    user_id: args.userId,
    categories: args.tables.categories ?? [],
    subcategories: args.tables.subcategories ?? [],
    tasks: args.tables.tasks ?? [],
    routine_items: args.tables.routine_items ?? [],
    routine_logs: args.tables.routine_logs ?? [],
    settings: redactSettings(args.settings),
  }
}

/** Fetch every user-scoped table from Supabase and assemble the payload. */
export async function exportAllData(
  userId: string,
  exportedAt: string = new Date().toISOString(),
): Promise<ExportPayload> {
  const tables: Partial<Record<(typeof EXPORT_TABLES)[number], Row[]>> = {}
  for (const t of EXPORT_TABLES) {
    const { data, error } = await supabase
      .from(t)
      .select('*')
      .eq('user_id', userId)
    if (error) throw new Error(error.message || `Failed to export ${t}`)
    tables[t] = (data ?? []) as Row[]
  }
  const { data: settings, error: sErr } = await supabase
    .from('settings')
    .select('*')
    .eq('user_id', userId)
    .maybeSingle()
  if (sErr) throw new Error(sErr.message || 'Failed to export settings')

  return buildExportPayload({
    userId,
    exportedAt,
    tables,
    settings: (settings as Row) ?? null,
  })
}

export function exportFilename(date: Date = new Date()): string {
  return `dashboard-export-${date.toISOString().slice(0, 10)}.json`
}

/** Trigger a browser download of the payload as pretty JSON. */
export function downloadExport(payload: ExportPayload, filename: string): void {
  const blob = new Blob([JSON.stringify(payload, null, 2)], {
    type: 'application/json',
  })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  a.remove()
  URL.revokeObjectURL(url)
}
