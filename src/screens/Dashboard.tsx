import {
  Suspense,
  lazy,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react'
import {
  DndContext,
  PointerSensor,
  TouchSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
} from '@dnd-kit/core'
import { Flame } from 'lucide-react'
import { useNavigate } from 'react-router-dom'
import { toast } from 'sonner'

import AllClearBanner from '@/components/AllClearBanner'
import BusyStrip, { BusyInline, useBusyToday } from '@/components/BusyStrip'
import CategoryColumn from '@/components/CategoryColumn'
import type { DeleteListChoice } from '@/components/DeleteSubcategoryDialog'
import EmptyStateCard from '@/components/EmptyStateCard'
import DailyHero from '@/components/gamify/DailyHero'
import ReconnectBanner from '@/components/ReconnectBanner'
import RecoveredTasks from '@/components/RecoveredTasks'
import ReviewPrompt from '@/components/ReviewPrompt'
import { TaskDragOverlay } from '@/components/TaskDragGhost'
import TodayPanel from '@/components/TodayPanel'
import TodayRoutines from '@/components/TodayRoutines'
import { repo } from '@/db/repo'
import type { Category, Subcategory, Task, TodayMark } from '@/db/types'
import { useSession } from '@/lib/auth'
import { today as clockToday } from '@/lib/clock'
import { selectDashboardState } from '@/lib/dashboardState'
import {
  loadHorizonFilter,
  storeHorizonFilter,
  type HorizonFilter,
} from '@/lib/horizon'
import {
  isReviewDue,
  loadLastReview,
  reviewCandidates,
  storeLastReview,
} from '@/lib/review'
import { deleteList, DELETE_LIST_TOAST } from '@/lib/deleteList'
import {
  isTaskDragId,
  resolveTaskDrop,
  taskDragCollision,
  type MoveTaskFn,
} from '@/lib/taskDragCollision'
import { resolveToday } from '@/lib/today'
import {
  loadTaskSortKey,
  storeTaskSortKey,
  type TaskSortKey,
} from '@/lib/taskSort'
import { taskStreak } from '@/lib/taskStreak'
import {
  deleteTasksWithUndo,
  moveLabel,
  offerCompleteUndo,
  offerMoveUndo,
} from '@/lib/taskUndo'
import type { RoutingProposal } from '@/lib/sorting'
import { useIsTouchDevice } from '@/lib/useIsTouchDevice'
import { useTodayListStore } from '@/state/todayList'
import { useTodayPlan, type WriteTodayMark } from '@/state/todayPlan'
import { useUIStore } from '@/state/uiStore'

/*
 * Unified dashboard.
 *
 * Chunks 6 + 7 collaborate here: chunk 6 owns the read/render skeleton
 * and the design-system surfaces; chunk 7 layers create/edit/complete/
 * delete on top. Effect dep is still `uiStore.dashboardRefreshKey` —
 * the load only re-runs on explicit cues (Force-resync button, realtime
 * apply). Tasks update in-place via the returned row from each repo
 * mutation, so totals re-derive without a refetch.
 *
 * Chunk 7's render filter: incomplete tasks render by default;
 * completed tasks are tucked behind the "N completed" expander per
 * subcategory. The filter lives in SubcategorySection — completed
 * tasks still load from the repo so the expander has something to show.
 *
 * Drill-down navigation, three-dot menus, AI triage, bell-icon
 * interaction, and reminders all remain stubs handled by later chunks
 * (9, 11, 14).
 */

const SAVE_ERROR = 'Could not save — retry'

// The review walk (chunk 74) loads on first open, like the chunk-73 dialogs.
const ReviewSheet = lazy(() => import('@/components/ReviewSheet'))
// Sort General (chunk 89): only the chip and its count are eager.
const SortingSheet = lazy(() => import('@/components/SortingSheet'))

/** Pending routing proposals (chunk 89), re-read on every dashboard refresh. */
function usePendingRouting(userId: string | null) {
  const [pending, setPending] = useState<RoutingProposal[]>([])
  const key = useUIStore((s) => s.dashboardRefreshKey)
  useEffect(() => {
    if (!userId) return
    let cancelled = false
    repo.routing
      .pending()
      .then((rows) => {
        if (!cancelled) setPending(rows)
      })
      .catch(() => {}) // offline or unreachable: keep the last count
    return () => {
      cancelled = true
    }
  }, [key, userId])
  return pending
}

type DashboardData = {
  categories: Category[]
  subcategories: Subcategory[]
  tasks: Task[]
}

function useDashboardData(userId: string | null) {
  const [data, setData] = useState<DashboardData>({
    categories: [],
    subcategories: [],
    tasks: [],
  })
  // The user's Today marks (chunk 64) — `null` until the first load completes,
  // which is how `useTodayPlan` tells "no marks" from "not loaded yet".
  const [todayMarks, setTodayMarks] = useState<TodayMark[] | null>(null)
  // The Settings time zone Today's day frame and the task streak run in
  // (chunks 66, 78), resolved in `load`. The default matches `tz`'s.
  const [timeZone, setTimeZone] = useState('America/New_York')
  const [loading, setLoading] = useState(true)
  const dashboardRefreshKey = useUIStore((s) => s.dashboardRefreshKey)

  useEffect(() => {
    let cancelled = false
    async function load() {
      // Resolve the timezone from settings first (default if not yet
      // hydrated).
      const settings = userId ? await repo.settings.get(userId) : null
      const tz = settings?.timezone ?? 'America/New_York'
      const [categories, subcategories, tasks, marks] = await Promise.all([
        repo.categories.list(),
        repo.subcategories.list(),
        repo.tasks.list(),
        repo.todayMarks.list(),
      ])
      if (cancelled) return
      setData({ categories, subcategories, tasks })
      setTodayMarks(marks)
      setTimeZone(tz)
      setLoading(false)
    }
    load().catch((e) => {
      console.error('Dashboard load failed', e)
      if (!cancelled) setLoading(false)
    })
    return () => {
      cancelled = true
    }
  }, [dashboardRefreshKey, userId])

  return { data, setData, loading, todayMarks, timeZone }
}

export default function Dashboard() {
  const { user } = useSession()
  const userId = user?.id ?? null
  const { data, setData, loading, todayMarks, timeZone } =
    useDashboardData(userId)
  // The hero's task streak (chunk 78, ARCH §11): every task held, in any
  // subcategory. Derived in render, so completing a task (or Undo) moves the
  // chip without a refetch. `clockToday` keeps the DEV `__clockOverride`.
  const streak = useMemo(
    () => taskStreak(data.tasks, clockToday(timeZone), timeZone),
    [data.tasks, timeZone],
  )
  const navigate = useNavigate()
  // Today's busy times (chunk 74): fetched once here, rendered as the Today
  // header's line, the standalone strip, or the reconnect banner.
  const busy = useBusyToday()

  // Weekly review of old tasks (chunk 74). The last-review date is per device.
  const [lastReview, setLastReview] = useState<string | null>(loadLastReview)
  const [reviewOpen, setReviewOpen] = useState(false)
  // Latched on the first open so the lazy sheet stays mounted to close.
  const [reviewUsed, setReviewUsed] = useState(false)
  if (reviewOpen && !reviewUsed) setReviewUsed(true)
  const routing = usePendingRouting(userId)
  const [sortOpen, setSortOpen] = useState(false)
  const [sortUsed, setSortUsed] = useState(false)
  if (sortOpen && !sortUsed) setSortUsed(true)
  const markReviewed = useCallback(() => {
    const now = new Date()
    storeLastReview(now)
    setLastReview(now.toISOString())
  }, [])

  // Global list-sort preference (chunk 33) — one localStorage-backed
  // value shared by both column controls and every list in the app.
  const [sortKey, setSortKey] = useState<TaskSortKey>(loadTaskSortKey)
  const onChangeSortKey = useCallback((key: TaskSortKey) => {
    setSortKey(key)
    storeTaskSortKey(key)
  }, [])

  // Global horizon filter (chunk 76) — same shape as the sort preference.
  const [horizon, setHorizon] = useState<HorizonFilter>(loadHorizonFilter)
  const onChangeHorizon = useCallback((f: HorizonFilter) => {
    setHorizon(f)
    storeHorizonFilter(f)
  }, [])

  const subsByCat = useMemo(() => {
    const m: Record<string, Subcategory[]> = {}
    const live = data.subcategories.filter((s) => !s.archivedAt)
    live.sort((a, b) => a.sortOrder - b.sortOrder)
    for (const s of live) {
      ;(m[s.categoryId] ??= []).push(s)
    }
    return m
  }, [data.subcategories])

  // Live subcategory ids — used to filter tasks belonging to archived
  // subs so they don't briefly flash visible while a row update is in
  // flight. Same render-layer filter approach used for completed tasks.
  const liveSubIds = useMemo(() => {
    const s = new Set<string>()
    for (const sub of data.subcategories) {
      if (!sub.archivedAt) s.add(sub.id)
    }
    return s
  }, [data.subcategories])

  const tasksBySub = useMemo(() => {
    const m: Record<string, Task[]> = {}
    for (const t of data.tasks) {
      if (!liveSubIds.has(t.subcategoryId)) continue
      ;(m[t.subcategoryId] ??= []).push(t)
    }
    return m
  }, [data.tasks, liveSubIds])

  // All tasks under live subcategories (done + open) — the hero's XP, level
  // and bars derive from these so they stay consistent with the visible
  // columns (chunk-26 note E). The ring reads the Today plan (chunk 70).
  const liveTasks = useMemo(
    () => data.tasks.filter((t) => liveSubIds.has(t.subcategoryId)),
    [data.tasks, liveSubIds],
  )

  // Open tasks whose subcategory is archived or missing (chunk 70). Every other
  // view filters them out; the Recovered card is the one place to reach them.
  const orphanTasks = useMemo(
    () =>
      data.tasks
        .filter((t) => t.completedAt === null && !liveSubIds.has(t.subcategoryId))
        .sort((a, b) => a.createdAt.localeCompare(b.createdAt)),
    [data.tasks, liveSubIds],
  )
  // Every subcategory's name, archived ones included, for "from <list>".
  const subNameById = useMemo(() => {
    const m: Record<string, string> = {}
    for (const s of data.subcategories) m[s.id] = s.name
    return m
  }, [data.subcategories])

  // Today plan — membership seeded from the live tasks, re-seeded on task-set
  // identity change. The sun toggle on both the Today panel and the dashboard
  // rows drives this one shared set (chunk: Today list). The manual pins and
  // removals are synced through `today_marks` (chunk 64): the hook reads the
  // loaded marks and writes one per toggle.
  const isTouch = useIsTouchDevice()
  const todayVariant = useTodayListStore((s) => s.todayList)
  const writeTodayMark = useCallback<WriteTodayMark>(
    async (taskId, kind, day) => {
      if (!userId) return
      await repo.todayMarks.set({ taskId, userId, day, kind })
    },
    [userId],
  )
  const { todaySet, toggleToday } = useTodayPlan(
    liveTasks,
    todayMarks,
    writeTodayMark,
    timeZone,
  )

  // "On a roll ×N" combo (chunk 27). A render-diff over the live tasks: when
  // exactly one task flips to done (open −1, done +1) within ~9s of the last
  // such flip, the combo climbs; at ×2+ a brief badge shows, auto-dismissing
  // after 1.5s. No confetti, ever. Snapshots live in refs so the detection
  // never triggers a re-render itself — only the ×2+ badge does.
  const comboSnap = useRef<{ open: number; done: number } | null>(null)
  const lastCompletionAt = useRef(0)
  const comboCount = useRef(0)
  // `onCompleteTask` bumps `localCompletions` on a local (user) completion;
  // the effect only credits the roll when it advanced since its last pass.
  // The snapshot diff alone can't tell a user click from a realtime / Force-
  // resync replacement of `data.tasks` (both shift done/open), so without this
  // a remote completion would prime the window and mis-fire the next click.
  const localCompletions = useRef(0)
  const seenCompletions = useRef(0)
  const [comboMsg, setComboMsg] = useState<{ n: number; k: number } | null>(null)
  useEffect(() => {
    const open = liveTasks.filter((t) => !t.completedAt).length
    const done = liveTasks.length - open
    const prev = comboSnap.current
    const localHappened = localCompletions.current !== seenCompletions.current
    seenCompletions.current = localCompletions.current
    if (localHappened && prev && done === prev.done + 1 && open === prev.open - 1) {
      const now = Date.now()
      comboCount.current =
        now - lastCompletionAt.current < 9000 ? comboCount.current + 1 : 1
      lastCompletionAt.current = now
      if (comboCount.current >= 2) {
        const k = now
        setComboMsg({ n: comboCount.current, k })
        // Guard on `k` so a stale timer can't clear a newer badge.
        setTimeout(() => setComboMsg((m) => (m && m.k === k ? null : m)), 1500)
      }
    }
    comboSnap.current = { open, done }
  }, [liveTasks])

  // ---------- mutation handlers ----------

  const upsertTask = useCallback((next: Task) => {
    setData((prev) => {
      const idx = prev.tasks.findIndex((t) => t.id === next.id)
      const tasks =
        idx === -1
          ? [...prev.tasks, next]
          : prev.tasks.map((t) => (t.id === next.id ? next : t))
      return { ...prev, tasks }
    })
  }, [setData])

  const onCreateTask = useCallback(
    async (input: {
      subcategoryId: string
      title: string
      estimateMinutes: number
    }): Promise<boolean> => {
      if (!userId) return false
      try {
        const created = await repo.tasks.create({
          userId,
          subcategoryId: input.subcategoryId,
          title: input.title,
          estimateMinutes: input.estimateMinutes,
          dueAt: null,
          remindAt: null,
          priority: null,
          completedAt: null,
        })
        upsertTask(created)
        toast('Task added')
        return true
      } catch (e) {
        console.error('Create task failed', e)
        toast.error(SAVE_ERROR)
        return false
      }
    },
    [userId, upsertTask],
  )

  const onEditTitle = useCallback(
    async (id: string, title: string) => {
      try {
        const updated = await repo.tasks.update(id, { title })
        upsertTask(updated)
      } catch (e) {
        console.error('Edit title failed', e)
        toast.error(SAVE_ERROR)
      }
    },
    [upsertTask],
  )

  const onEditMinutes = useCallback(
    async (id: string, estimateMinutes: number) => {
      try {
        const updated = await repo.tasks.update(id, { estimateMinutes })
        upsertTask(updated)
      } catch (e) {
        console.error('Edit minutes failed', e)
        toast.error(SAVE_ERROR)
      }
    },
    [upsertTask],
  )

  const onCompleteTask = useCallback(
    async (id: string, completed: boolean) => {
      const before = data.tasks.find((t) => t.id === id)
      try {
        const updated = await repo.tasks.markComplete(id, completed)
        // Tag this as a local completion so the "On a roll" combo only counts
        // the user's own clicks — not realtime/resync echoes.
        if (completed) localCompletions.current += 1
        upsertTask(updated)
        // Checking off offers a 6 s Undo (chunk 72); unchecking does not.
        if (completed && before) {
          offerCompleteUndo({
            before: [before],
            onRestored: (rows) => rows.forEach(upsertTask),
          })
        }
      } catch (e) {
        console.error('Complete task failed', e)
        toast.error(SAVE_ERROR)
      }
    },
    [data.tasks, upsertTask],
  )

  // No confirm and no write here (chunk 72): the row leaves the screen now and
  // lib/taskUndo hard-deletes it 6 s later unless Undo is pressed.
  const onDeleteTask = useCallback(
    (id: string) => {
      const task = data.tasks.find((t) => t.id === id)
      if (!task) return
      setData((prev) => ({
        ...prev,
        tasks: prev.tasks.filter((t) => t.id !== id),
      }))
      deleteTasksWithUndo({
        tasks: [task],
        // Undo puts the held row back (upsert is by id, so no duplicates).
        onRestore: (rows) => rows.forEach(upsertTask),
      })
    },
    [data.tasks, setData, upsertTask],
  )

  // Several at once, for the review sheet (chunk 74): one toast, one Undo.
  const onDeleteTasks = useCallback(
    (ids: string[]) => {
      const drop = new Set(ids)
      const tasks = data.tasks.filter((t) => drop.has(t.id))
      if (tasks.length === 0) return
      setData((prev) => ({
        ...prev,
        tasks: prev.tasks.filter((t) => !drop.has(t.id)),
      }))
      deleteTasksWithUndo({
        tasks,
        onRestore: (rows) => rows.forEach(upsertTask),
      })
    },
    [data.tasks, setData, upsertTask],
  )

  // Every close of the review sheet. Deletes run only now: while the modal is
  // open, the Undo toast cannot be clicked.
  const onReviewClose = useCallback(
    (deleteIds: string[]) => {
      setReviewOpen(false)
      markReviewed()
      if (deleteIds.length > 0) onDeleteTasks(deleteIds)
    },
    [markReviewed, onDeleteTasks],
  )

  // Every move — drag or ⋯ → Move to… — toasts where it went, with Undo
  // (chunk 88). `viaDrag` is accepted and ignored (MoveTaskFn).
  const onMoveTaskToSubcategory = useCallback<MoveTaskFn>(
    async (id, targetSubcategoryId) => {
      const before = data.tasks.find((t) => t.id === id)
      try {
        const updated = await repo.tasks.update(id, {
          subcategoryId: targetSubcategoryId,
        })
        upsertTask(updated)
        const toLabel = moveLabel(
          before?.subcategoryId ?? '',
          targetSubcategoryId,
          data.subcategories,
          data.categories,
        )
        if (before) offerMoveUndo({ before, toLabel, onRestored: upsertTask })
        else toast(`Moved to ${toLabel}`)
      } catch (e) {
        console.error('Move task failed', e)
        toast.error(SAVE_ERROR)
      }
    },
    [data.tasks, data.subcategories, data.categories, upsertTask],
  )

  const onSetTaskReminder = useCallback(
    async (id: string, remindAt: string | null) => {
      try {
        const updated = await repo.tasks.update(id, {
          remindAt,
          // Resetting `remindAt` resets the notified flag so a future
          // reminder fires; chunk 14 owns the actual delivery.
          notified: false,
        })
        upsertTask(updated)
        toast(remindAt ? 'Reminder set' : 'Reminder cleared')
      } catch (e) {
        console.error('Set reminder failed', e)
        toast.error(SAVE_ERROR)
      }
    },
    [upsertTask],
  )

  const onSetTaskDue = useCallback(
    async (id: string, dueAt: string | null) => {
      try {
        const updated = await repo.tasks.update(id, { dueAt })
        upsertTask(updated)
        toast(dueAt ? 'Due date set' : 'Due date cleared')
      } catch (e) {
        console.error('Set due date failed', e)
        toast.error(SAVE_ERROR)
      }
    },
    [upsertTask],
  )

  const onSetTaskPriority = useCallback(
    async (id: string, priority: 1 | 2 | 3 | null) => {
      try {
        const updated = await repo.tasks.update(id, { priority })
        upsertTask(updated)
        toast(priority ? `Priority set to P${priority}` : 'Priority cleared')
      } catch (e) {
        console.error('Set priority failed', e)
        toast.error(SAVE_ERROR)
      }
    },
    [upsertTask],
  )

  const upsertSubcategory = useCallback(
    (next: Subcategory) => {
      setData((prev) => {
        const idx = prev.subcategories.findIndex((s) => s.id === next.id)
        const subcategories =
          idx === -1
            ? [...prev.subcategories, next]
            : prev.subcategories.map((s) => (s.id === next.id ? next : s))
        return { ...prev, subcategories }
      })
    },
    [setData],
  )

  const onCreateSubcategory = useCallback(
    async (input: {
      categoryId: string
      name: string
    }): Promise<boolean> => {
      if (!userId) return false
      const siblings = data.subcategories.filter(
        (s) => s.categoryId === input.categoryId && !s.archivedAt,
      )
      const nextSortOrder =
        siblings.reduce((max, s) => Math.max(max, s.sortOrder), -1) + 1
      try {
        const created = await repo.subcategories.create({
          userId,
          categoryId: input.categoryId,
          name: input.name,
          sortOrder: nextSortOrder,
        })
        upsertSubcategory(created)
        toast('Subcategory added')
        return true
      } catch (e) {
        console.error('Create subcategory failed', e)
        toast.error(SAVE_ERROR)
        return false
      }
    },
    [userId, data.subcategories, upsertSubcategory],
  )

  const onRenameSubcategory = useCallback(
    async (id: string, name: string) => {
      try {
        const updated = await repo.subcategories.update(id, { name })
        upsertSubcategory(updated)
      } catch (e) {
        console.error('Rename subcategory failed', e)
        toast.error(SAVE_ERROR)
      }
    },
    [upsertSubcategory],
  )

  const onDeleteSubcategory = useCallback(
    async (id: string, choice: DeleteListChoice) => {
      try {
        const { archived, updated, deletedIds } = await deleteList(
          id,
          choice,
          data.tasks,
        )
        if (updated.length > 0 || deletedIds.length > 0) {
          const byId = new Map(updated.map((t) => [t.id, t]))
          const gone = new Set(deletedIds)
          setData((prev) => ({
            ...prev,
            tasks: prev.tasks
              .filter((t) => !gone.has(t.id))
              .map((t) => byId.get(t.id) ?? t),
          }))
        }
        upsertSubcategory(archived)
        toast(DELETE_LIST_TOAST[choice.kind])
      } catch (e) {
        console.error('Delete list failed', e)
        toast.error(SAVE_ERROR)
      }
    },
    [data.tasks, setData, upsertSubcategory],
  )

  const onMergeSubcategory = useCallback(
    async (sourceId: string, targetId: string) => {
      const sourceTasks = data.tasks.filter(
        (t) => t.subcategoryId === sourceId,
      )
      const targetSub = data.subcategories.find((s) => s.id === targetId)
      try {
        if (sourceTasks.length > 0) {
          const moved = await repo.tasks.bulkUpdate(
            sourceTasks.map((t) => ({
              id: t.id,
              patch: { subcategoryId: targetId },
            })),
          )
          setData((prev) => {
            const byId = new Map(moved.map((t) => [t.id, t]))
            return {
              ...prev,
              tasks: prev.tasks.map((t) => byId.get(t.id) ?? t),
            }
          })
        }
        const archived = await repo.subcategories.archive(sourceId)
        upsertSubcategory(archived)
        toast(`Merged into ${targetSub?.name ?? 'subcategory'}`)
      } catch (e) {
        console.error('Merge subcategory failed', e)
        toast.error(SAVE_ERROR)
      }
    },
    [data.tasks, data.subcategories, setData, upsertSubcategory],
  )

  const reorderSubsByIds = useCallback(
    async (categoryId: string, orderedIds: string[]) => {
      // Recompute sort_order densely (0, 1, 2, ...) for the visible
      // subs in this category. The repo loops updates so each row
      // becomes its own outbox entry offline — fine for 3-5 rows.
      const orders = orderedIds.map((id, idx) => ({ id, sortOrder: idx }))
      // Optimistic local apply before the await so the UI doesn't
      // bounce back during the round-trip.
      setData((prev) => ({
        ...prev,
        subcategories: prev.subcategories.map((s) => {
          if (s.categoryId !== categoryId) return s
          const order = orders.find((o) => o.id === s.id)
          return order ? { ...s, sortOrder: order.sortOrder } : s
        }),
      }))
      try {
        await repo.subcategories.reorder(orders)
      } catch (e) {
        console.error('Reorder subcategories failed', e)
        toast.error(SAVE_ERROR)
      }
    },
    [setData],
  )

  const onReorderSubcategories = useCallback(
    (categoryId: string, orderedIds: string[]) => {
      void reorderSubsByIds(categoryId, orderedIds)
    },
    [reorderSubsByIds],
  )

  const onMoveSubcategory = useCallback(
    (id: string, direction: 'up' | 'down') => {
      const target = data.subcategories.find((s) => s.id === id)
      if (!target) return
      const siblings = data.subcategories
        .filter((s) => s.categoryId === target.categoryId && !s.archivedAt)
        .sort((a, b) => a.sortOrder - b.sortOrder)
      const idx = siblings.findIndex((s) => s.id === id)
      if (idx === -1) return
      const swapIdx = direction === 'up' ? idx - 1 : idx + 1
      if (swapIdx < 0 || swapIdx >= siblings.length) return
      const next = [...siblings]
      ;[next[idx], next[swapIdx]] = [next[swapIdx], next[idx]]
      void reorderSubsByIds(
        target.categoryId,
        next.map((s) => s.id),
      )
    },
    [data.subcategories, reorderSubsByIds],
  )

  const onDrillDown = useCallback(
    (kind: 'category' | 'subcategory', id: string) => {
      navigate(`/${kind}/${id}`)
    },
    [navigate],
  )

  // First-run CTA (chunk 20 — UX-05, Option 3): route into the chosen category
  // with the inline "Add subcategory" input auto-opened. A brand-new account has
  // no subcategory to hold a task, so the first step is creating a list — not
  // dropping the user onto empty columns with no add affordance.
  const onPickCategory = useCallback(
    (categoryId: string) => {
      navigate(`/category/${categoryId}`, {
        state: { addSubcategory: true },
      })
    },
    [navigate],
  )

  const liveSubcategories = useMemo(
    () => data.subcategories.filter((s) => !s.archivedAt),
    [data.subcategories],
  )

  // Chunk 88: one DndContext over both columns, so a task drags from Work to
  // Personal. 5px activation keeps grip clicks from starting drags; the touch
  // sensor serves the grip on phones (200ms hold).
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 200, tolerance: 5 } }),
  )

  function handleDragEnd(event: DragEndEvent) {
    const drop = resolveTaskDrop(event)
    if (drop) {
      void onMoveTaskToSubcategory(drop.taskId, drop.toSubId, { viaDrag: true })
      return
    }
    // List reorder, inside the dragged list's own category only.
    const { active, over } = event
    if (!over || isTaskDragId(active.id) || active.id === over.id) return
    const moved = liveSubcategories.find((s) => s.id === active.id)
    if (!moved) return
    const ids = (subsByCat[moved.categoryId] ?? []).map((s) => s.id)
    const oldIndex = ids.indexOf(String(active.id))
    const newIndex = ids.indexOf(String(over.id))
    if (oldIndex === -1 || newIndex === -1) return
    const next = [...ids]
    next.splice(oldIndex, 1)
    next.splice(newIndex, 0, moved.id)
    onReorderSubcategories(moved.categoryId, next)
  }

  if (loading) {
    return (
      <div className="text-[13px] text-muted-foreground">Loading…</div>
    )
  }

  const dashboardState = selectDashboardState(data.subcategories, data.tasks)

  const todayData = {
    categories: data.categories,
    subcategories: liveSubcategories,
    tasks: liveTasks,
  }
  // The hero ring's figures (chunk 70) — the same call the Today panel counts
  // with, so the two can never disagree.
  const todayRows = resolveToday(todayData, todaySet, timeZone)
  const todayFigures = {
    done: todayRows.filter((r) => r.task.completedAt).length,
    total: todayRows.length,
  }

  // First-run: a dashed-border CTA card replaces the columns (DESIGN_NOTES §3).
  if (dashboardState === 'first-run') {
    return (
      <div>
        {busy.kind === 'reconnect' && <ReconnectBanner className="mb-6" />}
        <BusyStrip busy={busy} />
        <DailyHero
          user={user}
          tasks={liveTasks}
          subcategories={liveSubcategories}
          categories={data.categories}
          streak={streak}
          today={todayFigures}
        />
        <EmptyStateCard
          categories={data.categories}
          onPickCategory={onPickCategory}
        />
      </div>
    )
  }

  // Old, open, unplanned tasks, offered for review once a week (chunk 74).
  const now = new Date()
  const candidates = reviewCandidates(todayData, todaySet, timeZone, now)
  // With Today off there is no header to carry the busy line.
  const busyInline =
    todayVariant === 'off' ? undefined : <BusyInline busy={busy} />

  const columns = (
    // Chunk 69: two columns come from a container query on `.category-cols`
    // (index.css), not the viewport — page margins and the Today rail both
    // narrow this grid independently of the window. No `grid-cols-*` utility
    // here: it would be emitted after `.category-grid` and override it.
    <div className="category-cols min-w-0">
      <DndContext
        sensors={sensors}
        collisionDetection={taskDragCollision}
        onDragEnd={handleDragEnd}
      >
        <div className="category-grid grid gap-6 sm:gap-8">
          {data.categories.map((cat) => (
            <CategoryColumn
              key={cat.id}
              category={cat}
              allCategories={data.categories}
              allSubcategories={liveSubcategories}
              subcategories={subsByCat[cat.id] ?? []}
              tasksBySub={tasksBySub}
              onDrillDown={onDrillDown}
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
              onChangeSortKey={onChangeSortKey}
              horizon={horizon}
              onChangeHorizon={onChangeHorizon}
              onCreateSubcategory={onCreateSubcategory}
              onRenameSubcategory={onRenameSubcategory}
              onDeleteSubcategory={onDeleteSubcategory}
              onMergeSubcategory={onMergeSubcategory}
              onMoveSubcategory={onMoveSubcategory}
              todaySet={todaySet}
              onToggleToday={toggleToday}
              timeZone={timeZone}
            />
          ))}
        </div>
        <TaskDragOverlay />
      </DndContext>
    </div>
  )

  return (
    <div>
      {comboMsg && (
        <div className="combo-badge" key={comboMsg.k}>
          <Flame className="size-[15px] text-warn" aria-hidden />
          On a roll ×{comboMsg.n}
        </div>
      )}
      {busy.kind === 'reconnect' && <ReconnectBanner className="mb-6" />}
      {todayVariant === 'off' && <BusyStrip busy={busy} />}
      <DailyHero
        user={user}
        tasks={liveTasks}
        subcategories={liveSubcategories}
        categories={data.categories}
        streak={streak}
        today={todayFigures}
        extraChip={
          routing.length > 0 && (
            <button
              type="button"
              onClick={() => setSortOpen(true)}
              className="min-h-8 rounded-full border border-line px-3 text-[12.5px] font-semibold text-ink hover:bg-bg-alt"
            >
              Sort General · {routing.length}
            </button>
          )
        }
      />
      {sortUsed && (
        <Suspense fallback={null}>
          <SortingSheet
            open={sortOpen}
            proposals={routing}
            categories={data.categories}
            subcategories={liveSubcategories}
            onClose={() => setSortOpen(false)}
          />
        </Suspense>
      )}
      <RecoveredTasks
        tasks={orphanTasks}
        subNameById={subNameById}
        liveSubcategories={liveSubcategories}
        categories={data.categories}
        onMove={onMoveTaskToSubcategory}
        onComplete={(id) => onCompleteTask(id, true)}
      />
      {isReviewDue(lastReview, now) && (
        <ReviewPrompt
          count={candidates.length}
          onReview={() => setReviewOpen(true)}
          onNotNow={markReviewed}
        />
      )}
      {reviewUsed && (
        <Suspense fallback={null}>
          <ReviewSheet
            open={reviewOpen}
            candidates={candidates}
            categories={data.categories}
            subcategories={liveSubcategories}
            timeZone={timeZone}
            onToggleToday={toggleToday}
            onClose={onReviewClose}
          />
        </Suspense>
      )}
      {/* All-clear: jade banner above the still-visible columns. */}
      {dashboardState === 'all-clear' && <AllClearBanner />}
      {/* Today plan. stacked/banner sit full-width above the columns; rail sits
          beside them (collapsing above on small screens); off renders nothing. */}
      {(todayVariant === 'stacked' || todayVariant === 'banner') && (
        <div className="mb-6 sm:mb-8">
          <TodayPanel
            variant={todayVariant}
            data={todayData}
            todaySet={todaySet}
            timeZone={timeZone}
            onToggleToday={toggleToday}
            onCompleteTask={onCompleteTask}
            mobile={isTouch}
            busy={busyInline}
            freeMin={busy.kind === 'ready' ? busy.freeMin : null}
            routines={<TodayRoutines />}
          />
        </div>
      )}
      {/* Routines in Today (chunk 78): banner and off have no panel body to
          hold them, so they sit on their own where the panel ends (or would). */}
      {(todayVariant === 'banner' || todayVariant === 'off') && (
        <div className="mb-6 sm:mb-8">
          <TodayRoutines standalone />
        </div>
      )}
      {todayVariant === 'rail' ? (
        <div className="grid items-start gap-6 lg:grid-cols-[minmax(230px,300px)_minmax(0,1fr)] lg:gap-8">
          <TodayPanel
            variant="rail"
            data={todayData}
            todaySet={todaySet}
            timeZone={timeZone}
            onToggleToday={toggleToday}
            onCompleteTask={onCompleteTask}
            mobile={isTouch}
            busy={busyInline}
            freeMin={busy.kind === 'ready' ? busy.freeMin : null}
            routines={<TodayRoutines />}
          />
          {columns}
        </div>
      ) : (
        columns
      )}
    </div>
  )
}
