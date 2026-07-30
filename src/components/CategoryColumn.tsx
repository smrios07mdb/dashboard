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

import AddSubcategoryInline from '@/components/AddSubcategoryInline'
import SubcategorySection from '@/components/SubcategorySection'
import TaskSortControl from '@/components/TaskSortControl'
import type { Category, Subcategory, Task } from '@/db/types'
import { catColor, fmtMin } from '@/lib/cat'
import type { TaskSortKey } from '@/lib/taskSort'
import { useIsTouchDevice } from '@/lib/useIsTouchDevice'

/*
 * Drag discriminator helpers. `useDraggable` IDs we emit are prefixed
 * with `task:` (in TaskRow); sortable subcategory items use their raw
 * UUID. The unified onDragEnd handler routes on this prefix.
 */
function isTaskDragId(id: unknown): boolean {
  return typeof id === 'string' && id.startsWith('task:')
}

/*
 * One category column on the dashboard ("Work" or "Personal").
 *
 * Renders the category header with totals plus a card listing each
 * subcategory section. Chunk 8 adds:
 *   - DndContext + SortableContext scoped per column (within-category
 *     reorder only; cross-category drag is chunk 9's job)
 *   - AddSubcategoryInline at the bottom of the column
 *   - Per-sub touch/desktop reorder fallbacks via the header's menu
 *
 * Subcategories arrive already-filtered (Dashboard drops archived rows
 * before passing them down). Tasks belonging to subs that aren't in the
 * incoming list are dropped here as a defensive filter so an in-flight
 * archive doesn't leave orphan rows briefly visible.
 */

export type CategoryColumnProps = {
  category: Category
  /** All categories — needed for the task-menu MoveToPicker. */
  allCategories: Category[]
  /** All non-archived subcategories — needed for the task-menu MoveToPicker. */
  allSubcategories: Subcategory[]
  subcategories: Subcategory[]
  tasksBySub: Record<string, Task[]>
  onDrillDown: (kind: 'category' | 'subcategory', id: string) => void
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
  onSetTaskPriority: (
    id: string,
    priority: 1 | 2 | 3 | null,
  ) => void | Promise<void>
  onEditTaskNotes: (
    id: string,
    notes: string | null,
  ) => void | Promise<void>
  /** Global sort preference (chunk 33) — one control per column, shared state. */
  sortKey: TaskSortKey
  onChangeSortKey: (key: TaskSortKey) => void
  onCreateSubcategory: (input: {
    categoryId: string
    name: string
  }) => Promise<boolean>
  onRenameSubcategory: (id: string, name: string) => void | Promise<void>
  onDeleteSubcategory: (
    id: string,
    options: { moveToId?: string; cascadeDelete?: boolean },
  ) => void | Promise<void>
  onMergeSubcategory: (
    sourceId: string,
    targetId: string,
  ) => void | Promise<void>
  onReorderSubcategories: (
    categoryId: string,
    orderedIds: string[],
  ) => void | Promise<void>
  onMoveSubcategory: (id: string, direction: 'up' | 'down') => void
}

export default function CategoryColumn({
  category,
  allCategories,
  allSubcategories,
  subcategories,
  tasksBySub,
  onDrillDown,
  onCreateTask,
  onCompleteTask,
  onEditTitle,
  onEditMinutes,
  onDeleteTask,
  onMoveTaskToSubcategory,
  onSetTaskReminder,
  onSetTaskPriority,
  onEditTaskNotes,
  sortKey,
  onChangeSortKey,
  onCreateSubcategory,
  onRenameSubcategory,
  onDeleteSubcategory,
  onMergeSubcategory,
  onReorderSubcategories,
  onMoveSubcategory,
}: CategoryColumnProps) {
  const isTouch = useIsTouchDevice()

  const allTasks = subcategories.flatMap((s) => tasksBySub[s.id] ?? [])
  const open = allTasks.filter((t) => !t.completedAt)
  const total = open.reduce((sum, t) => sum + t.estimateMinutes, 0)
  const accent = catColor(category.name)

  // 5px activation distance prevents accidental drags from clicks on
  // the grip handle. Touch sensor stays inert because the handle is
  // hidden on touch devices.
  const sensors = useSensors(
    useSensor(PointerSensor, {
      activationConstraint: { distance: 5 },
    }),
    useSensor(TouchSensor, {
      activationConstraint: { delay: 200, tolerance: 5 },
    }),
  )

  const subIds = subcategories.map((s) => s.id)

  function handleDragEnd(event: DragEndEvent) {
    const { active, over } = event
    if (!over) return

    // Task drag → drop on a SubcategoryHeader's useDroppable. Active
    // id is prefixed `task:<uuid>`; the drop target's data carries
    // `{ type: 'subcategory', subcategoryId }`.
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

    // Subcategory sortable reorder (chunk-8 behavior).
    if (active.id === over.id) return
    const oldIndex = subIds.indexOf(String(active.id))
    const newIndex = subIds.indexOf(String(over.id))
    if (oldIndex === -1 || newIndex === -1) return
    const next = [...subIds]
    const [moved] = next.splice(oldIndex, 1)
    next.splice(newIndex, 0, moved)
    void onReorderSubcategories(category.id, next)
  }

  return (
    <div>
      <header
        role="button"
        tabIndex={0}
        onDoubleClick={() => onDrillDown('category', category.id)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault()
            onDrillDown('category', category.id)
          }
        }}
        className="grid cursor-pointer items-center gap-3.5 p-0.5 pb-4 [grid-template-columns:5px_1fr_auto_auto_auto_auto]"
      >
        {/* Full-bleed accent bar — no card behind the header. */}
        <span
          aria-hidden
          className="min-h-[30px] w-[5px] self-stretch rounded"
          style={{ background: accent, boxShadow: `0 2px 8px -2px ${accent}` }}
        />
        {/* Serif display heading, tinted to the category color. */}
        <h2
          className="m-0 font-display text-[31px] font-medium"
          style={{ letterSpacing: '-0.018em', color: accent }}
        >
          {category.name}
        </h2>
        {/* "N open" pill — solid category color with a soft colored shadow. */}
        <span
          className="num label inline-block rounded-full"
          style={{
            background: accent,
            color: '#fff',
            fontSize: 10.5,
            padding: '4px 10px',
            letterSpacing: '0.1em',
            boxShadow: `0 5px 14px -5px ${accent}`,
          }}
        >
          {open.length} open
        </span>
        <span className="whitespace-nowrap font-display text-[19px] font-medium tabular-nums text-ink-2">
          {fmtMin(total)}
        </span>
        {/* Chunk 33: list sort — global preference, one control per column. */}
        <TaskSortControl value={sortKey} onChange={onChangeSortKey} />
        <button
          type="button"
          aria-label={`Open ${category.name}`}
          onClick={(e) => {
            e.stopPropagation()
            onDrillDown('category', category.id)
          }}
          className="inline-flex h-8 w-8 items-center justify-center rounded-sm text-[20px] leading-none text-ink-3 transition-colors hover:bg-bg-alt hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          <span aria-hidden>›</span>
        </button>
      </header>
      <div
        className="overflow-hidden rounded-md"
        style={{
          backgroundColor: 'var(--surface)',
          backgroundImage: `linear-gradient(180deg, color-mix(in srgb, ${accent} 11%, transparent), transparent 140px)`,
          border: '1px solid var(--line)',
          borderTop: `4px solid ${accent}`,
          boxShadow: `var(--shadow-md), 0 10px 30px -16px ${accent}`,
        }}
      >
        {subcategories.length === 0 ? (
          <div className="px-4 py-6 text-center text-[13px] text-ink-3">
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
                  allCategories={allCategories}
                  allSubcategories={allSubcategories}
                  tasks={tasksBySub[sub.id] ?? []}
                  otherSubsInCategory={subcategories.filter(
                    (s) => s.id !== sub.id,
                  )}
                  canMoveUp={index > 0}
                  canMoveDown={index < subcategories.length - 1}
                  isTouch={isTouch}
                  onDrillDown={(id) => onDrillDown('subcategory', id)}
                  onCreateTask={onCreateTask}
                  onCompleteTask={onCompleteTask}
                  onEditTitle={onEditTitle}
                  onEditMinutes={onEditMinutes}
                  onDeleteTask={onDeleteTask}
                  onMoveTaskToSubcategory={onMoveTaskToSubcategory}
                  onSetTaskReminder={onSetTaskReminder}
                  onSetTaskPriority={onSetTaskPriority}
                  onEditTaskNotes={onEditTaskNotes}
                  sortKey={sortKey}
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
            onCreateSubcategory({ categoryId: category.id, name })
          }
        />
      </div>
    </div>
  )
}

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
  onSetTaskPriority: (
    id: string,
    priority: 1 | 2 | 3 | null,
  ) => void | Promise<void>
  onEditTaskNotes: (id: string, notes: string | null) => void | Promise<void>
  sortKey: TaskSortKey
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
