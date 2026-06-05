import { useCallback, useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { toast } from 'sonner'

import AllClearBanner from '@/components/AllClearBanner'
import BusyStrip from '@/components/BusyStrip'
import CategoryColumn from '@/components/CategoryColumn'
import EmptyStateCard from '@/components/EmptyStateCard'
import DailyHero from '@/components/gamify/DailyHero'
import { repo } from '@/db/repo'
import type { Category, Subcategory, Task } from '@/db/types'
import { useSession } from '@/lib/auth'
import { dateKeyDaysAgo, today as clockToday } from '@/lib/clock'
import { selectDashboardState } from '@/lib/dashboardState'
import { calcStreak } from '@/lib/streak'
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

/**
 * How far back the hero's routine-log read reaches. Mirrors the
 * `STREAK_LOOKBACK_DAYS` window in `src/lib/streak.ts` so the hero's streak
 * inputs match the Routines screen exactly (ARCH §11).
 */
const STREAK_LOOKBACK_DAYS = 60

type DashboardData = {
  categories: Category[]
  subcategories: Subcategory[]
  tasks: Task[]
}

function useDashboardData(userId: string | null) {
  const [data, setData] = useState<DashboardData>({
    categories: [],
    subcategories: [],
    tasks: [],
  })
  // The hero's "best current routine streak" — the larger of the morning and
  // night streaks. Computed at load since it depends only on routine
  // items/logs (not task CRUD), so it survives optimistic task mutations.
  const [streak, setStreak] = useState(0)
  const [loading, setLoading] = useState(true)
  const dashboardRefreshKey = useUIStore((s) => s.dashboardRefreshKey)

  useEffect(() => {
    let cancelled = false
    async function load() {
      // Source the streak inputs identically to Routines.tsx so the two
      // screens never disagree: resolve the timezone from settings first
      // (default if not yet hydrated), then load a 60-day routine-log window
      // plus the routine items. `today(tz)` flows through the clock module so
      // the DEV `__clockOverride` smoke hook still pins it.
      const settings = userId ? await repo.settings.get(userId) : null
      const tz = settings?.timezone ?? 'America/New_York'
      const todayKey = clockToday(tz)
      const fromKey = dateKeyDaysAgo(todayKey, STREAK_LOOKBACK_DAYS - 1)
      const [categories, subcategories, tasks, logs, items] =
        await Promise.all([
          repo.categories.list(),
          repo.subcategories.list(),
          repo.tasks.list(),
          repo.routineLogs.listByRange(fromKey, todayKey),
          repo.routineItems.list(),
        ])
      if (cancelled) return
      // The canonical routines streak is per-routine; the hero shows the
      // stronger of the two — always equal to the larger number on the
      // Routines screen, so the hero can never contradict it.
      const heroStreak = Math.max(
        calcStreak('morning', items, logs, todayKey, tz),
        calcStreak('night', items, logs, todayKey, tz),
      )
      setData({ categories, subcategories, tasks })
      setStreak(heroStreak)
      setLoading(false)
    }
    load().catch((e) => {
      console.error('Dashboard load failed', e)
      if (!cancelled) setLoading(false)
    })
    return () => {
      cancelled = true
    }
  }, [dashboardRefreshKey, userId])

  return { data, setData, loading, streak }
}

export default function Dashboard() {
  const { user } = useSession()
  const userId = user?.id ?? null
  const { data, setData, loading, streak } = useDashboardData(userId)
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

  // All tasks under live subcategories (done + open) — the hero's ring,
  // bars and counts derive from these so they stay consistent with the
  // visible columns (chunk-26 note E).
  const liveTasks = useMemo(
    () => data.tasks.filter((t) => liveSubIds.has(t.subcategoryId)),
    [data.tasks, liveSubIds],
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

  // First-run CTA (chunk 20 — UX-05, Option 3): route into the chosen category
  // with the inline "Add subcategory" input auto-opened. A brand-new account has
  // no subcategory to hold a task, so the first step is creating a list — not
  // dropping the user onto empty columns with no add affordance.
  const onPickCategory = useCallback(
    (categoryId: string) => {
      navigate(`/category/${categoryId}`, {
        state: { addSubcategory: true },
      })
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

  const dashboardState = selectDashboardState(data.subcategories, data.tasks)

  // First-run: a dashed-border CTA card replaces the columns (DESIGN_NOTES §3).
  if (dashboardState === 'first-run') {
    return (
      <div>
        <BusyStrip />
        <DailyHero
          user={user}
          tasks={liveTasks}
          subcategories={liveSubcategories}
          categories={data.categories}
          streak={streak}
        />
        <EmptyStateCard
          categories={data.categories}
          onPickCategory={onPickCategory}
        />
      </div>
    )
  }

  return (
    <div>
      <BusyStrip />
      <DailyHero
        user={user}
        tasks={liveTasks}
        subcategories={liveSubcategories}
        categories={data.categories}
        streak={streak}
      />
      {/* All-clear: jade banner above the still-visible columns. */}
      {dashboardState === 'all-clear' && <AllClearBanner />}
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
