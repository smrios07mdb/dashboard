import { render, renderHook, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

// The file also holds `useBusyToday`; its fetch is mocked at the module edges.
vi.mock('@/db/repo', () => ({ repo: { settings: { get: vi.fn() } } }))
vi.mock('@/lib/auth', () => ({ useSession: () => ({ user: { id: 'u1' } }) }))
vi.mock('@/lib/busyCache', () => ({ getBusyDay: vi.fn() }))
vi.mock('@/lib/session', () => ({
  withSessionRetry: <T,>(action: () => Promise<T>) => action(),
}))
vi.mock('@/lib/calendarApi', () => ({ isAuthFailed: () => false }))

import { repo } from '@/db/repo'
import { getBusyDay } from '@/lib/busyCache'

import BusyStrip, {
  BusyInline,
  useBusyToday,
  type BusyToday,
} from './BusyStrip'

/* The two views of today's busy times (chunk 74), one case per `BusyToday` kind. */

const READY: BusyToday = { kind: 'ready', text: '12–12:30', freeMin: 120 }
const EMPTY: BusyToday = { kind: 'ready', text: '', freeMin: 540 }

describe('BusyInline', () => {
  it.each<BusyToday>([{ kind: 'hidden' }, { kind: 'reconnect' }])(
    'renders nothing when $kind',
    (busy) => {
      const { container } = render(<BusyInline busy={busy} />)
      expect(container).toBeEmptyDOMElement()
    },
  )

  it('shows a short skeleton while loading', () => {
    const { container } = render(<BusyInline busy={{ kind: 'loading' }} />)
    expect(container.firstElementChild).toHaveClass('animate-pulse', 'h-3', 'w-24')
    expect(container).toHaveTextContent('')
  })

  it('shows the ranges on one line', () => {
    render(<BusyInline busy={READY} />)
    const line = screen.getByText('Busy 12–12:30')
    expect(line.tagName).toBe('SPAN')
    expect(line).toHaveClass(
      'font-mono',
      'text-[12px]',
      'text-ink-3',
      'whitespace-nowrap',
    )
  })

  it('says so when there are no ranges', () => {
    render(<BusyInline busy={EMPTY} />)
    expect(screen.getByText('No busy times')).toBeInTheDocument()
  })

  it('says so when the fetch failed', () => {
    render(<BusyInline busy={{ kind: 'error' }} />)
    expect(screen.getByText('Busy times unavailable')).toBeInTheDocument()
  })
})

describe('BusyStrip', () => {
  it.each<BusyToday>([{ kind: 'hidden' }, { kind: 'reconnect' }])(
    'renders nothing when $kind',
    (busy) => {
      const { container } = render(<BusyStrip busy={busy} />)
      expect(container).toBeEmptyDOMElement()
    },
  )

  it('shows the label and a skeleton while loading', () => {
    const { container } = render(<BusyStrip busy={{ kind: 'loading' }} />)
    expect(screen.getByText('Busy')).toBeInTheDocument()
    expect(container.querySelector('.animate-pulse')).toHaveClass('h-4', 'w-44')
  })

  it('shows the ranges beside the label', () => {
    render(<BusyStrip busy={READY} />)
    expect(screen.getByText('Busy')).toBeInTheDocument()
    expect(screen.getByText('12–12:30')).toBeInTheDocument()
  })

  it('says so when there are no ranges', () => {
    render(<BusyStrip busy={EMPTY} />)
    expect(screen.getByText('No busy times today')).toBeInTheDocument()
  })

  it('says so when the fetch failed', () => {
    render(<BusyStrip busy={{ kind: 'error' }} />)
    expect(
      screen.getByText('Couldn’t load busy times — retry on next refresh.'),
    ).toBeInTheDocument()
  })
})

describe('useBusyToday', () => {
  afterEach(() => vi.useRealTimers())

  it('carries the free minutes left today in the ready state (chunk 87)', async () => {
    // Wed 2026-10-14 10:07 in New York: counted from 10:15, busy 12–13.
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(new Date('2026-10-14T10:07:00-04:00'))
    vi.mocked(repo.settings.get).mockResolvedValue({
      caldavStatus: 'ok',
      timezone: 'America/New_York',
    } as Awaited<ReturnType<typeof repo.settings.get>>)
    vi.mocked(getBusyDay).mockResolvedValue([
      { start: '2026-10-14T16:00:00.000Z', end: '2026-10-14T17:00:00.000Z' },
    ])
    const { result } = renderHook(() => useBusyToday())
    await waitFor(() => expect(result.current.kind).toBe('ready'))
    expect(getBusyDay).toHaveBeenCalledWith('2026-10-14', 'America/New_York')
    expect(result.current).toEqual({
      kind: 'ready',
      text: '12–13',
      freeMin: 465 - 60,
    })
  })
})
