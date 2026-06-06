import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Navigate, useParams, useSearchParams } from 'react-router-dom'
import { ArrowUpDown, Check, ChevronDown, Move, Trash2 } from 'lucide-react'
import { toast } from 'sonner'

import AddTaskInline from '@/components/AddTaskInline'
import Breadcrumbs from '@/components/Breadcrumbs'
import DeleteConfirm from '@/components/DeleteConfirm'
import { MoveToPickerContent } from '@/components/MoveToPicker'
import TaskRow from '@/components/TaskRow'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { repo } from '@/db/repo'
import type { Category, Subcategory, Task } from '@/db/types'
import { useSession } from '@/lib/auth'
import { cn } from '@/lib/utils'
import { useUIStore } from '@/state/uiStore'

/*
 * Subcategory drill-down view (`/subcategory/:subcategoryId`).
 *
 * Differs from CategoryView in three load-bearing ways:
 *   - One subcategory's tasks only (full list, no per-sub grouping).
 *   - Bulk-select via a leading square checkbox per row. Sticky
 *     toolbar appears at the top when any row is selected: Move to…
 *     (cascading picker, reuses MoveToPickerContent) / Delete N tasks
 *     (DeleteConfirm) / Clear selection.
 *   - No cross-subcategory drag. The chunk-9 prompt's UX choice:
 *     bulk-select + Move-to is the within-subcategory move pattern,
 *     not drag.
 *
 * Selection state is a component-level `useState<Set<string>>` per
 * pre-flight note #9 — selection doesn't need to survive route
 * changes; navigating away clears it.
 */

const SAVE_ERROR = 'Could not save — retry'

function formatMinutes(mins: number): string {
  if (!mins) return '0m'
  if (mins < 60) return `${mins}m`
  const h = Math.floor(mins / 60)
  const m = mins % 60
  return m ? `${h}h ${m}m` : `${h}h`
}

// Client-side list sort (chunk 31, Decision D2). View-only — never persisted.
type SortBy = 'created' | 'minutes' | 'priority' | 'title'

const SORT_OPTIONS: { value: SortBy; label: string }[] = [
  { value: 'created', label: 'Created (default)' },
  { value: 'minutes', label: 'Estimate (high → low)' },
  { value: 'priority', label: 'Priority (1 → 3)' },
  { value: 'title', label: 'Title (A → Z)' },
]

/*
 * Sort the visible task list. `created` keeps the natural order
 * (repo.tasks.list returns newest-updated first); the others re-sort a copy.
 *
 * Judgment calls baked in here (see the chunk note / ask the human if these
 * should differ):
 *   - Priority sorts 1 → 3 with null LAST via `?? Infinity`. Our model is
 *     {1, 2, 3, null}, so this is safe — and avoids the prototype's `|| 9`
 *     idiom, which would also push a (non-existent) priority 0 to the back.
 *   - Ties preserve input order: Array.prototype.sort is stable in V8, so an
 *     equal-estimate / equal-priority group keeps its prior arrangement.
 */
function sortTasks(tasks: Task[], sortBy: SortBy): Task[] {
  if (sortBy === 'created') return tasks
  const list = [...tasks]
  if (sortBy === 'minutes') {
    list.sort((a, b) => b.estimateMinutes - a.estimateMinutes)
  } else if (sortBy === 'priority') {
    list.sort((a, b) => (a.priority ?? Infinity) - (b.priority ?? Infinity))
  } else if (sortBy === 'title') {
    list.sort((a, b) => a.title.localeCompare(b.title))
  }
  return list
}

type ViewData = {
  categories: Category[]
  subcategories: Subcategory[]
  tasks: Task[]
}

function useSubcategoryViewData() {
  const [data, setData] = useState<ViewData>({
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
      console.error('SubcategoryView load failed', e)
      if (!cancelled) setLoading(false)
    })
    return () => {
      cancelled = true
    }
  }, [dashboardRefreshKey])

  return { data, setData, loading }
}

export default function SubcategoryView() {
  const { subcategoryId } = useParams<{ subcategoryId: string }>()
  const { user } = useSession()
  const userId = user?.id ?? null
  const { data, setData, loading } = useSubcategoryViewData()
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [showCompleted, setShowCompleted] = useState(false)
  const [sortBy, setSortBy] = useState<SortBy>('created')
  const [searchParams, setSearchParams] = useSearchParams()
  const highlightId = searchParams.get('task')
  const highlightRef = useRef<HTMLDivElement | null>(null)

  const subcategory = useMemo(
    () => data.subcategories.find((s) => s.id === subcategoryId) ?? null,
    [data.subcategories, subcategoryId],
  )

  const category = useMemo(() => {
    if (!subcategory) return null
    return data.categories.find((c) => c.id === subcategory.categoryId) ?? null
  }, [data.categories, subcategory])

  const allTasks = useMemo(
    () => data.tasks.filter((t) => t.subcategoryId === subcategoryId),
    [data.tasks, subcategoryId],
  )
  const incomplete = useMemo(
    () => allTasks.filter((t) => !t.completedAt),
    [allTasks],
  )
  const completed = useMemo(
    () => allTasks.filter((t) => t.completedAt),
    [allTasks],
  )

  const visibleTasks = showCompleted ? allTasks : incomplete
  // Rendered order respects the D2 sort menu; selection still operates on the
  // unsorted `visibleTasks` set (order is irrelevant to which ids are chosen).
  const sortedTasks = sortTasks(visibleTasks, sortBy)
  const openMinutes = incomplete.reduce(
    (sum, t) => sum + t.estimateMinutes,
    0,
  )

  const liveSubs = useMemo(
    () => data.subcategories.filter((s) => !s.archivedAt),
    [data.subcategories],
  )

  // AI "Start" deep-link: arriving with ?task=<id> scrolls the row into
  // view and flashes a ring, then drops the param so a reload/re-render
  // doesn't re-flash. The ring is derived from the URL param (no local
  // state → no set-state-in-effect lint), and TaskRow stays untouched.
  useEffect(() => {
    if (loading || !highlightId) return
    if (!visibleTasks.some((t) => t.id === highlightId)) return
    highlightRef.current?.scrollIntoView?.({
      block: 'center',
      behavior: 'smooth',
    })
    const timer = window.setTimeout(() => {
      setSearchParams(
        (prev) => {
          const next = new URLSearchParams(prev)
          next.delete('task')
          return next
        },
        { replace: true },
      )
    }, 2200)
    return () => window.clearTimeout(timer)
  }, [loading, highlightId, visibleTasks, setSearchParams])

  // ---------- selection helpers ----------

  function toggleSelected(id: string) {
    setSelected((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  function clearSelection() {
    setSelected(new Set())
  }

  // D1 — select-all over the *visible* rows. If every visible row is already
  // selected, the master checkbox clears them; otherwise it selects them all.
  function toggleAllVisible() {
    setSelected((prev) => {
      const next = new Set(prev)
      const allChosen =
        visibleTasks.length > 0 && visibleTasks.every((t) => prev.has(t.id))
      for (const t of visibleTasks) {
        if (allChosen) next.delete(t.id)
        else next.add(t.id)
      }
      return next
    })
  }

  // ---------- mutation helpers ----------

  const upsertTask = useCallback(
    (next: Task) => {
      setData((prev) => {
        const idx = prev.tasks.findIndex((t) => t.id === next.id)
        const tasks =
          idx === -1
            ? [...prev.tasks, next]
            : prev.tasks.map((t) => (t.id === next.id ? next : t))
        return { ...prev, tasks }
      })
    },
    [setData],
  )

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
    async (id: string, isCompleted: boolean) => {
      try {
        const updated = await repo.tasks.markComplete(id, isCompleted)
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
        setSelected((prev) => {
          if (!prev.has(id)) return prev
          const next = new Set(prev)
          next.delete(id)
          return next
        })
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

  // ---------- bulk actions ----------

  const onBulkMove = useCallback(
    async (targetSubcategoryId: string) => {
      const ids = Array.from(selected)
      if (ids.length === 0) return
      try {
        const moved = await repo.tasks.bulkUpdate(
          ids.map((id) => ({
            id,
            patch: { subcategoryId: targetSubcategoryId },
          })),
        )
        setData((prev) => {
          const byId = new Map(moved.map((t) => [t.id, t]))
          return {
            ...prev,
            tasks: prev.tasks.map((t) => byId.get(t.id) ?? t),
          }
        })
        toast(`${ids.length} task${ids.length === 1 ? '' : 's'} moved`)
        clearSelection()
      } catch (e) {
        console.error('Bulk move failed', e)
        toast.error(SAVE_ERROR)
      }
    },
    [selected, setData],
  )

  const onBulkComplete = useCallback(async () => {
    const ids = Array.from(selected)
    if (ids.length === 0) return
    // markComplete(id) is just update(id, { completedAt }) (repo.ts) — no extra
    // side effects — so one shared timestamp lets bulkUpdate group every id into
    // a single round-trip, mirroring the bulk-move path (Decision D3).
    const completedAt = new Date().toISOString()
    try {
      const updated = await repo.tasks.bulkUpdate(
        ids.map((id) => ({ id, patch: { completedAt } })),
      )
      setData((prev) => {
        const byId = new Map(updated.map((t) => [t.id, t]))
        return {
          ...prev,
          tasks: prev.tasks.map((t) => byId.get(t.id) ?? t),
        }
      })
      toast(`${ids.length} task${ids.length === 1 ? '' : 's'} completed`)
      clearSelection()
    } catch (e) {
      console.error('Bulk complete failed', e)
      toast.error(SAVE_ERROR)
    }
  }, [selected, setData])

  const onBulkDelete = useCallback(async () => {
    const ids = Array.from(selected)
    if (ids.length === 0) return
    try {
      await repo.tasks.bulkDelete(ids)
      setData((prev) => ({
        ...prev,
        tasks: prev.tasks.filter((t) => !selected.has(t.id)),
      }))
      toast(`${ids.length} task${ids.length === 1 ? '' : 's'} deleted`)
      clearSelection()
    } catch (e) {
      console.error('Bulk delete failed', e)
      toast.error(SAVE_ERROR)
    }
  }, [selected, setData])

  if (loading) {
    return <div className="text-[13px] text-ink-3">Loading…</div>
  }
  if (!subcategory || subcategory.archivedAt || !category) {
    // Archived or missing → punt to Dashboard.
    return <Navigate to="/" replace />
  }

  const accent = category.name === 'Work' ? 'var(--work)' : 'var(--personal)'
  const selectedCount = selected.size
  const allVisibleSelected =
    visibleTasks.length > 0 && visibleTasks.every((t) => selected.has(t.id))
  const someVisibleSelected = visibleTasks.some((t) => selected.has(t.id))

  return (
    <div>
      <Breadcrumbs category={category} subcategory={subcategory} />
      <header className="mb-6 flex flex-wrap items-baseline gap-4">
        <span
          aria-hidden
          className="h-9 w-1.5 self-center rounded-sm"
          style={{ background: accent }}
        />
        <h1
          className="m-0 font-display text-[40px] font-medium text-ink"
          style={{ letterSpacing: '-0.02em' }}
        >
          {subcategory.name}
        </h1>
        <span className="label">
          {incomplete.length} open · {formatMinutes(openMinutes)}
        </span>
        <div className="ml-auto flex items-center gap-2">
          {completed.length > 0 && (
            <button
              type="button"
              onClick={() => setShowCompleted((s) => !s)}
              className="inline-flex items-center gap-1.5 rounded-sm border border-line px-2 py-1 font-mono text-[11px] font-medium uppercase tracking-[0.08em] text-ink-3 hover:bg-bg-alt hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              <ChevronDown
                aria-hidden
                className={cn(
                  'size-3 transition-transform',
                  showCompleted && 'rotate-180',
                )}
              />
              {showCompleted
                ? `Hide ${completed.length} done`
                : `Show ${completed.length} done`}
            </button>
          )}
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button
                type="button"
                aria-label="Sort tasks"
                className="inline-flex items-center gap-1.5 rounded-sm border border-line px-2 py-1 font-mono text-[11px] font-medium uppercase tracking-[0.08em] text-ink-3 hover:bg-bg-alt hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                <ArrowUpDown aria-hidden className="size-3" />
                Sort
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuRadioGroup
                value={sortBy}
                onValueChange={(v) => setSortBy(v as SortBy)}
              >
                {SORT_OPTIONS.map((opt) => (
                  <DropdownMenuRadioItem key={opt.value} value={opt.value}>
                    {opt.label}
                  </DropdownMenuRadioItem>
                ))}
              </DropdownMenuRadioGroup>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </header>

      {selectedCount > 0 && (
        <BulkToolbar
          selectedCount={selectedCount}
          categories={data.categories}
          subcategories={liveSubs}
          currentSubcategoryId={subcategoryId}
          onMove={onBulkMove}
          onComplete={onBulkComplete}
          onDelete={onBulkDelete}
          onClear={clearSelection}
        />
      )}

      <div className="overflow-hidden rounded-md border border-line bg-surface">
        {visibleTasks.length === 0 ? (
          <div className="px-4 py-8 text-center text-[13px] italic text-ink-3">
            {allTasks.length === 0
              ? 'No tasks here yet. Add one below.'
              : `All done. ${completed.length} completed.`}
          </div>
        ) : (
          <>
            {/* List header (D1): select-all master + column captions. */}
            <div className="flex items-center gap-3 border-b border-line bg-bg-alt px-3 py-2">
              <Checkbox
                aria-label={
                  allVisibleSelected ? 'Deselect all tasks' : 'Select all tasks'
                }
                checked={
                  allVisibleSelected
                    ? true
                    : someVisibleSelected
                      ? 'indeterminate'
                      : false
                }
                onCheckedChange={toggleAllVisible}
                className="rounded-sm"
              />
              <span className="label">Task</span>
              <span className="label ml-auto">Est.</span>
            </div>
            {sortedTasks.map((t) => (
              <div
                key={t.id}
                ref={t.id === highlightId ? highlightRef : undefined}
                className={cn(
                  t.id === highlightId &&
                    'rounded-md ring-2 ring-ring ring-inset transition-shadow duration-500',
                )}
              >
                <TaskRow
                  task={t}
                  categories={data.categories}
                  subcategories={liveSubs}
                  selectable
                  selected={selected.has(t.id)}
                  onToggleSelected={toggleSelected}
                  dragEnabled={false}
                  onComplete={onCompleteTask}
                  onEditTitle={onEditTitle}
                  onEditMinutes={onEditMinutes}
                  onDelete={onDeleteTask}
                  onMoveToSubcategory={onMoveTaskToSubcategory}
                  onSetReminder={onSetTaskReminder}
                  onEditNotes={onEditTaskNotes}
                />
              </div>
            ))}
          </>
        )}
        <AddTaskInline
          onCreate={({ title, estimateMinutes }) =>
            onCreateTask({
              subcategoryId: subcategoryId!,
              title,
              estimateMinutes,
            })
          }
        />
      </div>
    </div>
  )
}

type BulkToolbarProps = {
  selectedCount: number
  categories: Category[]
  subcategories: Subcategory[]
  currentSubcategoryId?: string
  onMove: (targetSubcategoryId: string) => void | Promise<void>
  onComplete: () => void | Promise<void>
  onDelete: () => void | Promise<void>
  onClear: () => void
}

function BulkToolbar({
  selectedCount,
  categories,
  subcategories,
  currentSubcategoryId,
  onMove,
  onComplete,
  onDelete,
  onClear,
}: BulkToolbarProps) {
  return (
    <div
      role="toolbar"
      aria-label={`${selectedCount} task${selectedCount === 1 ? '' : 's'} selected`}
      className="sticky top-2 z-10 mb-4 flex flex-wrap items-center gap-3 rounded-full bg-[var(--ink)] px-5 py-2 text-[var(--bg)] shadow-[0_8px_24px_rgba(0,0,0,0.32)]"
    >
      <span className="text-[13px] font-semibold">
        {selectedCount} selected
      </span>
      <span aria-hidden className="h-3.5 w-px bg-[var(--bg)]/20" />
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <button
            type="button"
            className="inline-flex items-center gap-1.5 text-[13px] hover:opacity-70"
          >
            <Move className="size-3.5" aria-hidden />
            Move to…
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start">
          <MoveToPickerContent
            categories={categories}
            subcategories={subcategories}
            currentSubcategoryId={currentSubcategoryId}
            onSelect={(id) => void onMove(id)}
          />
        </DropdownMenuContent>
      </DropdownMenu>
      <button
        type="button"
        onClick={() => void onComplete()}
        className="inline-flex items-center gap-1.5 text-[13px] hover:opacity-70"
      >
        <Check className="size-3.5" aria-hidden />
        Mark complete
      </button>
      <span className="ml-auto" />
      <DeleteConfirm
        trigger={
          <button
            type="button"
            className="inline-flex items-center gap-1.5 text-[13px] text-destructive hover:opacity-70"
          >
            <Trash2 className="size-3.5" aria-hidden />
            Delete {selectedCount}
          </button>
        }
        title={`Delete ${selectedCount} task${selectedCount === 1 ? '' : 's'}?`}
        description="This cannot be undone."
        onConfirm={onDelete}
      />
      <Button
        type="button"
        variant="ghost"
        size="sm"
        onClick={onClear}
        className="text-[12px] text-[var(--bg)]/60 hover:bg-[var(--bg)]/10 hover:text-[var(--bg)]"
      >
        Cancel
      </Button>
    </div>
  )
}
