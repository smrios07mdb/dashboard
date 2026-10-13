import { render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

// The file also holds `useBusyToday`; only the two views are under test.
vi.mock('@/db/repo', () => ({ repo: { settings: { get: vi.fn() } } }))

import BusyStrip, { BusyInline, type BusyToday } from './BusyStrip'

/* The two views of today's busy times (chunk 74), one case per `BusyToday` kind. */

const READY: BusyToday = { kind: 'ready', text: '12–12:30' }
const EMPTY: BusyToday = { kind: 'ready', text: '' }

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
