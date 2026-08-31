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
  /**
   * Dedup key — `weekKey:busyRefreshKey`. A content signature of `blocks`
   * (id + startAt + endAt + calendarUid) is folded in internally (chunk 43,
   * F2), so the same key with unchanged blocks never reconciles twice, while
   * a block that changed since the key was consumed — drift written from
   * another device, an outbox drain, a failed mirror write — re-reconciles
   * on the week's next load without a `busyRefreshKey` bump.
   */
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
  // Last-reconciled block signature per dedup key. A Map (not a Set of
  // key+signature) so each `weekKey:busyRefreshKey` holds exactly one entry —
  // the store stays bounded however often a week's blocks change.
  const reconciled = new Map<string, string>()
  // Blocks with a create in flight — reconcile must not backfill them too.
  const creating = new Set<string>()
  // Session record of the events this mirror wrote: uid → the times it wrote
  // (chunk 46, D1). `plannerEvents` is the snapshot from the last `/busy`
  // fetch, whose effect deps know nothing about blocks or mirror writes — so
  // an event created since that fetch is absent from it and the drift loop
  // has nothing to compare a freshly-mirrored block against. The mirror
  // creates the event, so it already knows the uid and the times; this keeps
  // them instead of discarding them and waiting for a refetch that the
  // drift-repair path exists to avoid. Fallback only: `plannerEvents` wins
  // wherever both know a uid (D3), so a Calendar.app edit still reads as
  // drift and is still rewritten one-way.
  const written = new Map<string, { start: string; end: string }>()
  // Uids this mirror deleted — the orphan sweep skips them (chunk 46, D6).
  // The post-unschedule blocks refetch is a new content signature, so the
  // reconcile runs against a `plannerEvents` snapshot that still lists the
  // just-deleted event and would delete it a second time. Session-scoped and
  // safe to keep: uids are `hupo-block-<uuid>` and never reused.
  const deleted = new Set<string>()

  async function create(block: MirrorBlock, title: string): Promise<void> {
    creating.add(block.id)
    try {
      const { uid } = await deps.createEvent({
        title,
        start: block.startAt,
        end: block.endAt,
        source: 'planner',
      })
      if (uid) {
        await deps.stampUid(block.id, uid)
        written.set(uid, { start: block.startAt, end: block.endAt })
      }
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
    // Keep the record current after a repair, so the same drift is never
    // PATCHed twice while `plannerEvents` remains stale.
    written.set(block.calendarUid, { start: block.startAt, end: block.endAt })
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
        if (!calendarUid) return
        await deps.deleteEvent(calendarUid)
        written.delete(calendarUid)
        deleted.add(calendarUid)
      }),

    async reconcile({ key, blocks, plannerEvents, titleOf }) {
      if (!deps.enabled()) return
      const signature = blockSignature(blocks)
      if (reconciled.get(key) === signature) return
      reconciled.set(key, signature)

      const byUid = new Map<string, MirrorBlock>()
      for (const b of blocks) if (b.calendarUid) byUid.set(b.calendarUid, b)

      // 1. Orphans: events on the calendar no visible block claims — blocks
      //    removed by a task delete/cascade, a wipe, or a replace-import.
      //    A uid this mirror already deleted is skipped (chunk 46, D6): the
      //    snapshot still lists it, but the delete already happened.
      for (const ev of plannerEvents) {
        if (byUid.has(ev.uid) || deleted.has(ev.uid)) continue
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
      //    `plannerEvents` is authoritative (D3); `written` fills only the
      //    uids it does not mention — an event mirrored since the last
      //    `/busy` fetch. The orphan sweep above deliberately does NOT
      //    consult `written` (D4): it stays on what the calendar reports.
      const eventByUid = new Map(plannerEvents.map((e) => [e.uid, e]))
      for (const b of blocks) {
        if (!b.calendarUid) continue
        const ev = eventByUid.get(b.calendarUid) ?? written.get(b.calendarUid)
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

/**
 * Order-independent content signature of a week's blocks. Only the fields the
 * mirror writes out — volatile fields like `updatedAt` are excluded so a
 * touch that changes nothing the calendar sees never re-reconciles.
 */
function blockSignature(blocks: MirrorBlock[]): string {
  return blocks
    .map((b) => `${b.id}|${b.startAt}|${b.endAt}|${b.calendarUid ?? ''}`)
    .sort()
    .join('\n')
}

function drifted(
  block: MirrorBlock,
  ev: { start: string; end: string },
): boolean {
  const bs = Date.parse(block.startAt)
  const be = Date.parse(block.endAt)
  const es = Date.parse(ev.start)
  const ee = Date.parse(ev.end)
  if ([bs, be, es, ee].some((n) => Number.isNaN(n))) return false
  return Math.abs(bs - es) >= DRIFT_MS || Math.abs(be - ee) >= DRIFT_MS
}
