import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

import type { BlockGroup } from '@/db/types'

/*
 * Chunk 99 (D11) — Settings › Site blocking on the dashboard.
 */

const h = vi.hoisted(() => ({
  groups: [] as BlockGroup[],
  list: vi.fn(),
  create: vi.fn(),
  update: vi.fn(),
  remove: vi.fn(),
}))

vi.mock('@/db/repo', () => ({
  repo: {
    blockGroups: {
      list: h.list,
      create: h.create,
      update: h.update,
      delete: h.remove,
    },
  },
}))
vi.mock('@/lib/auth', () => ({
  useSession: () => ({ user: { id: 'u-1' }, loading: false }),
}))

import SiteBlockingSection from './SiteBlockingSection'

function aGroup(over: Partial<BlockGroup> = {}): BlockGroup {
  return {
    id: 'g-1',
    userId: 'u-1',
    name: 'Social',
    domains: ['x.com'],
    enabled: true,
    blockInFocus: true,
    blockOnSchedule: false,
    scheduleDays: [1, 2, 3, 4, 5],
    scheduleFrom: '09:00',
    scheduleTo: '17:00',
    dailyLimitOn: false,
    dailyLimitMinutes: 30,
    sortOrder: 0,
    createdAt: '2026-11-11T00:00:00Z',
    updatedAt: '2026-11-11T00:00:00Z',
    ...over,
  }
}

beforeEach(() => {
  h.groups = []
  h.list.mockReset().mockImplementation(async () => h.groups)
  h.create.mockReset().mockImplementation(async (input: Partial<BlockGroup>) =>
    aGroup({ id: 'new', ...input, domains: input.domains ?? [] }),
  )
  h.update
    .mockReset()
    .mockImplementation(async (id: string, patch: Partial<BlockGroup>) => {
      const g = h.groups.find((x) => x.id === id) ?? aGroup({ id })
      const next = { ...g, ...patch }
      h.groups = h.groups.map((x) => (x.id === id ? next : x))
      return next
    })
  h.remove.mockReset().mockResolvedValue(undefined)
})

afterEach(() => vi.clearAllMocks())

const lastPatch = () => h.update.mock.calls.at(-1)?.[1] as Partial<BlockGroup>

async function withGroup(over: Partial<BlockGroup> = {}) {
  h.groups = [aGroup(over)]
  render(<SiteBlockingSection />)
  return screen.findByRole('group', { name: h.groups[0].name })
}

describe('SiteBlockingSection (chunk 99, D11)', () => {
  it('shows the lead hint and the empty line', async () => {
    render(<SiteBlockingSection />)
    expect(
      await screen.findByText(
        'No groups yet. Add one to block sites during focus or at set hours.',
      ),
    ).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'Site blocking' })).toBeInTheDocument()
    expect(
      screen.getByText(/Enforced by the menu bar app on your Mac/),
    ).toBeInTheDocument()
  })

  it('Add group creates a focus group and focuses its name', async () => {
    const user = userEvent.setup()
    render(<SiteBlockingSection />)
    await screen.findByText(/No groups yet/)
    await user.click(screen.getByRole('button', { name: 'Add group' }))
    expect(h.create).toHaveBeenCalledWith({
      userId: 'u-1',
      name: 'New group',
      domains: [],
      blockInFocus: true,
      sortOrder: 0,
    })
    const name = await screen.findByRole('textbox', { name: 'Group name' })
    await waitFor(() => expect(name).toHaveFocus())
  })

  it('adds a site by Enter, by comma and from a pasted URL', async () => {
    const user = userEvent.setup()
    const g = await withGroup({ domains: [] })
    const input = within(g).getByRole('textbox', { name: 'Add a site' })

    await user.type(input, 'reddit.com{Enter}')
    expect(lastPatch()).toEqual({ domains: ['reddit.com'] })
    expect(input).toHaveValue('')

    await user.type(input, 'x.com,')
    expect(lastPatch()).toEqual({ domains: ['reddit.com', 'x.com'] })

    await user.click(input)
    await user.paste('https://www.example.org/x')
    await user.keyboard('{Enter}')
    expect(lastPatch()).toEqual({
      domains: ['reddit.com', 'x.com', 'example.org'],
    })
  })

  it('an invalid site reads "Not a site address" and saves nothing', async () => {
    const user = userEvent.setup()
    const g = await withGroup()
    const input = within(g).getByRole('textbox', { name: 'Add a site' })
    await user.type(input, 'not a site{Enter}')
    expect(screen.getByText('Not a site address')).toBeInTheDocument()
    expect(input).toHaveAttribute('aria-invalid', 'true')
    expect(h.update).not.toHaveBeenCalled()
  })

  it('a duplicate is ignored', async () => {
    const user = userEvent.setup()
    const g = await withGroup({ domains: ['x.com'] })
    const input = within(g).getByRole('textbox', { name: 'Add a site' })
    await user.type(input, 'https://x.com/home{Enter}')
    expect(h.update).not.toHaveBeenCalled()
    expect(input).toHaveValue('')
  })

  it('the 51st site reads "50 sites at most"', async () => {
    const user = userEvent.setup()
    const fifty = Array.from({ length: 50 }, (_, i) => `s${i}.com`)
    const g = await withGroup({ domains: fifty })
    await user.type(
      within(g).getByRole('textbox', { name: 'Add a site' }),
      'one-more.com{Enter}',
    )
    expect(screen.getByText('50 sites at most')).toBeInTheDocument()
    expect(h.update).not.toHaveBeenCalled()
  })

  it('removes a site', async () => {
    const user = userEvent.setup()
    const g = await withGroup({ domains: ['x.com', 'y.com'] })
    await user.click(within(g).getByRole('button', { name: 'Remove x.com' }))
    expect(lastPatch()).toEqual({ domains: ['y.com'] })
  })

  it('each switch saves', async () => {
    const user = userEvent.setup()
    const g = await withGroup()
    await user.click(within(g).getByRole('switch', { name: 'Block during focus' }))
    expect(lastPatch()).toEqual({ blockInFocus: false })
    await user.click(within(g).getByRole('switch', { name: 'Block on a schedule' }))
    expect(lastPatch()).toEqual({ blockOnSchedule: true })
    await user.click(within(g).getByRole('switch', { name: 'On' }))
    expect(lastPatch()).toEqual({ enabled: false })
  })

  it('renames on blur; an empty name reverts', async () => {
    const user = userEvent.setup()
    const g = await withGroup()
    const name = within(g).getByRole('textbox', { name: 'Group name' })
    await user.clear(name)
    expect(name).toHaveAttribute('aria-invalid', 'true')
    await user.tab()
    expect(h.update).not.toHaveBeenCalled()
    expect(name).toHaveValue('Social')
    await user.clear(name)
    await user.type(name, 'News{Enter}')
    expect(lastPatch()).toEqual({ name: 'News' })
  })

  it('the schedule row shows only when the schedule is on', async () => {
    const user = userEvent.setup()
    const g = await withGroup()
    expect(within(g).queryByTestId('schedule-row')).toBeNull()
    await user.click(within(g).getByRole('switch', { name: 'Block on a schedule' }))
    const row = await within(g).findByTestId('schedule-row')
    expect(within(row).getByRole('button', { name: 'Monday' })).toHaveAttribute(
      'aria-pressed',
      'true',
    )
    expect(within(row).getByRole('button', { name: 'Sunday' })).toHaveAttribute(
      'aria-pressed',
      'false',
    )
    expect(within(row).getByText("Times follow your Mac's clock.")).toBeInTheDocument()
  })

  it('toggles a day and changes the times', async () => {
    const user = userEvent.setup()
    const g = await withGroup({ blockOnSchedule: true })
    await user.click(within(g).getByRole('button', { name: 'Saturday' }))
    expect(lastPatch()).toEqual({ scheduleDays: [1, 2, 3, 4, 5, 6] })
    await user.click(within(g).getByRole('button', { name: 'Monday' }))
    expect(lastPatch()).toEqual({ scheduleDays: [2, 3, 4, 5, 6] })
    // jsdom's time input does not take typed keys; set the value as a pick.
    fireEvent.change(within(g).getByLabelText('From'), {
      target: { value: '08:30' },
    })
    expect(lastPatch()).toEqual({ scheduleFrom: '08:30' })
    fireEvent.change(within(g).getByLabelText('To'), {
      target: { value: '18:00' },
    })
    expect(lastPatch()).toEqual({ scheduleTo: '18:00' })
  })

  it('the last day on cannot be switched off', async () => {
    const user = userEvent.setup()
    const g = await withGroup({ blockOnSchedule: true, scheduleDays: [3] })
    const wed = within(g).getByRole('button', { name: 'Wednesday' })
    expect(wed).toBeDisabled()
    await user.click(wed)
    expect(h.update).not.toHaveBeenCalled()
  })

  it('reads "Runs past midnight." when to is at or before from', async () => {
    const g = await withGroup({
      blockOnSchedule: true,
      scheduleFrom: '22:00',
      scheduleTo: '06:00',
    })
    expect(within(g).getByText(/Runs past midnight\./)).toBeInTheDocument()
  })

  it('no "Runs past midnight." for a same-day window', async () => {
    const g = await withGroup({ blockOnSchedule: true })
    expect(within(g).queryByText(/Runs past midnight/)).toBeNull()
  })

  it('the Daily allowance switch saves (chunk 100)', async () => {
    const user = userEvent.setup()
    const g = await withGroup()
    await user.click(within(g).getByRole('switch', { name: 'Daily allowance' }))
    expect(lastPatch()).toEqual({ dailyLimitOn: true })
  })

  it('the minutes input shows only while the allowance is on', async () => {
    const user = userEvent.setup()
    const g = await withGroup()
    expect(within(g).queryByTestId('allowance-row')).toBeNull()
    expect(within(g).queryByRole('spinbutton', { name: 'Minutes a day' })).toBeNull()
    await user.click(within(g).getByRole('switch', { name: 'Daily allowance' }))
    const row = await within(g).findByTestId('allowance-row')
    expect(within(row).getByRole('spinbutton', { name: 'Minutes a day' })).toHaveValue(30)
    expect(
      within(row).getByText(
        'Counted on your Mac while the site is the tab in front. Resets at midnight.',
      ),
    ).toBeInTheDocument()
    expect(within(row).queryByText('1 to 1440 minutes')).toBeNull()
  })

  it.each(['0', '1441', '', '1.5'])(
    'minutes "%s" read "1 to 1440 minutes" and are not saved',
    async (value) => {
      const user = userEvent.setup()
      const g = await withGroup({ dailyLimitOn: true, dailyLimitMinutes: 30 })
      const input = within(g).getByRole('spinbutton', { name: 'Minutes a day' })
      await user.clear(input)
      if (value) await user.type(input, value)
      expect(within(g).getByText('1 to 1440 minutes')).toBeInTheDocument()
      expect(input).toHaveAttribute('aria-invalid', 'true')
      await user.keyboard('{Enter}')
      await user.tab()
      expect(h.update).not.toHaveBeenCalled()
      // Not saved: the row reads what is stored again.
      expect(input).toHaveValue(30)
    },
  )

  it('a valid number of minutes saves on Enter and on blur', async () => {
    const user = userEvent.setup()
    const g = await withGroup({ dailyLimitOn: true, dailyLimitMinutes: 30 })
    const input = within(g).getByRole('spinbutton', { name: 'Minutes a day' })
    await user.clear(input)
    await user.type(input, '45{Enter}')
    expect(lastPatch()).toEqual({ dailyLimitMinutes: 45 })
    expect(within(g).queryByText('1 to 1440 minutes')).toBeNull()
    await user.clear(input)
    await user.type(input, '1440')
    await user.tab()
    expect(lastPatch()).toEqual({ dailyLimitMinutes: 1440 })
    // Unchanged: nothing is sent.
    h.update.mockClear()
    await user.click(input)
    await user.tab()
    expect(h.update).not.toHaveBeenCalled()
  })

  it('deletes behind the confirm dialog', async () => {
    const user = userEvent.setup()
    const g = await withGroup()
    await user.click(within(g).getByRole('button', { name: 'Delete' }))
    const dialog = await screen.findByRole('alertdialog')
    expect(within(dialog).getByText('Delete "Social"?')).toBeInTheDocument()
    expect(h.remove).not.toHaveBeenCalled()
    await user.click(within(dialog).getByRole('button', { name: 'Delete' }))
    await waitFor(() => expect(h.remove).toHaveBeenCalledWith('g-1'))
    await waitFor(() =>
      expect(screen.queryByRole('group', { name: 'Social' })).toBeNull(),
    )
  })

  it('Add group is disabled at 20 groups', async () => {
    h.groups = Array.from({ length: 20 }, (_, i) =>
      aGroup({ id: `g-${i}`, name: `G${i}`, sortOrder: i }),
    )
    render(<SiteBlockingSection />)
    await screen.findByRole('group', { name: 'G19' })
    expect(screen.getByRole('button', { name: 'Add group' })).toBeDisabled()
    expect(screen.getByText('20 groups at most')).toBeInTheDocument()
  })
})
