/*
 * Today-membership state for the dashboard.
 *
 * Membership is a `Set<taskId>` seeded from `autoTodayIds(tasks)` plus the
 * user's manual deltas — pins and removals — and mutated by the sun toggle
 * (on both the Today rows and the main-list rows — one shared set). Since
 * chunk 64 the deltas are server-synced through `today_marks` (migration 20):
 * one row per task, keyed by the task's id, carrying the local calendar day
 * it was made for and the intent (`pin` / `remove`). The hook is handed the
 * user's marks and a writer; it keeps the ones dated today and ignores the
 * rest, so yesterday's plan never resurfaces and nothing has to be cleaned
 * up. Only the deltas are stored, never the resolved set, so auto signals
 * keep flowing as tasks change. The day frame is the calendar day in the
 * user's Settings time zone (`timeZone`, chunk 66) — the same frame
 * `lib/today` derives from — so `today_marks.day` is stamped in that zone.
 *
 * A toggle on another device arrives as a changed `marks` array (realtime →
 * dashboard refresh) and is applied with the same operation a local toggle
 * performs. Where this session has toggled a task itself, the newer of the
 * two observations decides — a refresh that predates a rapid second toggle
 * cannot flip the row back, and a later toggle elsewhere still wins.
 *
 * `hup:todayPlan`, the per-device localStorage entry that held the deltas
 * from chunk 43 until chunk 64, is read once, written to the server as marks
 * and removed.
 *
 * "Changes identity" is detected by the set of task IDs, so:
 *   - in-place edits (title, minutes, completion) never disturb the plan — which
 *     is what lets a just-completed task linger and keep counting toward
 *     done/total;
 *   - a created/deleted/swapped task triggers an incremental reconcile that adds
 *     newly-signalled tasks and drops deleted ones while preserving the user's
 *     manual pins and removals (see `reconcileTodayMembership`). A deleted
 *     task's mark is cascaded away server-side; until the refresh that drops
 *     it, a mark whose task is not in `tasks` is simply ignored.
 */
import { useCallback, useEffect, useRef, useState } from 'react'
import { toast } from 'sonner'

import type { Task, TodayMark } from '@/db/types'
import { dateKeyIn } from '@/lib/clock'
import { autoTodayIds, reconcileTodayMembership } from '@/lib/today'

export type TodayPlan = {
  /** The live membership set — shared by TodayPanel and the dashboard rows. */
  todaySet: Set<string>
  /** Add/remove a task. `force` sets an explicit state (true=add, false=remove). */
  toggleToday: (id: string, force?: boolean) => void
}

/** The user's manual intent, layered over the auto derivation. */
export type TodayDeltas = {
  pinned: Set<string>
  removed: Set<string>
}

type MarkKind = TodayMark['kind']

/** One of this session's own toggles: what it set and when (ISO). */
type LocalWrite = { kind: MarkKind; at: string }

export type WriteTodayMark = (
  taskId: string,
  kind: MarkKind,
  day: string,
) => Promise<unknown>

const STORAGE_KEY = 'hup:todayPlan'

/**
 * Browser-local day key (YYYY-MM-DD). Used ONLY to read the legacy
 * `hup:todayPlan` entry, which pre-chunk-64 builds dated in this frame.
 */
function localDayKey(now: Date): string {
  const p = (n: number) => String(n).padStart(2, '0')
  return `${now.getFullYear()}-${p(now.getMonth() + 1)}-${p(now.getDate())}`
}

function emptyDeltas(): TodayDeltas {
  return { pinned: new Set(), removed: new Set() }
}

/**
 * The deltas a pre-chunk-64 build left in localStorage for today, or empty
 * ones — a stale-dated or bad entry is discarded. Kept ONLY for the one-time
 * move onto `today_marks` in `useTodayPlan`; nothing writes this key any more.
 */
export function readTodayDeltas(now: Date = new Date()): TodayDeltas {
  if (typeof localStorage === 'undefined') return emptyDeltas()
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return emptyDeltas()
    const parsed: unknown = JSON.parse(raw)
    if (typeof parsed !== 'object' || parsed === null) return emptyDeltas()
    const { date, pinned, removed } = parsed as Record<string, unknown>
    if (date !== localDayKey(now)) {
      // Yesterday's plan is over — drop the entry rather than leaving the
      // string on disk for a device that is opened, untouched and closed
      // (chunk 46, D7). Only the stale-date branch prunes; a parse failure
      // on an entry dated today is left alone. A removal failure (private
      // mode) must not break the read, so it rides the outer try/catch —
      // the discard has already happened either way.
      localStorage.removeItem(STORAGE_KEY)
      return emptyDeltas()
    }
    const ids = (v: unknown) =>
      new Set(
        Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : [],
      )
    return { pinned: ids(pinned), removed: ids(removed) }
  } catch {
    return emptyDeltas()
  }
}

/** Resolved membership = (auto ∪ pinned) − removed. */
export function applyTodayDeltas(
  auto: Set<string>,
  deltas: TodayDeltas,
): Set<string> {
  const next = new Set(auto)
  for (const id of deltas.pinned) next.add(id)
  for (const id of deltas.removed) next.delete(id)
  return next
}

/**
 * Today's deltas: the marks dated `day` whose task is in `tasks`, with this
 * session's own toggles layered in. Where a task has both, the later
 * observation decides — compared as instants, never as strings (an optimistic
 * `…000Z` and PostgREST's `…+00:00` name the same moment; chunk 48 D13).
 * Empty until both marks and tasks have loaded.
 */
function resolveTodayDeltas(
  marks: TodayMark[] | null,
  tasks: Task[],
  day: string,
  localWrites: Map<string, LocalWrite>,
): TodayDeltas {
  const deltas = emptyDeltas()
  if (marks === null || tasks.length === 0) return deltas
  const ids = new Set(tasks.map((t) => t.id))
  const kinds = new Map<string, MarkKind>()
  const markAt = new Map<string, number>()
  for (const m of marks) {
    if (m.day !== day || !ids.has(m.id)) continue
    kinds.set(m.id, m.kind)
    markAt.set(m.id, Date.parse(m.updatedAt))
  }
  for (const [id, w] of localWrites) {
    if (!ids.has(id)) continue
    const at = markAt.get(id)
    if (at === undefined || !(at >= Date.parse(w.at))) kinds.set(id, w.kind)
  }
  for (const [id, kind] of kinds) {
    if (kind === 'pin') deltas.pinned.add(id)
    else deltas.removed.add(id)
  }
  return deltas
}

/** Content signature of a deltas pair — what "the deltas changed" compares. */
function deltasSignature(deltas: TodayDeltas): string {
  return `${[...deltas.pinned].sort().join(',')}|${[...deltas.removed].sort().join(',')}`
}

export function useTodayPlan(
  tasks: Task[],
  marks: TodayMark[] | null,
  writeMark: WriteTodayMark,
  timeZone: string,
): TodayPlan {
  // `day` is the day (in `timeZone`) the plan is being resolved for. Every write stamps
  // THIS key, not the wall clock, and only marks carrying it count — so a tab
  // open across midnight keeps one consistent frame until `rollIfNewDay`
  // observes the change.
  const [initial] = useState(() => {
    const day = dateKeyIn(new Date(), timeZone)
    const deltas = resolveTodayDeltas(marks, tasks, day, new Map())
    return { day, deltas, signature: deltasSignature(deltas) }
  })
  const dayRef = useRef(initial.day)
  // The zone membership was last derived in; a change re-seeds (see effect).
  const zoneRef = useRef(timeZone)
  const [membership, setMembership] = useState<Set<string>>(() =>
    applyTodayDeltas(autoTodayIds(tasks, timeZone), initial.deltas),
  )
  // The task-id set from the render that last seeded/reconciled membership.
  const idsRef = useRef<Set<string>>(new Set(tasks.map((t) => t.id)))
  // Signature of the deltas membership last had applied.
  const signatureRef = useRef(initial.signature)
  // This session's own toggles for the current day, by task id.
  const localWritesRef = useRef<Map<string, LocalWrite>>(new Map())
  // The localStorage → marks move runs at most once per mount.
  const movedRef = useRef(false)
  // Current membership for the toggle's synchronous read (no updater-side
  // effects — StrictMode double-invokes updaters).
  const membershipRef = useRef(membership)
  useEffect(() => {
    membershipRef.current = membership
  }, [membership])
  // Latest inputs for the toggle's rollover re-seed (a roll invalidates the
  // resolved set in `membershipRef`, so it re-derives from the auto signals)
  // and for writes issued outside render.
  const tasksRef = useRef(tasks)
  const marksRef = useRef(marks)
  const writeMarkRef = useRef(writeMark)
  const timeZoneRef = useRef(timeZone)
  useEffect(() => {
    tasksRef.current = tasks
    marksRef.current = marks
    writeMarkRef.current = writeMark
    timeZoneRef.current = timeZone
  })

  // Send one mark. Offline is not a failure — the repo queues the write — so
  // a rejection is the server refusing it (a 4xx): say so and keep the local
  // plan, which is what the user asked for and what a retry will re-send.
  const sendMark = useCallback((id: string, kind: MarkKind, day: string) => {
    void (async () => {
      try {
        await writeMarkRef.current(id, kind, day)
      } catch {
        toast.error('Could not save Today plan — retry')
      }
    })()
  }, [])

  // Day rollover, observed lazily on the next interaction or task refresh —
  // deliberately no timer/interval/visibility listener (the app has no
  // day-tick). When the day (in the Settings zone) has changed, yesterday's plan is over:
  // its marks no longer match `dayRef` and this session's toggles are
  // dropped. Nothing is written — a stale mark is overwritten by the next
  // toggle of its task.
  const rollIfNewDay = useCallback((now: Date): boolean => {
    const key = dateKeyIn(now, timeZoneRef.current)
    if (key === dayRef.current) return false
    localWritesRef.current.clear()
    dayRef.current = key
    return true
  }, [])

  // Re-resolve when the task-id set changes identity (added, removed, or
  // swapped) or the deltas change content (marks loaded, or a toggle on
  // another device arrived) — not on in-place field edits (which keep the
  // same ids) or reorder. That's what lets a just-completed task linger in
  // the plan and keep counting toward done/total. Runs in an effect
  // (post-commit) so refs aren't touched during render; the conditional
  // setState mirrors the SubcategorySection linger idiom.
  useEffect(() => {
    const rolled = rollIfNewDay(new Date())
    // A Settings-zone change moves the day frame: re-derive the auto signals
    // in the new zone (this session's toggles for the day are kept).
    const rezoned = zoneRef.current !== timeZone
    zoneRef.current = timeZone
    const day = dayRef.current
    const curIds = tasks.map((t) => t.id)
    const prevIds = idsRef.current
    const changed =
      curIds.length !== prevIds.size ||
      curIds.some((id) => !prevIds.has(id))

    // One-time move off localStorage, on the first pass where both marks and
    // tasks are loaded: each stored pin/removal whose task exists and has no
    // mark for today becomes a mark (a server mark already there wins), then
    // the key is removed for good.
    if (!movedRef.current && marks !== null && curIds.length > 0) {
      movedRef.current = true
      const stored = readTodayDeltas(new Date())
      const live = new Set(curIds)
      const marked = new Set(
        marks.filter((m) => m.day === day).map((m) => m.id),
      )
      const at = new Date().toISOString()
      const move = (ids: Set<string>, kind: MarkKind) => {
        for (const id of ids) {
          if (!live.has(id) || marked.has(id)) continue
          localWritesRef.current.set(id, { kind, at })
          sendMark(id, kind, day)
        }
      }
      move(stored.pinned, 'pin')
      move(stored.removed, 'remove')
      try {
        localStorage.removeItem(STORAGE_KEY)
      } catch {
        // Private mode / SSR shim — nothing to remove.
      }
    }

    const deltas = resolveTodayDeltas(marks, tasks, day, localWritesRef.current)
    const signature = deltasSignature(deltas)
    const deltasChanged = signature !== signatureRef.current
    if (!changed && !rolled && !rezoned && !deltasChanged) return
    idsRef.current = new Set(curIds)
    signatureRef.current = signature
    // After a roll the previous membership is yesterday's resolved set —
    // re-seed from the auto signals rather than layering the deltas over it.
    setMembership((cur) => {
      if (rolled || rezoned) {
        return applyTodayDeltas(autoTodayIds(tasks, timeZone), deltas)
      }
      const base = changed
        ? reconcileTodayMembership(cur, prevIds, tasks, timeZone)
        : cur
      return applyTodayDeltas(base, deltas)
    })
  }, [tasks, marks, timeZone, rollIfNewDay, sendMark])

  const toggleToday = useCallback(
    (id: string, force?: boolean) => {
      const rolled = rollIfNewDay(new Date())
      const cur = rolled
        ? applyTodayDeltas(
            autoTodayIds(tasksRef.current, timeZoneRef.current),
            resolveTodayDeltas(
              marksRef.current,
              tasksRef.current,
              dayRef.current,
              localWritesRef.current,
            ),
          )
        : membershipRef.current
      const want = force === undefined ? !cur.has(id) : force
      if (want === cur.has(id)) {
        if (rolled) {
          membershipRef.current = cur
          setMembership(cur)
        }
        return
      }
      const kind: MarkKind = want ? 'pin' : 'remove'
      localWritesRef.current.set(id, { kind, at: new Date().toISOString() })
      const next = new Set(cur)
      if (want) next.add(id)
      else next.delete(id)
      membershipRef.current = next
      setMembership(next)
      sendMark(id, kind, dayRef.current)
    },
    [rollIfNewDay, sendMark],
  )

  return { todaySet: membership, toggleToday }
}
