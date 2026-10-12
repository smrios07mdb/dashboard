import { useMemo, useState, type ReactNode } from 'react'

import { Plus, Search, X } from '@/components/icons'
import { Button } from '@/components/ui/button'
import { IconButton } from '@/components/ui/icon-button'
import type { Note } from '@/db/types'
import {
  byUpdatedDesc,
  filterNotes,
  isOnCompletedTask,
  noteExcerpt,
  noteFirstLine,
  noteMatchLine,
  noteRel,
  resolveAttachment,
  splitOnMatch,
  type NoteContext,
  type NoteFilter,
} from '@/lib/notes'
import { cn } from '@/lib/utils'

import AttachmentChip from './AttachmentChip'

/*
 * Notebook list pane (chunk 58, D6): header, search, the All / Freeform /
 * Attached segment, then PINNED and RECENT groups, each newest-updated first.
 *
 * Notes on completed tasks are left out until the `+N ON COMPLETED TASKS` row
 * is used. That reveal is session-scoped component state, the same shape as
 * `SubcategorySection`'s completed-task reveal — the app has no persisted
 * hide-completed preference. Freeform and list notes are never hidden.
 *
 * Search runs over the notes already in memory (the Dexie mirror), title and
 * body, case-insensitive.
 */

const FILTERS: { id: NoteFilter; label: string }[] = [
  { id: 'all', label: 'All' },
  { id: 'freeform', label: 'Freeform' },
  { id: 'attached', label: 'Attached' },
]

/** `text` with the first match of `query` wrapped in a <mark> — text nodes only. */
function Highlight({ text, query }: { text: string; query: string }) {
  const parts = splitOnMatch(text, query)
  if (!parts) return <>{text}</>
  return (
    <>
      {parts.before}
      <mark className="rounded-[2px] bg-accent-soft px-px font-semibold text-accent-ink">
        {parts.match}
      </mark>
      {parts.after}
    </>
  )
}

function DashedCard({
  title,
  body,
  action,
}: {
  title: ReactNode
  body: string
  action?: ReactNode
}) {
  return (
    <div className="m-4 rounded-md border-2 border-dashed border-line-strong bg-[color-mix(in_srgb,var(--surface)_30%,transparent)] px-5 py-8 text-center sm:px-6 sm:py-12">
      <h2 className="title mb-2 text-[20px] sm:text-[22px]">{title}</h2>
      <p className="mx-auto max-w-[300px] text-pretty text-[13px] leading-[1.55] text-ink-2">
        {body}
      </p>
      {action && <div className="mt-[18px]">{action}</div>}
    </div>
  )
}

type NoteListProps = {
  notes: Note[]
  ctx: NoteContext
  activeId: string | null
  touch: boolean
  onSelect: (id: string) => void
  onNew: () => void
}

export default function NoteList({
  notes,
  ctx,
  activeId,
  touch,
  onSelect,
  onNew,
}: NoteListProps) {
  const [filter, setFilter] = useState<NoteFilter>('all')
  const [query, setQuery] = useState('')
  const [showCompleted, setShowCompleted] = useState(false)

  const q = query.trim()
  const { pinned, recent, hiddenCount, anyOnCompleted, shown } = useMemo(() => {
    const matched = filterNotes(notes, filter, q)
    const onCompleted = matched.filter((n) => isOnCompletedTask(n, ctx.tasks))
    const visible = (
      showCompleted
        ? matched
        : matched.filter((n) => !isOnCompletedTask(n, ctx.tasks))
    )
      .slice()
      .sort(byUpdatedDesc)
    return {
      pinned: visible.filter((n) => n.pinned),
      recent: visible.filter((n) => !n.pinned),
      hiddenCount: showCompleted ? 0 : onCompleted.length,
      anyOnCompleted: onCompleted.length > 0,
      shown: visible.length,
    }
  }, [notes, filter, q, showCompleted, ctx.tasks])

  const empty = notes.length === 0

  const row = (note: Note) => {
    const active = note.id === activeId
    const attachment = resolveAttachment(note, ctx)
    const excerpt = (q && noteMatchLine(note, q)) || noteExcerpt(note)
    return (
      <button
        key={note.id}
        type="button"
        onClick={() => onSelect(note.id)}
        aria-current={active ? 'true' : undefined}
        data-testid="note-row"
        className={cn(
          'grid min-h-11 w-full grid-cols-[1fr_auto] gap-x-3 gap-y-0.5 border-b border-l-[3px] border-b-line px-4 py-[13px] text-left transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring sm:px-3.5 sm:py-[11px]',
          active
            ? 'border-l-[hsl(var(--accent))] bg-accent-soft'
            : 'border-l-transparent hover:bg-bg-alt',
        )}
      >
        <span
          data-testid="note-row-title"
          className={cn(
            'truncate text-[14px] font-semibold tracking-[-0.005em]',
            note.title ? 'text-ink' : 'italic text-ink-2',
          )}
        >
          <Highlight text={noteFirstLine(note)} query={q} />
        </span>
        <span className="num pt-0.5 text-[11px] text-ink-3">
          {noteRel(note.updatedAt)}
        </span>
        {excerpt && (
          <span className="col-span-full line-clamp-2 text-pretty text-[12.5px] leading-[1.45] text-ink-2">
            <Highlight text={excerpt} query={q} />
          </span>
        )}
        {attachment && (
          <span className="col-span-full mt-[5px] flex">
            <AttachmentChip attachment={attachment} size="sm" />
          </span>
        )}
      </button>
    )
  }

  return (
    <div className="flex min-h-0 flex-col sm:h-full">
      <div className="flex items-center justify-between gap-3 px-4 pb-3 pt-1 sm:px-3.5 sm:pt-3.5">
        <div className="min-w-0">
          <h1 className="title text-[32px] sm:text-[26px]">Notebook</h1>
          <div className="label mt-1.5 sm:hidden">
            {notes.length} {notes.length === 1 ? 'note' : 'notes'}
          </div>
        </div>
        {/* One control at both sizes: a 44px round "+" on phones, the labelled
            primary button from sm up. */}
        <Button
          type="button"
          onClick={onNew}
          className="size-11 shrink-0 rounded-full p-0 sm:h-8 sm:w-auto sm:rounded-md sm:px-3 sm:text-xs"
        >
          <Plus aria-hidden />
          <span className="max-sm:sr-only">New note</span>
        </Button>
      </div>

      {!empty && (
        <div className="flex flex-col gap-2.5 px-4 pb-2.5 sm:px-3.5">
          <div
            className={cn(
              'flex items-center gap-2 rounded-md border border-line-strong bg-surface px-2.5 focus-within:ring-2 focus-within:ring-ring',
              touch ? 'h-11' : 'h-9',
            )}
          >
            <Search aria-hidden size={15} className="shrink-0 text-ink-3" />
            <input
              type="search"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search notes"
              aria-label="Search notes"
              className={cn(
                'min-w-0 flex-1 border-0 bg-transparent p-0 text-ink outline-none placeholder:text-ink-3 [&::-webkit-search-cancel-button]:hidden',
                touch ? 'text-[16px]' : 'text-[13px]',
              )}
            />
            {query && (
              <IconButton
                label="Clear search"
                size={touch ? 32 : 24}
                onClick={() => setQuery('')}
              >
                <X size={14} />
              </IconButton>
            )}
          </div>
          <div
            role="tablist"
            aria-label="Filter notes"
            className="inline-flex gap-0.5 self-start rounded-full bg-bg-alt p-0.5"
          >
            {FILTERS.map((it) => {
              const on = it.id === filter
              return (
                <button
                  key={it.id}
                  type="button"
                  role="tab"
                  aria-selected={on}
                  onClick={() => setFilter(it.id)}
                  className={cn(
                    'rounded-full text-[12px] transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
                    touch ? 'h-8 px-3.5' : 'h-[26px] px-3',
                    on
                      ? 'bg-surface font-semibold text-ink shadow-sm'
                      : 'font-medium text-ink-2',
                  )}
                >
                  {it.label}
                </button>
              )
            })}
          </div>
        </div>
      )}

      <div className="min-h-0 flex-1 sm:overflow-y-auto">
        {empty && (
          <DashedCard
            title="Nothing written yet."
            body="Notes can stand alone or sit beside a task or list. Start one here, or from any task's menu."
            action={
              <Button type="button" onClick={onNew}>
                <Plus aria-hidden />
                New note
              </Button>
            }
          />
        )}
        {!empty && shown === 0 && hiddenCount === 0 && (
          <DashedCard
            title={q ? `No notes match “${q}”.` : 'No notes here.'}
            body={
              q
                ? 'Search looks at titles and bodies. Try another word, or clear the filter.'
                : filter === 'attached'
                  ? 'Attach a note to a task or list from its header, or from a task’s menu.'
                  : 'Every note is attached to a task or list. Start a freeform one with New note.'
            }
          />
        )}
        {pinned.length > 0 && <div className="label px-4 pb-1 pt-2.5">Pinned</div>}
        {pinned.map(row)}
        {recent.length > 0 && (
          <div className={cn('label px-4 pb-1', pinned.length > 0 ? 'pt-3.5' : 'pt-2.5')}>
            Recent
          </div>
        )}
        {recent.map(row)}
        {hiddenCount > 0 && (
          <button
            type="button"
            onClick={() => setShowCompleted(true)}
            className="label block min-h-11 w-full px-4 py-3.5 text-left hover:text-ink-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
          >
            +{hiddenCount} on completed tasks
          </button>
        )}
        {showCompleted && anyOnCompleted && (
          <button
            type="button"
            onClick={() => setShowCompleted(false)}
            className="label block min-h-11 w-full px-4 py-3.5 text-left hover:text-ink-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
          >
            Hide completed tasks’ notes
          </button>
        )}
      </div>
    </div>
  )
}
