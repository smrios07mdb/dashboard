import { useState, useSyncExternalStore, type KeyboardEvent, type ReactNode } from 'react'
import {
  DndContext,
  PointerSensor,
  TouchSensor,
  pointerWithin,
  useDraggable,
  useDroppable,
  useSensor,
  useSensors,
  type DragEndEvent,
} from '@dnd-kit/core'
import { MoreHorizontal, Plus, X } from 'lucide-react'
import { toast } from 'sonner'

import { TaskDragOverlay } from '@/components/TaskDragGhost'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet'
import { repo } from '@/db/repo'
import type { Category, Subcategory } from '@/db/types'
import { isOnline } from '@/lib/network'
import {
  addNewGroup,
  approveToast,
  buildGroups,
  buildPayload,
  destFromGroupId,
  groupId,
  initialState,
  moveItem,
  newListNameError,
  renameNewGroup,
  routingTargets,
  type Dest,
  type Group,
  type NewGroup,
  type RoutingProposal,
  type SortItem,
  type SortState,
} from '@/lib/sorting'
import { useIsTouchDevice } from '@/lib/useIsTouchDevice'
import { cn } from '@/lib/utils'
import { useUIStore } from '@/state/uiStore'

/*
 * Sort General (chunk 89, ARCHITECTURE.md §10). Claude's routing proposals,
 * one group per destination: existing lists, proposed New lists, Keep in
 * General. Cards move by drag or by their Move to… menu; × keeps a task in
 * General. Approve sends the arrangement to `apply_routing` in one call;
 * Not now closes and leaves every proposal pending. Online-only.
 *
 * Desktop: right-side sheet. Touch: full-height bottom sheet. One branch
 * mounts (useIsTouchDevice), so there is no `data-branch` pair.
 */

const BUTTON =
  'min-h-11 rounded-md border border-line bg-bg px-3.5 text-[13px] font-semibold text-ink hover:bg-bg-alt focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50'
const INVALID = 'shadow-[inset_0_0_0_1px_hsl(var(--destructive))]'
const SAVE_ERROR = 'Could not save — retry'

function subscribeOnline(cb: () => void) {
  window.addEventListener('online', cb)
  window.addEventListener('offline', cb)
  return () => {
    window.removeEventListener('online', cb)
    window.removeEventListener('offline', cb)
  }
}

type SortingSheetProps = {
  open: boolean
  proposals: RoutingProposal[]
  categories: Category[]
  /** Live (non-archived) subcategories. */
  subcategories: Subcategory[]
  onClose: () => void
}

export default function SortingSheet({
  open,
  proposals,
  categories,
  subcategories,
  onClose,
}: SortingSheetProps) {
  const isTouch = useIsTouchDevice()
  const online = useSyncExternalStore(subscribeOnline, isOnline, () => true)
  const [state, setState] = useState<SortState>(() => initialState(proposals, subcategories))
  const [saving, setSaving] = useState(false)
  // Re-snapshot on each open ("adjust state during render", prompts/README).
  const [prevOpen, setPrevOpen] = useState(open)
  if (open !== prevOpen) {
    setPrevOpen(open)
    if (open) setState(initialState(proposals, subcategories))
  }

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 200, tolerance: 5 } }),
  )

  const groups = buildGroups(state, categories, subcategories)
  const move = (proposalId: string, dest: Dest) => setState((s) => moveItem(s, proposalId, dest))

  function handleDragEnd(event: DragEndEvent) {
    const proposalId = (event.active.data.current as { proposalId?: string } | undefined)
      ?.proposalId
    const dest = event.over ? destFromGroupId(String(event.over.id)) : null
    if (proposalId && dest) move(proposalId, dest)
  }

  async function approve() {
    setSaving(true)
    try {
      const result = await repo.routing.apply(buildPayload(state))
      toast.success(approveToast(result))
      useUIStore.getState().forceDashboardRefresh()
      onClose()
    } catch (e) {
      console.error('apply_routing failed', e)
      toast.error(SAVE_ERROR)
    } finally {
      setSaving(false)
    }
  }

  return (
    <Sheet
      open={open}
      onOpenChange={(next) => {
        if (!next) onClose()
      }}
    >
      <SheetContent
        side={isTouch ? 'bottom' : 'right'}
        data-side={isTouch ? 'bottom' : 'right'}
        className="flex w-full flex-col gap-4 overflow-y-auto sm:max-w-md data-[side=bottom]:h-[100dvh]"
      >
        <SheetHeader>
          <SheetTitle>Sort General</SheetTitle>
          <SheetDescription>
            Claude&rsquo;s suggestions. Drag a task to another group, then Approve.
          </SheetDescription>
        </SheetHeader>

        <DndContext sensors={sensors} collisionDetection={pointerWithin} onDragEnd={handleDragEnd}>
          <div className="flex flex-col gap-4">
            {groups.map((g) => (
              <GroupSection
                key={g.id}
                group={g}
                state={state}
                subcategories={subcategories}
                onRename={(key, name) => setState((s) => renameNewGroup(s, key, name))}
              >
                {g.items.map((item) => (
                  <ProposalCard
                    key={item.proposalId}
                    item={item}
                    state={state}
                    categories={categories}
                    subcategories={subcategories}
                    onMove={move}
                  />
                ))}
              </GroupSection>
            ))}
          </div>
          <TaskDragOverlay />
        </DndContext>

        <NewListForm
          state={state}
          categories={categories}
          subcategories={subcategories}
          onAdd={(name, categoryId) => setState((s) => addNewGroup(s, name, categoryId))}
        />

        <div className="mt-auto flex flex-wrap items-center gap-2 border-t border-line pt-4">
          <Button
            className="min-h-11"
            disabled={!online || saving || state.items.length === 0}
            onClick={() => void approve()}
          >
            Approve
          </Button>
          <button type="button" className={BUTTON} onClick={onClose}>
            Not now
          </button>
          {!online && <span className="text-[13px] text-ink-3">Needs a connection</span>}
        </div>
      </SheetContent>
    </Sheet>
  )
}

function GroupSection({
  group,
  state,
  subcategories,
  onRename,
  children,
}: {
  group: Group
  state: SortState
  subcategories: Subcategory[]
  onRename: (key: string, name: string) => void
  children: ReactNode
}) {
  const { setNodeRef, isOver } = useDroppable({ id: group.id })
  let heading: ReactNode
  if (group.kind === 'existing') {
    heading = (
      <span className="text-[13px] font-semibold text-ink">
        {group.categoryName} › {group.sub.name}
      </span>
    )
  } else if (group.kind === 'new') {
    heading = (
      <span className="flex min-w-0 items-center gap-2">
        <span className="label rounded bg-accent-soft px-1.5 py-0.5 text-[11px]">NEW</span>
        <span className="text-[13px] text-ink-3">{group.categoryName} ›</span>
        <NewListName
          group={group.group}
          state={state}
          subcategories={subcategories}
          onRename={onRename}
        />
      </span>
    )
  } else {
    heading = <span className="text-[13px] font-semibold text-ink">Keep in General</span>
  }
  return (
    <section
      ref={setNodeRef}
      aria-label={group.kind === 'keep' ? 'Keep in General' : undefined}
      data-group={group.id}
      className={cn(
        'flex flex-col gap-2 rounded-lg border border-line p-3',
        isOver && 'bg-accent-soft ring-1 ring-inset ring-[hsl(var(--ring))]',
      )}
    >
      <div className="flex items-center justify-between gap-2">
        {heading}
        <span className="num text-[12px] text-ink-3">{group.items.length}</span>
      </div>
      {children}
      {group.items.length === 0 && (
        <p className="m-0 text-[12px] text-ink-3">Drop tasks here</p>
      )}
    </section>
  )
}

/** Inline rename, draft-or-null (prompts/README). Invalid input reverts on blur. */
function NewListName({
  group,
  state,
  subcategories,
  onRename,
}: {
  group: NewGroup
  state: SortState
  subcategories: Subcategory[]
  onRename: (key: string, name: string) => void
}) {
  const [draft, setDraft] = useState<string | null>(null)
  if (draft === null) {
    return (
      <button
        type="button"
        className="min-w-0 truncate text-left text-[13px] font-semibold text-ink underline decoration-dotted underline-offset-4"
        aria-label={`Rename new list ${group.name}`}
        onClick={() => setDraft(group.name)}
      >
        {group.name}
      </button>
    )
  }
  const error = newListNameError(state, subcategories, group.categoryId, draft, group.key)
  const commit = () => {
    if (!error) onRename(group.key, draft)
    setDraft(null)
  }
  return (
    <input
      autoFocus
      value={draft}
      aria-label="New list name"
      aria-invalid={error ? true : undefined}
      title={error ?? undefined}
      maxLength={60}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={commit}
      onKeyDown={(e: KeyboardEvent<HTMLInputElement>) => {
        if (e.key === 'Enter' && !error) commit()
        if (e.key === 'Escape') {
          e.stopPropagation()
          setDraft(null)
        }
      }}
      className={cn(
        'min-w-0 flex-1 rounded border border-line bg-bg px-2 py-1 text-base text-ink sm:text-[13px]',
        error && INVALID,
      )}
    />
  )
}

function ProposalCard({
  item,
  state,
  categories,
  subcategories,
  onMove,
}: {
  item: SortItem
  state: SortState
  categories: Category[]
  subcategories: Subcategory[]
  onMove: (proposalId: string, dest: Dest) => void
}) {
  const [expanded, setExpanded] = useState(false)
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({
    id: `task:${item.taskId}`,
    data: {
      title: item.title,
      subcategoryId: item.fromSubcategoryId,
      proposalId: item.proposalId,
    },
  })
  const current = groupId(item.dest)
  const targets = routingTargets(subcategories)
  return (
    <div
      ref={setNodeRef}
      data-testid="sort-card"
      data-proposal={item.proposalId}
      className={cn(
        'flex touch-manipulation items-start gap-2 rounded-md border border-line bg-surface px-3 py-2',
        isDragging && 'opacity-40',
      )}
      {...attributes}
      {...listeners}
    >
      <div className="min-w-0 flex-1">
        <p className="m-0 break-words text-[14px] text-ink">{item.title}</p>
        <p
          title={item.reason}
          onClick={() => setExpanded((x) => !x)}
          className={cn('m-0 text-[12px] text-ink-3', expanded ? 'break-words' : 'truncate')}
        >
          {item.reason}
        </p>
      </div>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <button
            type="button"
            aria-label={`Move ${item.title} to…`}
            onPointerDown={(e) => e.stopPropagation()}
            className="grid size-8 shrink-0 place-items-center rounded text-ink-3 hover:bg-bg-alt focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            <MoreHorizontal className="size-4" aria-hidden />
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="max-h-[60vh] overflow-y-auto">
          <DropdownMenuLabel>Move to…</DropdownMenuLabel>
          {current !== 'keep' && (
            <DropdownMenuItem onSelect={() => onMove(item.proposalId, { kind: 'keep' })}>
              Keep in General
            </DropdownMenuItem>
          )}
          {state.newGroups
            .filter((g) => current !== `new:${g.key}`)
            .map((g) => (
              <DropdownMenuItem
                key={g.key}
                onSelect={() => onMove(item.proposalId, { kind: 'new', key: g.key })}
              >
                New: {g.name}
              </DropdownMenuItem>
            ))}
          {categories.map((c) => {
            const lists = targets
              .filter((s) => s.categoryId === c.id && current !== `list:${s.id}`)
              .sort((a, b) => a.sortOrder - b.sortOrder)
            if (lists.length === 0) return null
            return (
              <div key={c.id}>
                <DropdownMenuSeparator />
                <DropdownMenuLabel>{c.name}</DropdownMenuLabel>
                {lists.map((s) => (
                  <DropdownMenuItem
                    key={s.id}
                    onSelect={() => onMove(item.proposalId, { kind: 'existing', subId: s.id })}
                  >
                    {s.name}
                  </DropdownMenuItem>
                ))}
              </div>
            )
          })}
        </DropdownMenuContent>
      </DropdownMenu>
      {current !== 'keep' && (
        <button
          type="button"
          aria-label={`Keep ${item.title} in General`}
          onPointerDown={(e) => e.stopPropagation()}
          onClick={() => onMove(item.proposalId, { kind: 'keep' })}
          className="grid size-8 shrink-0 place-items-center rounded text-ink-3 hover:bg-bg-alt focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          <X className="size-4" aria-hidden />
        </button>
      )}
    </div>
  )
}

function NewListForm({
  state,
  categories,
  subcategories,
  onAdd,
}: {
  state: SortState
  categories: Category[]
  subcategories: Subcategory[]
  onAdd: (name: string, categoryId: string) => void
}) {
  const [name, setName] = useState<string | null>(null)
  const [categoryId, setCategoryId] = useState(categories[0]?.id ?? '')
  if (name === null) {
    return (
      <button type="button" className={cn(BUTTON, 'self-start')} onClick={() => setName('')}>
        <Plus className="mr-1 inline size-4" aria-hidden />
        New list
      </button>
    )
  }
  const error = newListNameError(state, subcategories, categoryId, name)
  const add = () => {
    if (error) return
    onAdd(name, categoryId)
    setName(null)
  }
  return (
    <div className="flex flex-wrap items-center gap-2">
      <input
        autoFocus
        value={name}
        aria-label="New list name"
        aria-invalid={name.length > 0 && error ? true : undefined}
        placeholder="List name"
        maxLength={60}
        onChange={(e) => setName(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') add()
          if (e.key === 'Escape') {
            e.stopPropagation()
            setName(null)
          }
        }}
        className={cn(
          'min-h-11 min-w-0 flex-[1_1_160px] rounded-md border border-line bg-bg px-3 text-base text-ink sm:text-[13px]',
          name.length > 0 && error && INVALID,
        )}
      />
      <select
        aria-label="Category"
        value={categoryId}
        onChange={(e) => setCategoryId(e.target.value)}
        className="min-h-11 rounded-md border border-line bg-bg px-2 text-base text-ink sm:text-[13px]"
      >
        {categories.map((c) => (
          <option key={c.id} value={c.id}>
            {c.name}
          </option>
        ))}
      </select>
      <button type="button" className={BUTTON} disabled={Boolean(error)} onClick={add}>
        Add
      </button>
      <button type="button" className={BUTTON} onClick={() => setName(null)}>
        Cancel
      </button>
    </div>
  )
}
