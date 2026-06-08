import { beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

import type { Task } from '@/db/types'

/*
 * PRIV-03: Block Time must create a TITLE-ONLY Apple Calendar event by default;
 * task notes (free text that syncs to all devices on the Apple ID) only leave
 * the device when the user explicitly opts in via the toggle.
 */

const {
  createEventMock,
  settingsGetMock,
  getBusyDayMock,
  bustBusyDaysMock,
  proposeSlotsMock,
  navigateMock,
} = vi.hoisted(() => ({
  createEventMock: vi.fn(),
  settingsGetMock: vi.fn(),
  getBusyDayMock: vi.fn(),
  bustBusyDaysMock: vi.fn(),
  proposeSlotsMock: vi.fn(),
  navigateMock: vi.fn(),
}))

// Keep the real CalendarError / isAuthFailed; only stub the network createEvent.
vi.mock('@/lib/calendarApi', async (importActual) => {
  const actual = await importActual<typeof import('@/lib/calendarApi')>()
  return { ...actual, createEvent: createEventMock }
})
vi.mock('@/db/repo', () => ({ repo: { settings: { get: settingsGetMock } } }))
vi.mock('@/lib/busyCache', () => ({
  getBusyDay: getBusyDayMock,
  bustBusyDays: bustBusyDaysMock,
}))
vi.mock('@/lib/slots', async (importActual) => {
  const actual = await importActual<typeof import('@/lib/slots')>()
  return { ...actual, proposeSlots: proposeSlotsMock }
})
vi.mock('@/lib/auth', () => ({ useSession: () => ({ user: { id: 'u1' } }) }))
vi.mock('@/lib/session', () => ({
  withSessionRetry: (fn: () => unknown) => fn(),
}))
vi.mock('@/lib/useIsTouchDevice', () => ({ useIsTouchDevice: () => false }))
vi.mock('react-router-dom', () => ({ useNavigate: () => navigateMock }))
vi.mock('sonner', () => ({
  toast: Object.assign(vi.fn(), { error: vi.fn() }),
}))

import BlockTimeSheet from './BlockTimeSheet'

function taskWithNotes(): Task {
  return {
    id: 't1',
    userId: 'u1',
    subcategoryId: 'sub1',
    title: 'Write report',
    notes: 'private notes',
    estimateMinutes: 25,
    dueAt: null,
    remindAt: null,
    notified: false,
    priority: null,
    completedAt: null,
    createdAt: '2026-05-31T00:00:00.000Z',
    updatedAt: '2026-05-31T00:00:00.000Z',
  }
}

beforeEach(() => {
  vi.clearAllMocks()
  settingsGetMock.mockResolvedValue({
    caldavStatus: 'ok',
    timezone: 'America/New_York',
  })
  getBusyDayMock.mockResolvedValue([])
  bustBusyDaysMock.mockResolvedValue(undefined)
  proposeSlotsMock.mockReturnValue([
    { start: '2026-06-01T14:00:00.000Z', end: '2026-06-01T14:25:00.000Z' },
  ])
  createEventMock.mockResolvedValue({ uid: 'evt1' })
})

async function selectSlotAndPrepare() {
  const user = userEvent.setup()
  render(<BlockTimeSheet task={taskWithNotes()} open onOpenChange={vi.fn()} />)
  // The SlotCard is the only button carrying aria-pressed.
  const slot = await screen.findByRole('button', { pressed: false })
  await user.click(slot)
  return user
}

describe('BlockTimeSheet notes opt-in (PRIV-03)', () => {
  it('creates a title-only event by default (toggle off → no description)', async () => {
    const user = await selectSlotAndPrepare()

    await user.click(
      screen.getByRole('button', { name: /add to apple calendar/i }),
    )

    await waitFor(() => expect(createEventMock).toHaveBeenCalledTimes(1))
    const arg = createEventMock.mock.calls[0][0]
    expect(arg.title).toBe('Write report')
    expect(arg.description).toBeUndefined()
  })

  it('includes notes only when the opt-in toggle is on', async () => {
    const user = await selectSlotAndPrepare()

    await user.click(screen.getByRole('checkbox', { name: /include notes/i }))
    await user.click(
      screen.getByRole('button', { name: /add to apple calendar/i }),
    )

    await waitFor(() => expect(createEventMock).toHaveBeenCalledTimes(1))
    expect(createEventMock).toHaveBeenCalledWith(
      expect.objectContaining({ title: 'Write report', description: 'private notes' }),
    )
  })

  it('discloses that the event syncs to Apple Calendar', async () => {
    await selectSlotAndPrepare()
    expect(
      screen.getByText(/sync(s)? to all devices on your apple id/i),
    ).toBeInTheDocument()
  })

  // Guards the limited-availability notice (re-skinned from the dead dark: amber
  // variant to the --warn token): the copy must still render when proposeSlots
  // returns fewer than three slots. The default fixture proposes a single slot.
  it('warns when fewer than three slots are available', async () => {
    render(<BlockTimeSheet task={taskWithNotes()} open onOpenChange={vi.fn()} />)
    expect(
      await screen.findByText(/limited availability — only 1 slot/i),
    ).toBeInTheDocument()
  })
})
