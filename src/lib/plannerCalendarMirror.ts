import type { ScheduledBlock } from '@/db/types'
import type { PlannerEvent } from '@/lib/calendarApi'

/*
 * Apple Calendar mirror for Week Planner blocks (chunk 39, ARCHITECTURE.md
 * §4/§7).
 *
 * `scheduled_blocks` is the source of truth; the iCloud event is a
 * best-effort mirror. Every hook here runs AFTER the Supabase write has
 * succeeded and is fire-and-forget from the handler's point of view — the
 * optimistic UI and the chunk-37/38 toasts never wait on iCloud. A calendar
 * failure never rolls a block back: the foreground hooks toast once
 * (`onWriteFailed`) and leave `calendarUid` as it was; `reconcile` repairs
 * the mirror on the next week load. Nothing here ever enters the outbox.
 *
 * The proxy tags planner events (`hupo-block-…` uids) and keeps them out of
 * busy, returning them as `plannerEvents` instead — that list is what
 * `reconcile` compares the visible week's blocks against.
 */

export type MirrorBlock = Pick<
  ScheduledBlock,
  'id' | 'startAt' | 'endAt' | 'calendarUid'
>

export interface MirrorDeps {
  /** True only when every precondition holds: toggle on, caldav ok, online. */
  enabled: () => boolean
  createEvent: (args: {
    title: string
    start: string
    end: string
    source: 'planner'
  }) => Promise<{ uid: string }>
  updateEvent: (args: {
    uid: string
    title: string
    start: string
    end: string
  }) => Promise<void>
  deleteEvent: (uid: string) => Promise<{ missing: boolean }>
  /** Persist the uid on the block (Supabase + local state). */
  stampUid: (blockId: string, uid: string) => Promise<void>
  /** Foreground failure — the D11 toast, at most once per hook call. */
  onWriteFailed: () => void
  /** Background (reconcile) failure sink. Defaults to console.warn. */
  warn?: (message: string, error: unknown) => void
}

export interface ReconcileInput {
  /** Dedup key — `weekKey:busyRefreshKey`; the same key never reconciles twice. */
  key: string
  blocks: MirrorBlock[]
  plannerEvents: PlannerEvent[]
  /** Task title for a block's create/update; undefined → the block is skipped. */
  titleOf: (blockId: string) => string | undefined
}

export interface CalendarMirror {
  /** After a block was created in Supabase (place, Place all). */
  afterCreate: (block: MirrorBlock, title: string) => Promise<void>
  /** After a block's time changed (move, resize, carryMove). Creates when
   *  the block has no uid yet, so a carried offline placement gets its event. */
  afterUpdate: (block: MirrorBlock, title: string) => Promise<void>
  /** After a block was deleted in Supabase (unschedule). */
  afterDelete: (calendarUid: string | null) => Promise<void>
  /** Per-week repair: orphans → delete, null uids → create, time drift → update. */
  reconcile: (input: ReconcileInput) => Promise<void>
}

/** Minutes of difference at which an event is considered drifted. */
const DRIFT_MS = 60_000

export function createCalendarMirror(deps: MirrorDeps): CalendarMirror {
  const warn =
    deps.warn ??
    ((message: string, error: unknown) => console.warn(message, error))
  const reconciled = new Set<string>()
  // Blocks with a create in flight — reconcile must not backfill them too.
  const creating = new Set<string>()

  async function create(block: MirrorBlock, title: string): Promise<void> {
    creating.add(block.id)
    try {
      const { uid } = await deps.createEvent({
        title,
        start: block.startAt,
        end: block.endAt,
        source: 'planner',
      })
      if (uid) await deps.stampUid(block.id, uid)
    } finally {
      creating.delete(block.id)
    }
  }

  async function update(
    block: MirrorBlock & { calendarUid: string },
    title: string,
  ): Promise<void> {
    await deps.updateEvent({
      uid: block.calendarUid,
      title,
      start: block.startAt,
      end: block.endAt,
    })
  }

  async function foreground(work: () => Promise<void>): Promise<void> {
    if (!deps.enabled()) return
    try {
      await work()
    } catch (e) {
      console.warn('Planner calendar mirror: write failed', e)
      deps.onWriteFailed()
    }
  }

  return {
    afterCreate: (block, title) => foreground(() => create(block, title)),

    afterUpdate: (block, title) =>
      foreground(() =>
        block.calendarUid
          ? update({ ...block, calendarUid: block.calendarUid }, title)
          : create(block, title),
      ),

    afterDelete: (calendarUid) =>
      foreground(async () => {
        if (calendarUid) await deps.deleteEvent(calendarUid)
      }),

    async reconcile({ key, blocks, plannerEvents, titleOf }) {
      if (!deps.enabled()) return
      if (reconciled.has(key)) return
      reconciled.add(key)

      const byUid = new Map<string, MirrorBlock>()
      for (const b of blocks) if (b.calendarUid) byUid.set(b.calendarUid, b)

      // 1. Orphans: events on the calendar no visible block claims — blocks
      //    removed by a task delete/cascade, a wipe, or a replace-import.
      for (const ev of plannerEvents) {
        if (byUid.has(ev.uid)) continue
        try {
          await deps.deleteEvent(ev.uid)
        } catch (e) {
          warn(`Planner calendar mirror: orphan delete failed (${ev.uid})`, e)
        }
      }

      // 2. Backfill: blocks never written (offline placement, a failed
      //    write, or the toggle turned on after the block existed).
      for (const b of blocks) {
        if (b.calendarUid || creating.has(b.id)) continue
        const title = titleOf(b.id)
        if (!title) continue
        try {
          await create(b, title)
        } catch (e) {
          warn(`Planner calendar mirror: backfill failed (${b.id})`, e)
        }
      }

      // 3. Time drift (≥1 minute either end). Title drift is out of scope:
      //    `plannerEvents` carries no summary to compare against.
      const eventByUid = new Map(plannerEvents.map((e) => [e.uid, e]))
      for (const b of blocks) {
        if (!b.calendarUid) continue
        const ev = eventByUid.get(b.calendarUid)
        if (!ev) continue
        if (!drifted(b, ev)) continue
        const title = titleOf(b.id)
        if (!title) continue
        try {
          await update({ ...b, calendarUid: b.calendarUid }, title)
        } catch (e) {
          warn(`Planner calendar mirror: drift update failed (${b.id})`, e)
        }
      }
    },
  }
}

function drifted(block: MirrorBlock, ev: PlannerEvent): boolean {
  const bs = Date.parse(block.startAt)
  const be = Date.parse(block.endAt)
  const es = Date.parse(ev.start)
  const ee = Date.parse(ev.end)
  if ([bs, be, es, ee].some((n) => Number.isNaN(n))) return false
  return Math.abs(bs - es) >= DRIFT_MS || Math.abs(be - ee) >= DRIFT_MS
}
