import { beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

import { mkNote } from '@/components/notebook/fixtures'
import { NotesContext } from '@/components/notebook/notesContext'
import type { Note, Task } from '@/db/types'

/*
 * PRIV-03: Block Time must create a TITLE-ONLY Apple Calendar event by default;
 * task notes (free text that syncs to all devices on the Apple ID) only leave
 * the device when the user explicitly opts in via the toggle.
 *
 * Chunk 59 (D8): the notes come from the `notes` table (many per task), not
 * `tasks.notes` — every non-blank note on the task, newest first.
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

/** The task's notes: out of order, with a blank one and another task's. */
const TASK_NOTES: Note[] = [
  mkNote({ id: 'n-old', title: 'Outline', body: 'intro, body, close', taskId: 't1', updatedAt: '2026-10-01T00:00:00.000Z' }),
  mkNote({ id: 'n-new', title: '', body: '- private notes', taskId: 't1', updatedAt: '2026-10-05T00:00:00.000Z' }),
  mkNote({ id: 'n-blank', title: '', body: '  ', taskId: 't1', updatedAt: '2026-10-09T00:00:00.000Z' }),
  mkNote({ id: 'n-other', title: 'Not this task', taskId: 't2' }),
]

function renderSheet(notes: Note[] = TASK_NOTES) {
  return render(
    <NotesContext.Provider
      value={{ notes, report: () => undefined, openTaskNotes: () => undefined }}
    >
      <BlockTimeSheet task={taskWithNotes()} open onOpenChange={vi.fn()} />
    </NotesContext.Provider>,
  )
}

async function selectSlotAndPrepare(notes?: Note[]) {
  const user = userEvent.setup()
  renderSheet(notes)
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
    // Every non-blank note on the task, newest first; `title\n\nbody`, or just
    // the body when untitled; raw Markdown; joined by a blank line.
    expect(createEventMock).toHaveBeenCalledWith(
      expect.objectContaining({
        title: 'Write report',
        description: '- private notes\n\nOutline\n\nintro, body, close',
      }),
    )
  })

  it.each([
    ['no notes at all', []],
    ['only blank notes', [TASK_NOTES[2]]],
    ['only another task’s notes', [TASK_NOTES[3]]],
  ])('hides the toggle and the notes sentence with %s', async (_label, notes) => {
    const user = await selectSlotAndPrepare(notes)
    expect(screen.queryByRole('checkbox', { name: /include notes/i })).toBeNull()
    expect(screen.queryByText(/and notes, if included above/)).toBeNull()

    await user.click(
      screen.getByRole('button', { name: /add to apple calendar/i }),
    )
    await waitFor(() => expect(createEventMock).toHaveBeenCalledTimes(1))
    expect(createEventMock.mock.calls[0][0].description).toBeUndefined()
  })

  it('keeps the disclosure sentence about notes when the task has some', async () => {
    await selectSlotAndPrepare()
    expect(screen.getByText(/\(and notes, if included above\)/)).toBeInTheDocument()
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
    renderSheet()
    expect(
      await screen.findByText(/limited availability — only 1 slot/i),
    ).toBeInTheDocument()
  })
})
