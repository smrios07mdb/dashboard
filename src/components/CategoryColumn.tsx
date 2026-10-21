import {
  SortableContext,
  useSortable,
  verticalListSortingStrategy,
} from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'

import AddSubcategoryInline from '@/components/AddSubcategoryInline'
import type { DeleteListChoice } from '@/components/DeleteSubcategoryDialog'
import HorizonControl from '@/components/HorizonControl'
import SubcategorySection from '@/components/SubcategorySection'
import TaskSortControl from '@/components/TaskSortControl'
import type { Category, Subcategory, Task } from '@/db/types'
import { catColor, catInk } from '@/lib/cat'
import { filterByHorizon, type HorizonFilter } from '@/lib/horizon'
import type { MoveTaskFn } from '@/lib/taskDragCollision'
import type { TaskSortKey } from '@/lib/taskSort'
import { useIsTouchDevice } from '@/lib/useIsTouchDevice'
import { browserTimezone } from '@/lib/userTimezone'

/*
 * One category column on the dashboard ("Work" or "Personal").
 *
 * Renders the category header (open count, controls) plus a card listing each
 * subcategory section. Chunk 8 adds:
 *   - a SortableContext per column (`subs:<categoryId>`) for list reorder.
 *     Chunk 88: the DndContext is the Dashboard's, one over both columns, so
 *     tasks drag across categories; list reorder stays inside its own column
 *     (taskDragCollision scopes it to this container)
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
  /** Global sort preference (chunk 33) — one control per column, shared state. */
  sortKey: TaskSortKey
  onChangeSortKey: (key: TaskSortKey) => void
  /** Global horizon filter (chunk 76) — one control per column, shared state. */
  horizon: HorizonFilter
  onChangeHorizon: (f: HorizonFilter) => void
  onCreateSubcategory: (input: {
    categoryId: string
    name: string
  }) => Promise<boolean>
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
  /**
   * Today-plan wiring (dashboard only). When provided, each task row shows the
   * sun toggle reflecting `todaySet` membership. Omitted by drill-down screens.
   */
  todaySet?: Set<string>
  onToggleToday?: (id: string, force?: boolean) => void
  /** Settings time zone for each row's when-chip (chunk 71). */
  timeZone?: string
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
  onSetTaskDue,
  onSetTaskPriority,
  sortKey,
  onChangeSortKey,
  horizon,
  onChangeHorizon,
  onCreateSubcategory,
  onRenameSubcategory,
  onDeleteSubcategory,
  onMergeSubcategory,
  onMoveSubcategory,
  todaySet,
  onToggleToday,
  timeZone,
}: CategoryColumnProps) {
  const isTouch = useIsTouchDevice()

  const allTasks = subcategories.flatMap((s) => tasksBySub[s.id] ?? [])
  // Chunk 76: the pill follows the horizon filter. Chunk 86: no time total.
  const open = filterByHorizon(
    allTasks.filter((t) => !t.completedAt),
    horizon,
    timeZone ?? browserTimezone(),
  )
  const accent = catColor(category.name)

  const subIds = subcategories.map((s) => s.id)

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
        className="flex min-w-0 cursor-pointer flex-wrap items-center justify-end gap-x-3.5 gap-y-1.5 p-0.5 pb-4"
      >
        {/* Chunk 68: two wrapping groups instead of one no-wrap grid, so the
            header can never be wider than its column. Line one takes the full
            width below `sm` (pushing line two under it, right-aligned); at
            >=sm both sit on one line whenever the column can hold them. */}
        <div className="flex min-w-0 grow basis-full items-center gap-3.5 sm:basis-auto">
          {/* Full-bleed accent bar — no card behind the header. */}
          <span
            aria-hidden
            className="min-h-[30px] w-[5px] shrink-0 self-stretch rounded"
            style={{ background: accent, boxShadow: `0 2px 8px -2px ${accent}` }}
          />
          {/* Serif display heading, tinted to the category color. */}
          <h2
            title={category.name}
            className="m-0 min-w-0 grow truncate font-display text-[31px] font-medium"
            style={{ letterSpacing: '-0.018em', color: accent }}
          >
            {category.name}
          </h2>
          {/* "N open" pill — solid text-safe category color (white on it clears
              AA, chunk 75) with a soft colored shadow. */}
          <span
            className="num label inline-block shrink-0 rounded-full"
            style={{
              background: catInk(category.name),
              color: '#fff',
              padding: '4px 10px',
              letterSpacing: '0.1em',
              boxShadow: `0 5px 14px -5px ${accent}`,
            }}
          >
            {open.length} open
          </span>
        </div>
        {/* Wraps too: in a column narrower than the controls they wrap rather
            than overflowing to the left. */}
        <div className="flex min-w-0 flex-wrap items-center justify-end gap-x-3.5 gap-y-1.5">
          {/* Chunk 33: list sort — global preference, one control per column. */}
          {/* Chunk 76: near/long horizon — global preference, beside sort. */}
          <HorizonControl value={horizon} onChange={onChangeHorizon} />
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
        </div>
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
          <SortableContext
            id={`subs:${category.id}`}
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
                onSetTaskDue={onSetTaskDue}
                onSetTaskPriority={onSetTaskPriority}
                sortKey={sortKey}
                horizon={horizon}
                onRenameSubcategory={onRenameSubcategory}
                onDeleteSubcategory={onDeleteSubcategory}
                onMergeSubcategory={onMergeSubcategory}
                onMoveSubcategory={onMoveSubcategory}
                todaySet={todaySet}
                onToggleToday={onToggleToday}
                timeZone={timeZone}
              />
            ))}
          </SortableContext>
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
  todaySet?: Set<string>
  onToggleToday?: (id: string, force?: boolean) => void
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
