import { useCallback, useEffect, useMemo, useState } from 'react'
import { toast } from 'sonner'

import { repo } from '@/db/repo'
import type { RoutineItem, RoutineLog } from '@/db/types'
import { today as clockToday } from '@/lib/clock'
import { useUIStore } from '@/state/uiStore'

/**
 * Routine checklists' data and handlers (chunk 78), moved as-is out of the
 * retired Routines screen so the checklist can live inside Today
 * (`TodayRoutines`).
 *
 * Reads `settings.timezone` first (schema default until settings hydrate), so
 * today's key matches the user's setting, then the routine items and today's
 * logs only: no streak or dot grid needs history any more (ARCH §11). One
 * `routineItems.list()` feeds both checklists; each panel filters by
 * `routine` itself.
 *
 * Subscribes to `uiStore.dashboardRefreshKey` so cross-tab realtime echoes
 * and the Force-resync button refetch it like the other screens (chunk-7
 * precedent).
 */

const SAVE_ERROR = 'Could not save — retry'

type RoutinesData = {
  items: RoutineItem[]
  logs: RoutineLog[]
  timezone: string
}

export function useRoutines(userId: string | null) {
  const [data, setData] = useState<RoutinesData>({
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
      const settings = await repo.settings.get(userId)
      const tz = settings?.timezone ?? 'America/New_York'
      const todayKey = clockToday(tz)
      const [items, logs] = await Promise.all([
        repo.routineItems.list(),
        repo.routineLogs.listByRange(todayKey, todayKey),
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

  return {
    items: data.items,
    logs: data.logs,
    todayKey,
    loading,
    onToggle,
    onCreate,
    onRename,
    onArchive,
    reorderByIds,
    onMove,
  }
}
