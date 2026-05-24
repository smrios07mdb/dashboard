import { useEffect, useMemo, useState } from 'react'
import { Bell, MoreHorizontal, Sparkles } from 'lucide-react'

import { Button } from '@/components/ui/button'
import { repo } from '@/db/repo'
import type { Category, Subcategory, Task } from '@/db/types'
import { cn } from '@/lib/utils'
import { useUIStore } from '@/state/uiStore'

/*
 * Unified dashboard — read-only for chunk 6.
 *
 * Reads via repo on mount, then re-reads whenever
 * `uiStore.dashboardRefreshKey` is bumped — today that's only the
 * Force-resync button in <SyncIndicator />. The realtime layer keeps
 * Dexie warm in the background; we deliberately don't subscribe to
 * `syncStore.lastSyncAt` here, because the repo stamps that on every
 * successful read and we'd spin into an infinite refetch loop.
 *
 * Chevrons-as-primary-affordance per ARCHITECTURE §13: visible `›` on
 * every category and subcategory header, plus double-click handler on
 * the header. Long-press is deliberately NOT wired.
 *
 * Task interactions (toggle, edit, delete, three-dot menu actions) and
 * drill-down navigation are NOT implemented here:
 *   - Task CRUD                 → chunk 7
 *   - Subcategory CRUD          → chunk 8
 *   - Drill-down routes         → chunk 9
 *   - "What's next?" wiring     → chunk 11
 */

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
    // Re-read when something explicitly bumps dashboardRefreshKey
    // (today: <SyncIndicator />'s Force-resync). The realtime layer
    // keeps Dexie warm in the background; this screen's in-memory
    // snapshot only needs the explicit cue.
  }, [dashboardRefreshKey])

  return { data, loading }
}

type TaskRowProps = { task: Task }

function TaskRow({ task }: TaskRowProps) {
  const completed = !!task.completedAt
  return (
    <div
      className={cn(
        'grid items-center gap-3 border-t border-border px-3 py-2',
        '[grid-template-columns:1fr_auto_auto_auto]',
        completed && 'opacity-50',
      )}
    >
      <span
        className={cn(
          'truncate text-[13px] text-foreground',
          completed && 'line-through decoration-muted-foreground',
        )}
        title={task.title}
      >
        {task.title}
      </span>
      <span className="font-mono text-[12px] text-muted-foreground tabular-nums">
        {formatMinutes(task.estimateMinutes)}
      </span>
      {task.remindAt ? (
        <span
          aria-label="Reminder set"
          title="Reminder set"
          className="inline-flex h-6 w-6 items-center justify-center text-[var(--accent-ink)]"
        >
          <Bell className="size-3.5" />
        </span>
      ) : (
        <span aria-hidden className="inline-block h-6 w-6" />
      )}
      {/* Placeholder three-dot menu — chunk 9 wires real actions. */}
      <button
        type="button"
        aria-label="Task actions"
        className="inline-flex h-6 w-6 items-center justify-center rounded-sm text-muted-foreground hover:bg-secondary hover:text-secondary-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        // TODO chunk 9: wire task action menu (toggle, edit, delete, move…)
      >
        <MoreHorizontal className="size-3.5" />
      </button>
    </div>
  )
}

type SubcategorySectionProps = {
  subcategory: Subcategory
  tasks: Task[]
  onDrillDown: (id: string) => void
}

function SubcategorySection({
  subcategory,
  tasks,
  onDrillDown,
}: SubcategorySectionProps) {
  const open = tasks.filter((t) => !t.completedAt)
  const minutes = open.reduce((sum, t) => sum + t.estimateMinutes, 0)
  return (
    <section className="border-t border-border first:border-t-0">
      <header
        role="button"
        tabIndex={0}
        onDoubleClick={() => onDrillDown(subcategory.id)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault()
            onDrillDown(subcategory.id)
          }
        }}
        className="grid cursor-pointer items-center gap-2 px-3 py-3 hover:bg-secondary/40 [grid-template-columns:1fr_auto_auto_auto]"
      >
        <span className="text-[14px] font-medium text-foreground">
          {subcategory.name}
        </span>
        <span className="font-mono text-[12px] text-muted-foreground tabular-nums">
          {open.length}
        </span>
        <span className="font-mono text-[12px] text-muted-foreground tabular-nums">
          {formatMinutes(minutes)}
        </span>
        <button
          type="button"
          aria-label={`Open ${subcategory.name}`}
          onClick={(e) => {
            e.stopPropagation()
            onDrillDown(subcategory.id)
          }}
          className="inline-flex h-6 w-6 items-center justify-center rounded-sm text-[16px] leading-none text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          <span aria-hidden>›</span>
        </button>
      </header>
      <div className="pb-2">
        {tasks.length === 0 ? (
          <div className="border-t border-border px-4 py-3 text-[12px] italic text-muted-foreground">
            No tasks here.
          </div>
        ) : (
          tasks.map((t) => <TaskRow key={t.id} task={t} />)
        )}
      </div>
    </section>
  )
}

type CategoryColumnProps = {
  category: Category
  subcategories: Subcategory[]
  tasksBySub: Record<string, Task[]>
  onDrillDown: (id: string) => void
}

function CategoryColumn({
  category,
  subcategories,
  tasksBySub,
  onDrillDown,
}: CategoryColumnProps) {
  const allTasks = subcategories.flatMap((s) => tasksBySub[s.id] ?? [])
  const open = allTasks.filter((t) => !t.completedAt)
  const total = open.reduce((sum, t) => sum + t.estimateMinutes, 0)
  const accent =
    category.name === 'Work' ? 'var(--work)' : 'var(--personal)'

  return (
    <div>
      <header
        role="button"
        tabIndex={0}
        onDoubleClick={() => onDrillDown(category.id)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault()
            onDrillDown(category.id)
          }
        }}
        className="mb-3 grid cursor-pointer items-baseline gap-3 pb-3 [grid-template-columns:4px_1fr_auto_auto_auto]"
      >
        <span
          aria-hidden
          className="mt-2 h-7 w-[4px] self-stretch rounded-sm"
          style={{ background: accent }}
        />
        <h2
          className="m-0 text-[24px] font-semibold text-foreground"
          style={{ letterSpacing: '-0.025em' }}
        >
          {category.name}
        </h2>
        <span className="label">{open.length} open</span>
        <span className="font-mono text-[16px] font-medium text-secondary-foreground tabular-nums">
          {formatMinutes(total)}
        </span>
        <button
          type="button"
          aria-label={`Open ${category.name}`}
          onClick={(e) => {
            e.stopPropagation()
            onDrillDown(category.id)
          }}
          className="inline-flex h-8 w-8 items-center justify-center rounded-sm text-[20px] leading-none text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          <span aria-hidden>›</span>
        </button>
      </header>
      <div className="overflow-hidden rounded-md border border-border bg-card">
        {subcategories.length === 0 ? (
          <div className="px-4 py-6 text-center text-[13px] text-muted-foreground">
            No subcategories yet.
          </div>
        ) : (
          subcategories.map((sub) => (
            <SubcategorySection
              key={sub.id}
              subcategory={sub}
              tasks={tasksBySub[sub.id] ?? []}
              onDrillDown={onDrillDown}
            />
          ))
        )}
      </div>
    </div>
  )
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
  const { data, loading } = useDashboardData()

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
    // Stable sort by sortOrder ascending.
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

  // TODO chunk 9: navigate to drill-down route.
  const onDrillDown = () => {}

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
          />
        ))}
      </div>
    </div>
  )
}
