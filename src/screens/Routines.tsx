import { useCallback, useEffect, useMemo, useState } from 'react'
import { toast } from 'sonner'

import RoutinePanel from '@/components/RoutinePanel'
import { repo } from '@/db/repo'
import type { RoutineItem, RoutineLog } from '@/db/types'
import { useSession } from '@/lib/auth'
import { dateKeyDaysAgo, today as clockToday } from '@/lib/clock'
import { useUIStore } from '@/state/uiStore'

/**
 * Routines screen — Morning + Night.
 *
 * Side-by-side at ≥768 px (Tailwind `md:`), stacked below. Per ARCH §11,
 * streak math reads `settings.timezone`; we load settings here, fall
 * back to the schema default if it isn't yet hydrated.
 *
 * Logs fetched cover the past 60 days to satisfy the streak lookback
 * window declared in `src/lib/streak.ts`. The 14-day dot grid trivially
 * fits inside that range. We pull `routineItems.list()` (not
 * `listByRoutine`) so a single fetch feeds both panels — the panels
 * each filter by `routine` themselves.
 *
 * Subscribes to `uiStore.dashboardRefreshKey` so cross-tab realtime
 * echoes and the Force-resync button propagate refetches uniformly
 * (chunk-7 precedent — same store key the Dashboard / drill-down
 * screens use).
 */

const SAVE_ERROR = 'Could not save — retry'
const STREAK_LOOKBACK_DAYS = 60

type ViewData = {
  items: RoutineItem[]
  logs: RoutineLog[]
  timezone: string
}

function useRoutinesData(userId: string | null) {
  const [data, setData] = useState<ViewData>({
    items: [],
    logs: [],
    timezone: 'America/New_York',
  })
  const [loading, setLoading] = useState(true)
  const dashboardRefreshKey = useUIStore((s) => s.dashboardRefreshKey)

  useEffect(() => {
    let cancelled = false
    // All setState calls live inside async function bodies / callbacks
    // so the React 19 set-state-in-effect lint rule stays satisfied.
    async function load() {
      if (!userId) {
        if (!cancelled) setLoading(false)
        return
      }
      // Bootstrap timezone first so the today-key the load uses matches
      // the user's setting. If settings aren't loaded yet we use the
      // schema default; the next refresh (after settings hydrate) will
      // correct it.
      const settings = await repo.settings.get(userId)
      const tz = settings?.timezone ?? 'America/New_York'
      const todayKey = clockToday(tz)
      const from = dateKeyDaysAgo(todayKey, STREAK_LOOKBACK_DAYS - 1)
      const [items, logs] = await Promise.all([
        repo.routineItems.list(),
        repo.routineLogs.listByRange(from, todayKey),
      ])
      if (cancelled) return
      setData({ items, logs, timezone: tz })
      setLoading(false)
    }
    load().catch((e) => {
      console.error('Routines load failed', e)
      if (!cancelled) setLoading(false)
    })
    return () => {
      cancelled = true
    }
  }, [userId, dashboardRefreshKey])

  return { data, setData, loading }
}

export default function Routines() {
  const { user } = useSession()
  const userId = user?.id ?? null
  const { data, setData, loading } = useRoutinesData(userId)

  const todayKey = useMemo(() => clockToday(data.timezone), [data.timezone])

  // ---------- log mutation ----------

  const onToggle = useCallback(
    async (itemId: string, completed: boolean) => {
      if (!userId) return
      // Optimistically reflect the toggle in local logs before the
      // round-trip so the checkbox state doesn't visibly bounce.
      setData((prev) => {
        const others = prev.logs.filter(
          (l) => !(l.routineItemId === itemId && l.dateKey === todayKey),
        )
        const optimistic: RoutineLog = {
          id: `optimistic-${itemId}-${todayKey}`,
          userId,
          routineItemId: itemId,
          dateKey: todayKey,
          completed,
        }
        return { ...prev, logs: [...others, optimistic] }
      })
      try {
        const real = await repo.routineLogs.toggle({
          userId,
          routineItemId: itemId,
          dateKey: todayKey,
          completed,
        })
        setData((prev) => {
          const without = prev.logs.filter(
            (l) =>
              !(
                l.routineItemId === itemId &&
                l.dateKey === todayKey &&
                l.id.startsWith('optimistic-')
              ),
          )
          return { ...prev, logs: [...without, real] }
        })
      } catch (e) {
        console.error('Toggle routine log failed', e)
        toast.error(SAVE_ERROR)
        // Roll back: drop the optimistic placeholder. The realtime
        // echo or next refresh will reconcile final state.
        setData((prev) => ({
          ...prev,
          logs: prev.logs.filter(
            (l) =>
              !(
                l.routineItemId === itemId &&
                l.dateKey === todayKey &&
                l.id.startsWith('optimistic-')
              ),
          ),
        }))
      }
    },
    [userId, setData, todayKey],
  )

  // ---------- item mutation ----------

  const upsertItem = useCallback(
    (next: RoutineItem) => {
      setData((prev) => {
        const idx = prev.items.findIndex((i) => i.id === next.id)
        const items =
          idx === -1
            ? [...prev.items, next]
            : prev.items.map((i) => (i.id === next.id ? next : i))
        return { ...prev, items }
      })
    },
    [setData],
  )

  const onCreate = useCallback(
    async (routine: 'morning' | 'night', label: string): Promise<boolean> => {
      if (!userId) return false
      const siblings = data.items.filter(
        (i) => i.routine === routine && !i.archivedAt,
      )
      const nextSortOrder =
        siblings.reduce((max, i) => Math.max(max, i.sortOrder), -1) + 1
      try {
        const created = await repo.routineItems.create({
          userId,
          routine,
          label,
          sortOrder: nextSortOrder,
        })
        upsertItem(created)
        toast(`${routine === 'morning' ? 'Morning' : 'Night'} item added`)
        return true
      } catch (e) {
        console.error('Create routine item failed', e)
        toast.error(SAVE_ERROR)
        return false
      }
    },
    [userId, data.items, upsertItem],
  )

  const onRename = useCallback(
    async (id: string, label: string) => {
      try {
        const updated = await repo.routineItems.update(id, { label })
        upsertItem(updated)
      } catch (e) {
        console.error('Rename routine item failed', e)
        toast.error(SAVE_ERROR)
      }
    },
    [upsertItem],
  )

  const onArchive = useCallback(
    async (id: string) => {
      try {
        const archived = await repo.routineItems.archive(id)
        upsertItem(archived)
        toast('Item removed')
      } catch (e) {
        console.error('Archive routine item failed', e)
        toast.error(SAVE_ERROR)
      }
    },
    [upsertItem],
  )

  // Reorder helper shared by drag-and-drop and the Move up / Move down
  // touch menu. Renumbers densely 0,1,2,… for the given routine.
  const reorderByIds = useCallback(
    async (routine: 'morning' | 'night', orderedIds: string[]) => {
      const orders = orderedIds.map((id, idx) => ({ id, sortOrder: idx }))
      setData((prev) => ({
        ...prev,
        items: prev.items.map((i) => {
          if (i.routine !== routine) return i
          const o = orders.find((x) => x.id === i.id)
          return o ? { ...i, sortOrder: o.sortOrder } : i
        }),
      }))
      try {
        await repo.routineItems.reorder(orders)
      } catch (e) {
        console.error('Reorder routine items failed', e)
        toast.error(SAVE_ERROR)
      }
    },
    [setData],
  )

  const onReorderMorning = useCallback(
    (orderedIds: string[]) => void reorderByIds('morning', orderedIds),
    [reorderByIds],
  )
  const onReorderNight = useCallback(
    (orderedIds: string[]) => void reorderByIds('night', orderedIds),
    [reorderByIds],
  )

  const onMove = useCallback(
    (routine: 'morning' | 'night', id: string, direction: 'up' | 'down') => {
      const siblings = data.items
        .filter((i) => i.routine === routine && !i.archivedAt)
        .sort((a, b) => a.sortOrder - b.sortOrder)
      const idx = siblings.findIndex((s) => s.id === id)
      if (idx === -1) return
      const swapIdx = direction === 'up' ? idx - 1 : idx + 1
      if (swapIdx < 0 || swapIdx >= siblings.length) return
      const next = [...siblings]
      ;[next[idx], next[swapIdx]] = [next[swapIdx], next[idx]]
      void reorderByIds(
        routine,
        next.map((s) => s.id),
      )
    },
    [data.items, reorderByIds],
  )

  if (loading) {
    return <div className="text-[13px] text-muted-foreground">Loading…</div>
  }

  return (
    <div>
      <header className="mb-6 flex flex-wrap items-baseline gap-3">
        <h1
          className="m-0 text-[28px] font-semibold text-foreground"
          style={{ letterSpacing: '-0.02em' }}
        >
          Routines
        </h1>
        <span className="label">Daily rituals · streaks</span>
      </header>
      <div className="grid gap-6 md:grid-cols-2">
        <RoutinePanel
          routine="morning"
          items={data.items}
          logs={data.logs}
          todayKey={todayKey}
          timezone={data.timezone}
          onToggle={onToggle}
          onCreate={(label) => onCreate('morning', label)}
          onRename={onRename}
          onArchive={onArchive}
          onReorder={onReorderMorning}
          onMove={(id, dir) => onMove('morning', id, dir)}
        />
        <RoutinePanel
          routine="night"
          items={data.items}
          logs={data.logs}
          todayKey={todayKey}
          timezone={data.timezone}
          onToggle={onToggle}
          onCreate={(label) => onCreate('night', label)}
          onRename={onRename}
          onArchive={onArchive}
          onReorder={onReorderNight}
          onMove={(id, dir) => onMove('night', id, dir)}
        />
      </div>
    </div>
  )
}
