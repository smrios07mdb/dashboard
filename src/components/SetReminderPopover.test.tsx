import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

/*
 * Chunk 61: the reminder picker reads and writes wall-clock times in
 * `settings.timezone`, not the browser's zone. `@/lib/userTimezone` is mocked
 * (settings zone Asia/Tokyo, device zone America/New_York) so every assertion
 * is independent of the zone of the machine running the suite.
 */

const { loadUserTimezone } = vi.hoisted(() => ({
  loadUserTimezone: vi.fn(),
}))

vi.mock('@/lib/userTimezone', () => ({
  browserTimezone: () => 'America/New_York',
  loadUserTimezone,
}))

import SetReminderPopover, {
  fromZonedInputValue,
  toZonedInputValue,
} from './SetReminderPopover'

// Radix Popover (popper + pointer dismissal) needs these jsdom shims.
beforeAll(() => {
  Element.prototype.hasPointerCapture ??= () => false
  Element.prototype.releasePointerCapture ??= () => {}
  Element.prototype.scrollIntoView ??= () => {}
  if (typeof globalThis.ResizeObserver === 'undefined') {
    globalThis.ResizeObserver = class {
      observe() {}
      unobserve() {}
      disconnect() {}
    } as unknown as typeof ResizeObserver
  }
})

function popover(
  props: Partial<React.ComponentProps<typeof SetReminderPopover>> = {},
) {
  return (
    <SetReminderPopover
      open
      onOpenChange={() => {}}
      remindAt={null}
      trigger={<button type="button">bell</button>}
      onSave={() => {}}
      onClear={() => {}}
      {...props}
    />
  )
}

const input = () =>
  screen.getByLabelText('Reminder date and time') as HTMLInputElement
const save = () => screen.getByRole('button', { name: 'Save' })

function deferred() {
  let resolve!: (tz: string) => void
  const promise = new Promise<string>((r) => {
    resolve = r
  })
  return { promise, resolve }
}

describe('SetReminderPopover — settings.timezone (chunk 61)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    loadUserTimezone.mockResolvedValue('Asia/Tokyo')
  })

  it('(1) saves the picked wall time as an instant in settings.timezone', async () => {
    const onSave = vi.fn()
    render(popover({ onSave }))
    await waitFor(() => expect(input()).not.toBeDisabled())

    fireEvent.change(input(), { target: { value: '2026-10-20T09:00' } })
    await act(async () => {
      fireEvent.click(save())
    })

    expect(onSave).toHaveBeenCalledWith('2026-10-20T00:00:00.000Z')
  })

  it('(2) shows an existing reminder as a wall time in settings.timezone', async () => {
    render(popover({ remindAt: '2026-10-20T00:00:00.000Z' }))
    await waitFor(() => expect(input()).not.toBeDisabled())

    expect(input().value).toBe('2026-10-20T09:00')
  })

  it('(3) shows the zone hint only when it differs from the device zone', async () => {
    const { unmount } = render(popover())
    expect(await screen.findByText('Times in Asia/Tokyo')).toBeInTheDocument()
    unmount()

    loadUserTimezone.mockResolvedValue('America/New_York')
    render(popover())
    await waitFor(() => expect(input()).not.toBeDisabled())
    expect(screen.queryByText(/^Times in /)).not.toBeInTheDocument()
  })

  it('(4) disables the input and Save until the zone resolves', async () => {
    const d = deferred()
    loadUserTimezone.mockReturnValue(d.promise)
    render(popover({ remindAt: '2026-10-20T00:00:00.000Z' }))

    expect(input()).toBeDisabled()
    expect(input()).toHaveAttribute('aria-busy', 'true')
    expect(save()).toBeDisabled()

    await act(async () => {
      d.resolve('Asia/Tokyo')
    })
    expect(input()).not.toBeDisabled()
    expect(save()).not.toBeDisabled()
  })

  it('(5) drops a zone resolution that arrives after the popover closed', async () => {
    const first = deferred()
    const second = deferred()
    loadUserTimezone
      .mockReturnValueOnce(first.promise)
      .mockReturnValueOnce(second.promise)

    const { rerender } = render(
      popover({ remindAt: '2026-10-20T00:00:00.000Z' }),
    )
    rerender(popover({ open: false, remindAt: '2026-10-20T00:00:00.000Z' }))
    await act(async () => {
      first.resolve('Asia/Tokyo')
    })

    rerender(popover({ remindAt: '2026-12-01T03:15:00.000Z' }))
    // The stale resolution set nothing: still waiting on the second open's zone.
    expect(input()).toBeDisabled()
    expect(input().value).toBe('')

    await act(async () => {
      second.resolve('Asia/Tokyo')
    })
    expect(input().value).toBe('2026-12-01T12:15')
  })

  it('(6) converters round-trip New York across the fall-back hour', () => {
    const NY = 'America/New_York'
    const iso = fromZonedInputValue('2026-11-01T01:30', NY)
    expect(iso).toBe('2026-11-01T05:30:00.000Z')
    expect(toZonedInputValue(iso, NY)).toBe('2026-11-01T01:30')

    expect(fromZonedInputValue('2026-03-08T02:30', NY)).toBe(
      '2026-03-08T07:30:00.000Z',
    )
    expect(fromZonedInputValue('', NY)).toBeNull()
    expect(fromZonedInputValue('nope', NY)).toBeNull()
    expect(toZonedInputValue(null, NY)).toBe('')
    expect(toZonedInputValue('nope', NY)).toBe('')
  })

  // Chunk 81: date-fns-tz picks between the two instants of a repeated wall
  // time by the HOST zone; the app takes the earlier one on every host.
  it('(6b) an ambiguous wall time resolves to the earlier instant', () => {
    const LH = 'Australia/Lord_Howe'
    const iso = fromZonedInputValue('2026-04-05T01:45', LH)
    expect(iso).toBe('2026-04-04T14:45:00.000Z')
    expect(toZonedInputValue(iso, LH)).toBe('2026-04-05T01:45')
  })

  // Chunk 82: one Intl-only helper, so the answer no longer depends on the host.
  // Not a regression guard from base: chunk 81's ±30/60 loop already got
  // this one right on every host; it pins the zonedTime path to the oracle.
  it('(6c) a repeated late-evening time resolves to the earlier instant', () => {
    expect(fromZonedInputValue('2026-04-04T23:30', 'America/Santiago')).toBe(
      '2026-04-05T02:30:00.000Z',
    )
  })

  it('(6d) a skipped wall time shifts forward by the gap', () => {
    expect(fromZonedInputValue('2026-10-04T02:15', 'Australia/Lord_Howe')).toBe(
      '2026-10-03T15:45:00.000Z',
    )
  })
})
