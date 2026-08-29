import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type PointerEvent,
} from 'react'
import { toast } from 'sonner'

import { ChevronLeft, ChevronRight } from '@/components/icons'
import BlockActionSheet from '@/components/planner/BlockActionSheet'
import DayStrip from '@/components/planner/DayStrip'
import DayTimeline from '@/components/planner/DayTimeline'
import PlannerTray, {
  MobileUnscheduledList,
  TrayCard,
  type TrayItem,
} from '@/components/planner/PlannerTray'
import ScheduleSheet from '@/components/planner/ScheduleSheet'
import { usePlannerDrag, type DropResult } from '@/components/planner/usePlannerDrag'
import WeekGrid, { type GridTaskBlock } from '@/components/planner/WeekGrid'
import { Button } from '@/components/ui/button'
import { IconButton } from '@/components/ui/icon-button'
import { repo } from '@/db/repo'
import type { Category, ScheduledBlock, Subcategory, Task } from '@/db/types'
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
  DAY_LABELS,
  fmtClock,
  fmtRange,
  minutesOfDay,
  PLANNER,
  todayIndex,
  weekDays,
  weekMetaLabel,
  weekRangeLabel,
  weekStart,
} from '@/lib/plannerGeometry'
import {
  blockDurationMin,
  overlapBusy,
  scheduledToWeekBlocks,
  splitTray,
  toInstant,
  type WeekScheduledBlock,
} from '@/lib/plannerSchedule'
import { withSessionRetry } from '@/lib/session'
import {
  loadTaskSortKey,
  storeTaskSortKey,
  type TaskSortKey,
} from '@/lib/taskSort'
import { useIsTouchDevice } from '@/lib/useIsTouchDevice'
import { useUIStore } from '@/state/uiStore'

/*
 * Week Planner (chunk 36 grid + chunk 37 scheduling).
 *
 * Desktop ≥sm: 300px unscheduled tray + 7-column week grid. Mobile <sm:
 * day-selector strip + single-day timeline + tap-to-schedule rows.
 *
 * Busy overlays and scheduled blocks are both fetched per visible week
 * (Monday 00:00 → Sunday 24:00, local) with simple in-memory per-week
 * caches keyed on `dashboardRefreshKey`, so a realtime event on either
 * `tasks` or `scheduled_blocks` (bumping the key) refetches. Placement,
 * move, resize, done and unschedule are optimistic through the repo with
 * the normalized error toast + re-read on failure.
 *
 * All day/time math is browser-local (D3/D6); `settings.timezone` stays a
 * routines/streak concern.
 */

const SAVE_ERROR = 'Could not save — retry'

const DAY_SHORT = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'] as const
const MONTH_SHORT = [
  'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
  'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec',
] as const
const DAY_FULL = [
  'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday',
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
  const isTouch = useIsTouchDevice()

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
  const todayInWeek = todayIdx >= 0 && todayIdx <= 6

  // Mobile selected day follows the week: today when visible, else Monday.
  // Reset on week change via the React-19 "adjust state during render"
  // pattern (prompts/README) rather than an effect.
  const [selectedDay, setSelectedDay] = useState(() =>
    todayInWeek ? todayIdx : 0,
  )
  const [prevWeekKey, setPrevWeekKey] = useState(weekKey)
  if (prevWeekKey !== weekKey) {
    setPrevWeekKey(weekKey)
    setSelectedDay(todayInWeek ? todayIdx : 0)
  }

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

  // ── scheduled blocks (per-week, D14) ───────────────────────────────────
  const [blocks, setBlocks] = useState<ScheduledBlock[]>([])
  const [blocksLoading, setBlocksLoading] = useState(true)
  const blocksCacheRef = useRef(new Map<string, ScheduledBlock[]>())
  // Bumped after a failed write to force a re-read of the visible week.
  const [blocksReloadKey, setBlocksReloadKey] = useState(0)
  const reloadBlocks = useCallback(() => {
    blocksCacheRef.current.clear()
    setBlocksReloadKey((k) => k + 1)
  }, [])

  useEffect(() => {
    if (!userId) return
    let cancelled = false
    const key = `${dashboardRefreshKey}:${weekKey}`
    const cached = blocksCacheRef.current.get(key)
    if (cached) {
      setBlocks(cached)
      setBlocksLoading(false)
      return
    }
    setBlocksLoading(true)
    const from = weekStartDate.toISOString()
    const to = addDays(weekStartDate, 7).toISOString()
    repo.scheduledBlocks
      .listByRange(from, to)
      .then((rows) => {
        if (cancelled) return
        blocksCacheRef.current.set(key, rows)
        setBlocks(rows)
        setBlocksLoading(false)
      })
      .catch((e) => {
        if (cancelled) return
        console.error('Planner: load scheduled blocks failed', e)
        setBlocksLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [userId, weekKey, weekStartDate, dashboardRefreshKey, blocksReloadKey])

  /** Apply a local optimistic change and keep the per-week cache honest. */
  const patchBlocks = useCallback(
    (fn: (prev: ScheduledBlock[]) => ScheduledBlock[]) => {
      setBlocks((prev) => {
        const next = fn(prev)
        blocksCacheRef.current.set(`${dashboardRefreshKey}:${weekKey}`, next)
        return next
      })
    },
    [dashboardRefreshKey, weekKey],
  )

  const weekBlocks = useMemo(
    () => scheduledToWeekBlocks(blocks, weekStartDate),
    [blocks, weekStartDate],
  )

  // ── capacity (scheduled is real now — chunk 37) ────────────────────────
  const capacity = useMemo(
    () => computeCapacity(busyBlocks, weekBlocks),
    [busyBlocks, weekBlocks],
  )
  const dayFree = useMemo(
    () =>
      days.map((_, i) =>
        i >= 5
          ? undefined
          : computeDayFree(i, busyBlocks, weekBlocks, todayIdx, nowMin),
      ),
    [days, busyBlocks, weekBlocks, todayIdx, nowMin],
  )
  // Header free-total is the sum of the per-day figures by construction —
  // `computeCapacity.free` has no past-day/elapsed-time clamping and would
  // show the full 45h even on past weeks.
  const weekFree = useMemo(
    () => dayFree.reduce((sum: number, v) => sum + (v ?? 0), 0),
    [dayFree],
  )

  // ── tasks (tray + block join) ──────────────────────────────────────────
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

  const subToCat = useMemo(() => {
    const catById = new Map(taskData.categories.map((c) => [c.id, c.name]))
    return new Map(
      taskData.subcategories
        .filter((s) => !s.archivedAt)
        .map((s) => [s.id, catById.get(s.categoryId) ?? 'Work']),
    )
  }, [taskData.categories, taskData.subcategories])

  const toTrayItem = useCallback(
    (task: Task): TrayItem => {
      const n0 = new Date(now.getFullYear(), now.getMonth(), now.getDate())
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
    },
    [now, subToCat],
  )

  const trayItems: TrayItem[] = useMemo(
    () =>
      splitTray(taskData.tasks, blocks)
        .filter((t) => subToCat.has(t.subcategoryId))
        .map(toTrayItem),
    [taskData.tasks, blocks, subToCat, toTrayItem],
  )

  const tasksById = useMemo(
    () => new Map(taskData.tasks.map((t) => [t.id, t])),
    [taskData.tasks],
  )

  const gridBlocks: GridTaskBlock[] = useMemo(
    () =>
      weekBlocks.flatMap((b) => {
        const task = tasksById.get(b.taskId)
        if (!task) return []
        return [
          {
            block: b,
            task,
            catName: subToCat.get(task.subcategoryId) ?? 'Work',
            done: b.done || task.completedAt !== null,
          },
        ]
      }),
    [weekBlocks, tasksById, subToCat],
  )

  // ── mutations (optimistic via repo; error → toast + re-read) ──────────
  const fail = useCallback(
    (e: unknown) => {
      console.error('Planner: write failed', e)
      toast.error(SAVE_ERROR)
      reloadBlocks()
    },
    [reloadBlocks],
  )

  const place = useCallback(
    async (
      task: Task,
      day: number,
      startMin: number,
      durationMin: number,
      via: 'drag' | 'sheet',
    ) => {
      if (!userId) return
      const endMin = Math.min(startMin + durationMin, 24 * 60)
      const ol = overlapBusy(day, startMin, endMin, busyBlocks)
      try {
        const created = await repo.scheduledBlocks.create({
          userId,
          taskId: task.id,
          startAt: toInstant(weekStartDate, day, startMin),
          endAt: toInstant(weekStartDate, day, endMin),
        })
        patchBlocks((prev) => [
          ...prev.filter((b) => b.taskId !== task.id),
          created,
        ])
        const where =
          via === 'drag'
            ? `Placed ${DAY_LABELS[day]} ${fmtClock(startMin)}`
            : `Scheduled ${fmtClock(startMin)}`
        toast(
          ol
            ? `${where} — overlaps ${ol.title ?? 'busy'} by ${ol.mins}m.`
            : `${where}.`,
        )
      } catch (e) {
        fail(e)
      }
    },
    [userId, busyBlocks, weekStartDate, patchBlocks, fail],
  )

  const move = useCallback(
    async (wb: WeekScheduledBlock, day: number, startMin: number) => {
      const full = blocks.find((b) => b.id === wb.id)
      if (!full) return
      const durMin =
        (new Date(full.endAt).getTime() - new Date(full.startAt).getTime()) /
        60_000
      const startAt = toInstant(weekStartDate, day, startMin)
      const endAt = new Date(
        new Date(startAt).getTime() + durMin * 60_000,
      ).toISOString()
      patchBlocks((prev) =>
        prev.map((b) => (b.id === wb.id ? { ...b, startAt, endAt } : b)),
      )
      try {
        const saved = await repo.scheduledBlocks.update(wb.id, { startAt, endAt })
        patchBlocks((prev) => prev.map((b) => (b.id === wb.id ? saved : b)))
      } catch (e) {
        fail(e)
      }
    },
    [blocks, weekStartDate, patchBlocks, fail],
  )

  const resize = useCallback(
    async (wb: WeekScheduledBlock, endMin: number) => {
      const endAt = toInstant(weekStartDate, wb.day, endMin)
      patchBlocks((prev) =>
        prev.map((b) => (b.id === wb.id ? { ...b, endAt } : b)),
      )
      try {
        const saved = await repo.scheduledBlocks.update(wb.id, { endAt })
        patchBlocks((prev) => prev.map((b) => (b.id === wb.id ? saved : b)))
      } catch (e) {
        fail(e)
      }
    },
    [weekStartDate, patchBlocks, fail],
  )

  const toggleDone = useCallback(
    async (wb: WeekScheduledBlock) => {
      const task = tasksById.get(wb.taskId)
      const currentlyDone = wb.done || (task?.completedAt ?? null) !== null
      const next = !currentlyDone
      patchBlocks((prev) =>
        prev.map((b) => (b.id === wb.id ? { ...b, done: next } : b)),
      )
      try {
        const savedBlock = await repo.scheduledBlocks.update(wb.id, { done: next })
        patchBlocks((prev) => prev.map((b) => (b.id === wb.id ? savedBlock : b)))
        const savedTask = await repo.tasks.markComplete(wb.taskId, next)
        setTaskData((d) => ({
          ...d,
          tasks: d.tasks.map((t) => (t.id === savedTask.id ? savedTask : t)),
        }))
      } catch (e) {
        fail(e)
      }
    },
    [tasksById, patchBlocks, fail],
  )

  const unschedule = useCallback(
    async (wb: WeekScheduledBlock) => {
      patchBlocks((prev) => prev.filter((b) => b.id !== wb.id))
      try {
        await repo.scheduledBlocks.delete(wb.id)
        toast('Returned to tray.')
      } catch (e) {
        fail(e)
      }
    },
    [patchBlocks, fail],
  )

  // ── sheets (mounted once, shared by both breakpoints) ─────────────────
  const [sheet, setSheet] = useState<{
    item: TrayItem
    day: number
    from: 'desktop' | 'mobile'
  } | null>(null)
  const [actionBlock, setActionBlock] = useState<WeekScheduledBlock | null>(null)
  const actionEntry = actionBlock
    ? gridBlocks.find((g) => g.block.id === actionBlock.id) ?? null
    : null

  const openScheduleDesktop = useCallback(
    (item: TrayItem) =>
      setSheet({ item, day: todayInWeek ? todayIdx : 0, from: 'desktop' }),
    [todayInWeek, todayIdx],
  )
  const openScheduleMobile = useCallback(
    (item: TrayItem) => setSheet({ item, day: selectedDay, from: 'mobile' }),
    [selectedDay],
  )

  // ── drag (desktop, native pointer events — D7) ─────────────────────────
  const gridRef = useRef<HTMLDivElement | null>(null)
  const windowRef = useRef({ h0: PLANNER.winCollapsedStart, h1: PLANNER.winCollapsedEnd })
  const onWindowChange = useCallback((w: { h0: number; h1: number }) => {
    windowRef.current = w
  }, [])
  const onGridRef = useCallback((el: HTMLDivElement | null) => {
    gridRef.current = el
  }, [])
  const onDrop = useCallback(
    (r: DropResult) => {
      if (r.kind === 'tray') {
        void place(
          r.task,
          r.over.day,
          r.over.startMin,
          r.over.endMin - r.over.startMin,
          'drag',
        )
      } else if (r.kind === 'move') {
        void move(r.block, r.over.day, r.over.startMin)
      } else {
        void resize(r.block, r.endMin)
      }
    },
    [place, move, resize],
  )
  const { drag, startTray, startMove, startResize } = usePlannerDrag({
    gridRef,
    getWindow: () => windowRef.current,
    enabled: !isTouch,
    onDrop,
  })

  const onCardPointerDown = useCallback(
    (e: PointerEvent<HTMLElement>, item: TrayItem) =>
      startTray(
        e,
        item.task,
        item.catName,
        blockDurationMin(item.task.estimateMinutes),
      ),
    [startTray],
  )

  // ── render ─────────────────────────────────────────────────────────────
  const loading = busyState.phase === 'loading' || blocksLoading
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
        · {fmtMin(weekFree)} free
      </span>
    </header>
  )

  const selectedDayBusy = busyBlocks.filter((b) => b.day === selectedDay)
  const selectedDayBlocks = gridBlocks.filter((g) => g.block.day === selectedDay)
  const selectedDayFree =
    selectedDay >= 5
      ? undefined
      : computeDayFree(selectedDay, busyBlocks, weekBlocks, todayIdx, nowMin)

  const draggingTrayItem =
    drag?.kind === 'tray'
      ? trayItems.find((i) => i.task.id === drag.task.id) ?? toTrayItem(drag.task)
      : null

  return (
    <div>
      {/* Desktop / tablet ≥sm */}
      <div className="hidden gap-6 sm:flex">
        <PlannerTray
          items={trayItems}
          sortKey={sortKey}
          onChangeSortKey={onChangeSortKey}
          onSchedule={openScheduleDesktop}
          onCardPointerDown={onCardPointerDown}
          draggingTaskId={drag?.kind === 'tray' ? drag.task.id : null}
          touch={isTouch}
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
            scheduled={gridBlocks}
            drag={drag}
            touch={isTouch}
            onGridRef={onGridRef}
            onWindowChange={onWindowChange}
            onBlockPointerDown={startMove}
            onResizePointerDown={startResize}
            onToggleDone={toggleDone}
            onUnschedule={unschedule}
            onOpenActions={setActionBlock}
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
          scheduled={selectedDayBlocks}
          isToday={selectedDay === todayIdx}
          nowMin={nowMin}
          stale={!!stale}
          staleTime={staleTime}
          fetchedAt={busyState.fetchedAt}
          loading={loading}
          errorMessage={errorMessage}
          onOpenActions={setActionBlock}
          onToggleDone={toggleDone}
        />
        <MobileUnscheduledList
          items={trayItems}
          sortKey={sortKey}
          onSchedule={openScheduleMobile}
        />
      </div>

      {/* Floating card while a tray drag is live (desktop). */}
      {drag?.kind === 'tray' && draggingTrayItem && (
        <div
          aria-hidden
          className="pointer-events-none fixed w-[210px] rounded"
          style={{
            left: drag.px + 10,
            top: drag.py + 8,
            zIndex: 100,
            transform: 'rotate(-2deg)',
            boxShadow: 'var(--shadow-lg)',
          }}
        >
          <TrayCard item={draggingTrayItem} inert />
        </div>
      )}

      <ScheduleSheet
        open={sheet !== null}
        task={sheet?.item.task ?? null}
        catName={sheet?.item.catName ?? 'Work'}
        overdue={sheet?.item.overdue ?? false}
        days={days}
        todayIdx={todayIdx}
        initialDay={sheet?.day ?? 0}
        nowMin={nowMin}
        busy={busyBlocks}
        scheduled={weekBlocks}
        showDaySelector={sheet?.from === 'desktop'}
        onClose={() => setSheet(null)}
        onAdd={(day, startMin) => {
          const item = sheet?.item
          setSheet(null)
          if (!item) return
          void place(
            item.task,
            day,
            startMin,
            blockDurationMin(item.task.estimateMinutes),
            'sheet',
          )
        }}
      />

      <BlockActionSheet
        open={actionEntry !== null}
        title={actionEntry?.task.title ?? ''}
        rangeText={
          actionEntry
            ? fmtRange(actionEntry.block.startMin, actionEntry.block.endMin)
            : ''
        }
        done={actionEntry?.done ?? false}
        onToggleDone={() => {
          if (actionEntry) void toggleDone(actionEntry.block)
          setActionBlock(null)
        }}
        onUnschedule={() => {
          if (actionEntry) void unschedule(actionEntry.block)
          setActionBlock(null)
        }}
        onClose={() => setActionBlock(null)}
      />
    </div>
  )
}
