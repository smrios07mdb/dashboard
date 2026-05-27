import { useCallback, useEffect, useMemo, useState } from 'react'
import { Navigate, useParams, useNavigate } from 'react-router-dom'
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
import SubcategorySection from '@/components/SubcategorySection'
import { repo } from '@/db/repo'
import type { Category, Subcategory, Task } from '@/db/types'
import { useSession } from '@/lib/auth'
import { useIsTouchDevice } from '@/lib/useIsTouchDevice'
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

function formatMinutes(mins: number): string {
  if (!mins) return '0m'
  if (mins < 60) return `${mins}m`
  const h = Math.floor(mins / 60)
  const m = mins % 60
  return m ? `${h}h ${m}m` : `${h}h`
}

function isTaskDragId(id: unknown): boolean {
  return typeof id === 'string' && id.startsWith('task:')
}

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
  const { user } = useSession()
  const userId = user?.id ?? null
  const isTouch = useIsTouchDevice()
  const { data, setData, loading } = useCategoryViewData()

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
  const openCount = allTasks.length
  const openMinutes = allTasks.reduce((s, t) => s + t.estimateMinutes, 0)

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
    const { active, over } = event
    if (!over) return

    if (isTaskDragId(active.id)) {
      const data = active.data.current as
        | { taskId?: string; currentSubcategoryId?: string }
        | undefined
      const target = over.data.current as
        | { type?: string; subcategoryId?: string }
        | undefined
      const taskId = data?.taskId
      const targetSubId = target?.subcategoryId
      const currentSubId = data?.currentSubcategoryId
      if (
        taskId &&
        targetSubId &&
        target?.type === 'subcategory' &&
        targetSubId !== currentSubId
      ) {
        void onMoveTaskToSubcategory(taskId, targetSubId)
      }
      return
    }

    if (active.id === over.id) return
    const oldIndex = subIds.indexOf(String(active.id))
    const newIndex = subIds.indexOf(String(over.id))
    if (oldIndex === -1 || newIndex === -1) return
    const next = [...subIds]
    const [moved] = next.splice(oldIndex, 1)
    next.splice(newIndex, 0, moved)
    void reorderSubsByIds(categoryId!, next)
  }

  if (loading) {
    return <div className="text-[13px] text-muted-foreground">Loading…</div>
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
          className="m-0 text-[36px] font-semibold text-foreground"
          style={{ letterSpacing: '-0.02em' }}
        >
          {category.name}
        </h1>
        <span className="label">
          {openCount} open · {formatMinutes(openMinutes)}
        </span>
      </header>
      <div className="overflow-hidden rounded-md border border-border bg-card">
        {subcategories.length === 0 ? (
          <div className="px-4 py-6 text-center text-[13px] text-muted-foreground">
            No subcategories yet.
          </div>
        ) : (
          <DndContext sensors={sensors} onDragEnd={handleDragEnd}>
            <SortableContext
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
                  onEditTaskNotes={onEditTaskNotes}
                  onRenameSubcategory={onRenameSubcategory}
                  onDeleteSubcategory={onDeleteSubcategory}
                  onMergeSubcategory={onMergeSubcategory}
                  onMoveSubcategory={onMoveSubcategory}
                />
              ))}
            </SortableContext>
          </DndContext>
        )}
        <AddSubcategoryInline
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
  onMoveTaskToSubcategory: (
    taskId: string,
    targetSubcategoryId: string,
  ) => void | Promise<void>
  onSetTaskReminder: (
    id: string,
    remindAt: string | null,
  ) => void | Promise<void>
  onEditTaskNotes: (id: string, notes: string | null) => void | Promise<void>
  onRenameSubcategory: (id: string, name: string) => void | Promise<void>
  onDeleteSubcategory: (
    id: string,
    options: { moveToId?: string; cascadeDelete?: boolean },
  ) => void | Promise<void>
  onMergeSubcategory: (
    sourceId: string,
    targetId: string,
  ) => void | Promise<void>
  onMoveSubcategory: (id: string, direction: 'up' | 'down') => void
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
