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
  /**
   * When the `/busy` snapshot in `plannerEvents` was fetched (chunk 47, D9).
   * The drift loop ranks the snapshot against the mirror's own write record by
   * recency: the snapshot decides only when it is the newer observation. Null
   * or absent → the snapshot wins unconditionally, i.e. the pre-chunk-47 rule.
   */
  plannerEventsAt?: number | null
  /**
   * Block ids whose mirror write the caller owns right now and has not issued
   * yet (chunk 48, D12). The backfill and drift loops skip them: the caller
   * patched its local state optimistically and is still awaiting the Supabase
   * write, so the reconcile would otherwise "repair" a block against a `/busy`
   * snapshot holding the pre-mutation times — writing exactly what the caller's
   * own `afterUpdate` is about to write. Absent → today's behaviour.
   *
   * The orphan sweep is deliberately not gated on it: `deleted` (chunk 47, D8)
   * already covers the delete path. A pass that skipped a pending block also
   * releases the dedup key, so the same key + content reconciles again once the
   * id leaves the set — the repair is deferred, never dropped.
   */
  pending?: ReadonlySet<string>
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
  // and when it wrote them (chunk 46, D1; `at` added chunk 47, D9).
  // `plannerEvents` is the snapshot from the last `/busy` fetch, whose effect
  // deps know nothing about blocks or mirror writes — so an event created
  // since that fetch is absent from it and the drift loop has nothing to
  // compare a freshly-mirrored block against. The mirror creates the event, so
  // it already knows the uid and the times; this keeps them instead of
  // discarding them and waiting for a refetch that the drift-repair path
  // exists to avoid.
  //
  // Where both sources know a uid the drift loop takes **the newer
  // observation** (chunk 47, D9), not `plannerEvents` unconditionally (chunk
  // 46, D3). D3's purpose is unchanged — a Calendar.app edit reported by a
  // fetch that postdates the mirror's write still reads as drift and is still
  // rewritten to the DB time, one-way — but a snapshot older than the mirror's
  // own write no longer overrides what the mirror knows it just wrote, which
  // is what made a single drag-move fire two identical PATCHes.
  const written = new Map<string, { start: string; end: string; at: number }>()
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
        written.set(uid, {
          start: block.startAt,
          end: block.endAt,
          at: Date.now(),
        })
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
    written.set(block.calendarUid, {
      start: block.startAt,
      end: block.endAt,
      at: Date.now(),
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
        if (!calendarUid) return
        // Recorded BEFORE the await, like `creating` (chunk 47, D8): the
        // reconcile that the post-unschedule blocks refetch triggers runs
        // while this delete is still in flight (live on 2026-08-31: the
        // sweep's delete started at +184 ms, this one resolved at ~+594 ms),
        // so a guard set after the await never fires in the window it was
        // written for.
        written.delete(calendarUid)
        deleted.add(calendarUid)
        try {
          await deps.deleteEvent(calendarUid)
        } catch (e) {
          // The event is still out there — let the sweep retry it. Rethrown so
          // `foreground`'s catch still warns and toasts once.
          deleted.delete(calendarUid)
          throw e
        }
      }),

    async reconcile({
      key,
      blocks,
      plannerEvents,
      plannerEventsAt,
      pending,
      titleOf,
    }) {
      if (!deps.enabled()) return
      const signature = blockSignature(blocks)
      if (reconciled.get(key) === signature) return
      reconciled.set(key, signature)
      // Set true when a block was skipped only because its mirror write is
      // still the caller's to issue (chunk 48, D12) — that pass did not do the
      // work the key claims, so the key is released at the end.
      let deferred = false

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
        if (pending?.has(b.id)) {
          deferred = true
          continue
        }
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
      //    Where only one source knows a uid it decides. Where both do, the
      //    newer observation decides (chunk 47, D9): the `/busy` snapshot iff
      //    it was fetched after the mirror's own write, otherwise the record.
      //    A missing `plannerEventsAt` means the snapshot wins, which is the
      //    pre-chunk-47 rule (D3) exactly. The orphan sweep above deliberately
      //    consults neither `written` nor timestamps (D4/D11): it stays on
      //    what the calendar reports.
      const eventByUid = new Map(plannerEvents.map((e) => [e.uid, e]))
      for (const b of blocks) {
        if (!b.calendarUid) continue
        if (pending?.has(b.id)) {
          deferred = true
          continue
        }
        const ev = observation(
          eventByUid.get(b.calendarUid),
          written.get(b.calendarUid),
          plannerEventsAt,
        )
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

      // A pass that deferred work has not consumed the key it claimed: release
      // it so the next blocks change — including one with identical content —
      // reconciles the block once its owner has finished writing. If that write
      // landed, `written` now holds the new times and there is no drift; if it
      // failed, the snapshot still wins and the repair happens then.
      if (deferred && reconciled.get(key) === signature) reconciled.delete(key)
    },
  }
}

/**
 * Order-independent content signature of a week's blocks. Only the fields the
 * mirror writes out — volatile fields like `updatedAt` are excluded so a
 * touch that changes nothing the calendar sees never re-reconciles.
 *
 * Timestamps are compared as **instants**, not strings (chunk 48, D13). An
 * optimistic patch writes `toInstant`'s `…T20:00:00.000Z`; the saved row comes
 * back through `scheduledBlockFromRow` as PostgREST's `…T20:00:00+00:00`. Same
 * moment, different text — so every block save produced a fresh signature and
 * re-ran the whole reconcile for free. Chunk 43's "an unchanged week never
 * re-reconciles" held; "a save that changed nothing" did not.
 */
function blockSignature(blocks: MirrorBlock[]): string {
  return blocks
    .map(
      (b) =>
        `${b.id}|${instantKey(b.startAt)}|${instantKey(b.endAt)}|${b.calendarUid ?? ''}`,
    )
    .sort()
    .join('\n')
}

/**
 * A timestamp's instant as a stable key. An unparseable value falls back to its
 * own text, so malformed timestamps still differentiate rather than collapsing
 * into one signature.
 */
function instantKey(value: string): string {
  const t = Date.parse(value)
  return Number.isNaN(t) ? value : String(t)
}

/**
 * The times the drift loop compares a block against (chunk 47, D9). With both
 * a `/busy` snapshot entry and a mirror write record for the same uid, the one
 * observed more recently wins; a snapshot with no fetch timestamp is treated as
 * authoritative, preserving chunk 46's D3 behaviour unchanged.
 */
function observation(
  snapshot: { start: string; end: string } | undefined,
  record: { start: string; end: string; at: number } | undefined,
  plannerEventsAt: number | null | undefined,
): { start: string; end: string } | undefined {
  if (!snapshot) return record
  if (!record) return snapshot
  return plannerEventsAt == null || plannerEventsAt > record.at
    ? snapshot
    : record
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
