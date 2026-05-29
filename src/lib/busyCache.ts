import { db } from '@/db/dexie'
import type { BusyRange } from '@/db/types'
import { getBusy } from '@/lib/calendarApi'
import { dateKeyDaysAgo, startOfDayIso } from '@/lib/clock'

/*
 * Busy-range cache (ARCHITECTURE.md §7: busy ranges are "cached 5min
 * client-side"). One Dexie row per local day, keyed by dateKey. The proxy call
 * is the unit of fetching — one local day per request — so the cache key and
 * the post-createEvent bust key (resolution 5) line up exactly.
 */

const TTL_MS = 5 * 60 * 1000

/**
 * A local day's busy ranges, cache-first (5-min TTL). On miss or stale entry,
 * fetches that single day in `timezone` and caches it. Propagates
 * `CalendarError` (including `'auth_failed'`) from the underlying proxy call so
 * the caller can flip to the reconnect banner.
 */
export async function getBusyDay(
  dateKey: string,
  timezone: string,
): Promise<BusyRange[]> {
  const cached = await db.busyCache.get(dateKey)
  if (cached && Date.now() - cached.fetchedAt < TTL_MS) {
    return cached.ranges
  }
  // Day boundaries are computed in the user's timezone (resolution 6): from
  // local midnight of `dateKey` to local midnight of the next day.
  const from = startOfDayIso(dateKey, timezone)
  const to = startOfDayIso(dateKeyDaysAgo(dateKey, -1), timezone)
  const ranges = await getBusy({ from, to })
  await db.busyCache.put({ dateKey, ranges, fetchedAt: Date.now() })
  return ranges
}

/**
 * Drop cached busy ranges for the given local days so the next read refetches.
 * Called right after a successful createEvent so a just-booked block can't be
 * double-booked from a still-warm 5-min cache (resolution 5).
 */
export async function bustBusyDays(dateKeys: string[]): Promise<void> {
  if (dateKeys.length === 0) return
  await db.busyCache.bulkDelete(dateKeys)
}
