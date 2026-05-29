import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { CalendarPlus, Clock } from 'lucide-react'
import { formatInTimeZone } from 'date-fns-tz'
import { toast } from 'sonner'

import ReconnectBanner from '@/components/ReconnectBanner'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet'
import { Skeleton } from '@/components/ui/skeleton'
import { repo } from '@/db/repo'
import type { Task } from '@/db/types'
import { useSession } from '@/lib/auth'
import { bustBusyDays, getBusyDay } from '@/lib/busyCache'
import { CalendarError, createEvent, isAuthFailed } from '@/lib/calendarApi'
import { dateKeyDaysAgo, today as clockToday } from '@/lib/clock'
import { withSessionRetry } from '@/lib/session'
import { proposeSlots, type ProposedSlot } from '@/lib/slots'
import { useIsTouchDevice } from '@/lib/useIsTouchDevice'

/*
 * "Block time" sheet (ARCHITECTURE.md §8, chunk-13 prompt).
 *
 * Controlled by TaskMenu (no self-trigger). Slides from the right on pointer
 * devices, from the bottom on touch (useIsTouchDevice → ARCH §13). On open it
 * loads the calendar config + busy ranges and proposes up to 3 slots; picking
 * one and confirming creates a VEVENT via the proxy and busts the busy cache so
 * the strip can't double-book from a stale entry (resolution 5).
 *
 * Mirrors the three caldav states: 'ok' → slots; 'auth_failed' → reconnect
 * banner; 'unconfigured' → a "set it up in Settings" prompt (rather than a
 * dead-end slot list with no calendar to write to).
 */

type Phase =
  | { status: 'loading' }
  | { status: 'ready'; slots: ProposedSlot[]; timezone: string }
  | { status: 'reconnect' }
  | { status: 'unconfigured' }
  | { status: 'error' }

function formatMinutes(mins: number): string {
  if (!mins) return '0m'
  if (mins < 60) return `${mins}m`
  const h = Math.floor(mins / 60)
  const m = mins % 60
  return m ? `${h}h ${m}m` : `${h}h`
}

export type BlockTimeSheetProps = {
  task: Task
  open: boolean
  onOpenChange: (open: boolean) => void
}

export default function BlockTimeSheet({
  task,
  open,
  onOpenChange,
}: BlockTimeSheetProps) {
  const navigate = useNavigate()
  const isTouch = useIsTouchDevice()
  const { user } = useSession()
  const userId = user?.id ?? null

  const [phase, setPhase] = useState<Phase>({ status: 'loading' })
  const [selected, setSelected] = useState<number | null>(null)
  const [creating, setCreating] = useState(false)
  const [reloadNonce, setReloadNonce] = useState(0)

  // Reset to the loading state when the sheet opens — done during render via
  // the prevOpen-compare pattern (NOT a useEffect), matching EditNotesDialog and
  // the project convention, so it doesn't trip the React-19 set-state-in-effect
  // lint. The effect below then only setStates after an await.
  const [prevOpen, setPrevOpen] = useState(open)
  if (prevOpen !== open) {
    setPrevOpen(open)
    if (open) {
      setPhase({ status: 'loading' })
      setSelected(null)
    }
  }

  // Fetch config + busy ranges + propose slots when open (and on retry via
  // reloadNonce). Every setState happens AFTER an await, so nothing fires
  // synchronously inside the effect; a cancelled flag guards close/reopen races.
  useEffect(() => {
    if (!open || !userId) return
    let cancelled = false

    const run = async () => {
      try {
        const settings = await repo.settings.get(userId)
        if (cancelled) return
        const status = settings?.caldavStatus ?? 'unconfigured'
        const tz = settings?.timezone ?? 'America/New_York'
        if (status === 'unconfigured') {
          if (!cancelled) setPhase({ status: 'unconfigured' })
          return
        }
        if (status === 'auth_failed') {
          if (!cancelled) setPhase({ status: 'reconnect' })
          return
        }
        // 'ok': the 24h slot horizon can spill into tomorrow, so fetch both
        // local days (each cache-first) and let proposeSlots window them.
        const todayKey = clockToday(tz)
        const tomorrowKey = dateKeyDaysAgo(todayKey, -1)
        // withSessionRetry refreshes the JWT once and retries if the proxy
        // rejects a stale token (signed_out, resolution 3 source #2).
        const [todayBusy, tomorrowBusy] = await withSessionRetry(() =>
          Promise.all([getBusyDay(todayKey, tz), getBusyDay(tomorrowKey, tz)]),
        )
        const slots = proposeSlots({
          estimateMinutes: task.estimateMinutes,
          busyRanges: [...todayBusy, ...tomorrowBusy],
          timezone: tz,
          now: new Date(),
        })
        if (!cancelled) setPhase({ status: 'ready', slots, timezone: tz })
      } catch (e) {
        if (cancelled) return
        if (isAuthFailed(e)) setPhase({ status: 'reconnect' })
        else if (e instanceof CalendarError && e.kind === 'not_configured')
          setPhase({ status: 'unconfigured' })
        else {
          console.error('BlockTime: load failed', e)
          setPhase({ status: 'error' })
        }
      }
    }

    void run()
    return () => {
      cancelled = true
    }
  }, [open, task.id, task.estimateMinutes, userId, reloadNonce])

  async function addToCalendar(slot: ProposedSlot, timezone: string) {
    setCreating(true)
    try {
      // Retry once through a JWT refresh on a stale-token signed_out. Safe to
      // retry: signed_out is thrown at the auth layer before any VEVENT is
      // created, so there's no risk of a double-booked event.
      await withSessionRetry(() =>
        createEvent({
          title: task.title,
          start: slot.start,
          end: slot.end,
          // Task notes become the event description; null → omitted (resolution 8).
          description: task.notes ?? undefined,
        }),
      )
      // Bust the affected day(s) so the next strip/sheet refresh sees the new
      // block instead of a ≤5-min-stale cache (resolution 5).
      const startKey = formatInTimeZone(new Date(slot.start), timezone, 'yyyy-MM-dd')
      const endKey = formatInTimeZone(new Date(slot.end), timezone, 'yyyy-MM-dd')
      await bustBusyDays(startKey === endKey ? [startKey] : [startKey, endKey])
      toast('Event added to Apple Calendar')
      onOpenChange(false)
    } catch (e) {
      if (isAuthFailed(e)) {
        setPhase({ status: 'reconnect' })
      } else {
        console.error('BlockTime: create event failed', e)
        toast.error('Could not add event — retry')
      }
    } finally {
      setCreating(false)
    }
  }

  function goToSettings() {
    onOpenChange(false)
    navigate('/settings')
  }

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        side={isTouch ? 'bottom' : 'right'}
        className="flex w-full flex-col gap-5 overflow-y-auto sm:max-w-md data-[side=bottom]:max-h-[85vh] data-[side=bottom]:rounded-t-xl"
        data-side={isTouch ? 'bottom' : 'right'}
      >
        <SheetHeader>
          <SheetTitle className="flex items-center gap-2">
            <Clock className="size-4 text-primary" aria-hidden />
            Block time
          </SheetTitle>
          <SheetDescription>
            Find a free {formatMinutes(task.estimateMinutes)} slot for “
            {task.title}” and add it to your Apple Calendar.
          </SheetDescription>
        </SheetHeader>

        <div className="min-h-0 flex-1">
          {phase.status === 'loading' && <LoadingSkeleton />}

          {phase.status === 'reconnect' && <ReconnectBanner />}

          {phase.status === 'unconfigured' && (
            <div className="space-y-3">
              <p className="text-[13px] text-muted-foreground">
                Connect your Apple Calendar to block time for tasks.
              </p>
              <Button onClick={goToSettings}>Set up in Settings</Button>
            </div>
          )}

          {phase.status === 'error' && (
            <div className="space-y-3">
              <p className="text-[13px] text-muted-foreground">
                Couldn’t load your calendar. Try again.
              </p>
              <Button
                onClick={() => {
                  setPhase({ status: 'loading' })
                  setReloadNonce((n) => n + 1)
                }}
              >
                Try again
              </Button>
            </div>
          )}

          {phase.status === 'ready' && phase.slots.length === 0 && (
            <p className="text-[13px] text-muted-foreground">
              {task.estimateMinutes > 0
                ? 'No open slots in the next 24 hours (working hours are 9 AM–6 PM).'
                : 'Add a time estimate to this task first, then try blocking time.'}
            </p>
          )}

          {phase.status === 'ready' && phase.slots.length > 0 && (
            <div className="space-y-3">
              {phase.slots.length < 3 && (
                <p className="text-[13px] text-amber-700 dark:text-amber-400">
                  Limited availability — only {phase.slots.length}{' '}
                  {phase.slots.length === 1 ? 'slot' : 'slots'} found.
                </p>
              )}
              <div className="space-y-2">
                {phase.slots.map((slot, i) => (
                  <SlotCard
                    key={slot.start}
                    slot={slot}
                    timezone={phase.timezone}
                    durationLabel={formatMinutes(task.estimateMinutes)}
                    selected={selected === i}
                    onSelect={() => setSelected(i)}
                  />
                ))}
              </div>
              <div className="pt-1">
                <Button
                  onClick={() => {
                    if (selected === null) return
                    const slot = phase.slots[selected]
                    if (slot) void addToCalendar(slot, phase.timezone)
                  }}
                  disabled={selected === null || creating}
                >
                  <CalendarPlus className="size-4" />
                  {creating ? 'Adding…' : 'Add to Apple Calendar'}
                </Button>
              </div>
            </div>
          )}
        </div>
      </SheetContent>
    </Sheet>
  )
}

function SlotCard({
  slot,
  timezone,
  durationLabel,
  selected,
  onSelect,
}: {
  slot: ProposedSlot
  timezone: string
  durationLabel: string
  selected: boolean
  onSelect: () => void
}) {
  const dateLabel = formatInTimeZone(new Date(slot.start), timezone, 'EEE, MMM d')
  const timeLabel = `${formatInTimeZone(
    new Date(slot.start),
    timezone,
    'h:mm a',
  )} – ${formatInTimeZone(new Date(slot.end), timezone, 'h:mm a')}`
  return (
    <button
      type="button"
      onClick={onSelect}
      aria-pressed={selected}
      className={
        selected
          ? 'flex w-full items-center justify-between gap-3 rounded-md border border-primary bg-primary/5 p-3 text-left ring-1 ring-primary'
          : 'flex w-full items-center justify-between gap-3 rounded-md border border-border p-3 text-left transition-colors hover:bg-secondary/50'
      }
    >
      <div className="min-w-0">
        <div className="font-medium leading-snug text-foreground">
          {dateLabel}
        </div>
        <div className="font-mono text-[13px] text-muted-foreground tabular-nums">
          {timeLabel}
        </div>
      </div>
      <div className="flex shrink-0 items-center gap-2">
        <span className="font-mono text-[12px] text-muted-foreground tabular-nums">
          {durationLabel}
        </span>
        {selected && <Badge variant="success">Selected</Badge>}
      </div>
    </button>
  )
}

function LoadingSkeleton() {
  return (
    <div className="space-y-2" aria-busy="true" aria-label="Finding open slots">
      {[0, 1, 2].map((i) => (
        <div key={i} className="rounded-md border border-border p-3">
          <Skeleton className="h-4 w-1/3" />
          <Skeleton className="mt-2 h-3 w-1/2" />
        </div>
      ))}
    </div>
  )
}
