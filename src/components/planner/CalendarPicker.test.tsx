import { useState } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'

import type { ReadCalendar } from '@/db/types'
import { useUIStore } from '@/state/uiStore'

/*
 * Chunk 51 — the Planner "Calendars" picker: the READ set UI. Persistence is
 * the component's own (optimistic toggle → repo write → busyRefreshKey bump;
 * error → toast + revert), and opening re-runs discovery to pick up new
 * calendars. The write target is only tagged here — it is chosen in Settings.
 */

const mocks = vi.hoisted(() => ({
  settingsUpdate: vi.fn(),
  listCalendars: vi.fn(),
  toastError: vi.fn(),
}))

vi.mock('@/db/repo', () => ({
  repo: { settings: { update: mocks.settingsUpdate } },
}))
vi.mock('@/lib/calendarApi', () => ({ listCalendars: mocks.listCalendars }))
vi.mock('sonner', () => ({
  toast: Object.assign(vi.fn(), { error: mocks.toastError }),
}))

import CalendarPicker from './CalendarPicker'

const HOME = 'https://caldav.icloud.com/1/calendars/home/'
const WORK = 'https://caldav.icloud.com/1/calendars/work/'
const FAMILY = 'https://caldav.icloud.com/1/calendars/family/'
const SET: ReadCalendar[] = [
  { url: HOME, name: 'Home', enabled: true },
  { url: WORK, name: 'Work', enabled: true },
  { url: FAMILY, name: 'Family', enabled: false },
]

type PickerProps = React.ComponentProps<typeof CalendarPicker>

/** Stands in for the Planner: holds the stored set and feeds a persisted
 *  set back as the prop, the way the screen's `onPersisted` does. */
function Host({ onPersisted, ...props }: PickerProps) {
  const [calendars, setCalendars] = useState(props.calendars)
  return (
    <CalendarPicker
      {...props}
      calendars={calendars}
      onPersisted={(next) => {
        onPersisted(next)
        setCalendars(next)
      }}
    />
  )
}

function renderPicker(props: Partial<PickerProps> = {}) {
  const onPersisted = vi.fn()
  const utils = render(
    <MemoryRouter>
      <Host
        userId="u1"
        calendars={SET}
        writeTargetUrl={HOME}
        initializing={false}
        onPersisted={onPersisted}
        {...props}
      />
    </MemoryRouter>,
  )
  return { ...utils, onPersisted }
}

const chip = () => screen.getByRole('button', { name: 'Calendars' })

describe('CalendarPicker (chunk 51)', () => {
  beforeEach(() => {
    // Radix Popover positions through @floating-ui, which needs a
    // ResizeObserver jsdom lacks (SyncIndicator.test precedent).
    if (typeof globalThis.ResizeObserver === 'undefined') {
      globalThis.ResizeObserver = class {
        observe() {}
        unobserve() {}
        disconnect() {}
      } as unknown as typeof ResizeObserver
    }
    vi.spyOn(console, 'error').mockImplementation(() => {})
    // Default refresh: discovery returns the same set → nothing to persist.
    mocks.listCalendars.mockResolvedValue({
      calendars: SET.map(({ url, name }) => ({ url, name })),
      writeTargetUrl: HOME,
    })
    mocks.settingsUpdate.mockImplementation(async (_id, changes) => ({
      userId: 'u1',
      ...changes,
    }))
  })
  afterEach(() => {
    vi.restoreAllMocks()
    vi.clearAllMocks()
  })

  it('renders the enabled/total count, one switch per calendar, the WRITE tag and the footer', async () => {
    const user = userEvent.setup()
    renderPicker()
    expect(chip()).toHaveTextContent('CALENDARS · 2/3')
    await user.click(chip())
    const home = await screen.findByRole('switch', { name: 'Home' })
    expect(home).toHaveAttribute('aria-checked', 'true')
    expect(screen.getByRole('switch', { name: 'Work' })).toHaveAttribute('aria-checked', 'true')
    expect(screen.getByRole('switch', { name: 'Family' })).toHaveAttribute('aria-checked', 'false')
    // The write-target row is tagged; the tag is informational (switch still there).
    expect(screen.getByText('WRITE')).toBeInTheDocument()
    expect(screen.getByText('Home', { selector: 'label' })).toBeInTheDocument()
    expect(screen.getByText(/Planner blocks write to/)).toHaveTextContent(
      'Planner blocks write to Home. Change in Settings.',
    )
    // Same set came back from discovery → no write.
    expect(mocks.settingsUpdate).not.toHaveBeenCalled()
  })

  it('toggling persists the updated set, reports it, and bumps busyRefreshKey', async () => {
    const user = userEvent.setup()
    const before = useUIStore.getState().busyRefreshKey
    const { onPersisted } = renderPicker()
    await user.click(chip())
    await user.click(await screen.findByRole('switch', { name: 'Work' }))
    const expected = [
      { url: HOME, name: 'Home', enabled: true },
      { url: WORK, name: 'Work', enabled: false },
      { url: FAMILY, name: 'Family', enabled: false },
    ]
    await waitFor(() =>
      expect(mocks.settingsUpdate).toHaveBeenCalledWith('u1', {
        caldavReadCalendars: expected,
      }),
    )
    await waitFor(() => expect(onPersisted).toHaveBeenCalledWith(expected))
    expect(useUIStore.getState().busyRefreshKey).toBe(before + 1)
  })

  it('a failed write toasts, reverts to the stored set, and leaves busyRefreshKey alone', async () => {
    const user = userEvent.setup()
    mocks.settingsUpdate.mockRejectedValue(new Error('offline'))
    const before = useUIStore.getState().busyRefreshKey
    const { onPersisted } = renderPicker()
    await user.click(chip())
    await user.click(await screen.findByRole('switch', { name: 'Work' }))
    await waitFor(() => expect(mocks.toastError).toHaveBeenCalledWith('Could not save — retry.'))
    // Reverted: Work reads from the prop again.
    await waitFor(() =>
      expect(screen.getByRole('switch', { name: 'Work' })).toHaveAttribute('aria-checked', 'true'),
    )
    expect(chip()).toHaveTextContent('CALENDARS · 2/3')
    expect(onPersisted).not.toHaveBeenCalled()
    expect(useUIStore.getState().busyRefreshKey).toBe(before)
  })

  it('renders the empty state when the Apple ID has no event calendars', async () => {
    const user = userEvent.setup()
    mocks.listCalendars.mockResolvedValue({ calendars: [], writeTargetUrl: null })
    renderPicker({ calendars: [], writeTargetUrl: null })
    expect(chip()).toHaveTextContent('CALENDARS · 0/0')
    await user.click(chip())
    expect(
      await screen.findByText('No event calendars found on this Apple ID.'),
    ).toBeInTheDocument()
    expect(screen.queryByRole('switch')).toBeNull()
  })

  it('a null set reads “…” while initializing and “–” after a failed initialization', () => {
    const { unmount } = renderPicker({ calendars: null, initializing: true })
    expect(chip()).toHaveTextContent('CALENDARS · …')
    unmount()
    renderPicker({ calendars: null, initializing: false })
    expect(chip()).toHaveTextContent('CALENDARS · –')
    expect(mocks.listCalendars).not.toHaveBeenCalled()
  })

  it('opening re-discovers: new calendars are appended enabled, vanished ones dropped, and the set persisted', async () => {
    const user = userEvent.setup()
    const NEW = 'https://caldav.icloud.com/1/calendars/new/'
    mocks.listCalendars.mockResolvedValue({
      calendars: [
        { url: HOME, name: 'Home' },
        { url: FAMILY, name: 'Family' },
        { url: NEW, name: 'Side project' },
      ],
      writeTargetUrl: HOME,
    })
    const before = useUIStore.getState().busyRefreshKey
    const { onPersisted } = renderPicker()
    await user.click(chip())
    const expected = [
      { url: HOME, name: 'Home', enabled: true },
      { url: FAMILY, name: 'Family', enabled: false },
      { url: NEW, name: 'Side project', enabled: true },
    ]
    await waitFor(() =>
      expect(mocks.settingsUpdate).toHaveBeenCalledWith('u1', {
        caldavReadCalendars: expected,
      }),
    )
    await waitFor(() => expect(onPersisted).toHaveBeenCalledWith(expected))
    // Work (enabled) vanished and Side project (enabled) arrived → the read
    // set changed → busy cache dropped.
    expect(useUIStore.getState().busyRefreshKey).toBe(before + 1)
    expect(await screen.findByRole('switch', { name: 'Side project' })).toHaveAttribute(
      'aria-checked',
      'true',
    )
    expect(screen.queryByRole('switch', { name: 'Work' })).toBeNull()
  })

  it('every row carries a distinct color dot (chunk 51b): iCloud’s color where known, palette otherwise', async () => {
    const user = userEvent.setup()
    const withColor: ReadCalendar[] = [
      { ...SET[0]!, color: '#ff2968' },
      SET[1]!,
      SET[2]!,
    ]
    mocks.listCalendars.mockResolvedValue({
      calendars: withColor.map(({ url, name, color }) => ({ url, name, ...(color ? { color } : {}) })),
      writeTargetUrl: HOME,
    })
    renderPicker({ calendars: withColor })
    await user.click(chip())
    const dots = await screen.findAllByTestId('calendar-swatch')
    expect(dots).toHaveLength(3)
    const colors = dots.map((d) => d.style.background)
    expect(colors[0]).toBe('rgb(255, 41, 104)')
    expect(new Set(colors).size).toBe(3)
    // Nothing changed upstream → no write.
    await waitFor(() => expect(mocks.listCalendars).toHaveBeenCalled())
    expect(mocks.settingsUpdate).not.toHaveBeenCalled()
  })

  it('lists the Outlook feed as a read-only row with its own distinct dot and a FEED tag (chunk 51c)', async () => {
    const user = userEvent.setup()
    renderPicker({ outlookFeedName: 'Work feed' })
    await user.click(chip())
    const row = await screen.findByTestId('outlook-feed-row')
    expect(row).toHaveTextContent('Work feed')
    expect(row).toHaveTextContent('FEED')
    expect(row.querySelector('[role="switch"]')).toBeNull()
    // Three iCloud switches only; the chip count is iCloud-only too.
    expect(screen.getAllByRole('switch')).toHaveLength(3)
    expect(chip()).toHaveTextContent('CALENDARS · 2/3')
    const dots = screen.getAllByTestId('calendar-swatch')
    expect(dots).toHaveLength(4)
    expect(new Set(dots.map((d) => d.style.background)).size).toBe(4)
  })

  it('no Outlook row when the feed is not configured', async () => {
    const user = userEvent.setup()
    renderPicker({ outlookFeedName: null })
    await user.click(chip())
    await screen.findAllByRole('switch')
    expect(screen.queryByTestId('outlook-feed-row')).toBeNull()
  })

  it('re-discovery persists a calendar’s color into the read set (chunk 51b)', async () => {
    const user = userEvent.setup()
    mocks.listCalendars.mockResolvedValue({
      calendars: [
        { url: HOME, name: 'Home', color: '#ff2968' },
        { url: WORK, name: 'Work' },
        { url: FAMILY, name: 'Family' },
      ],
      writeTargetUrl: HOME,
    })
    const before = useUIStore.getState().busyRefreshKey
    renderPicker()
    await user.click(chip())
    await waitFor(() =>
      expect(mocks.settingsUpdate).toHaveBeenCalledWith('u1', {
        caldavReadCalendars: [
          { url: HOME, name: 'Home', enabled: true, color: '#ff2968' },
          { url: WORK, name: 'Work', enabled: true },
          { url: FAMILY, name: 'Family', enabled: false },
        ],
      }),
    )
    // Only a color changed, not what is read → the busy cache is kept.
    expect(useUIStore.getState().busyRefreshKey).toBe(before)
  })
})
