import { useCallback, useEffect, useMemo, useState } from 'react'
import { Navigate, useLocation, useParams, useNavigate } from 'react-router-dom'
import {
  DndContext,
  PointerSensor,
  TouchSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
} from '@dnd-kit/core'
import {
  SortableContext,
  useSortable,
  verticalListSortingStrategy,
} from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import { toast } from 'sonner'

import AddSubcategoryInline from '@/components/AddSubcategoryInline'
import Breadcrumbs from '@/components/Breadcrumbs'
import type { DeleteListChoice } from '@/components/DeleteSubcategoryDialog'
import HorizonControl from '@/components/HorizonControl'
import SubcategorySection from '@/components/SubcategorySection'
import { TaskDragOverlay } from '@/components/TaskDragGhost'
import TaskSortControl from '@/components/TaskSortControl'
import { repo } from '@/db/repo'
import type { Category, Subcategory, Task } from '@/db/types'
import { useSession } from '@/lib/auth'
import {
  filterByHorizon,
  loadHorizonFilter,
  storeHorizonFilter,
  type HorizonFilter,
} from '@/lib/horizon'
import { deleteList, DELETE_LIST_TOAST } from '@/lib/deleteList'
import {
  isTaskDragId,
  resolveTaskDrop,
  taskDragCollision,
  type MoveTaskFn,
} from '@/lib/taskDragCollision'
import {
  loadTaskSortKey,
  storeTaskSortKey,
  type TaskSortKey,
} from '@/lib/taskSort'
import {
  deleteTasksWithUndo,
  moveLabel,
  offerCompleteUndo,
  offerMoveUndo,
} from '@/lib/taskUndo'
import { useIsTouchDevice } from '@/lib/useIsTouchDevice'
import { browserTimezone, loadUserTimezone } from '@/lib/userTimezone'
import { useUIStore } from '@/state/uiStore'

/*
 * Category drill-down view (`/category/:categoryId`).
 *
 * Shows every non-archived subcategory of one category, each with its
 * full task list. Single DndContext at the screen level so tasks can be
 * dragged between subcategories (intra-category) and subcategories can
 * be reordered. Cross-category drag is intentionally out of scope (per
 * pre-flight note #4) — each route is its own context.
 *
 * Data loading mirrors Dashboard: the screen owns its own
 * `useCategoryViewData` hook, subscribing to
 * `uiStore.dashboardRefreshKey` so realtime ticks and Force-resync
 * cascade everywhere uniformly. No separate refresh key in the store.
 *
 * Archived subs (and their tasks) are filtered at the screen level,
 * matching chunk-8's Dashboard precedent.
 */

const SAVE_ERROR = 'Could not save — retry'

type ViewData = {
  categories: Category[]
  subcategories: Subcategory[]
  tasks: Task[]
}

function useCategoryViewData() {
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
      console.error('CategoryView load failed', e)
      if (!cancelled) setLoading(false)
    })
    return () => {
      cancelled = true
    }
  }, [dashboardRefreshKey])

  return { data, setData, loading }
}

export default function CategoryView() {
  const { categoryId } = useParams<{ categoryId: string }>()
  const navigate = useNavigate()
  const location = useLocation()
  // First-run flow (chunk 20 — UX-05): the Dashboard empty-state card routes
  // here with `{ addSubcategory: true }` so the inline "Add subcategory" input
  // opens focused and the user can create their first list immediately.
  const autoOpenAddSub =
    (location.state as { addSubcategory?: boolean } | null)?.addSubcategory ===
    true
  const { user } = useSession()
  const userId = user?.id ?? null
  const isTouch = useIsTouchDevice()
  const { data, setData, loading } = useCategoryViewData()

  // The Settings time zone the rows' when-chips read in (chunk 71). Browser
  // zone until it resolves — and for good when settings are unreadable.
  const [timeZone, setTimeZone] = useState(browserTimezone)
  useEffect(() => {
    let cancelled = false
    void loadUserTimezone().then((tz) => {
      if (!cancelled) setTimeZone(tz)
    })
    return () => {
      cancelled = true
    }
  }, [])

  // Global list-sort preference (chunk 33) — shared with Dashboard and
  // SubcategoryView via localStorage.
  const [sortKey, setSortKey] = useState<TaskSortKey>(loadTaskSortKey)
  const onChangeSortKey = useCallback((key: TaskSortKey) => {
    setSortKey(key)
    storeTaskSortKey(key)
  }, [])

  // Global horizon filter (chunk 76) — shared with Dashboard and
  // SubcategoryView via localStorage.
  const [horizon, setHorizon] = useState<HorizonFilter>(loadHorizonFilter)
  const onChangeHorizon = useCallback((f: HorizonFilter) => {
    setHorizon(f)
    storeHorizonFilter(f)
  }, [])

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 200, tolerance: 5 } }),
  )

  const category = useMemo(
    () => data.categories.find((c) => c.id === categoryId) ?? null,
    [data.categories, categoryId],
  )

  const subcategories = useMemo(() => {
    return data.subcategories
      .filter((s) => s.categoryId === categoryId && !s.archivedAt)
      .sort((a, b) => a.sortOrder - b.sortOrder)
  }, [data.subcategories, categoryId])

  const liveSubIds = useMemo(
    () => new Set(subcategories.map((s) => s.id)),
    [subcategories],
  )

  const tasksBySub = useMemo(() => {
    const m: Record<string, Task[]> = {}
    for (const t of data.tasks) {
      if (!liveSubIds.has(t.subcategoryId)) continue
      ;(m[t.subcategoryId] ??= []).push(t)
    }
    return m
  }, [data.tasks, liveSubIds])

  const allLiveSubs = useMemo(
    () => data.subcategories.filter((s) => !s.archivedAt),
    [data.subcategories],
  )

  const allTasks = useMemo(
    () =>
      data.tasks.filter(
        (t) => liveSubIds.has(t.subcategoryId) && !t.completedAt,
      ),
    [data.tasks, liveSubIds],
  )
  // Chunk 76: the header count follows the horizon filter (no time total,
  // chunk 86).
  const shownOpen = filterByHorizon(allTasks, horizon, timeZone)
  const openCount = shownOpen.length

  // ---------- task mutation helpers ----------

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
      const before = data.tasks.find((t) => t.id === id)
      try {
        const updated = await repo.tasks.markComplete(id, completed)
        upsertTask(updated)
        // Checking off offers a 6 s Undo (chunk 72); unchecking does not.
        if (completed && before) {
          offerCompleteUndo({
            before: [before],
            onRestored: (rows) => rows.forEach(upsertTask),
          })
        }
      } catch (e) {
        console.error('Complete task failed', e)
        toast.error(SAVE_ERROR)
      }
    },
    [data.tasks, upsertTask],
  )

  // No confirm and no write here (chunk 72): the row leaves the screen now and
  // lib/taskUndo hard-deletes it 6 s later unless Undo is pressed.
  const onDeleteTask = useCallback(
    (id: string) => {
      const task = data.tasks.find((t) => t.id === id)
      if (!task) return
      setData((prev) => ({
        ...prev,
        tasks: prev.tasks.filter((t) => t.id !== id),
      }))
      deleteTasksWithUndo({
        tasks: [task],
        // Undo puts the held row back (upsert is by id, so no duplicates).
        onRestore: (rows) => rows.forEach(upsertTask),
      })
    },
    [data.tasks, setData, upsertTask],
  )

  // Every move toasts where it went, with Undo (chunk 88; as the Dashboard).
  const onMoveTaskToSubcategory = useCallback<MoveTaskFn>(
    async (id, targetSubcategoryId) => {
      const before = data.tasks.find((t) => t.id === id)
      try {
        const updated = await repo.tasks.update(id, {
          subcategoryId: targetSubcategoryId,
        })
        upsertTask(updated)
        const toLabel = moveLabel(
          before?.subcategoryId ?? '',
          targetSubcategoryId,
          data.subcategories,
          data.categories,
        )
        if (before) offerMoveUndo({ before, toLabel, onRestored: upsertTask })
        else toast(`Moved to ${toLabel}`)
      } catch (e) {
        console.error('Move task failed', e)
        toast.error(SAVE_ERROR)
      }
    },
    [data.tasks, data.subcategories, data.categories, upsertTask],
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

  const onSetTaskDue = useCallback(
    async (id: string, dueAt: string | null) => {
      try {
        const updated = await repo.tasks.update(id, { dueAt })
        upsertTask(updated)
        toast(dueAt ? 'Due date set' : 'Due date cleared')
      } catch (e) {
        console.error('Set due date failed', e)
        toast.error(SAVE_ERROR)
      }
    },
    [upsertTask],
  )

  const onSetTaskPriority = useCallback(
    async (id: string, priority: 1 | 2 | 3 | null) => {
      try {
        const updated = await repo.tasks.update(id, { priority })
        upsertTask(updated)
        toast(priority ? `Priority set to P${priority}` : 'Priority cleared')
      } catch (e) {
        console.error('Set priority failed', e)
        toast.error(SAVE_ERROR)
      }
    },
    [upsertTask],
  )

  // ---------- subcategory mutation helpers ----------

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
    async (id: string, choice: DeleteListChoice) => {
      try {
        const { archived, updated, deletedIds } = await deleteList(
          id,
          choice,
          data.tasks,
        )
        if (updated.length > 0 || deletedIds.length > 0) {
          const byId = new Map(updated.map((t) => [t.id, t]))
          const gone = new Set(deletedIds)
          setData((prev) => ({
            ...prev,
            tasks: prev.tasks
              .filter((t) => !gone.has(t.id))
              .map((t) => byId.get(t.id) ?? t),
          }))
        }
        upsertSubcategory(archived)
        toast(DELETE_LIST_TOAST[choice.kind])
      } catch (e) {
        console.error('Delete list failed', e)
        toast.error(SAVE_ERROR)
      }
    },
    [data.tasks, setData, upsertSubcategory],
  )

  const onMergeSubcategory = useCallback(
    async (sourceId: string, targetId: string) => {
      const sourceTasks = data.tasks.filter((t) => t.subcategoryId === sourceId)
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
    async (catId: string, orderedIds: string[]) => {
      const orders = orderedIds.map((id, idx) => ({ id, sortOrder: idx }))
      setData((prev) => ({
        ...prev,
        subcategories: prev.subcategories.map((s) => {
          if (s.categoryId !== catId) return s
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

  const onMoveSubcategory = useCallback(
    (id: string, direction: 'up' | 'down') => {
      const idx = subcategories.findIndex((s) => s.id === id)
      if (idx === -1) return
      const swapIdx = direction === 'up' ? idx - 1 : idx + 1
      if (swapIdx < 0 || swapIdx >= subcategories.length) return
      const next = [...subcategories]
      ;[next[idx], next[swapIdx]] = [next[swapIdx], next[idx]]
      void reorderSubsByIds(
        categoryId!,
        next.map((s) => s.id),
      )
    },
    [subcategories, reorderSubsByIds, categoryId],
  )

  const onDrillSub = useCallback(
    (id: string) => navigate(`/subcategory/${id}`),
    [navigate],
  )

  const subIds = subcategories.map((s) => s.id)

  function handleDragEnd(event: DragEndEvent) {
    const drop = resolveTaskDrop(event)
    if (drop) {
      void onMoveTaskToSubcategory(drop.taskId, drop.toSubId, { viaDrag: true })
      return
    }
    const { active, over } = event
    if (!over || isTaskDragId(active.id) || active.id === over.id) return
    const oldIndex = subIds.indexOf(String(active.id))
    const newIndex = subIds.indexOf(String(over.id))
    if (oldIndex === -1 || newIndex === -1) return
    const next = [...subIds]
    const [moved] = next.splice(oldIndex, 1)
    next.splice(newIndex, 0, moved)
    void reorderSubsByIds(categoryId!, next)
  }

  if (loading) {
    return <div className="text-[13px] text-ink-3">Loading…</div>
  }

  if (!category) {
    // Bad id (deleted sub, mistyped URL, etc.) → punt to Dashboard.
    return <Navigate to="/" replace />
  }

  const accent = category.name === 'Work' ? 'var(--work)' : 'var(--personal)'

  return (
    <div>
      <Breadcrumbs category={category} />
      <header className="mb-6 flex flex-wrap items-baseline gap-4">
        <span
          aria-hidden
          className="h-9 w-1.5 self-center rounded-sm"
          style={{ background: accent }}
        />
        <h1
          className="m-0 font-display text-[44px] font-medium text-ink"
          style={{ letterSpacing: '-0.02em' }}
        >
          {category.name}
        </h1>
        <span className="label">
          {openCount} open
        </span>
        {/* Chunk 76: horizon, then chunk 33's list sort — same global
            preferences as the Dashboard. */}
        <div className="ml-auto flex items-center gap-2">
          <HorizonControl value={horizon} onChange={onChangeHorizon} />
          <TaskSortControl value={sortKey} onChange={onChangeSortKey} />
        </div>
      </header>
      <div className="overflow-hidden rounded-md border border-line bg-surface">
        {subcategories.length === 0 ? (
          <div className="px-4 py-6 text-center text-[13px] text-ink-3">
            No subcategories yet.
          </div>
        ) : (
          <DndContext
            sensors={sensors}
            collisionDetection={taskDragCollision}
            onDragEnd={handleDragEnd}
          >
            <SortableContext
              id={`subs:${categoryId}`}
              items={subIds}
              strategy={verticalListSortingStrategy}
            >
              {subcategories.map((sub, index) => (
                <SortableSubSection
                  key={sub.id}
                  subcategory={sub}
                  allCategories={data.categories}
                  allSubcategories={allLiveSubs}
                  tasks={tasksBySub[sub.id] ?? []}
                  otherSubsInCategory={subcategories.filter(
                    (s) => s.id !== sub.id,
                  )}
                  canMoveUp={index > 0}
                  canMoveDown={index < subcategories.length - 1}
                  isTouch={isTouch}
                  onDrillDown={onDrillSub}
                  onCreateTask={onCreateTask}
                  onCompleteTask={onCompleteTask}
                  onEditTitle={onEditTitle}
                  onEditMinutes={onEditMinutes}
                  onDeleteTask={onDeleteTask}
                  onMoveTaskToSubcategory={onMoveTaskToSubcategory}
                  onSetTaskReminder={onSetTaskReminder}
                  onSetTaskDue={onSetTaskDue}
                  onSetTaskPriority={onSetTaskPriority}
                  sortKey={sortKey}
                  horizon={horizon}
                  onRenameSubcategory={onRenameSubcategory}
                  onDeleteSubcategory={onDeleteSubcategory}
                  onMergeSubcategory={onMergeSubcategory}
                  onMoveSubcategory={onMoveSubcategory}
                  timeZone={timeZone}
                />
              ))}
            </SortableContext>
            <TaskDragOverlay />
          </DndContext>
        )}
        <AddSubcategoryInline
          autoOpen={autoOpenAddSub}
          onCreate={({ name }) =>
            onCreateSubcategory({ categoryId: categoryId!, name })
          }
        />
      </div>
    </div>
  )
}

/*
 * Lifted from CategoryColumn — the sortable wrapper that applies
 * useSortable's transform to each section and forwards the drag
 * handle props to SubcategoryHeader via SubcategorySection.
 */
type SortableSubSectionProps = {
  subcategory: Subcategory
  allCategories: Category[]
  allSubcategories: Subcategory[]
  tasks: Task[]
  otherSubsInCategory: Subcategory[]
  canMoveUp: boolean
  canMoveDown: boolean
  isTouch: boolean
  onDrillDown: (id: string) => void
  onCreateTask: (input: {
    subcategoryId: string
    title: string
    estimateMinutes: number
  }) => Promise<boolean>
  onCompleteTask: (id: string, completed: boolean) => void | Promise<void>
  onEditTitle: (id: string, title: string) => void | Promise<void>
  onEditMinutes: (id: string, minutes: number) => void | Promise<void>
  onDeleteTask: (id: string) => void | Promise<void>
  onMoveTaskToSubcategory: MoveTaskFn
  onSetTaskReminder: (
    id: string,
    remindAt: string | null,
  ) => void | Promise<void>
  onSetTaskDue: (
    id: string,
    dueAt: string | null,
  ) => void | Promise<void>
  onSetTaskPriority: (
    id: string,
    priority: 1 | 2 | 3 | null,
  ) => void | Promise<void>
  sortKey: TaskSortKey
  horizon: HorizonFilter
  onRenameSubcategory: (id: string, name: string) => void | Promise<void>
  onDeleteSubcategory: (
    id: string,
    choice: DeleteListChoice,
  ) => void | Promise<void>
  onMergeSubcategory: (
    sourceId: string,
    targetId: string,
  ) => void | Promise<void>
  onMoveSubcategory: (id: string, direction: 'up' | 'down') => void
  timeZone?: string
}

function SortableSubSection({
  subcategory,
  ...rest
}: SortableSubSectionProps) {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: subcategory.id })

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.5 : undefined,
  }

  return (
    <div ref={setNodeRef} style={style}>
      <SubcategorySection
        subcategory={subcategory}
        dragHandleProps={{
          attributes: attributes as unknown as Record<string, unknown>,
          listeners: (listeners ?? {}) as unknown as Record<string, unknown>,
        }}
        {...rest}
      />
    </div>
  )
}
