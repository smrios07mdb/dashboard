/*
 * Realtime subscription manager.
 *
 * Opens one channel per signed-in user, with a postgres_changes listener
 * for each user-scoped table. Inbound INSERT/UPDATE/DELETE events are
 * applied to the Dexie cache via the mappers so any reader sees fresh
 * data without a Supabase round trip.
 *
 * Lifecycle is driven by App.tsx (via the RealtimeBridge component):
 *   start on sign-in, stop on sign-out.
 *
 * `start` is idempotent — calling it twice with the same userId is a
 * no-op; with a different userId it tears down the old channel first.
 *
 * Realtime DOES NOT flow while offline (see ARCHITECTURE.md §6). The
 * repo's read path will reconcile cache against Supabase on the next
 * reconnect; this layer only handles the connected delta stream.
 */
import type { RealtimeChannel } from '@supabase/supabase-js'

import { supabase } from '@/lib/supabase'

import { db } from './dexie'
import {
  categoryFromRow,
  pushSubscriptionFromRow,
  routineItemFromRow,
  routineLogFromRow,
  settingsFromRow,
  subcategoryFromRow,
  taskFromRow,
  type CategoryRow,
  type PushSubscriptionRow,
  type RoutineItemRow,
  type RoutineLogRow,
  type SettingsRow,
  type SubcategoryRow,
  type TaskRow,
} from './mappers'

type PostgresChangePayload<Row> = {
  eventType: 'INSERT' | 'UPDATE' | 'DELETE'
  new: Row
  old: Partial<Row> & { id?: string; user_id?: string }
}

let channel: RealtimeChannel | null = null
let activeUserId: string | null = null

function makeHandler<Row extends { id?: string }>(args: {
  apply: (row: Row) => Promise<void>
  remove: (id: string) => Promise<void>
}) {
  return async (payload: PostgresChangePayload<Row>) => {
    try {
      if (payload.eventType === 'DELETE') {
        const id = payload.old?.id
        if (id) await args.remove(id)
        return
      }
      if (payload.new) await args.apply(payload.new)
    } catch (e) {
      // Don't let one bad event kill the subscription. Future chunks
      // can wire structured logging.
      console.error('Realtime handler failed', e)
    }
  }
}

const handlers = {
  categories: makeHandler<CategoryRow>({
    apply: async (row) => {
      await db.categories.put(categoryFromRow(row))
    },
    remove: async (id) => {
      await db.categories.delete(id)
    },
  }),
  subcategories: makeHandler<SubcategoryRow>({
    apply: async (row) => {
      await db.subcategories.put(subcategoryFromRow(row))
    },
    remove: async (id) => {
      await db.subcategories.delete(id)
    },
  }),
  tasks: makeHandler<TaskRow>({
    apply: async (row) => {
      await db.tasks.put(taskFromRow(row))
    },
    remove: async (id) => {
      await db.tasks.delete(id)
    },
  }),
  routine_items: makeHandler<RoutineItemRow>({
    apply: async (row) => {
      await db.routine_items.put(routineItemFromRow(row))
    },
    remove: async (id) => {
      await db.routine_items.delete(id)
    },
  }),
  routine_logs: makeHandler<RoutineLogRow>({
    apply: async (row) => {
      await db.routine_logs.put(routineLogFromRow(row))
    },
    remove: async (id) => {
      await db.routine_logs.delete(id)
    },
  }),
  push_subscriptions: makeHandler<PushSubscriptionRow>({
    apply: async (row) => {
      await db.push_subscriptions.put(pushSubscriptionFromRow(row))
    },
    remove: async (id) => {
      await db.push_subscriptions.delete(id)
    },
  }),
}

/** Settings is keyed by user_id — handler uses the same as PK. */
async function settingsHandler(
  payload: PostgresChangePayload<SettingsRow>,
): Promise<void> {
  try {
    if (payload.eventType === 'DELETE') {
      const userId = payload.old?.user_id
      if (userId) await db.settings.delete(userId)
      return
    }
    if (payload.new) await db.settings.put(settingsFromRow(payload.new))
  } catch (e) {
    console.error('Realtime settings handler failed', e)
  }
}

export function startRealtime(userId: string): void {
  if (activeUserId === userId && channel) return
  if (channel) stopRealtime()

  activeUserId = userId
  const filter = `user_id=eq.${userId}`

  channel = supabase
    .channel(`user-${userId}`)
    .on(
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      'postgres_changes' as any,
      { event: '*', schema: 'public', table: 'categories', filter },
      handlers.categories,
    )
    .on(
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      'postgres_changes' as any,
      { event: '*', schema: 'public', table: 'subcategories', filter },
      handlers.subcategories,
    )
    .on(
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      'postgres_changes' as any,
      { event: '*', schema: 'public', table: 'tasks', filter },
      handlers.tasks,
    )
    .on(
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      'postgres_changes' as any,
      { event: '*', schema: 'public', table: 'routine_items', filter },
      handlers.routine_items,
    )
    .on(
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      'postgres_changes' as any,
      { event: '*', schema: 'public', table: 'routine_logs', filter },
      handlers.routine_logs,
    )
    .on(
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      'postgres_changes' as any,
      { event: '*', schema: 'public', table: 'settings', filter },
      settingsHandler,
    )
    .on(
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      'postgres_changes' as any,
      { event: '*', schema: 'public', table: 'push_subscriptions', filter },
      handlers.push_subscriptions,
    )
    .subscribe()
}

export function stopRealtime(): void {
  if (channel) {
    void supabase.removeChannel(channel)
    channel = null
  }
  activeUserId = null
}
