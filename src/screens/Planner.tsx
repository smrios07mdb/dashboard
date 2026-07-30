import { useCallback, useEffect, useMemo, useRef, useState } from 'react'

import { ChevronLeft, ChevronRight } from '@/components/icons'
import DayStrip from '@/components/planner/DayStrip'
import DayTimeline from '@/components/planner/DayTimeline'
import PlannerTray, {
  MobileUnscheduledList,
  type TrayItem,
} from '@/components/planner/PlannerTray'
import WeekGrid from '@/components/planner/WeekGrid'
import { Button } from '@/components/ui/button'
import { IconButton } from '@/components/ui/icon-button'
import { repo } from '@/db/repo'
import type { Category, Subcategory, Task } from '@/db/types'
import { useSession } from '@/lib/auth'
import {
  CalendarError,
  getBusy,
  type BusySources,
  type GetBusyResult,
} from '@/lib/calendarApi'
import { fmtMin } from '@/lib/cat'
import { computeCapacity, computeDayFree } from '@/lib/plannerCapacity'
import {
  addDays,
  busyToWeekBlocks,
  minutesOfDay,
  todayIndex,
  weekDays,
  weekMetaLabel,
  weekRangeLabel,
  weekStart,
} from '@/lib/plannerGeometry'
import { withSessionRetry } from '@/lib/session'
import {
  loadTaskSortKey,
  storeTaskSortKey,
  type TaskSortKey,
} from '@/lib/taskSort'
import { useUIStore } from '@/state/uiStore'

/*
 * Week Planner — read-only grid (chunk 36).
 *
 * Desktop ≥sm: 300px unscheduled tray + 7-column week grid. Mobile <sm:
 * day-selector strip + single-day timeline + inert unscheduled rows.
 * Busy overlays come from `getBusy` fetched once per visible week
 * (Monday 00:00 → Sunday 24:00, local — locked decision D3) with a
 * simple in-memory per-week cache, cleared when `dashboardRefreshKey`
 * bumps. No `scheduled_blocks`, no scheduling interactions — chunk 37.
 *
 * All day/time math is browser-local (D6); `settings.timezone` stays a
 * routines/streak concern.
 */

const DAY_SHORT = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'] as const
const MONTH_SHORT = [
  'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
  'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec',
] as const

/** `Tue 5` within ±6 days of today, `May 12` further out. */
function dueFragment(due: Date, now: Date): string {
  const dayMs = 86_400_000
  const d0 = new Date(due.getFullYear(), due.getMonth(), due.getDate())
  const n0 = new Date(now.getFullYear(), now.getMonth(), now.getDate())
  const diff = Math.round((d0.getTime() - n0.getTime()) / dayMs)
  return Math.abs(diff) <= 6
    ? `${DAY_SHORT[due.getDay()]} ${due.getDate()}`
    : `${MONTH_SHORT[due.getMonth()]} ${due.getDate()}`
}

/** ISO instant → local `HH:MM`, or null when absent/invalid. */
function localHHMM(iso: string | null): string | null {
  if (!iso) return null
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return null
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${pad(d.getHours())}:${pad(d.getMinutes())}`
}

/** Quiet amber `OUTLOOK FEED STALE` header chip (prototype `StaleChip`). */
function StaleChip() {
  return (
    <span
      className="mono inline-flex items-center gap-1.5 rounded-full px-[9px] py-[3px] text-[9px] font-semibold tracking-[.13em]"
      style={{
        background: 'color-mix(in srgb, var(--warn) 13%, transparent)',
        border: '1px solid color-mix(in srgb, var(--warn) 28%, transparent)',
        color: 'color-mix(in srgb, var(--warn) 62%, var(--ink))',
      }}
    >
      <span
        aria-hidden
        className="rounded-full"
        style={{ width: 6, height: 6, background: 'var(--warn)' }}
      />
      OUTLOOK FEED STALE
    </span>
  )
}

type BusyPhase = 'loading' | 'ready' | 'error' | 'not_configured'

type BusyState = {
  phase: BusyPhase
  busy: GetBusyResult | null
  fetchedAt: number | null
  errorMessage: string | null
}

export default function Planner() {
  const { user } = useSession()
  const userId = user?.id ?? null
  const dashboardRefreshKey = useUIStore((s) => s.dashboardRefreshKey)

  // Local clock — re-ticks every minute for the now-line / capacity-from-now.
  const [now, setNow] = useState(() => new Date())
  useEffect(() => {
    const id = window.setInterval(() => setNow(new Date()), 60_000)
    return () => window.clearInterval(id)
  }, [])

  // ── week navigation ────────────────────────────────────────────────────
  const [weekOffset, setWeekOffset] = useState(0)
  const weekStartDate = useMemo(
    () => addDays(weekStart(new Date()), weekOffset * 7),
    // Deliberately not keyed on `now`: the visible week only moves on
    // explicit navigation, not while the tab idles across midnight.
    [weekOffset],
  )
  const days = useMemo(() => weekDays(weekStartDate), [weekStartDate])
  const weekKey = weekStartDate.toISOString().slice(0, 10)
  const todayIdx = todayIndex(weekStartDate, now)
  const nowMin = minutesOfDay(now)

  // Mobile selected day follows the week: today when visible, else Monday.
  const [selectedDay, setSelectedDay] = useState(() =>
    todayIdx >= 0 && todayIdx <= 6 ? todayIdx : 0,
  )
  useEffect(() => {
    const t = todayIndex(weekStartDate, new Date())
    setSelectedDay(t >= 0 && t <= 6 ? t : 0)
  }, [weekStartDate])

  // ── busy fetch (screen-level, per-week — D3) ───────────────────────────
  const [busyState, setBusyState] = useState<BusyState>({
    phase: 'loading',
    busy: null,
    fetchedAt: null,
    errorMessage: null,
  })
  const busyCacheRef = useRef(
    new Map<string, { busy: GetBusyResult; fetchedAt: number }>(),
  )

  useEffect(() => {
    let cancelled = false
    // Refresh-key in the cache key ⇒ a Force-resync bump refetches.
    const key = `${dashboardRefreshKey}:${weekKey}`
    const cached = busyCacheRef.current.get(key)
    if (cached) {
      setBusyState({ phase: 'ready', ...cached, errorMessage: null })
      return
    }
    setBusyState((s) => ({ ...s, phase: 'loading' }))
    const from = weekStartDate.toISOString()
    const to = addDays(weekStartDate, 7).toISOString()
    withSessionRetry(() => getBusy({ from, to }))
      .then((busy) => {
        if (cancelled) return
        const entry = { busy, fetchedAt: Date.now() }
        busyCacheRef.current.set(key, entry)
        setBusyState({ phase: 'ready', ...entry, errorMessage: null })
      })
      .catch((e: unknown) => {
        if (cancelled) return
        if (e instanceof CalendarError && e.kind === 'not_configured') {
          // Neither source set up → no overlays, no error chrome.
          setBusyState({
            phase: 'not_configured',
            busy: null,
            fetchedAt: null,
            errorMessage: null,
          })
          return
        }
        console.error('Planner: load busy failed', e)
        setBusyState({
          phase: 'error',
          busy: null,
          fetchedAt: null,
          errorMessage:
            e instanceof CalendarError
              ? e.message
              : 'Could not load busy times.',
        })
      })
    return () => {
      cancelled = true
    }
  }, [weekKey, weekStartDate, dashboardRefreshKey])

  const sources: BusySources | undefined = busyState.busy?.sources
  const stale = sources?.outlook.status === 'stale'
  const staleTime = localHHMM(sources?.outlook.fetchedAt ?? null)

  const busyBlocks = useMemo(
    () => busyToWeekBlocks(busyState.busy ?? [], weekStartDate),
    [busyState.busy, weekStartDate],
  )

  // ── capacity (scheduled = [] until chunk 37 — D5) ──────────────────────
  const capacity = useMemo(() => computeCapacity(busyBlocks, []), [busyBlocks])
  const dayFree = useMemo(
    () =>
      days.map((_, i) =>
        i >= 5 ? undefined : computeDayFree(i, busyBlocks, [], todayIdx, nowMin),
      ),
    [days, busyBlocks, todayIdx, nowMin],
  )

  // ── tasks (tray) ───────────────────────────────────────────────────────
  const [taskData, setTaskData] = useState<{
    categories: Category[]
    subcategories: Subcategory[]
    tasks: Task[]
  }>({ categories: [], subcategories: [], tasks: [] })

  useEffect(() => {
    if (!userId) return
    let cancelled = false
    Promise.all([
      repo.categories.list(),
      repo.subcategories.list(),
      repo.tasks.list(),
    ])
      .then(([categories, subcategories, tasks]) => {
        if (!cancelled) setTaskData({ categories, subcategories, tasks })
      })
      .catch((e) => {
        console.error('Planner: load tasks failed', e)
      })
    return () => {
      cancelled = true
    }
  }, [userId, dashboardRefreshKey])

  const [sortKey, setSortKey] = useState<TaskSortKey>(loadTaskSortKey)
  const onChangeSortKey = useCallback((key: TaskSortKey) => {
    setSortKey(key)
    storeTaskSortKey(key)
  }, [])

  const trayItems: TrayItem[] = useMemo(() => {
    const catById = new Map(taskData.categories.map((c) => [c.id, c.name]))
    const subToCat = new Map(
      taskData.subcategories
        .filter((s) => !s.archivedAt)
        .map((s) => [s.id, catById.get(s.categoryId) ?? 'Work']),
    )
    const n0 = new Date(now.getFullYear(), now.getMonth(), now.getDate())
    return taskData.tasks
      .filter((t) => !t.completedAt && subToCat.has(t.subcategoryId))
      .map((task) => {
        const due = task.dueAt ? new Date(task.dueAt) : null
        const validDue = due && !Number.isNaN(due.getTime()) ? due : null
        const d0 = validDue
          ? new Date(validDue.getFullYear(), validDue.getMonth(), validDue.getDate())
          : null
        return {
          task,
          catName: subToCat.get(task.subcategoryId) ?? 'Work',
          overdue: d0 !== null && d0.getTime() < n0.getTime(),
          dueToday: d0 !== null && d0.getTime() === n0.getTime(),
          dueText: validDue ? dueFragment(validDue, now) : null,
        }
      })
  }, [taskData, now])

  // ── render ─────────────────────────────────────────────────────────────
  const loading = busyState.phase === 'loading'
  const errorMessage =
    busyState.phase === 'error' ? busyState.errorMessage : null

  const header = (
    <header className="mb-3.5 flex flex-wrap items-center gap-3.5">
      <div>
        <h1 className="title m-0 text-[27px]">{weekRangeLabel(weekStartDate)}</h1>
        <span className="label" style={{ fontSize: 9 }}>
          {weekMetaLabel(weekStartDate)}
        </span>
      </div>
      <div className="flex items-center gap-1">
        <IconButton
          label="Previous week"
          onClick={() => setWeekOffset((o) => o - 1)}
        >
          <ChevronLeft size={15} />
        </IconButton>
        <Button
          variant="outline"
          size="sm"
          onClick={() => setWeekOffset(0)}
          disabled={weekOffset === 0}
        >
          Today
        </Button>
        <IconButton label="Next week" onClick={() => setWeekOffset((o) => o + 1)}>
          <ChevronRight size={15} />
        </IconButton>
      </div>
      <span className="ml-auto" />
      {stale && <StaleChip />}
      <span className="num mono text-[11.5px] text-ink-3">
        <span style={{ color: 'var(--ink-2)', fontWeight: 600 }}>
          {fmtMin(capacity.planned)} planned
        </span>{' '}
        · {fmtMin(capacity.free)} free
      </span>
    </header>
  )

  const selectedDayBusy = busyBlocks.filter((b) => b.day === selectedDay)
  const selectedDayFree =
    selectedDay >= 5
      ? undefined
      : computeDayFree(selectedDay, busyBlocks, [], todayIdx, nowMin)
  const DAY_FULL = [
    'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday',
  ]

  return (
    <div>
      {/* Desktop / tablet ≥sm */}
      <div className="hidden gap-6 sm:flex">
        <PlannerTray
          items={trayItems}
          sortKey={sortKey}
          onChangeSortKey={onChangeSortKey}
        />
        <main className="min-w-0 flex-1">
          {header}
          <WeekGrid
            days={days}
            todayIdx={todayIdx}
            nowMin={nowMin}
            busy={busyBlocks}
            stale={!!stale}
            staleTime={staleTime}
            fetchedAt={busyState.fetchedAt}
            loading={loading}
            errorMessage={errorMessage}
            dayFree={dayFree}
          />
        </main>
      </div>

      {/* Mobile <sm (AppShell already pads the page x-axis) */}
      <div className="sm:hidden">
        {header}
        <DayStrip
          days={days}
          selected={selectedDay}
          todayIdx={todayIdx}
          onSelect={setSelectedDay}
        />
        <div className="num mono pb-2 text-[10px] text-ink-3">
          {DAY_FULL[selectedDay]} ·{' '}
          {selectedDayFree === undefined
            ? 'weekend'
            : selectedDayFree === null
              ? 'past'
              : `${fmtMin(selectedDayFree)} free 09–18`}
        </div>
        <DayTimeline
          busy={selectedDayBusy}
          isToday={selectedDay === todayIdx}
          nowMin={nowMin}
          stale={!!stale}
          staleTime={staleTime}
          fetchedAt={busyState.fetchedAt}
          loading={loading}
          errorMessage={errorMessage}
        />
        <MobileUnscheduledList items={trayItems} sortKey={sortKey} />
      </div>
    </div>
  )
}
