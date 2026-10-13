import { useEffect, useRef, useState, type FormEvent } from 'react'
import { ChevronDown, X } from 'lucide-react'
import { toast } from 'sonner'

import { DEFAULT_MINUTES } from '@/components/AddTaskInline'
import { fromDueInputValue } from '@/components/SetDuePopover'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { repo } from '@/db/repo'
import type { Category, Subcategory } from '@/db/types'
import { useSession } from '@/lib/auth'
import { parseCapture, resolveCaptureDest } from '@/lib/captureParse'
import { loadUserTimezone } from '@/lib/userTimezone'
import { useUIStore } from '@/state/uiStore'

/*
 * Quick capture (chunk 73, UX audit #7): one field, reachable from every
 * screen, that takes a task with its signal in the same line —
 * `Call Bob tomorrow p1 15m #work`. `lib/captureParse` reads the line; each
 * recognised word shows as a chip whose × hands the word back to the title.
 *
 * Destination: a `#list` word, else the list picked here, else the last list
 * captured into (`localStorage['hup:captureDest']`), else General — see
 * `resolveCaptureDest`. Nothing is created but the task; there is no Inbox.
 *
 * Open state lives in `uiStore.capture` (mode `add`). After a successful add
 * the dialog stays open, cleared and focused, for the next task — the
 * AddTaskInline pattern.
 */

const DEST_KEY = 'hup:captureDest'
const SAVE_ERROR = 'Could not save — retry'
const NO_IGNORE: ReadonlySet<number> = new Set()

// Near the top instead of centred, so the on-screen keyboard never covers it.
const PLACEMENT =
  'top-[env(safe-area-inset-top)] translate-y-0 gap-3 data-[state=closed]:!slide-out-to-top-0 data-[state=open]:!slide-in-from-top-0 sm:top-[15%]'

type Lists = {
  categories: Category[]
  /** Live only. */
  subcategories: Subcategory[]
  timeZone: string
  /** `hup:captureDest` as read on open, then the last list added to. */
  remembered: string | null
}

function readRemembered(): string | null {
  try {
    return localStorage.getItem(DEST_KEY)
  } catch {
    return null
  }
}

export default function QuickCapture() {
  const capture = useUIStore((s) => s.capture)
  const closeCapture = useUIStore((s) => s.closeCapture)
  const openCapture = useUIStore((s) => s.openCapture)
  const { user } = useSession()
  const userId = user?.id ?? null
  const open = capture?.mode === 'add' && userId !== null
  const seed = open ? (capture?.text ?? '') : ''

  const [text, setText] = useState(seed)
  // The instant the line was last read at; refreshed on open and every change.
  const [now, setNow] = useState(() => new Date())
  const [ignore, setIgnore] = useState(NO_IGNORE)
  const [picked, setPicked] = useState<string | null>(null)
  const [picking, setPicking] = useState(false)
  const [lists, setLists] = useState<Lists | null>(null)
  const [loadFailed, setLoadFailed] = useState(false)
  const [loadSeq, setLoadSeq] = useState(0)
  const [submitting, setSubmitting] = useState(false)
  const inputRef = useRef<HTMLInputElement | null>(null)

  // Reset on open and on close: the prevOpen pattern (prompts/README).
  const [prevOpen, setPrevOpen] = useState(open)
  if (prevOpen !== open) {
    setPrevOpen(open)
    setText(seed)
    setIgnore(NO_IGNORE)
    setPicked(null)
    setPicking(false)
    setLists(null)
    setLoadFailed(false)
  }

  useEffect(() => {
    if (!open) return
    let cancelled = false
    Promise.all([
      repo.categories.list(),
      repo.subcategories.list(),
      loadUserTimezone(),
    ])
      .then(([categories, subcategories, timeZone]) => {
        if (cancelled) return
        setLists({
          categories,
          subcategories: subcategories.filter((s) => s.archivedAt === null),
          timeZone,
          remembered: readRemembered(),
        })
      })
      .catch((e) => {
        if (cancelled) return
        console.error('Capture lists failed to load', e)
        setLoadFailed(true)
      })
    return () => {
      cancelled = true
    }
  }, [open, loadSeq])

  const parsed = lists
    ? parseCapture(text, {
        now,
        timeZone: lists.timeZone,
        categories: lists.categories,
        subcategories: lists.subcategories,
        ignore,
      })
    : null
  const dest =
    lists && parsed
      ? resolveCaptureDest(parsed, {
          categories: lists.categories,
          subcategories: lists.subcategories,
          picked,
          remembered: lists.remembered,
        })
      : null
  const destLabel = (sub: Subcategory) =>
    `${lists?.categories.find((c) => c.id === sub.categoryId)?.name ?? ''} › ${sub.name}`

  const disabled = submitting || !parsed || !dest || parsed.title.length === 0

  const keepInTitle = (indices: number[]) =>
    setIgnore((prev) => new Set([...prev, ...indices]))

  function pickList(subcategoryId: string) {
    // Every `#word` goes back to the title, not just the recognised one — or
    // the next `#list` in the line would take over from the list just picked.
    const words = text.split(/\s+/).filter((w) => w.length > 0)
    keepInTitle(words.flatMap((w, i) => (w.startsWith('#') ? [i] : [])))
    setPicked(subcategoryId)
    setPicking(false)
    inputRef.current?.focus()
  }

  async function submit() {
    if (disabled || !lists || !parsed || !dest || !userId) return
    setSubmitting(true)
    try {
      await repo.tasks.create({
        userId,
        subcategoryId: dest.id,
        title: parsed.title,
        estimateMinutes: parsed.estimateMinutes ?? DEFAULT_MINUTES,
        dueAt: parsed.dueDay
          ? fromDueInputValue(parsed.dueDay, lists.timeZone)
          : null,
        remindAt: null,
        priority: parsed.priority,
        completedAt: null,
      })
    } catch (e) {
      console.error('Capture failed', e)
      toast.error(SAVE_ERROR)
      setSubmitting(false)
      return
    }
    toast(`Task added — ${destLabel(dest)}`)
    try {
      localStorage.setItem(DEST_KEY, dest.id)
    } catch {
      // Storage unavailable: the destination is still remembered for this open.
    }
    useUIStore.getState().forceDashboardRefresh()
    setLists({ ...lists, remembered: dest.id })
    setText('')
    setIgnore(NO_IGNORE)
    setPicked(null)
    setSubmitting(false)
    // Microtask so React commits the cleared state before we focus.
    queueMicrotask(() => inputRef.current?.focus())
  }

  function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault()
    void submit()
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next) closeCapture()
      }}
    >
      <DialogContent
        className={PLACEMENT}
        onOpenAutoFocus={(e) => {
          e.preventDefault()
          setNow(new Date())
          inputRef.current?.focus()
        }}
      >
        <DialogTitle className="label text-[11px] font-medium leading-normal tracking-[0.16em]">
          New task
        </DialogTitle>
        <DialogDescription className="sr-only">
          Type a task. Add p1, 15m, tomorrow or #list to set them.
        </DialogDescription>

        <form onSubmit={onSubmit} className="flex items-center gap-2">
          <Input
            ref={inputRef}
            type="text"
            value={text}
            onChange={(e) => {
              setText(e.target.value)
              setNow(new Date())
            }}
            placeholder="Call Bob tomorrow p1 15m #work"
            aria-label="Task"
            autoComplete="off"
            className="h-10 bg-background text-base sm:text-[14px]"
          />
          <Button type="submit" disabled={disabled} className="h-10 shrink-0">
            {submitting ? 'Adding…' : 'Add'}
          </Button>
        </form>

        {loadFailed && (
          <div className="flex items-center gap-2 text-[13px] text-destructive">
            <span>Could not load your lists — retry.</span>
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => {
                setLoadFailed(false)
                setLoadSeq((n) => n + 1)
              }}
            >
              Retry
            </Button>
          </div>
        )}

        {lists && parsed && (
          <div className="flex flex-wrap items-center gap-1.5">
            {!dest ? (
              <span className="text-[13px] text-ink-3">Add a list first</span>
            ) : picking ? (
              <select
                aria-label="List"
                autoFocus
                value={dest.id}
                onChange={(e) => pickList(e.target.value)}
                onBlur={() => setPicking(false)}
                className="max-w-full rounded-sm border border-border bg-background px-2 py-1 text-base text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring sm:text-[13px]"
              >
                {lists.categories.map((cat) => (
                  <optgroup key={cat.id} label={cat.name}>
                    {lists.subcategories
                      .filter((s) => s.categoryId === cat.id)
                      .map((s) => (
                        <option key={s.id} value={s.id}>
                          {s.name}
                        </option>
                      ))}
                  </optgroup>
                ))}
              </select>
            ) : (
              <button
                type="button"
                onClick={() => setPicking(true)}
                title="Change list"
                className="inline-flex items-center gap-1 rounded-full border border-line px-2.5 py-0.5 text-[12px] font-medium text-foreground transition-colors hover:bg-secondary/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                {destLabel(dest)}
                <ChevronDown className="size-3 text-ink-3" aria-hidden />
              </button>
            )}
            {parsed.tokens
              .filter((t) => t.kind !== 'list')
              .map((t) => (
                <span
                  key={t.index}
                  className="inline-flex items-center gap-0.5 rounded-full bg-secondary py-0.5 pl-2.5 pr-1 text-[12px] font-medium text-secondary-foreground"
                >
                  {t.label}
                  <button
                    type="button"
                    aria-label={`Keep “${t.text}” in the title`}
                    onClick={() => {
                      keepInTitle([t.index])
                      inputRef.current?.focus()
                    }}
                    className="rounded-full p-1 text-ink-3 transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  >
                    <X className="size-3" aria-hidden />
                  </button>
                </span>
              ))}
          </div>
        )}

        {parsed?.unknownTags.map((tag, i) => (
          <p key={`${tag}-${i}`} className="text-[12px] text-ink-3">
            No list “{tag}” — kept in the title.
          </p>
        ))}

        <div className="flex justify-start">
          <button
            type="button"
            onClick={() => openCapture('search', text)}
            className="rounded-sm text-[12px] text-ink-3 underline-offset-4 transition-colors hover:text-foreground hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            Search tasks
          </button>
        </div>
      </DialogContent>
    </Dialog>
  )
}
