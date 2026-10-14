import { supabase } from '@/lib/supabase'

import { db } from './dexie'
import { TABLES, type TableName } from './types'

/*
 * The archived purge behind `repo.data.archivedCounts` / `purgeArchived`
 * (chunk 86, D5). Its own module so it loads on first use instead of riding
 * in the eager repo chunk. The repo methods own the offline guard and the
 * sync stamp; `check` is the repo's `throwIfClientError`.
 */

type Check = (error: { message?: string; status?: number; code?: string } | null) => void

const IN_BATCH = 100

/** Ids of this user's archived rows in `table` (RLS-scoped). */
async function archivedIds(table: TableName, check: Check): Promise<string[]> {
  const { data, error } = await supabase
    .from(table)
    .select('id')
    .not('archived_at', 'is', null)
  check(error)
  return ((data ?? []) as { id: string }[]).map((r) => r.id)
}

/** Which of `subIds` a row of `table` (tasks / notes) points at. */
async function referencedSubIds(
  table: TableName,
  subIds: string[],
  check: Check,
): Promise<Set<string>> {
  const found = new Set<string>()
  for (let i = 0; i < subIds.length; i += IN_BATCH) {
    const { data, error } = await supabase
      .from(table)
      .select('subcategory_id')
      .in('subcategory_id', subIds.slice(i, i + IN_BATCH))
    check(error)
    for (const row of (data ?? []) as { subcategory_id: string | null }[]) {
      if (row.subcategory_id) found.add(row.subcategory_id)
    }
  }
  return found
}

/**
 * What a purge would delete, read from the server now: every archived routine
 * item, and the archived lists no task (any state) and no note points at.
 * Lists that hold tasks or notes are kept — `tasks.subcategory_id` is
 * `on delete restrict`, and the Recovered card and detached-note memos read
 * them.
 */
async function archivedPlan(check: Check) {
  const routineItemIds = await archivedIds(TABLES.routineItems, check)
  const subIds = await archivedIds(TABLES.subcategories, check)
  const withTasks = await referencedSubIds(TABLES.tasks, subIds, check)
  const withNotes = await referencedSubIds(TABLES.notes, subIds, check)
  const kept = (id: string) => withTasks.has(id) || withNotes.has(id)
  return {
    routineItemIds,
    deletableSubIds: subIds.filter((id) => !kept(id)),
    keptSubIds: subIds.filter(kept),
  }
}

/** Hard-delete `ids` from `table` in batches; returns how many went. */
async function deleteIds(
  table: TableName,
  ids: string[],
  check: Check,
): Promise<number> {
  let n = 0
  for (let i = 0; i < ids.length; i += IN_BATCH) {
    const { data, error } = await supabase
      .from(table)
      .delete()
      .in('id', ids.slice(i, i + IN_BATCH))
      .select('id')
    check(error)
    n += ((data ?? []) as { id: string }[]).length
  }
  return n
}

export async function archivedCounts(check: Check) {
  const plan = await archivedPlan(check)
  return {
    routineItems: plan.routineItemIds.length,
    lists: plan.deletableSubIds.length,
    listsKept: plan.keptSubIds.length,
  }
}

export async function purgeArchived(check: Check) {
  const plan = await archivedPlan(check)
  const routineItems = await deleteIds(
    TABLES.routineItems,
    plan.routineItemIds,
    check,
  )
  const lists = await deleteIds(TABLES.subcategories, plan.deletableSubIds, check)
  await db.transaction(
    'rw',
    [db.routine_items, db.routine_logs, db.subcategories],
    async () => {
      await db.routine_items.bulkDelete(plan.routineItemIds)
      await db.routine_logs
        .where('routineItemId')
        .anyOf(plan.routineItemIds)
        .delete()
      await db.subcategories.bulkDelete(plan.deletableSubIds)
    },
  )
  return { routineItems, lists }
}
