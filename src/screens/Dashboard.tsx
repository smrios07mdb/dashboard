import { useCallback, useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { toast } from 'sonner'

import CategoryColumn from '@/components/CategoryColumn'
import WhatsNextSheet from '@/components/WhatsNextSheet'
import { repo } from '@/db/repo'
import type { Category, Subcategory, Task } from '@/db/types'
import { useSession } from '@/lib/auth'
import { today as clockToday } from '@/lib/clock'
import { useUIStore } from '@/state/uiStore'

/*
 * Unified dashboard.
 *
 * Chunks 6 + 7 collaborate here: chunk 6 owns the read/render skeleton
 * and the design-system surfaces; chunk 7 layers create/edit/complete/
 * delete on top. Effect dep is still `uiStore.dashboardRefreshKey` —
 * the load only re-runs on explicit cues (Force-resync button, realtime
 * apply). Tasks update in-place via the returned row from each repo
 * mutation, so totals re-derive without a refetch.
 *
 * Chunk 7's render filter: incomplete tasks render by default;
 * completed tasks are tucked behind the "N completed" expander per
 * subcategory. The filter lives in SubcategorySection — completed
 * tasks still load from the repo so the expander has something to show.
 *
 * Drill-down navigation, three-dot menus, AI triage, bell-icon
 * interaction, and reminders all remain stubs handled by later chunks
 * (9, 11, 14).
 */

const SAVE_ERROR = 'Could not save — retry'

function formatMinutes(mins: number): string {
  if (!mins) return '0m'
  if (mins < 60) return `${mins}m`
  const h = Math.floor(mins / 60)
  const m = mins % 60
  return m ? `${h}h ${m}m` : `${h}h`
}

function formatToday(d: Date): string {
  return d.toLocaleDateString(undefined, {
    weekday: 'long',
    month: 'long',
    day: 'numeric',
  })
}

type DashboardData = {
  categories: Category[]
  subcategories: Subcategory[]
  tasks: Task[]
}

function useDashboardData() {
  const [data, setData] = useState<DashboardData>({
    categories: [],
    subcategories: [],
    tasks: [],
  })
  const [loading, setLoading] = useState(true)
  const dashboardRefreshKey = useUIStore((s) => s.dashboardRefreshKey)

  useEffect(() => {
    let cancelled = false
    async function load() {
      const [categories, subcategories, tasks] = await Promise.all([
        repo.categories.list(),
        repo.subcategories.list(),
        repo.tasks.list(),
      ])
      if (cancelled) return
      setData({ categories, subcategories, tasks })
      setLoading(false)
    }
    load().catch((e) => {
      console.error('Dashboard load failed', e)
      if (!cancelled) setLoading(false)
    })
    return () => {
      cancelled = true
    }
  }, [dashboardRefreshKey])

  return { data, setData, loading }
}

type TodayStripProps = {
  openCount: number
  openMinutes: number
}

function TodayStrip({ openCount, openMinutes }: TodayStripProps) {
  const availableMinutes = useUIStore((s) => s.availableMinutes)
  const setAvailableMinutes = useUIStore((s) => s.setAvailableMinutes)
  // Read "today" through the clock module so the DEV-only
  // `__clockOverride` hook (see src/lib/clock.ts) can pin the displayed
  // date during smoke passes. We pass the browser's resolved timezone
  // — matching the pre-override `new Date()` behavior (which used the
  // browser's local tz implicitly) — instead of plumbing settings.tz
  // through the dashboard; the routines screen still uses settings.tz
  // directly where the math actually depends on it.
  const todayKey = clockToday(
    Intl.DateTimeFormat().resolvedOptions().timeZone,
  )
  // Mid-day local on the pinned date so DST transitions can't roll the
  // weekday/month/day result the formatter produces.
  const today = useMemo(
    () => new Date(`${todayKey}T12:00:00`),
    [todayKey],
  )
  return (
    <div className="mb-6 flex flex-wrap items-center gap-3 rounded-md border border-border bg-card px-4 py-3">
      <div className="flex flex-1 items-baseline gap-2">
        <span className="label">Today</span>
        <span className="font-mono text-[13px] text-muted-foreground">
          {formatToday(today)}
        </span>
        <span className="text-muted-foreground/60" aria-hidden>
          ·
        </span>
        <span className="font-mono text-[14px] font-semibold text-foreground tabular-nums">
          {openCount}
        </span>
        <span className="text-[13px] text-muted-foreground">open</span>
        <span className="text-muted-foreground/60" aria-hidden>
          ·
        </span>
        <span className="font-mono text-[13px] text-secondary-foreground tabular-nums">
          {formatMinutes(openMinutes)}
        </span>
      </div>
      <div className="flex items-center gap-2">
        <label className="label flex items-center gap-2">
          I have
          <input
            type="number"
            min={0}
            step={15}
            value={availableMinutes}
            onChange={(e) =>
              setAvailableMinutes(Number(e.target.value) || 0)
            }
            aria-label="Available minutes"
            className="w-16 rounded-sm border border-border bg-background px-2 py-1 text-right font-mono text-[13px] text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          />
          <span className="font-mono text-[11px] text-muted-foreground">
            min
          </span>
        </label>
        <WhatsNextSheet />
      </div>
    </div>
  )
}

export default function Dashboard() {
  const { data, setData, loading } = useDashboardData()
  const { user } = useSession()
  const userId = user?.id ?? null
  const navigate = useNavigate()

  const subsByCat = useMemo(() => {
    const m: Record<string, Subcategory[]> = {}
    const live = data.subcategories.filter((s) => !s.archivedAt)
    live.sort((a, b) => a.sortOrder - b.sortOrder)
    for (const s of live) {
      ;(m[s.categoryId] ??= []).push(s)
    }
    return m
  }, [data.subcategories])

  // Live subcategory ids — used to filter tasks belonging to archived
  // subs so they don't briefly flash visible while a row update is in
  // flight. Same render-layer filter approach used for completed tasks.
  const liveSubIds = useMemo(() => {
    const s = new Set<string>()
    for (const sub of data.subcategories) {
      if (!sub.archivedAt) s.add(sub.id)
    }
    return s
  }, [data.subcategories])

  const tasksBySub = useMemo(() => {
    const m: Record<string, Task[]> = {}
    for (const t of data.tasks) {
      if (!liveSubIds.has(t.subcategoryId)) continue
      ;(m[t.subcategoryId] ??= []).push(t)
    }
    return m
  }, [data.tasks, liveSubIds])

  const openTasks = data.tasks.filter(
    (t) => !t.completedAt && liveSubIds.has(t.subcategoryId),
  )
  const openCount = openTasks.length
  const openMinutes = openTasks.reduce(
    (sum, t) => sum + t.estimateMinutes,
    0,
  )

  // ---------- mutation handlers ----------

  const upsertTask = useCallback((next: Task) => {
    setData((prev) => {
      const idx = prev.tasks.findIndex((t) => t.id === next.id)
      const tasks =
        idx === -1
          ? [...prev.tasks, next]
          : prev.tasks.map((t) => (t.id === next.id ? next : t))
      return { ...prev, tasks }
    })
  }, [setData])

  const onCreateTask = useCallback(
    async (input: {
      subcategoryId: string
      title: string
      estimateMinutes: number
    }): Promise<boolean> => {
      if (!userId) return false
      try {
        const created = await repo.tasks.create({
          userId,
          subcategoryId: input.subcategoryId,
          title: input.title,
          notes: null,
          estimateMinutes: input.estimateMinutes,
          dueAt: null,
          remindAt: null,
          priority: null,
          completedAt: null,
        })
        upsertTask(created)
        toast('Task added')
        return true
      } catch (e) {
        console.error('Create task failed', e)
        toast.error(SAVE_ERROR)
        return false
      }
    },
    [userId, upsertTask],
  )

  const onEditTitle = useCallback(
    async (id: string, title: string) => {
      try {
        const updated = await repo.tasks.update(id, { title })
        upsertTask(updated)
      } catch (e) {
        console.error('Edit title failed', e)
        toast.error(SAVE_ERROR)
      }
    },
    [upsertTask],
  )

  const onEditMinutes = useCallback(
    async (id: string, estimateMinutes: number) => {
      try {
        const updated = await repo.tasks.update(id, { estimateMinutes })
        upsertTask(updated)
      } catch (e) {
        console.error('Edit minutes failed', e)
        toast.error(SAVE_ERROR)
      }
    },
    [upsertTask],
  )

  const onCompleteTask = useCallback(
    async (id: string, completed: boolean) => {
      try {
        const updated = await repo.tasks.markComplete(id, completed)
        upsertTask(updated)
      } catch (e) {
        console.error('Complete task failed', e)
        toast.error(SAVE_ERROR)
      }
    },
    [upsertTask],
  )

  const onDeleteTask = useCallback(
    async (id: string) => {
      try {
        await repo.tasks.delete(id)
        setData((prev) => ({
          ...prev,
          tasks: prev.tasks.filter((t) => t.id !== id),
        }))
        toast('Task deleted')
      } catch (e) {
        console.error('Delete task failed', e)
        toast.error(SAVE_ERROR)
      }
    },
    [setData],
  )

  const onMoveTaskToSubcategory = useCallback(
    async (id: string, targetSubcategoryId: string) => {
      try {
        const updated = await repo.tasks.update(id, {
          subcategoryId: targetSubcategoryId,
        })
        upsertTask(updated)
        toast('Task moved')
      } catch (e) {
        console.error('Move task failed', e)
        toast.error(SAVE_ERROR)
      }
    },
    [upsertTask],
  )

  const onSetTaskReminder = useCallback(
    async (id: string, remindAt: string | null) => {
      try {
        const updated = await repo.tasks.update(id, {
          remindAt,
          // Resetting `remindAt` resets the notified flag so a future
          // reminder fires; chunk 14 owns the actual delivery.
          notified: false,
        })
        upsertTask(updated)
        toast(remindAt ? 'Reminder set' : 'Reminder cleared')
      } catch (e) {
        console.error('Set reminder failed', e)
        toast.error(SAVE_ERROR)
      }
    },
    [upsertTask],
  )

  const onEditTaskNotes = useCallback(
    async (id: string, notes: string | null) => {
      try {
        const updated = await repo.tasks.update(id, { notes })
        upsertTask(updated)
        toast('Notes saved')
      } catch (e) {
        console.error('Edit notes failed', e)
        toast.error(SAVE_ERROR)
      }
    },
    [upsertTask],
  )

  const upsertSubcategory = useCallback(
    (next: Subcategory) => {
      setData((prev) => {
        const idx = prev.subcategories.findIndex((s) => s.id === next.id)
        const subcategories =
          idx === -1
            ? [...prev.subcategories, next]
            : prev.subcategories.map((s) => (s.id === next.id ? next : s))
        return { ...prev, subcategories }
      })
    },
    [setData],
  )

  const onCreateSubcategory = useCallback(
    async (input: {
      categoryId: string
      name: string
    }): Promise<boolean> => {
      if (!userId) return false
      const siblings = data.subcategories.filter(
        (s) => s.categoryId === input.categoryId && !s.archivedAt,
      )
      const nextSortOrder =
        siblings.reduce((max, s) => Math.max(max, s.sortOrder), -1) + 1
      try {
        const created = await repo.subcategories.create({
          userId,
          categoryId: input.categoryId,
          name: input.name,
          sortOrder: nextSortOrder,
        })
        upsertSubcategory(created)
        toast('Subcategory added')
        return true
      } catch (e) {
        console.error('Create subcategory failed', e)
        toast.error(SAVE_ERROR)
        return false
      }
    },
    [userId, data.subcategories, upsertSubcategory],
  )

  const onRenameSubcategory = useCallback(
    async (id: string, name: string) => {
      try {
        const updated = await repo.subcategories.update(id, { name })
        upsertSubcategory(updated)
      } catch (e) {
        console.error('Rename subcategory failed', e)
        toast.error(SAVE_ERROR)
      }
    },
    [upsertSubcategory],
  )

  const onDeleteSubcategory = useCallback(
    async (
      id: string,
      options: { moveToId?: string; cascadeDelete?: boolean },
    ) => {
      const subTasks = data.tasks.filter((t) => t.subcategoryId === id)
      try {
        if (options.moveToId && subTasks.length > 0) {
          const moved = await repo.tasks.bulkUpdate(
            subTasks.map((t) => ({
              id: t.id,
              patch: { subcategoryId: options.moveToId! },
            })),
          )
          setData((prev) => {
            const byId = new Map(moved.map((t) => [t.id, t]))
            return {
              ...prev,
              tasks: prev.tasks.map((t) => byId.get(t.id) ?? t),
            }
          })
        } else if (options.cascadeDelete && subTasks.length > 0) {
          await repo.tasks.bulkDelete(subTasks.map((t) => t.id))
          setData((prev) => ({
            ...prev,
            tasks: prev.tasks.filter((t) => t.subcategoryId !== id),
          }))
        }
        const archived = await repo.subcategories.archive(id)
        upsertSubcategory(archived)
        if (options.cascadeDelete && subTasks.length > 0) {
          toast('Subcategory and tasks deleted')
        } else if (options.moveToId) {
          toast('Tasks moved, subcategory deleted')
        } else {
          toast('Subcategory deleted')
        }
      } catch (e) {
        console.error('Delete subcategory failed', e)
        toast.error(SAVE_ERROR)
      }
    },
    [data.tasks, setData, upsertSubcategory],
  )

  const onMergeSubcategory = useCallback(
    async (sourceId: string, targetId: string) => {
      const sourceTasks = data.tasks.filter(
        (t) => t.subcategoryId === sourceId,
      )
      const targetSub = data.subcategories.find((s) => s.id === targetId)
      try {
        if (sourceTasks.length > 0) {
          const moved = await repo.tasks.bulkUpdate(
            sourceTasks.map((t) => ({
              id: t.id,
              patch: { subcategoryId: targetId },
            })),
          )
          setData((prev) => {
            const byId = new Map(moved.map((t) => [t.id, t]))
            return {
              ...prev,
              tasks: prev.tasks.map((t) => byId.get(t.id) ?? t),
            }
          })
        }
        const archived = await repo.subcategories.archive(sourceId)
        upsertSubcategory(archived)
        toast(`Merged into ${targetSub?.name ?? 'subcategory'}`)
      } catch (e) {
        console.error('Merge subcategory failed', e)
        toast.error(SAVE_ERROR)
      }
    },
    [data.tasks, data.subcategories, setData, upsertSubcategory],
  )

  const reorderSubsByIds = useCallback(
    async (categoryId: string, orderedIds: string[]) => {
      // Recompute sort_order densely (0, 1, 2, ...) for the visible
      // subs in this category. The repo loops updates so each row
      // becomes its own outbox entry offline — fine for 3-5 rows.
      const orders = orderedIds.map((id, idx) => ({ id, sortOrder: idx }))
      // Optimistic local apply before the await so the UI doesn't
      // bounce back during the round-trip.
      setData((prev) => ({
        ...prev,
        subcategories: prev.subcategories.map((s) => {
          if (s.categoryId !== categoryId) return s
          const order = orders.find((o) => o.id === s.id)
          return order ? { ...s, sortOrder: order.sortOrder } : s
        }),
      }))
      try {
        await repo.subcategories.reorder(orders)
      } catch (e) {
        console.error('Reorder subcategories failed', e)
        toast.error(SAVE_ERROR)
      }
    },
    [setData],
  )

  const onReorderSubcategories = useCallback(
    (categoryId: string, orderedIds: string[]) => {
      void reorderSubsByIds(categoryId, orderedIds)
    },
    [reorderSubsByIds],
  )

  const onMoveSubcategory = useCallback(
    (id: string, direction: 'up' | 'down') => {
      const target = data.subcategories.find((s) => s.id === id)
      if (!target) return
      const siblings = data.subcategories
        .filter((s) => s.categoryId === target.categoryId && !s.archivedAt)
        .sort((a, b) => a.sortOrder - b.sortOrder)
      const idx = siblings.findIndex((s) => s.id === id)
      if (idx === -1) return
      const swapIdx = direction === 'up' ? idx - 1 : idx + 1
      if (swapIdx < 0 || swapIdx >= siblings.length) return
      const next = [...siblings]
      ;[next[idx], next[swapIdx]] = [next[swapIdx], next[idx]]
      void reorderSubsByIds(
        target.categoryId,
        next.map((s) => s.id),
      )
    },
    [data.subcategories, reorderSubsByIds],
  )

  const onDrillDown = useCallback(
    (kind: 'category' | 'subcategory', id: string) => {
      navigate(`/${kind}/${id}`)
    },
    [navigate],
  )

  const liveSubcategories = useMemo(
    () => data.subcategories.filter((s) => !s.archivedAt),
    [data.subcategories],
  )

  if (loading) {
    return (
      <div className="text-[13px] text-muted-foreground">Loading…</div>
    )
  }

  return (
    <div>
      <TodayStrip openCount={openCount} openMinutes={openMinutes} />
      <div className="grid gap-6 sm:grid-cols-2 sm:gap-8">
        {data.categories.map((cat) => (
          <CategoryColumn
            key={cat.id}
            category={cat}
            allCategories={data.categories}
            allSubcategories={liveSubcategories}
            subcategories={subsByCat[cat.id] ?? []}
            tasksBySub={tasksBySub}
            onDrillDown={onDrillDown}
            onCreateTask={onCreateTask}
            onCompleteTask={onCompleteTask}
            onEditTitle={onEditTitle}
            onEditMinutes={onEditMinutes}
            onDeleteTask={onDeleteTask}
            onMoveTaskToSubcategory={onMoveTaskToSubcategory}
            onSetTaskReminder={onSetTaskReminder}
            onEditTaskNotes={onEditTaskNotes}
            onCreateSubcategory={onCreateSubcategory}
            onRenameSubcategory={onRenameSubcategory}
            onDeleteSubcategory={onDeleteSubcategory}
            onMergeSubcategory={onMergeSubcategory}
            onReorderSubcategories={onReorderSubcategories}
            onMoveSubcategory={onMoveSubcategory}
          />
        ))}
      </div>
    </div>
  )
}
