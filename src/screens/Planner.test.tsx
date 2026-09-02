import { StrictMode } from 'react'
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
  settingsUpdate: vi.fn(),
  listCalendars: vi.fn(),
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
    settings: { get: mocks.settingsGet, update: mocks.settingsUpdate },
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
    listCalendars: mocks.listCalendars,
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
      // Chunk 51: an initialized (empty) read set — these tests are about
      // the reconcile, and a null set would trigger the one-shot init and
      // its busyRefreshKey bump.
      caldavReadCalendars: [],
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

// ── Chunk 51: calendar read set ──────────────────────────────────────────────
describe('Planner — calendar read set (chunk 51)', () => {
  const HOME = 'https://caldav.icloud.com/1/calendars/home/'
  const WORK = 'https://caldav.icloud.com/1/calendars/work/'
  const SETTINGS = {
    userId: 'u1',
    plannerWriteout: false,
    caldavStatus: 'ok',
    caldavCalendarUrl: HOME,
    caldavReadCalendars: null,
    timezone: 'America/New_York',
  }

  beforeEach(() => {
    if (typeof globalThis.ResizeObserver === 'undefined') {
      globalThis.ResizeObserver = class {
        observe() {}
        unobserve() {}
        disconnect() {}
      } as unknown as typeof ResizeObserver
    }
    vi.spyOn(console, 'error').mockImplementation(() => {})
    mocks.settingsGet.mockResolvedValue(SETTINGS)
    mocks.settingsUpdate.mockImplementation(async (_id, changes) => ({
      ...SETTINGS,
      ...changes,
    }))
    mocks.listCalendars.mockResolvedValue({
      calendars: [
        { url: HOME, name: 'Home' },
        { url: WORK, name: 'Work' },
      ],
      writeTargetUrl: HOME,
    })
    mocks.listByRange.mockResolvedValue([])
    mocks.categoriesList.mockResolvedValue([])
    mocks.subcategoriesList.mockResolvedValue([])
    mocks.tasksList.mockResolvedValue([])
    mocks.getBusy.mockResolvedValue(busyResult([]))
  })

  afterEach(() => {
    vi.restoreAllMocks()
    vi.clearAllMocks()
  })

  it('a null read set is initialized once — all discovered calendars enabled — and busy refetched, even under StrictMode', async () => {
    const before = useUIStore.getState().busyRefreshKey
    render(
      <StrictMode>
        <Planner />
      </StrictMode>,
    )
    await waitFor(() =>
      expect(mocks.settingsUpdate).toHaveBeenCalledWith('u1', {
        caldavReadCalendars: [
          { url: HOME, name: 'Home', enabled: true },
          { url: WORK, name: 'Work', enabled: true },
        ],
      }),
    )
    await waitFor(() => expect(useUIStore.getState().busyRefreshKey).toBe(before + 1))
    // Both breakpoint branches mount a chip; both read the initialized set.
    await waitFor(() =>
      expect(screen.getAllByRole('button', { name: 'Calendars' })[0]).toHaveTextContent(
        'CALENDARS · 2/2',
      ),
    )
    // StrictMode double-invokes the effect; the ref guard keeps it to one
    // discovery and one write.
    expect(mocks.listCalendars).toHaveBeenCalledTimes(1)
    expect(mocks.settingsUpdate).toHaveBeenCalledTimes(1)
    // The bump re-ran the busy fetch: the last getBusy call is ordered
    // after the read-set write (StrictMode's double mount already fires
    // the mount fetch twice, so an exact count would be meaningless).
    await waitFor(() => {
      const writeOrder = mocks.settingsUpdate.mock.invocationCallOrder[0]!
      const lastFetch = mocks.getBusy.mock.invocationCallOrder.at(-1)!
      expect(lastFetch).toBeGreaterThan(writeOrder)
    })
  })

  it('renders no chip and runs no discovery unless Apple Calendar is connected', async () => {
    mocks.settingsGet.mockResolvedValue({ ...SETTINGS, caldavStatus: 'unconfigured' })
    render(<Planner />)
    await waitFor(() => expect(mocks.settingsGet).toHaveBeenCalled())
    await waitFor(() => expect(mocks.getBusy).toHaveBeenCalled())
    expect(screen.queryByRole('button', { name: 'Calendars' })).toBeNull()
    expect(mocks.listCalendars).not.toHaveBeenCalled()
    expect(mocks.settingsUpdate).not.toHaveBeenCalled()
  })

  it('a failed initialization leaves the set null (chip “–”) and does not write', async () => {
    mocks.listCalendars.mockRejectedValue(new Error('proxy down'))
    const before = useUIStore.getState().busyRefreshKey
    render(<Planner />)
    await waitFor(() =>
      expect(screen.getAllByRole('button', { name: 'Calendars' })[0]).toHaveTextContent(
        'CALENDARS · –',
      ),
    )
    expect(mocks.settingsUpdate).not.toHaveBeenCalled()
    expect(useUIStore.getState().busyRefreshKey).toBe(before)
  })

  it('the busy popover names the calendar an iCloud interval came from', async () => {
    const user = userEvent.setup()
    mocks.settingsGet.mockResolvedValue({
      ...SETTINGS,
      caldavReadCalendars: [{ url: WORK, name: 'Work', enabled: true }],
    })
    // Monday 10:00–11:00 local of the visible week, inside the default window.
    const start = new Date(thisWeekStart.getTime() + 10 * 3_600_000)
    const end = new Date(thisWeekStart.getTime() + 11 * 3_600_000)
    const result = [
      {
        start: start.toISOString(),
        end: end.toISOString(),
        source: 'icloud' as const,
        title: 'Standup',
        calendar: 'Work',
      },
    ] as unknown as GetBusyResult
    result.plannerEvents = []
    mocks.getBusy.mockResolvedValue(result)
    render(<Planner />)
    const blocks = await screen.findAllByRole('button', { name: /Busy 10:00 to 11:00 — Standup/ })
    await user.click(blocks[0])
    expect(await screen.findByText('ICLOUD · WORK')).toBeInTheDocument()
  })
})
