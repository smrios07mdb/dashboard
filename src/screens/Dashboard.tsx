import { useCallback, useEffect, useMemo, useState } from 'react'
import { Sparkles } from 'lucide-react'
import { toast } from 'sonner'

import CategoryColumn from '@/components/CategoryColumn'
import { Button } from '@/components/ui/button'
import { repo } from '@/db/repo'
import type { Category, Subcategory, Task } from '@/db/types'
import { useSession } from '@/lib/auth'
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
  const today = useMemo(() => new Date(), [])
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
        <Button
          size="sm"
          disabled
          // Chunk 11 wires the AI triage call. Disabled placeholder for chunk 6.
          title="What's next? is enabled in chunk 11"
        >
          <Sparkles className="size-4" />
          What&rsquo;s next?
        </Button>
      </div>
    </div>
  )
}

export default function Dashboard() {
  const { data, setData, loading } = useDashboardData()
  const { user } = useSession()
  const userId = user?.id ?? null

  const tasksBySub = useMemo(() => {
    const m: Record<string, Task[]> = {}
    for (const t of data.tasks) {
      ;(m[t.subcategoryId] ??= []).push(t)
    }
    return m
  }, [data.tasks])

  const subsByCat = useMemo(() => {
    const m: Record<string, Subcategory[]> = {}
    const live = data.subcategories.filter((s) => !s.archivedAt)
    live.sort((a, b) => a.sortOrder - b.sortOrder)
    for (const s of live) {
      ;(m[s.categoryId] ??= []).push(s)
    }
    return m
  }, [data.subcategories])

  const openTasks = data.tasks.filter((t) => !t.completedAt)
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

  // TODO chunk 9: navigate to drill-down route.
  const onDrillDown = useCallback(() => {}, [])

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
            subcategories={subsByCat[cat.id] ?? []}
            tasksBySub={tasksBySub}
            onDrillDown={onDrillDown}
            onCreateTask={onCreateTask}
            onCompleteTask={onCompleteTask}
            onEditTitle={onEditTitle}
            onEditMinutes={onEditMinutes}
            onDeleteTask={onDeleteTask}
          />
        ))}
      </div>
    </div>
  )
}
