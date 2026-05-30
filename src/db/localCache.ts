import { db } from './dexie'

/**
 * Wipe local cache (chunk 16, R3 — the SAFE wipe).
 *
 * Clears the Dexie cache MIRROR stores only. Deliberately does NOT:
 *  - touch Supabase (server is the source of truth; cache rebuilds on next read),
 *  - clear the outbox (un-synced offline edits must still drain).
 *
 * This is distinct from chunk-15 "Wipe my data" (destructive, deletes Supabase
 * + clears the outbox). Never conflate them.
 */
export async function wipeLocalCache(): Promise<void> {
  await db.transaction(
    'rw',
    [
      db.categories,
      db.subcategories,
      db.tasks,
      db.routine_items,
      db.routine_logs,
      db.settings,
      db.push_subscriptions,
      db.busyCache,
    ],
    async () => {
      await db.categories.clear()
      await db.subcategories.clear()
      await db.tasks.clear()
      await db.routine_items.clear()
      await db.routine_logs.clear()
      await db.settings.clear()
      await db.push_subscriptions.clear()
      await db.busyCache.clear()
    },
  )
  // NOTE: db.outbox is intentionally NOT cleared here.
}
