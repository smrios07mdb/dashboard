import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import TodayRoutines from './TodayRoutines'
import type { RoutineItem, RoutineLog } from '@/db/types'
import { today as clockToday } from '@/lib/clock'

/*
 * Routines inside Today (chunk 78): a collapsible block over the routine
 * checklists, loading through `useRoutines`.
 */

const { itemsList, logsByRange, logsToggle, settingsGet } = vi.hoisted(() => ({
  itemsList: vi.fn(),
  logsByRange: vi.fn(),
  logsToggle: vi.fn(),
  settingsGet: vi.fn(),
}))

vi.mock('@/lib/auth', () => ({
  useSession: () => ({
    user: { id: 'u1', email: 'u1@example.com' },
    session: null,
    loading: false,
  }),
}))

vi.mock('@/db/repo', () => ({
  repo: {
    settings: { get: settingsGet },
    routineItems: { list: itemsList },
    routineLogs: { listByRange: logsByRange, toggle: logsToggle },
  },
}))

const TZ = 'America/New_York'
const OPEN_KEY = 'hup:todayRoutinesOpen'

function mkItem(
  id: string,
  routine: 'morning' | 'night',
  label: string,
  sortOrder: number,
): RoutineItem {
  return {
    id,
    userId: 'u1',
    routine,
    label,
    sortOrder,
    archivedAt: null,
    createdAt: '2020-01-01T00:00:00.000Z',
  }
}

const ITEMS = [
  mkItem('m1', 'morning', 'Make the bed', 0),
  mkItem('m2', 'morning', 'Drink water', 1),
  mkItem('n1', 'night', 'Tidy the kitchen', 0),
  // Archived: not live, so not counted.
  { ...mkItem('n2', 'night', 'Old item', 1), archivedAt: '2026-01-01T00:00:00.000Z' },
]

const header = () => screen.getByRole('button', { name: /routines/i })

describe('TodayRoutines', () => {
  beforeEach(() => {
    localStorage.removeItem(OPEN_KEY)
    settingsGet.mockResolvedValue({ timezone: TZ })
    itemsList.mockResolvedValue(ITEMS)
    const tk = clockToday(TZ)
    const logs: RoutineLog[] = [
      { id: 'l1', userId: 'u1', routineItemId: 'm1', dateKey: tk, completed: true },
    ]
    logsByRange.mockResolvedValue(logs)
    logsToggle.mockImplementation(
      (input: { routineItemId: string; dateKey: string; completed: boolean }) =>
        Promise.resolve({ id: 'real', userId: 'u1', ...input }),
    )
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it("is collapsed by default and counts today's checked over live items", async () => {
    render(<TodayRoutines />)
    await waitFor(() => expect(header()).toHaveTextContent('1/3'))
    expect(header()).toHaveAttribute('aria-expanded', 'false')
    expect(screen.queryByRole('checkbox')).not.toBeInTheDocument()
    // Today's logs only.
    const tk = clockToday(TZ)
    expect(logsByRange).toHaveBeenCalledWith(tk, tk)
  })

  it("expands to Morning then Night; a check writes today's log", async () => {
    const user = userEvent.setup()
    render(<TodayRoutines />)
    await waitFor(() => expect(header()).toHaveTextContent('1/3'))

    await user.click(header())
    expect(header()).toHaveAttribute('aria-expanded', 'true')
    const headings = screen.getAllByRole('heading').map((h) => h.textContent)
    expect(headings).toEqual(['Morning', 'Night'])
    expect(
      screen.getByRole('checkbox', { name: 'Uncheck Make the bed' }),
    ).toBeInTheDocument()
    expect(
      screen.getByRole('checkbox', { name: 'Check Tidy the kitchen' }),
    ).toBeInTheDocument()

    await user.click(screen.getByRole('checkbox', { name: 'Check Drink water' }))
    expect(logsToggle).toHaveBeenCalledWith({
      userId: 'u1',
      routineItemId: 'm2',
      dateKey: clockToday(TZ),
      completed: true,
    })
    await waitFor(() => expect(header()).toHaveTextContent('2/3'))
  })

  it('remembers the open state in hup:todayRoutinesOpen', async () => {
    const user = userEvent.setup()
    const first = render(<TodayRoutines />)
    await waitFor(() => expect(header()).toHaveTextContent('1/3'))
    await user.click(header())
    expect(localStorage.getItem(OPEN_KEY)).toBe('1')
    first.unmount()

    render(<TodayRoutines />)
    expect(header()).toHaveAttribute('aria-expanded', 'true')

    await user.click(header())
    expect(localStorage.getItem(OPEN_KEY)).toBe('0')
  })

  it('renders collapsed when localStorage throws', async () => {
    const user = userEvent.setup()
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('blocked')
    })
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('blocked')
    })
    render(<TodayRoutines />)
    await waitFor(() => expect(header()).toHaveTextContent('1/3'))
    expect(header()).toHaveAttribute('aria-expanded', 'false')
    // Toggling still works in memory.
    await user.click(header())
    expect(header()).toHaveAttribute('aria-expanded', 'true')
  })

  it('shows Add with no live items, and expanding offers Edit list', async () => {
    const user = userEvent.setup()
    itemsList.mockResolvedValue([])
    logsByRange.mockResolvedValue([])
    render(<TodayRoutines />)
    await waitFor(() => expect(header()).toHaveTextContent('Add'))
    expect(header()).not.toHaveTextContent('/')

    await user.click(header())
    const region = header().closest('section')!
    expect(
      within(region).getAllByRole('button', { name: 'Edit list' }),
    ).toHaveLength(2)
  })
})
