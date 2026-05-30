/*
 * Typed CRUD repo for the data model.
 *
 * Wraps the Supabase client with a Dexie cache layer. See ARCHITECTURE.md
 * §6 for the canonical sync model.
 *
 * Read pattern  — try Supabase → mirror to cache → return; on network
 *                 failure, return cache.
 * Write pattern — online: write to Supabase + mirror to cache;
 *                 offline (or network/5xx failure): apply to cache +
 *                 enqueue in outbox; sync state flips to 'offline'.
 *
 * 4xx errors propagate as thrown Errors. 5xx and network errors fall
 * through to the offline path so the user's change isn't lost — chunk
 * 15's replay engine will retry them on reconnect.
 */
import { supabase } from '@/lib/supabase'
import { isOnline } from '@/lib/network'

import { db } from './dexie'
import {
  categoryFromRow,
  pushSubscriptionFromRow,
  pushSubscriptionToRow,
  routineItemFromRow,
  routineItemToRow,
  routineLogFromRow,
  routineLogToRow,
  settingsFromRow,
  settingsToRow,
  subcategoryFromRow,
  subcategoryToRow,
  taskFromRow,
  taskToRow,
  type CategoryRow,
  type PushSubscriptionRow,
  type RoutineItemRow,
  type RoutineLogRow,
  type SettingsRow,
  type SubcategoryRow,
  type TaskRow,
} from './mappers'
import { syncStore } from './syncStore'
import {
  TABLES,
  type Category,
  type OutboxOp,
  type OutboxRow,
  type PushSubscription,
  type RoutineItem,
  type RoutineLog,
  type Settings,
  type Subcategory,
  type TableName,
  type Task,
} from './types'

// ---------- error & offline helpers ----------

type SupabaseError = {
  message?: string
  status?: number
  code?: string
}

function isClientError(e: unknown): boolean {
  const status = (e as { status?: number } | null)?.status
  return typeof status === 'number' && status >= 400 && status < 500
}

function throwIfClientError(error: SupabaseError | null) {
  if (!error) return
  const err = new Error(
    error.message || 'Supabase request failed',
  ) as Error & { status?: number; code?: string }
  err.status = error.status
  err.code = error.code
  throw err
}

function markSyncedNow() {
  const s = syncStore.getState()
  if (s.state === 'syncing' || s.state === 'synced') {
    s.setState('synced')
  }
  s.setLastSyncAt(new Date().toISOString())
}

function markOffline() {
  syncStore.getState().setState('offline')
}

async function enqueueOutbox(
  op: OutboxOp,
  table: TableName,
  payload: unknown,
): Promise<void> {
  const row: OutboxRow = {
    op,
    table,
    payload,
    createdAt: new Date().toISOString(),
    attempts: 0,
    lastError: null,
    lastAttemptAt: null,
  }
  await db.outbox.add(row)
}

/**
 * Run an online read. On 4xx, re-throw. On network / 5xx, return the
 * cache snapshot via `fallback`. Caller is responsible for mirroring
 * successful results into the cache themselves (each table differs).
 */
async function readWithFallback<T>(args: {
  online: () => Promise<T>
  fallback: () => Promise<T> | T
}): Promise<T> {
  if (!isOnline()) {
    markOffline()
    return args.fallback()
  }
  try {
    const result = await args.online()
    markSyncedNow()
    return result
  } catch (e) {
    if (isClientError(e)) throw e
    markOffline()
    return args.fallback()
  }
}

// ---------- categories ----------
// Categories are seeded by the signup trigger and not user-editable, so
// only `list` and a name lookup are exposed.

const categoriesRepo = {
  async list(): Promise<Category[]> {
    return readWithFallback({
      online: async () => {
        const { data, error } = await supabase
          .from('categories')
          .select('*')
          .order('name', { ascending: true })
        throwIfClientError(error)
        const rows = (data ?? []) as CategoryRow[]
        const mapped = rows.map(categoryFromRow)
        await db.transaction('rw', db.categories, async () => {
          await db.categories.clear()
          await db.categories.bulkPut(mapped)
        })
        return mapped
      },
      fallback: async () => db.categories.orderBy('name').toArray(),
    })
  },
  async getByName(name: 'Work' | 'Personal'): Promise<Category | null> {
    const all = await categoriesRepo.list()
    return all.find((c) => c.name === name) ?? null
  },
}

// ---------- subcategories ----------

const subcategoriesRepo = {
  async list(): Promise<Subcategory[]> {
    return readWithFallback({
      online: async () => {
        const { data, error } = await supabase
          .from('subcategories')
          .select('*')
          .order('sort_order', { ascending: true })
        throwIfClientError(error)
        const rows = (data ?? []) as SubcategoryRow[]
        const mapped = rows.map(subcategoryFromRow)
        await db.transaction('rw', db.subcategories, async () => {
          await db.subcategories.clear()
          await db.subcategories.bulkPut(mapped)
        })
        return mapped
      },
      fallback: async () => db.subcategories.orderBy('sortOrder').toArray(),
    })
  },

  async listByCategory(categoryId: string): Promise<Subcategory[]> {
    return readWithFallback({
      online: async () => {
        const { data, error } = await supabase
          .from('subcategories')
          .select('*')
          .eq('category_id', categoryId)
          .order('sort_order', { ascending: true })
        throwIfClientError(error)
        const rows = (data ?? []) as SubcategoryRow[]
        const mapped = rows.map(subcategoryFromRow)
        await db.transaction('rw', db.subcategories, async () => {
          await db.subcategories
            .where('categoryId')
            .equals(categoryId)
            .delete()
          await db.subcategories.bulkPut(mapped)
        })
        return mapped
      },
      fallback: async () =>
        db.subcategories
          .where('categoryId')
          .equals(categoryId)
          .sortBy('sortOrder'),
    })
  },

  async create(
    input: Omit<Subcategory, 'id' | 'archivedAt'> & {
      id?: string
      archivedAt?: string | null
    },
  ): Promise<Subcategory> {
    const full: Subcategory = {
      id: input.id ?? crypto.randomUUID(),
      userId: input.userId,
      categoryId: input.categoryId,
      name: input.name,
      sortOrder: input.sortOrder,
      archivedAt: input.archivedAt ?? null,
    }
    return writeRow({
      op: 'insert',
      table: TABLES.subcategories,
      optimistic: full,
      cacheApply: async () => {
        await db.subcategories.put(full)
      },
      online: async () => {
        const { data, error } = await supabase
          .from('subcategories')
          .insert(subcategoryToRow(full))
          .select()
          .single()
        throwIfClientError(error)
        return subcategoryFromRow(data as SubcategoryRow)
      },
    })
  },

  async update(
    id: string,
    changes: Partial<Omit<Subcategory, 'id' | 'userId'>>,
  ): Promise<Subcategory> {
    const existing = await db.subcategories.get(id)
    const next: Subcategory = {
      ...(existing as Subcategory),
      ...changes,
      id,
    }
    return writeRow({
      op: 'update',
      table: TABLES.subcategories,
      optimistic: next,
      cacheApply: async () => {
        await db.subcategories.put(next)
      },
      online: async () => {
        const { data, error } = await supabase
          .from('subcategories')
          .update(subcategoryToRow(changes))
          .eq('id', id)
          .select()
          .single()
        throwIfClientError(error)
        return subcategoryFromRow(data as SubcategoryRow)
      },
    })
  },

  async archive(id: string): Promise<Subcategory> {
    return subcategoriesRepo.update(id, {
      archivedAt: new Date().toISOString(),
    })
  },

  async reorder(orders: { id: string; sortOrder: number }[]): Promise<void> {
    // Reorder is multiple updates — for the offline path each one
    // becomes its own outbox row, so replay applies them independently.
    for (const o of orders) {
      await subcategoriesRepo.update(o.id, { sortOrder: o.sortOrder })
    }
  },
}

// ---------- tasks ----------

const tasksRepo = {
  async list(): Promise<Task[]> {
    return readWithFallback({
      online: async () => {
        const { data, error } = await supabase
          .from('tasks')
          .select('*')
          .order('updated_at', { ascending: false })
        throwIfClientError(error)
        const rows = (data ?? []) as TaskRow[]
        const mapped = rows.map(taskFromRow)
        await db.transaction('rw', db.tasks, async () => {
          await db.tasks.clear()
          await db.tasks.bulkPut(mapped)
        })
        return mapped
      },
      fallback: async () =>
        db.tasks.orderBy('updatedAt').reverse().toArray(),
    })
  },

  async listBySubcategory(subcategoryId: string): Promise<Task[]> {
    return readWithFallback({
      online: async () => {
        const { data, error } = await supabase
          .from('tasks')
          .select('*')
          .eq('subcategory_id', subcategoryId)
        throwIfClientError(error)
        const rows = (data ?? []) as TaskRow[]
        const mapped = rows.map(taskFromRow)
        await db.transaction('rw', db.tasks, async () => {
          await db.tasks
            .where('subcategoryId')
            .equals(subcategoryId)
            .delete()
          await db.tasks.bulkPut(mapped)
        })
        return mapped
      },
      fallback: async () =>
        db.tasks.where('subcategoryId').equals(subcategoryId).toArray(),
    })
  },

  async listIncomplete(): Promise<Task[]> {
    return readWithFallback({
      online: async () => {
        const { data, error } = await supabase
          .from('tasks')
          .select('*')
          .is('completed_at', null)
        throwIfClientError(error)
        const rows = (data ?? []) as TaskRow[]
        const mapped = rows.map(taskFromRow)
        // Mirror — we only know about incomplete here; don't blow away
        // completed cache entries. Per-row upsert is the safe move.
        await db.tasks.bulkPut(mapped)
        return mapped
      },
      fallback: async () =>
        db.tasks
          .filter((t) => t.completedAt === null)
          .toArray(),
    })
  },

  /**
   * Completed tasks whose `completed_at` falls in [from, to) — the Insights
   * read (chunk 16, additive). Cache-first per the chunk-5 pattern. Uses
   * `completed_at`, NOT `created_at`.
   */
  async listCompletedInRange(from: string, to: string): Promise<Task[]> {
    return readWithFallback({
      online: async () => {
        const { data, error } = await supabase
          .from('tasks')
          .select('*')
          .gte('completed_at', from)
          .lt('completed_at', to)
          .order('completed_at', { ascending: true })
        throwIfClientError(error)
        const rows = (data ?? []) as TaskRow[]
        const mapped = rows.map(taskFromRow)
        await db.tasks.bulkPut(mapped)
        return mapped
      },
      fallback: async () =>
        db.tasks
          .filter(
            (t) =>
              t.completedAt !== null &&
              t.completedAt >= from &&
              t.completedAt < to,
          )
          .toArray(),
    })
  },

  async create(
    input: Omit<Task, 'id' | 'notified' | 'createdAt' | 'updatedAt'> & {
      id?: string
      notified?: boolean
    },
  ): Promise<Task> {
    const now = new Date().toISOString()
    const full: Task = {
      id: input.id ?? crypto.randomUUID(),
      userId: input.userId,
      subcategoryId: input.subcategoryId,
      title: input.title,
      notes: input.notes,
      estimateMinutes: input.estimateMinutes,
      dueAt: input.dueAt,
      remindAt: input.remindAt,
      notified: input.notified ?? false,
      priority: input.priority,
      completedAt: input.completedAt,
      createdAt: now,
      updatedAt: now,
    }
    return writeRow({
      op: 'insert',
      table: TABLES.tasks,
      optimistic: full,
      cacheApply: async () => {
        await db.tasks.put(full)
      },
      online: async () => {
        const { data, error } = await supabase
          .from('tasks')
          .insert(taskToRow(full))
          .select()
          .single()
        throwIfClientError(error)
        return taskFromRow(data as TaskRow)
      },
    })
  },

  async update(
    id: string,
    changes: Partial<Omit<Task, 'id' | 'userId' | 'createdAt'>>,
  ): Promise<Task> {
    const existing = await db.tasks.get(id)
    const next: Task = {
      ...(existing as Task),
      ...changes,
      id,
      updatedAt: new Date().toISOString(),
    }
    return writeRow({
      op: 'update',
      table: TABLES.tasks,
      optimistic: next,
      cacheApply: async () => {
        await db.tasks.put(next)
      },
      online: async () => {
        // Always stamp updated_at server-side too, so it stays in sync.
        const { data, error } = await supabase
          .from('tasks')
          .update(taskToRow({ ...changes, updatedAt: next.updatedAt }))
          .eq('id', id)
          .select()
          .single()
        throwIfClientError(error)
        return taskFromRow(data as TaskRow)
      },
    })
  },

  async delete(id: string): Promise<void> {
    if (!isOnline()) {
      markOffline()
      await db.tasks.delete(id)
      await enqueueOutbox('delete', TABLES.tasks, { id })
      return
    }
    try {
      const { error } = await supabase.from('tasks').delete().eq('id', id)
      throwIfClientError(error)
      await db.tasks.delete(id)
      markSyncedNow()
    } catch (e) {
      if (isClientError(e)) throw e
      markOffline()
      await db.tasks.delete(id)
      await enqueueOutbox('delete', TABLES.tasks, { id })
    }
  },

  async markComplete(id: string, completed = true): Promise<Task> {
    return tasksRepo.update(id, {
      completedAt: completed ? new Date().toISOString() : null,
    })
  },

  /**
   * Apply a list of (id, patch) updates. Online path groups by patch
   * shape so the common case (chunk-8's move-N-tasks-to-the-same-sub
   * and merge) lands in one Supabase round-trip per unique patch.
   * Offline path enqueues per-row outbox entries — chunk-15's drain
   * applies them independently.
   */
  async bulkUpdate(
    updates: {
      id: string
      patch: Partial<Omit<Task, 'id' | 'userId' | 'createdAt'>>
    }[],
  ): Promise<Task[]> {
    if (updates.length === 0) return []
    const now = new Date().toISOString()

    if (!isOnline()) {
      markOffline()
      const results: Task[] = []
      for (const u of updates) {
        const existing = await db.tasks.get(u.id)
        if (!existing) continue
        const next: Task = {
          ...existing,
          ...u.patch,
          id: u.id,
          updatedAt: now,
        }
        await db.tasks.put(next)
        await enqueueOutbox('update', TABLES.tasks, next)
        results.push(next)
      }
      return results
    }

    try {
      // Group by serialized patch so identical patches share one query.
      const groups = new Map<string, { patch: Partial<Task>; ids: string[] }>()
      for (const u of updates) {
        const key = JSON.stringify(u.patch)
        let g = groups.get(key)
        if (!g) {
          g = { patch: u.patch, ids: [] }
          groups.set(key, g)
        }
        g.ids.push(u.id)
      }
      const results: Task[] = []
      for (const g of groups.values()) {
        const { data, error } = await supabase
          .from('tasks')
          .update(taskToRow({ ...g.patch, updatedAt: now }))
          .in('id', g.ids)
          .select()
        throwIfClientError(error)
        const rows = ((data ?? []) as TaskRow[]).map(taskFromRow)
        for (const r of rows) {
          await db.tasks.put(r)
          results.push(r)
        }
      }
      markSyncedNow()
      return results
    } catch (e) {
      if (isClientError(e)) throw e
      markOffline()
      const results: Task[] = []
      for (const u of updates) {
        const existing = await db.tasks.get(u.id)
        if (!existing) continue
        const next: Task = {
          ...existing,
          ...u.patch,
          id: u.id,
          updatedAt: now,
        }
        await db.tasks.put(next)
        await enqueueOutbox('update', TABLES.tasks, next)
        results.push(next)
      }
      return results
    }
  },

  /**
   * Hard-delete tasks by id. Online path batches into one `.in()` query;
   * offline path enqueues a delete outbox entry per row.
   */
  async bulkDelete(ids: string[]): Promise<void> {
    if (ids.length === 0) return

    if (!isOnline()) {
      markOffline()
      await db.tasks.bulkDelete(ids)
      for (const id of ids) {
        await enqueueOutbox('delete', TABLES.tasks, { id })
      }
      return
    }
    try {
      const { error } = await supabase.from('tasks').delete().in('id', ids)
      throwIfClientError(error)
      await db.tasks.bulkDelete(ids)
      markSyncedNow()
    } catch (e) {
      if (isClientError(e)) throw e
      markOffline()
      await db.tasks.bulkDelete(ids)
      for (const id of ids) {
        await enqueueOutbox('delete', TABLES.tasks, { id })
      }
    }
  },

  /**
   * Claim this user's due reminders via the `claim_due_reminders()` RPC — a
   * conditional UPDATE (notified false -> true) that returns only the rows it
   * won. This is the client half of the race-safe exactly-once design (ARCH
   * §9): mutually exclusive with the Edge Function's per-row claim, so a
   * reminder is never delivered twice.
   *
   * Online-only and best-effort by design: claiming requires the server (no
   * offline claim exists), and this runs on a 60s background poll, so any
   * failure returns `[]` and the next tick retries — it deliberately does NOT
   * throw on 4xx or flip the sync indicator the way user-initiated writes do.
   * Claimed rows are mirrored to the Dexie cache as notified so a local read
   * doesn't re-surface them before the realtime echo arrives.
   */
  async claimDueReminders(): Promise<{ id: string; title: string }[]> {
    if (!isOnline()) return []
    try {
      const { data, error } = await supabase.rpc('claim_due_reminders')
      if (error) return []
      const rows = (data ?? []) as { id: string; title: string }[]
      for (const r of rows) {
        const existing = await db.tasks.get(r.id)
        if (existing) await db.tasks.put({ ...existing, notified: true })
      }
      return rows
    } catch {
      return []
    }
  },
}

// ---------- routine_items ----------

const routineItemsRepo = {
  async list(): Promise<RoutineItem[]> {
    return readWithFallback({
      online: async () => {
        const { data, error } = await supabase
          .from('routine_items')
          .select('*')
          .order('sort_order', { ascending: true })
        throwIfClientError(error)
        const rows = (data ?? []) as RoutineItemRow[]
        const mapped = rows.map(routineItemFromRow)
        await db.transaction('rw', db.routine_items, async () => {
          await db.routine_items.clear()
          await db.routine_items.bulkPut(mapped)
        })
        return mapped
      },
      fallback: async () => db.routine_items.orderBy('sortOrder').toArray(),
    })
  },

  async listByRoutine(routine: 'morning' | 'night'): Promise<RoutineItem[]> {
    return readWithFallback({
      online: async () => {
        const { data, error } = await supabase
          .from('routine_items')
          .select('*')
          .eq('routine', routine)
          .order('sort_order', { ascending: true })
        throwIfClientError(error)
        const rows = (data ?? []) as RoutineItemRow[]
        const mapped = rows.map(routineItemFromRow)
        await db.transaction('rw', db.routine_items, async () => {
          await db.routine_items.where('routine').equals(routine).delete()
          await db.routine_items.bulkPut(mapped)
        })
        return mapped
      },
      fallback: async () =>
        db.routine_items
          .where('routine')
          .equals(routine)
          .sortBy('sortOrder'),
    })
  },

  async create(
    input: Omit<RoutineItem, 'id' | 'createdAt' | 'archivedAt'> & {
      id?: string
      createdAt?: string
      archivedAt?: string | null
    },
  ): Promise<RoutineItem> {
    const full: RoutineItem = {
      id: input.id ?? crypto.randomUUID(),
      userId: input.userId,
      routine: input.routine,
      label: input.label,
      sortOrder: input.sortOrder,
      archivedAt: input.archivedAt ?? null,
      createdAt: input.createdAt ?? new Date().toISOString(),
    }
    return writeRow({
      op: 'insert',
      table: TABLES.routineItems,
      optimistic: full,
      cacheApply: async () => {
        await db.routine_items.put(full)
      },
      online: async () => {
        const { data, error } = await supabase
          .from('routine_items')
          .insert(routineItemToRow(full))
          .select()
          .single()
        throwIfClientError(error)
        return routineItemFromRow(data as RoutineItemRow)
      },
    })
  },

  async update(
    id: string,
    changes: Partial<Omit<RoutineItem, 'id' | 'userId' | 'createdAt'>>,
  ): Promise<RoutineItem> {
    const existing = await db.routine_items.get(id)
    const next: RoutineItem = { ...(existing as RoutineItem), ...changes, id }
    return writeRow({
      op: 'update',
      table: TABLES.routineItems,
      optimistic: next,
      cacheApply: async () => {
        await db.routine_items.put(next)
      },
      online: async () => {
        const { data, error } = await supabase
          .from('routine_items')
          .update(routineItemToRow(changes))
          .eq('id', id)
          .select()
          .single()
        throwIfClientError(error)
        return routineItemFromRow(data as RoutineItemRow)
      },
    })
  },

  async archive(id: string): Promise<RoutineItem> {
    return routineItemsRepo.update(id, {
      archivedAt: new Date().toISOString(),
    })
  },

  async reorder(orders: { id: string; sortOrder: number }[]): Promise<void> {
    for (const o of orders) {
      await routineItemsRepo.update(o.id, { sortOrder: o.sortOrder })
    }
  },
}

// ---------- routine_logs ----------

const routineLogsRepo = {
  async listByRange(fromDateKey: string, toDateKey: string): Promise<RoutineLog[]> {
    return readWithFallback({
      online: async () => {
        const { data, error } = await supabase
          .from('routine_logs')
          .select('*')
          .gte('date_key', fromDateKey)
          .lte('date_key', toDateKey)
        throwIfClientError(error)
        const rows = (data ?? []) as RoutineLogRow[]
        const mapped = rows.map(routineLogFromRow)
        await db.transaction('rw', db.routine_logs, async () => {
          await db.routine_logs
            .where('dateKey')
            .between(fromDateKey, toDateKey, true, true)
            .delete()
          await db.routine_logs.bulkPut(mapped)
        })
        return mapped
      },
      fallback: async () =>
        db.routine_logs
          .where('dateKey')
          .between(fromDateKey, toDateKey, true, true)
          .toArray(),
    })
  },

  /**
   * Toggle a routine item's log for a given date. Inserts if missing,
   * flips `completed` if present. Unique (user_id, routine_item_id,
   * date_key) means we can safely upsert.
   *
   * Wrapped in try/catch + re-throw so call sites (notably the
   * sample-data seeder loop) can wrap each call with their own
   * per-call try/catch and record failures, and so future diagnostic
   * work has a single hook to plug logging back in without
   * restructuring. The catch is intentionally a pure passthrough.
   * Kept per the Revisions chunk-5 silent-drop investigation (2026-
   * 05-27) — see PROGRESS.md.
   */
  async toggle(args: {
    userId: string
    routineItemId: string
    dateKey: string
    completed: boolean
  }): Promise<RoutineLog> {
    try {
      const existing = await db.routine_logs
        .where('[routineItemId+dateKey]')
        .equals([args.routineItemId, args.dateKey])
        .first()
      const full: RoutineLog = {
        id: existing?.id ?? crypto.randomUUID(),
        userId: args.userId,
        routineItemId: args.routineItemId,
        dateKey: args.dateKey,
        completed: args.completed,
      }
      return await writeRow({
        op: existing ? 'update' : 'insert',
        table: TABLES.routineLogs,
        optimistic: full,
        cacheApply: async () => {
          await db.routine_logs.put(full)
        },
        online: async () => {
          const { data, error } = await supabase
            .from('routine_logs')
            .upsert(routineLogToRow(full), {
              onConflict: 'user_id,routine_item_id,date_key',
            })
            .select()
            .single()
          throwIfClientError(error)
          return routineLogFromRow(data as RoutineLogRow)
        },
      })
    } catch (err) {
      throw err
    }
  },

  /**
   * Developer-only bulk reset: delete every routine_log for `userId` from
   * Supabase and clear the Dexie mirror. Used by Settings → Developer →
   * "Reset routine logs" so the smoke harness can establish a known-empty
   * streak baseline without changing prod UX (Wipe my data preserves
   * routine_logs by design — see PROGRESS.md Revisions 2026-05-27).
   *
   * Destructive bulk op: online-only, no outbox enqueue. If offline, the
   * method throws and nothing is touched — the caller surfaces the error.
   * Mirrors the chunk-5 write-path convention that bulk destructive
   * operations don't fan out across the offline outbox.
   *
   * Returns the number of rows deleted server-side.
   */
  async deleteAllForUser(userId: string): Promise<number> {
    if (!isOnline()) {
      throw new Error('Reset requires an online connection')
    }
    const { data, error } = await supabase
      .from('routine_logs')
      .delete()
      .eq('user_id', userId)
      .select('id')
    throwIfClientError(error as SupabaseError | null)
    // Cache is per-device — no user_id column in Dexie, see ARCH §6.
    await db.routine_logs.clear()
    markSyncedNow()
    return (data as { id: string }[] | null)?.length ?? 0
  },
}

// ---------- settings ----------

const settingsRepo = {
  async get(userId: string): Promise<Settings | null> {
    return readWithFallback({
      online: async () => {
        const { data, error } = await supabase
          .from('settings')
          .select('*')
          .eq('user_id', userId)
          .maybeSingle()
        throwIfClientError(error)
        if (!data) return null
        const mapped = settingsFromRow(data as SettingsRow)
        await db.settings.put(mapped)
        return mapped
      },
      fallback: async () => {
        const cached = await db.settings.get(userId)
        return cached ?? null
      },
    })
  },

  async update(
    userId: string,
    changes: Partial<Omit<Settings, 'userId'>>,
  ): Promise<Settings> {
    const existing = await db.settings.get(userId)
    const base: Settings = existing ?? {
      userId,
      aiApiKey: null,
      caldavAppleId: null,
      caldavCalendarUrl: null,
      caldavStatus: 'unconfigured',
      timezone: 'America/New_York',
      lastDailyReset: null,
    }
    const next: Settings = { ...base, ...changes, userId }
    return writeRow({
      op: 'update',
      table: TABLES.settings,
      optimistic: next,
      cacheApply: async () => {
        await db.settings.put(next)
      },
      online: async () => {
        const { data, error } = await supabase
          .from('settings')
          .update(settingsToRow(changes))
          .eq('user_id', userId)
          .select()
          .single()
        throwIfClientError(error)
        return settingsFromRow(data as SettingsRow)
      },
    })
  },
}

// ---------- push_subscriptions ----------

const pushSubscriptionsRepo = {
  async listMine(userId: string): Promise<PushSubscription[]> {
    return readWithFallback({
      online: async () => {
        const { data, error } = await supabase
          .from('push_subscriptions')
          .select('*')
          .eq('user_id', userId)
        throwIfClientError(error)
        const rows = (data ?? []) as PushSubscriptionRow[]
        const mapped = rows.map(pushSubscriptionFromRow)
        await db.transaction('rw', db.push_subscriptions, async () => {
          await db.push_subscriptions.clear()
          await db.push_subscriptions.bulkPut(mapped)
        })
        return mapped
      },
      fallback: async () => db.push_subscriptions.toArray(),
    })
  },

  async add(
    input: Omit<PushSubscription, 'id' | 'createdAt'> & {
      id?: string
      createdAt?: string
    },
  ): Promise<PushSubscription> {
    const full: PushSubscription = {
      id: input.id ?? crypto.randomUUID(),
      userId: input.userId,
      endpoint: input.endpoint,
      p256dh: input.p256dh,
      auth: input.auth,
      createdAt: input.createdAt ?? new Date().toISOString(),
    }
    return writeRow({
      op: 'insert',
      table: TABLES.pushSubscriptions,
      optimistic: full,
      cacheApply: async () => {
        await db.push_subscriptions.put(full)
      },
      online: async () => {
        const { data, error } = await supabase
          .from('push_subscriptions')
          .insert(pushSubscriptionToRow(full))
          .select()
          .single()
        throwIfClientError(error)
        return pushSubscriptionFromRow(data as PushSubscriptionRow)
      },
    })
  },

  async removeByEndpoint(endpoint: string): Promise<void> {
    if (!isOnline()) {
      markOffline()
      await db.push_subscriptions.where('endpoint').equals(endpoint).delete()
      await enqueueOutbox('delete', TABLES.pushSubscriptions, { endpoint })
      return
    }
    try {
      const { error } = await supabase
        .from('push_subscriptions')
        .delete()
        .eq('endpoint', endpoint)
      throwIfClientError(error)
      await db.push_subscriptions.where('endpoint').equals(endpoint).delete()
      markSyncedNow()
    } catch (e) {
      if (isClientError(e)) throw e
      markOffline()
      await db.push_subscriptions.where('endpoint').equals(endpoint).delete()
      await enqueueOutbox('delete', TABLES.pushSubscriptions, { endpoint })
    }
  },
}

// ---------- shared write engine ----------

async function writeRow<T>(args: {
  op: OutboxOp
  table: TableName
  optimistic: T
  cacheApply: () => Promise<void>
  online: () => Promise<T>
}): Promise<T> {
  if (!isOnline()) {
    markOffline()
    await args.cacheApply()
    await enqueueOutbox(args.op, args.table, args.optimistic)
    return args.optimistic
  }
  try {
    const result = await args.online()
    // Cache the server's truth (might differ from optimistic on update_at, etc).
    await args.cacheApply()
    // Re-cache with the canonical server response if it differs.
    // (cacheApply already wrote the optimistic; the realtime echo will
    // upsert the server row shortly. For now, write what we got back.)
    await applyServerEcho(args.table, result)
    markSyncedNow()
    return result
  } catch (e) {
    if (isClientError(e)) throw e
    markOffline()
    await args.cacheApply()
    await enqueueOutbox(args.op, args.table, args.optimistic)
    return args.optimistic
  }
}

/**
 * Mirror the server's returned row back into the cache. The optimistic
 * apply already wrote a row, but Supabase may have stamped `updated_at`
 * or filled defaults — this overwrites with the canonical version.
 */
async function applyServerEcho(table: TableName, row: unknown): Promise<void> {
  switch (table) {
    case TABLES.categories:
      await db.categories.put(row as Category)
      return
    case TABLES.subcategories:
      await db.subcategories.put(row as Subcategory)
      return
    case TABLES.tasks:
      await db.tasks.put(row as Task)
      return
    case TABLES.routineItems:
      await db.routine_items.put(row as RoutineItem)
      return
    case TABLES.routineLogs:
      await db.routine_logs.put(row as RoutineLog)
      return
    case TABLES.settings:
      await db.settings.put(row as Settings)
      return
    case TABLES.pushSubscriptions:
      await db.push_subscriptions.put(row as PushSubscription)
      return
  }
}

// ---------- bulk data import primitives (chunk 16) ----------
//
// Generic, raw-row helpers used by the export/import feature. Distinct from
// chunk-9's `tasks.bulkDelete(ids)` (do not overload that). These operate on
// snake_case rows + table names so a whole-account import round-trips exactly
// (including server-managed columns like created_at). Online-only — import is
// a deliberate, connected action; cache is reloaded from Supabase afterward.

const dataRepo = {
  /** Upsert raw rows into `table` (default conflict key `id`; `user_id` for settings). */
  async bulkUpsert(
    table: TableName,
    rows: Record<string, unknown>[],
    conflictKey = 'id',
  ): Promise<void> {
    if (rows.length === 0) return
    const { error } = await supabase
      .from(table)
      .upsert(rows, { onConflict: conflictKey })
    throwIfClientError(error as SupabaseError | null)
  },

  /** Hard-delete every row this user owns in `table` (Replace-import teardown). */
  async bulkDeleteAllForUser(table: TableName, userId: string): Promise<void> {
    const { error } = await supabase
      .from(table)
      .delete()
      .eq('user_id', userId)
    throwIfClientError(error as SupabaseError | null)
  },
}

// ---------- exported namespace ----------

export const repo = {
  data: dataRepo,
  categories: categoriesRepo,
  subcategories: subcategoriesRepo,
  tasks: tasksRepo,
  routineItems: routineItemsRepo,
  routineLogs: routineLogsRepo,
  settings: settingsRepo,
  pushSubscriptions: pushSubscriptionsRepo,
}
