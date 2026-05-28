import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Sparkles } from 'lucide-react'

import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from '@/components/ui/sheet'
import { Skeleton } from '@/components/ui/skeleton'
import { repo } from '@/db/repo'
import type { Task } from '@/db/types'
import {
  AiError,
  buildTriageTasks,
  triage,
  type AiErrorKind,
  type TriageResult,
} from '@/lib/ai'
import { useIsTouchDevice } from '@/lib/useIsTouchDevice'
import { useUIStore } from '@/state/uiStore'

/*
 * "What's next?" AI triage sheet (chunk 11 / ARCHITECTURE.md §10).
 *
 * Owns the (now-enabled) header trigger button. Slides from the right on
 * pointer devices and from the bottom on touch devices — `useIsTouchDevice`
 * is the canonical `(hover: none)` signal (ARCH §13), and using it here
 * also means Cowork's mobile-branch smoke technique (patch matchMedia +
 * remount) exercises the bottom layout without DevTools device emulation.
 *
 * Recommendations are ephemeral: nothing is written to the DB (per the
 * chunk's Do-NOT list). The minutes field is the shared
 * `uiStore.availableMinutes`, so it stays in sync with the dashboard
 * header input that prefills it.
 */

type CardTask = { task: Task; subName: string; catName: string }

type Phase =
  | { status: 'idle' }
  | { status: 'loading' }
  | { status: 'empty' }
  | { status: 'results'; result: TriageResult }
  | { status: 'error'; kind: AiErrorKind; raw?: string }

function formatMinutes(mins: number): string {
  if (!mins) return '0m'
  if (mins < 60) return `${mins}m`
  const h = Math.floor(mins / 60)
  const m = mins % 60
  return m ? `${h}h ${m}m` : `${h}h`
}

function formatDue(iso: string): string {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return ''
  return d.toLocaleDateString(undefined, {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  })
}

export default function WhatsNextSheet() {
  const navigate = useNavigate()
  const isTouch = useIsTouchDevice()
  const availableMinutes = useUIStore((s) => s.availableMinutes)
  const setAvailableMinutes = useUIStore((s) => s.setAvailableMinutes)

  const [open, setOpen] = useState(false)
  const [phase, setPhase] = useState<Phase>({ status: 'idle' })
  const [lookup, setLookup] = useState<Map<string, CardTask>>(new Map())

  async function getRecommendations() {
    setPhase({ status: 'loading' })
    try {
      const [tasks, subs, cats] = await Promise.all([
        repo.tasks.listIncomplete(),
        repo.subcategories.list(),
        repo.categories.list(),
      ])
      const liveSubs = subs.filter((s) => !s.archivedAt)
      const payload = buildTriageTasks(tasks, liveSubs, cats)

      // Display lookup keyed by task id — drives card context + the Start
      // navigation target. Built from the same filtered set as the payload.
      const subById = new Map(liveSubs.map((s) => [s.id, s]))
      const catById = new Map(cats.map((c) => [c.id, c]))
      const nextLookup = new Map<string, CardTask>()
      for (const t of tasks) {
        const sub = subById.get(t.subcategoryId)
        if (!sub) continue
        const cat = catById.get(sub.categoryId)
        if (!cat) continue
        nextLookup.set(t.id, { task: t, subName: sub.name, catName: cat.name })
      }
      setLookup(nextLookup)

      if (payload.length === 0) {
        setPhase({ status: 'empty' })
        return
      }

      const result = await triage({
        tasks: payload,
        availableMinutes,
        timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
      })
      setPhase({ status: 'results', result })
    } catch (e) {
      if (e instanceof AiError) {
        setPhase({ status: 'error', kind: e.kind, raw: e.raw })
      } else {
        console.error('Triage failed', e)
        setPhase({ status: 'error', kind: 'network' })
      }
    }
  }

  function start(task: Task) {
    navigate(`/subcategory/${task.subcategoryId}?task=${task.id}`)
    setOpen(false)
  }

  function goToSettings() {
    navigate('/settings')
    setOpen(false)
  }

  return (
    <Sheet
      open={open}
      onOpenChange={(next) => {
        setOpen(next)
        if (!next) setPhase({ status: 'idle' })
      }}
    >
      <SheetTrigger asChild>
        <Button size="sm">
          <Sparkles className="size-4" />
          What&rsquo;s next?
        </Button>
      </SheetTrigger>
      <SheetContent
        side={isTouch ? 'bottom' : 'right'}
        className="flex w-full flex-col gap-5 overflow-y-auto sm:max-w-md data-[side=bottom]:max-h-[85vh] data-[side=bottom]:rounded-t-xl"
        data-side={isTouch ? 'bottom' : 'right'}
      >
        <SheetHeader>
          <SheetTitle className="flex items-center gap-2">
            <Sparkles className="size-4 text-primary" aria-hidden />
            What&rsquo;s next?
          </SheetTitle>
          <SheetDescription>
            Claude looks at your open tasks and the time you have, then
            suggests where to start.
          </SheetDescription>
        </SheetHeader>

        <div className="flex items-end gap-3">
          <label className="label flex items-center gap-2">
            I have
            <input
              type="number"
              min={0}
              step={15}
              value={availableMinutes}
              onChange={(e) => setAvailableMinutes(Number(e.target.value) || 0)}
              aria-label="Available minutes"
              className="w-16 rounded-sm border border-border bg-background px-2 py-1 text-right font-mono text-[13px] text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            />
            <span className="font-mono text-[11px] text-muted-foreground">
              min
            </span>
          </label>
          <Button
            onClick={getRecommendations}
            disabled={phase.status === 'loading'}
            className="ml-auto"
          >
            {phase.status === 'loading' ? 'Thinking…' : 'Get recommendations'}
          </Button>
        </div>

        <div className="min-h-0 flex-1">
          {phase.status === 'loading' && <LoadingSkeleton />}

          {phase.status === 'empty' && (
            <p className="text-[13px] text-muted-foreground">
              Nothing to triage yet — add a few tasks and try again.
            </p>
          )}

          {phase.status === 'results' && (
            <div className="space-y-3">
              {phase.result.note && (
                <p className="text-[13px] italic text-muted-foreground">
                  {phase.result.note}
                </p>
              )}
              {phase.result.recommendations.map((rec) => {
                const item = lookup.get(rec.taskId)
                if (!item) return null
                return (
                  <ResultCard
                    key={rec.taskId}
                    item={item}
                    reason={rec.reason}
                    onStart={() => start(item.task)}
                  />
                )
              })}
            </div>
          )}

          {phase.status === 'error' && (
            <ErrorView
              kind={phase.kind}
              raw={phase.raw}
              onRetry={getRecommendations}
              onGoToSettings={goToSettings}
            />
          )}
        </div>
      </SheetContent>
    </Sheet>
  )
}

function ResultCard({
  item,
  reason,
  onStart,
}: {
  item: CardTask
  reason: string
  onStart: () => void
}) {
  const { task, subName, catName } = item
  return (
    <Card className="flex flex-col gap-2 p-4">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="font-medium leading-snug text-foreground">
            {task.title}
          </div>
          <div className="label mt-1">
            {subName} · {catName}
          </div>
        </div>
        <Button
          size="sm"
          variant="secondary"
          onClick={onStart}
          aria-label={`Start "${task.title}"`}
        >
          Start
        </Button>
      </div>
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 font-mono text-[12px] text-muted-foreground tabular-nums">
        <span>{formatMinutes(task.estimateMinutes)}</span>
        {task.dueAt && (
          <>
            <span aria-hidden className="text-muted-foreground/50">
              ·
            </span>
            <span>due {formatDue(task.dueAt)}</span>
          </>
        )}
      </div>
      <p className="text-[13px] leading-relaxed text-secondary-foreground">
        {reason}
      </p>
    </Card>
  )
}

function ErrorView({
  kind,
  raw,
  onRetry,
  onGoToSettings,
}: {
  kind: AiErrorKind
  raw?: string
  onRetry: () => void
  onGoToSettings: () => void
}) {
  if (kind === 'missing-key') {
    return (
      <div className="space-y-3">
        <p className="text-[13px] text-muted-foreground">
          You haven&rsquo;t added an Anthropic API key yet.
        </p>
        <Button onClick={onGoToSettings}>Add your API key in Settings</Button>
      </div>
    )
  }
  if (kind === 'auth') {
    return (
      <div className="space-y-3">
        <p className="text-[13px] text-muted-foreground">
          API key rejected. Update it in Settings.
        </p>
        <Button onClick={onGoToSettings}>Update key in Settings</Button>
      </div>
    )
  }
  if (kind === 'malformed') {
    return (
      <div className="space-y-3">
        <p className="text-[13px] text-muted-foreground">
          AI response was malformed. Try again.
        </p>
        <div className="flex items-center gap-2">
          <Button onClick={onRetry}>Try again</Button>
        </div>
        {raw && (
          <details className="rounded-md border border-border bg-secondary/40 px-3 py-2 text-[12px]">
            <summary className="cursor-pointer text-muted-foreground">
              Show raw response
            </summary>
            <pre className="mt-2 max-h-48 overflow-auto whitespace-pre-wrap break-words font-mono text-[11px] text-foreground">
              {raw}
            </pre>
          </details>
        )}
      </div>
    )
  }
  // network
  return (
    <div className="space-y-3">
      <p className="text-[13px] text-muted-foreground">
        Couldn&rsquo;t reach the AI. Try again.
      </p>
      <Button onClick={onRetry}>Try again</Button>
    </div>
  )
}

function LoadingSkeleton() {
  return (
    <div className="space-y-3" aria-busy="true" aria-label="Loading recommendations">
      {[0, 1, 2].map((i) => (
        <Card key={i} className="space-y-2 p-4">
          <Skeleton className="h-4 w-2/3" />
          <Skeleton className="h-3 w-1/3" />
          <Skeleton className="h-3 w-full" />
        </Card>
      ))}
    </div>
  )
}
