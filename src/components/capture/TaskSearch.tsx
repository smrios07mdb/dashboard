import { useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'

import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { repo } from '@/db/repo'
import type { Category, Subcategory, Task } from '@/db/types'
import { searchTasks } from '@/lib/taskSearch'
import { cn } from '@/lib/utils'
import { useUIStore } from '@/state/uiStore'

/*
 * Task search (chunk 73, UX audit #7): `/` from any screen, or `Search tasks`
 * in the capture dialog. Open tasks only, matched on title and list name
 * (`lib/taskSearch`); a hit opens its list. Open state is `uiStore.capture`
 * with mode `search`.
 */

// Same placement as QuickCapture: near the top, clear of the keyboard.
const PLACEMENT =
  'top-[env(safe-area-inset-top)] translate-y-0 gap-3 data-[state=closed]:!slide-out-to-top-0 data-[state=open]:!slide-in-from-top-0 sm:top-[15%]'

const LISTBOX_ID = 'task-search-results'
const optionId = (i: number) => `task-search-option-${i}`

type Data = { categories: Category[]; subcategories: Subcategory[]; tasks: Task[] }

export default function TaskSearch() {
  const capture = useUIStore((s) => s.capture)
  const closeCapture = useUIStore((s) => s.closeCapture)
  const openCapture = useUIStore((s) => s.openCapture)
  const navigate = useNavigate()
  const open = capture?.mode === 'search'
  const seed = open ? (capture?.text ?? '') : ''

  const [query, setQuery] = useState(seed)
  const [active, setActive] = useState(0)
  const [data, setData] = useState<Data | null>(null)
  const [loadFailed, setLoadFailed] = useState(false)
  const [loadSeq, setLoadSeq] = useState(0)
  const inputRef = useRef<HTMLInputElement | null>(null)

  // Reset on open and on close: the prevOpen pattern (prompts/README).
  const [prevOpen, setPrevOpen] = useState(open)
  if (prevOpen !== open) {
    setPrevOpen(open)
    setQuery(seed)
    setActive(0)
    setData(null)
    setLoadFailed(false)
  }

  useEffect(() => {
    if (!open) return
    let cancelled = false
    Promise.all([
      repo.categories.list(),
      repo.subcategories.list(),
      repo.tasks.listIncomplete(),
    ])
      .then(([categories, subcategories, tasks]) => {
        if (!cancelled) setData({ categories, subcategories, tasks })
      })
      .catch((e) => {
        if (cancelled) return
        console.error('Task search failed to load', e)
        setLoadFailed(true)
      })
    return () => {
      cancelled = true
    }
  }, [open, loadSeq])

  const trimmed = query.trim()
  const hits = data ? searchTasks(query, data) : []
  const current = Math.min(active, hits.length - 1)

  function openHit(index: number) {
    const hit = hits[index]
    if (!hit) return
    closeCapture()
    navigate(`/subcategory/${hit.task.subcategoryId}`)
  }

  function onKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault()
      if (hits.length === 0) return
      const next = current + (e.key === 'ArrowDown' ? 1 : -1)
      setActive(Math.max(0, Math.min(hits.length - 1, next)))
    } else if (e.key === 'Enter') {
      e.preventDefault()
      openHit(current)
    }
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
          inputRef.current?.focus()
        }}
      >
        <DialogTitle className="label text-[10px] font-medium leading-normal tracking-[0.16em]">
          Search
        </DialogTitle>
        <DialogDescription className="sr-only">
          Search open tasks by title or list. Enter opens the task's list.
        </DialogDescription>

        <Input
          ref={inputRef}
          type="search"
          role="combobox"
          aria-label="Search tasks"
          aria-expanded={hits.length > 0}
          aria-controls={LISTBOX_ID}
          aria-autocomplete="list"
          aria-activedescendant={hits.length > 0 ? optionId(current) : undefined}
          value={query}
          onChange={(e) => {
            setQuery(e.target.value)
            setActive(0)
          }}
          onKeyDown={onKeyDown}
          autoComplete="off"
          className="h-10 bg-background text-base sm:text-[14px]"
        />

        {loadFailed && (
          <div className="flex items-center gap-2 text-[13px] text-destructive">
            <span>Could not load your tasks — retry.</span>
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

        <ul
          id={LISTBOX_ID}
          role="listbox"
          aria-label="Open tasks"
          className={cn(
            'max-h-[50svh] overflow-y-auto',
            hits.length === 0 && 'hidden',
          )}
        >
          {hits.map((hit, i) => (
            <li
              key={hit.task.id}
              id={optionId(i)}
              role="option"
              aria-selected={i === current}
              onClick={() => openHit(i)}
              onMouseMove={() => setActive(i)}
              className={cn(
                'cursor-pointer rounded-sm px-2 py-1.5',
                i === current && 'bg-secondary',
              )}
            >
              <div className="line-clamp-2 text-[14px] text-foreground">
                {hit.task.title}
              </div>
              <div className="text-[12px] text-ink-3">
                {hit.catName} › {hit.subName}
              </div>
            </li>
          ))}
        </ul>

        {trimmed.length === 0 ? (
          <p className="text-[13px] text-ink-3">Type to search open tasks.</p>
        ) : (
          data &&
          hits.length === 0 && (
            <div className="space-y-2">
              <p className="text-[13px] text-ink-3">
                No open task matches “{trimmed}”.
              </p>
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="h-auto min-h-8 max-w-full whitespace-normal py-1.5 text-left"
                onClick={() => openCapture('add', trimmed)}
              >
                Add “{trimmed}” as a task
              </Button>
            </div>
          )
        )}
      </DialogContent>
    </Dialog>
  )
}
