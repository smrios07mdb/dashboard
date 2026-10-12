import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from 'react'

import DeleteConfirm from '@/components/DeleteConfirm'
import {
  BookOpen,
  ChevronLeft,
  Link,
  MoreHorizontal,
  Pin,
  Plus,
  Trash,
  Unlink,
} from '@/components/icons'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { IconButton } from '@/components/ui/icon-button'
import { SyncDot } from '@/components/ui/sync-badge'
import { countOutboxFor } from '@/db/outbox'
import { useSyncStore } from '@/db/syncStore'
import { TABLES, type Note } from '@/db/types'
import { renderNoteMarkdown } from '@/lib/noteMarkdown'
import {
  noteDate,
  noteRelLong,
  noteSaveState,
  type NoteAttachment,
} from '@/lib/notes'
import { cn } from '@/lib/utils'

import AttachmentChip from './AttachmentChip'

/*
 * Note editor (chunk 58, D7).
 *
 * The title is a borderless input. The body is a plain auto-growing
 * <textarea> while it has focus and rendered Markdown when it does not —
 * source on focus, rendered on blur. No rich editor, no new dependency.
 *
 * Autosave, no Save button: edits debounce 600 ms, and flush at once on blur,
 * on unmount (which covers a route change and a switch to another note — the
 * screen keys this component by note id) and when the tab goes hidden.
 *
 * Text state is draft-or-null (prompts/README): while the user has unsaved
 * keystrokes the fields render from `draft`, otherwise from the `note` prop,
 * so a realtime refetch can never clobber typing and no effect copies props
 * into state.
 *
 * Embedded in the task sheet (chunk 59) it is given a `menu`: a ⋯ dropdown
 * holding Open in Notebook, New note on this task and Delete note, which
 * replaces the standalone header trash. The Notebook screen passes none.
 */

const AUTOSAVE_MS = 600

const HINT = 'Write. # for a heading, - for a list, paste a link to link it.'

type TextChanges = { title?: string; body?: string }

type NoteEditorProps = {
  note: Note
  /** False for a New-note draft nothing has been written for yet. */
  persisted: boolean
  attachment: NoteAttachment | null
  touch: boolean
  /** Write title/body changes. Rejects when the write failed. */
  onSave: (changes: TextChanges) => Promise<void>
  onTogglePin: () => void
  /** Open the attach picker. */
  onAttach: () => void
  /** Detach from the header's unlink control — immediate. */
  onDetach: () => void
  onDelete: () => void | Promise<void>
  /** Phone only: back to the list. Omitted where the host has its own way back. */
  onBack?: () => void
  /**
   * Task sheet only: a ⋯ menu in place of the header trash. Delete note in it
   * is the same confirm as the trash, wired to `onDelete`.
   */
  menu?: NoteEditorMenu
}

export type NoteEditorMenu = {
  /** Absent for a draft nothing has been written for — it is not in the Notebook yet. */
  onOpenInNotebook?: () => void
  onNewNote: () => void
}

export default function NoteEditor({
  note,
  persisted,
  attachment,
  touch,
  onSave,
  onTogglePin,
  onAttach,
  onDetach,
  onDelete,
  onBack,
  menu,
}: NoteEditorProps) {
  const [draft, setDraft] = useState<TextChanges | null>(null)
  // A blank note opens straight into the textarea.
  const [editing, setEditing] = useState(() => !note.title && !note.body)
  const [pending, setPending] = useState(false)
  const [queued, setQueued] = useState(0)
  const sync = useSyncStore((s) => s.state)

  const title = draft?.title ?? note.title
  const body = draft?.body ?? note.body

  const bodyRef = useRef<HTMLTextAreaElement>(null)
  /** Edits not yet handed to `onSave`. */
  const unsentRef = useRef<TextChanges | null>(null)
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  /** Bumped on every keystroke, so a save can tell whether it is still current. */
  const versionRef = useRef(0)
  const inFlightRef = useRef(0)
  const mountedRef = useRef(true)
  const onSaveRef = useRef(onSave)
  useEffect(() => {
    onSaveRef.current = onSave
  }, [onSave])

  const noteId = note.id
  const refreshQueued = useCallback(() => {
    void countOutboxFor(TABLES.notes, noteId).then((n) => {
      if (mountedRef.current) setQueued(n)
    })
  }, [noteId])

  const flush = useCallback(() => {
    if (timerRef.current !== null) {
      clearTimeout(timerRef.current)
      timerRef.current = null
    }
    const changes = unsentRef.current
    if (!changes) return
    unsentRef.current = null
    const version = versionRef.current
    inFlightRef.current += 1
    const settle = () => {
      inFlightRef.current -= 1
      if (!mountedRef.current) return
      if (inFlightRef.current === 0 && !unsentRef.current) setPending(false)
      refreshQueued()
    }
    onSaveRef.current(changes).then(
      () => {
        // Nothing typed since: the saved note now carries this text.
        if (mountedRef.current && versionRef.current === version) setDraft(null)
        settle()
      },
      () => {
        // Keep the text on screen and resend it with the next edit or blur.
        unsentRef.current = { ...changes, ...unsentRef.current }
        settle()
      },
    )
  }, [refreshQueued])

  const edit = (changes: TextChanges) => {
    setDraft((d) => ({ ...d, ...changes }))
    unsentRef.current = { ...unsentRef.current, ...changes }
    versionRef.current += 1
    setPending(true)
    if (timerRef.current !== null) clearTimeout(timerRef.current)
    timerRef.current = setTimeout(flush, AUTOSAVE_MS)
  }

  // Flush on unmount (route change, another note selected) and when the tab
  // is hidden — the last chance before a phone suspends the page.
  useEffect(() => {
    mountedRef.current = true
    const onVisibility = () => {
      if (document.visibilityState === 'hidden') flush()
    }
    document.addEventListener('visibilitychange', onVisibility)
    return () => {
      document.removeEventListener('visibilitychange', onVisibility)
      mountedRef.current = false
      flush()
    }
  }, [flush])

  // The outbox count for this note moves when the sync state does.
  useEffect(() => {
    refreshQueued()
  }, [refreshQueued, sync])

  // Auto-grow, and put the caret at the end when the rendered body is tapped.
  useLayoutEffect(() => {
    const el = bodyRef.current
    if (!editing || !el) return
    el.style.height = 'auto'
    el.style.height = `${el.scrollHeight}px`
  }, [editing, body])
  useEffect(() => {
    const el = bodyRef.current
    if (!editing || !el || document.activeElement === el) return
    el.focus()
    el.setSelectionRange(el.value.length, el.value.length)
  }, [editing])

  const rendered = useMemo(() => renderNoteMarkdown(body), [body])
  const save = noteSaveState({ sync, queued, pending })
  const ctl = touch ? 40 : 28
  const glyph = touch ? 18 : 16
  const linked = attachment && attachment.kind !== 'detached' ? attachment : null

  const deleteCopy = linked ? (
    <>
      This cannot be undone. The {linked.kind === 'task' ? 'task' : 'list'}{' '}
      <strong className="font-semibold text-ink">{linked.name}</strong> is not
      affected.
    </>
  ) : (
    'This cannot be undone.'
  )

  return (
    <div className="flex h-full min-h-0 flex-col">
      <header
        className={cn(
          'flex min-w-0 items-center gap-2 border-b border-line py-2 pr-2.5',
          menu ? 'pl-3.5' : 'pl-1.5 sm:px-[18px] sm:py-3.5',
        )}
      >
        {onBack && (
          <IconButton
            label="Back to notes"
            size={44}
            tone="ink"
            onClick={onBack}
            className="sm:hidden"
          >
            <ChevronLeft size={20} />
          </IconButton>
        )}
        <div className="flex min-w-0 flex-1 items-center gap-0.5 overflow-hidden">
          {linked ? (
            <>
              <AttachmentChip
                attachment={linked}
                size={touch ? 'sm' : 'md'}
                onClick={onAttach}
                className="min-w-0 shrink"
              />
              <IconButton
                label={`Detach from ${linked.name}`}
                size={ctl}
                onClick={onDetach}
              >
                <Unlink size={glyph - 1} />
              </IconButton>
            </>
          ) : (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={onAttach}
              className="text-ink-2"
              style={{ height: ctl }}
            >
              <Link aria-hidden />
              Attach
            </Button>
          )}
        </div>
        {(persisted || pending) && (
          <span
            role="status"
            data-testid="note-save-state"
            className="inline-flex shrink-0 items-center gap-1.5 whitespace-nowrap text-[11.5px] text-ink-3"
          >
            <SyncDot state={save.dot} />
            {save.label}
          </span>
        )}
        <IconButton
          label={note.pinned ? 'Unpin' : 'Pin'}
          aria-pressed={note.pinned}
          size={ctl}
          tone={note.pinned ? 'accent' : 'ghost'}
          onClick={onTogglePin}
        >
          <Pin size={glyph} fill={note.pinned ? 'currentColor' : 'none'} />
        </IconButton>
        {menu ? (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <IconButton label="Note actions" size={ctl}>
                <MoreHorizontal size={glyph} />
              </IconButton>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem
                disabled={!menu.onOpenInNotebook}
                onSelect={() => menu.onOpenInNotebook?.()}
              >
                <BookOpen size={14} aria-hidden />
                Open in Notebook
              </DropdownMenuItem>
              <DropdownMenuItem onSelect={() => menu.onNewNote()}>
                <Plus size={14} aria-hidden />
                New note on this task
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DeleteConfirm
                trigger={
                  <DropdownMenuItem
                    // Keep the menu open until the AlertDialog has focus.
                    onSelect={(e) => e.preventDefault()}
                    className="text-destructive focus:text-destructive"
                  >
                    <Trash size={14} aria-hidden />
                    Delete note
                  </DropdownMenuItem>
                }
                title="Delete this note?"
                description={deleteCopy}
                onConfirm={onDelete}
              />
            </DropdownMenuContent>
          </DropdownMenu>
        ) : (
          <DeleteConfirm
            trigger={
              <IconButton label="Delete note" size={ctl}>
                <Trash size={glyph} />
              </IconButton>
            }
            title="Delete this note?"
            description={deleteCopy}
            onConfirm={onDelete}
          />
        )}
      </header>

      <div className="min-h-0 flex-1 overflow-y-auto">
        <div
          className={cn(
            'w-full max-w-[720px] px-5 pb-10 pt-3.5',
            !menu && 'sm:px-9 sm:pb-[60px] sm:pt-[26px]',
          )}
        >
          {attachment?.kind === 'detached' && (
            <div
              data-testid="detached-strip"
              className="mb-4 flex items-center gap-2.5 rounded-md bg-bg-alt px-3 py-[9px] text-[12.5px] text-ink-2"
            >
              <Unlink aria-hidden size={14} className="shrink-0 text-ink-3" />
              <span className="flex-1">
                Detached from{' '}
                <strong className="font-semibold text-ink">
                  {attachment.name}
                </strong>
                {note.detachedAt
                  ? `, which was deleted on ${noteDate(note.detachedAt)}.`
                  : '.'}{' '}
                The note was kept.
              </span>
            </div>
          )}
          <input
            value={title}
            onChange={(e) => edit({ title: e.target.value })}
            onBlur={flush}
            placeholder="Untitled"
            aria-label="Title"
            className={cn(
              'title mb-2 w-full border-0 bg-transparent p-0 leading-[1.15] outline-none placeholder:text-ink-4',
              menu ? 'text-[22px]' : 'text-[26px] sm:mb-3 sm:text-[30px]',
            )}
          />
          {editing ? (
            <textarea
              ref={bodyRef}
              value={body}
              onChange={(e) => edit({ body: e.target.value })}
              onBlur={() => {
                flush()
                if (body.trim()) setEditing(false)
              }}
              placeholder={HINT}
              aria-label="Note body"
              className={cn(
                'block min-h-40 w-full resize-none border-0 bg-transparent p-0 leading-[1.6] text-ink outline-none placeholder:text-ink-3',
                touch ? 'text-[16px]' : 'text-[15px]',
              )}
            />
          ) : (
            <div
              role="button"
              tabIndex={0}
              aria-label="Edit note body"
              onClick={(e) => {
                // A link in the rendered body opens; it does not start an edit.
                if ((e.target as HTMLElement).closest('a')) return
                setEditing(true)
              }}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && e.target === e.currentTarget) {
                  e.preventDefault()
                  setEditing(true)
                }
              }}
              className={cn(
                'min-h-[120px] cursor-text break-words leading-[1.6] text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
                touch ? 'text-[16px]' : 'text-[15px]',
              )}
            >
              {rendered}
            </div>
          )}
          <div className="mt-7 flex flex-wrap items-center gap-x-3.5 gap-y-2">
            <span className="label">
              Created {noteDate(note.createdAt)} · Updated{' '}
              {noteRelLong(note.updatedAt)}
            </span>
            {editing && (
              <span className="hidden text-[12px] text-ink-3 sm:inline">
                {HINT}
              </span>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
