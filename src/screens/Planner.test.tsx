import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

import { addDays, weekStart } from '@/lib/plannerGeometry'
import { useUIStore } from '@/state/uiStore'
import type { GetBusyResult, PlannerEvent } from '@/lib/calendarApi'

/*
 * Chunk 40 — F1 regression: the per-week calendar reconcile must run on an
 * in-session week NAVIGATION, not only on mount or a `busyRefreshKey` bump.
 * Pre-fix, the week-change commit rendered one frame where `weekKey` was the
 * new week while busy/blocks still held the previous week's 'ready' data;
 * the reconcile effect fired on that frame and burned the new week's dedup
 * key against stale data, so the real data found the key consumed.
 */

const mocks = vi.hoisted(() => ({
  settingsGet: vi.fn(),
  listByRange: vi.fn(),
  blockCreate: vi.fn(),
  blockUpdate: vi.fn(),
  blockDelete: vi.fn(),
  categoriesList: vi.fn(),
  subcategoriesList: vi.fn(),
  tasksList: vi.fn(),
  getBusy: vi.fn(),
  createEvent: vi.fn(),
  updateEvent: vi.fn(),
  deleteEvent: vi.fn(),
}))

vi.mock('@/db/repo', () => ({
  repo: {
    settings: { get: mocks.settingsGet },
    scheduledBlocks: {
      listByRange: mocks.listByRange,
      create: mocks.blockCreate,
      update: mocks.blockUpdate,
      delete: mocks.blockDelete,
    },
    categories: { list: mocks.categoriesList },
    subcategories: { list: mocks.subcategoriesList },
    tasks: { list: mocks.tasksList },
  },
}))

vi.mock('@/lib/auth', () => ({
  useSession: () => ({
    user: { id: 'u1', email: 'sam@hupo.app' },
    session: null,
    loading: false,
  }),
}))

vi.mock('@/lib/session', () => ({
  withSessionRetry: <T,>(action: () => Promise<T>) => action(),
}))

vi.mock('@/lib/calendarApi', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/calendarApi')>()
  return {
    ...actual,
    getBusy: mocks.getBusy,
    createEvent: mocks.createEvent,
    updateEvent: mocks.updateEvent,
    deleteEvent: mocks.deleteEvent,
  }
})

import Planner from './Planner'

const thisWeekStart = weekStart(new Date())
const nextWeekStart = addDays(thisWeekStart, 7)

/** A busy payload in `getBusy`'s array-with-extras shape, no busy ranges. */
function busyResult(plannerEvents: PlannerEvent[]): GetBusyResult {
  const result = [] as unknown as GetBusyResult
  result.plannerEvents = plannerEvents
  return result
}

function plannerEventAt(uid: string, base: Date): PlannerEvent {
  const start = new Date(base.getTime() + 10 * 3_600_000)
  const end = new Date(base.getTime() + 11 * 3_600_000)
  return { uid, start: start.toISOString(), end: end.toISOString() }
}

// No block claims either uid, so each week's event is an orphan the
// reconcile must delete on that week's load.
const ORPHAN_A = 'hupo-block-orphan-aaaa'
const ORPHAN_B = 'hupo-block-orphan-bbbb'

describe('Planner — reconcile on week navigation (chunk 40, F1)', () => {
  beforeEach(() => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    mocks.settingsGet.mockResolvedValue({
      userId: 'u1',
      plannerWriteout: true,
      caldavStatus: 'ok',
      timezone: 'America/New_York',
    })
    mocks.listByRange.mockResolvedValue([])
    mocks.categoriesList.mockResolvedValue([])
    mocks.subcategoriesList.mockResolvedValue([])
    mocks.tasksList.mockResolvedValue([])
    mocks.deleteEvent.mockResolvedValue({ missing: false })
    mocks.getBusy.mockImplementation(async ({ from }: { from: string }) =>
      from === nextWeekStart.toISOString()
        ? busyResult([plannerEventAt(ORPHAN_B, nextWeekStart)])
        : busyResult([plannerEventAt(ORPHAN_A, thisWeekStart)]),
    )
  })

  afterEach(() => {
    vi.restoreAllMocks()
    vi.clearAllMocks()
  })

  it('deletes a navigated-to week’s orphan without a busyRefreshKey bump', async () => {
    const user = userEvent.setup()
    render(<Planner />)

    // Mount path (already worked pre-fix): current week settles, orphan A goes.
    await waitFor(() => expect(mocks.deleteEvent).toHaveBeenCalledWith(ORPHAN_A))

    // In-session week navigation — the F1 path. Both breakpoint branches are
    // mounted (CLAUDE.md), so take the first "Next week" control.
    await user.click(screen.getAllByRole('button', { name: 'Next week' })[0])

    await waitFor(() => expect(mocks.deleteEvent).toHaveBeenCalledWith(ORPHAN_B))
  })

  it('reconciles a week exactly once per refresh key across re-visits', async () => {
    const user = userEvent.setup()
    render(<Planner />)
    await waitFor(() => expect(mocks.deleteEvent).toHaveBeenCalledWith(ORPHAN_A))
    await user.click(screen.getAllByRole('button', { name: 'Next week' })[0])
    await waitFor(() => expect(mocks.deleteEvent).toHaveBeenCalledWith(ORPHAN_B))

    // Back to the current week: both caches are fresh, the reconcile key is
    // already consumed — no second delete for orphan A.
    await user.click(screen.getAllByRole('button', { name: 'Today' })[0])
    await waitFor(() =>
      expect(screen.getAllByRole('button', { name: 'Today' })[0]).toBeDisabled(),
    )
    expect(
      mocks.deleteEvent.mock.calls.filter(([uid]) => uid === ORPHAN_A),
    ).toHaveLength(1)
  })

  it('never reconciles a week whose blocks read failed (unstamped tag)', async () => {
    const user = userEvent.setup()
    render(<Planner />)
    await waitFor(() => expect(mocks.deleteEvent).toHaveBeenCalledWith(ORPHAN_A))

    // The next week's blocks read fails; its catch sets phase 'ready' with a
    // possibly-empty list. The stale week tag must keep the reconcile from
    // orphan-deleting the week's mirror events against that list.
    mocks.listByRange.mockRejectedValue(new Error('boom'))
    await user.click(screen.getAllByRole('button', { name: 'Next week' })[0])

    await waitFor(() =>
      expect(console.error).toHaveBeenCalledWith(
        'Planner: load scheduled blocks failed',
        expect.anything(),
      ),
    )
    // Busy for week B resolved with orphan B; the reconcile must not have run.
    await waitFor(() =>
      expect(mocks.getBusy).toHaveBeenCalledWith(
        expect.objectContaining({ from: nextWeekStart.toISOString() }),
      ),
    )
    expect(mocks.deleteEvent).not.toHaveBeenCalledWith(ORPHAN_B)
  })

  // Chunk 43 (F2): the dedup key carries a content signature of the week's
  // blocks, so drift written after the week already reconciled — another
  // device, an outbox drain, a failed mirror write — is repaired on the
  // week's next blocks load, with no `busyRefreshKey` bump and no remount.
  it('repairs drift on the week’s next blocks load without a busyRefreshKey bump', async () => {
    const at = (minutes: number) =>
      new Date(thisWeekStart.getTime() + minutes * 60_000).toISOString()
    const MIRROR_UID = 'hupo-block-mirrored'
    mocks.tasksList.mockResolvedValue([
      {
        id: 't1',
        userId: 'u1',
        subcategoryId: 's1',
        title: 'Deep work',
        notes: null,
        estimateMinutes: 60,
        dueAt: null,
        remindAt: null,
        notified: false,
        priority: null,
        completedAt: null,
        createdAt: at(0),
        updatedAt: at(0),
      },
    ])
    const inSync = {
      id: 'blk1',
      userId: 'u1',
      taskId: 't1',
      startAt: at(10 * 60),
      endAt: at(11 * 60),
      calendarUid: MIRROR_UID,
      createdAt: at(0),
      updatedAt: at(0),
    }
    mocks.listByRange.mockResolvedValue([inSync])
    // The week's mirror event matches the block; orphan A makes the
    // reconcile's completion observable.
    mocks.getBusy.mockImplementation(async () =>
      busyResult([
        { uid: MIRROR_UID, start: inSync.startAt, end: inSync.endAt },
        plannerEventAt(ORPHAN_A, thisWeekStart),
      ]),
    )

    render(<Planner />)
    await waitFor(() => expect(mocks.deleteEvent).toHaveBeenCalledWith(ORPHAN_A))
    // In sync — the first reconcile repaired nothing.
    expect(mocks.updateEvent).not.toHaveBeenCalled()

    // The block drifts in the DB; the realtime echo bumps
    // `dashboardRefreshKey`, which refetches blocks — but never busy.
    mocks.listByRange.mockResolvedValue([
      { ...inSync, startAt: at(10 * 60 + 30), endAt: at(11 * 60 + 30) },
    ])
    act(() => useUIStore.getState().forceDashboardRefresh())

    await waitFor(() =>
      expect(mocks.updateEvent).toHaveBeenCalledWith({
        uid: MIRROR_UID,
        title: 'Deep work',
        start: at(10 * 60 + 30),
        end: at(11 * 60 + 30),
      }),
    )
    // No busyRefreshKey bump was needed: busy was fetched exactly once.
    expect(mocks.getBusy).toHaveBeenCalledTimes(1)
  })
})
