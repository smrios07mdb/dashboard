/*
 * One Today read for the popover (chunk 91, D5): the Dashboard's own reads,
 * in the Dashboard's order — settings first for the zone, then the four
 * lists. `repo` falls back to its Dexie cache when the network is down and
 * says so through `syncStore`, which is what `offline` reports.
 */
import { repo } from '@/db/repo'
import { syncStore } from '@/db/syncStore'

import type { ScratchLists } from './scratchpad'
import { buildTodayView, type TodayView } from './todayView'

export type TodayLoad = {
  view: TodayView
  offline: boolean
  /** The same read's lists and zone, for the scratchpad (chunk 93). */
  lists: ScratchLists
}

export async function loadToday(
  userId: string,
  keep?: ReadonlySet<string>,
): Promise<TodayLoad> {
  const settings = await repo.settings.get(userId)
  const timeZone = settings?.timezone ?? 'America/New_York'
  const [categories, subcategories, tasks, marks] = await Promise.all([
    repo.categories.list(),
    repo.subcategories.list(),
    repo.tasks.list(),
    repo.todayMarks.list(),
  ])
  return {
    view: buildTodayView({
      categories,
      subcategories,
      tasks,
      marks,
      timeZone,
      keep,
    }),
    offline: syncStore.getState().state === 'offline',
    lists: {
      categories,
      subcategories: subcategories.filter((s) => s.archivedAt === null),
      timeZone,
    },
  }
}
