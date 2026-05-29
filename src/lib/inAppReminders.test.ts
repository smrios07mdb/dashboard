import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { createReminderPoller, type ClaimedReminder } from './inAppReminders'

/*
 * The poller's value is its scheduling discipline — claim once per tick,
 * never overlap a tick with itself, idempotent start, clean stop, and
 * survive a failing claim. Those are pure and deterministic under fake
 * timers. The actual `claim` (Supabase RPC) and `notify` (Notification +
 * toast) are injected, so the real wiring is covered by docs/notifications.md
 * operator verification, not brittle mocks.
 */
function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((r) => {
    resolve = r
  })
  return { promise, resolve }
}

// Drain the microtask queue so an awaited claim settles between assertions.
async function flushMicrotasks() {
  for (let i = 0; i < 5; i++) await Promise.resolve()
}

describe('createReminderPoller', () => {
  beforeEach(() => vi.useFakeTimers())
  afterEach(() => vi.useRealTimers())

  it('claims immediately on start and notifies each claimed reminder', async () => {
    const claim = vi
      .fn<() => Promise<ClaimedReminder[]>>()
      .mockResolvedValue([
        { id: 'a', title: 'A' },
        { id: 'b', title: 'B' },
      ])
    const notify = vi.fn()
    const poller = createReminderPoller({ claim, notify, intervalMs: 60_000 })

    poller.start()
    await flushMicrotasks()

    expect(claim).toHaveBeenCalledTimes(1)
    expect(notify).toHaveBeenCalledTimes(2)
    expect(notify).toHaveBeenCalledWith({ id: 'a', title: 'A' })
    expect(notify).toHaveBeenCalledWith({ id: 'b', title: 'B' })
    poller.stop()
  })

  it('claims again after the interval elapses', async () => {
    const claim = vi.fn<() => Promise<ClaimedReminder[]>>().mockResolvedValue([])
    const poller = createReminderPoller({ claim, notify: vi.fn(), intervalMs: 60_000 })

    poller.start()
    await flushMicrotasks()
    expect(claim).toHaveBeenCalledTimes(1)

    await vi.advanceTimersByTimeAsync(60_000)
    expect(claim).toHaveBeenCalledTimes(2)
    poller.stop()
  })

  it('does not start a second tick while one is still in flight', async () => {
    const d = deferred<ClaimedReminder[]>()
    const claim = vi.fn<() => Promise<ClaimedReminder[]>>().mockReturnValue(d.promise)
    const poller = createReminderPoller({ claim, notify: vi.fn(), intervalMs: 60_000 })

    poller.start()
    await flushMicrotasks()
    expect(claim).toHaveBeenCalledTimes(1) // immediate tick, claim pending

    await vi.advanceTimersByTimeAsync(60_000)
    expect(claim).toHaveBeenCalledTimes(1) // interval fired but prior tick not settled

    d.resolve([])
    await flushMicrotasks()
    await vi.advanceTimersByTimeAsync(60_000)
    expect(claim).toHaveBeenCalledTimes(2) // free to claim again now
    poller.stop()
  })

  it('is idempotent: calling start twice runs a single interval', async () => {
    const claim = vi.fn<() => Promise<ClaimedReminder[]>>().mockResolvedValue([])
    const poller = createReminderPoller({ claim, notify: vi.fn(), intervalMs: 60_000 })

    poller.start()
    poller.start() // no-op
    await flushMicrotasks()
    expect(claim).toHaveBeenCalledTimes(1)

    await vi.advanceTimersByTimeAsync(60_000)
    expect(claim).toHaveBeenCalledTimes(2) // not 3 or 4
    poller.stop()
  })

  it('stops claiming after stop()', async () => {
    const claim = vi.fn<() => Promise<ClaimedReminder[]>>().mockResolvedValue([])
    const poller = createReminderPoller({ claim, notify: vi.fn(), intervalMs: 60_000 })

    poller.start()
    await flushMicrotasks()
    poller.stop()

    await vi.advanceTimersByTimeAsync(60_000 * 3)
    expect(claim).toHaveBeenCalledTimes(1)
  })

  it('survives a rejected claim and never notifies for it', async () => {
    const claim = vi
      .fn<() => Promise<ClaimedReminder[]>>()
      .mockRejectedValueOnce(new Error('network'))
      .mockResolvedValueOnce([{ id: 'a', title: 'A' }])
    const notify = vi.fn()
    const poller = createReminderPoller({ claim, notify, intervalMs: 60_000 })

    poller.start()
    await flushMicrotasks()
    expect(claim).toHaveBeenCalledTimes(1)
    expect(notify).not.toHaveBeenCalled()

    await vi.advanceTimersByTimeAsync(60_000)
    await flushMicrotasks()
    expect(claim).toHaveBeenCalledTimes(2)
    expect(notify).toHaveBeenCalledTimes(1)
    poller.stop()
  })
})
