import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { createRefresher, REFRESH_INTERVAL_MS } from './refresher'

describe('createRefresher', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })
  afterEach(() => {
    vi.useRealTimers()
  })

  it('refetches when the popover is shown', async () => {
    const load = vi.fn().mockResolvedValue(undefined)
    const r = createRefresher(load)
    expect(load).not.toHaveBeenCalled()
    r.setShown(true)
    await vi.advanceTimersByTimeAsync(0)
    expect(load).toHaveBeenCalledTimes(1)
    r.setShown(false)
    r.setShown(true)
    await vi.advanceTimersByTimeAsync(0)
    expect(load).toHaveBeenCalledTimes(2)
    r.dispose()
  })

  it('refetches every 5 minutes while it stays open', async () => {
    const load = vi.fn().mockResolvedValue(undefined)
    const r = createRefresher(load)
    r.setShown(true)
    await vi.advanceTimersByTimeAsync(REFRESH_INTERVAL_MS - 1)
    expect(load).toHaveBeenCalledTimes(1)
    await vi.advanceTimersByTimeAsync(1)
    expect(load).toHaveBeenCalledTimes(2)
    await vi.advanceTimersByTimeAsync(REFRESH_INTERVAL_MS)
    expect(load).toHaveBeenCalledTimes(3)
    r.dispose()
  })

  it('stops the timer when hidden', async () => {
    const load = vi.fn().mockResolvedValue(undefined)
    const r = createRefresher(load)
    r.setShown(true)
    await vi.advanceTimersByTimeAsync(0)
    r.setShown(false)
    expect(vi.getTimerCount()).toBe(0)
    await vi.advanceTimersByTimeAsync(REFRESH_INTERVAL_MS * 3)
    expect(load).toHaveBeenCalledTimes(1)
    r.dispose()
  })

  it('is 5 minutes', () => {
    expect(REFRESH_INTERVAL_MS).toBe(5 * 60 * 1000)
  })

  it('does not stack a second load on one still in flight', async () => {
    let finish: () => void = () => {}
    const load = vi.fn(
      () =>
        new Promise<void>((resolve) => {
          finish = resolve
        }),
    )
    const r = createRefresher(load)
    r.setShown(true)
    void r.refresh()
    expect(load).toHaveBeenCalledTimes(1)
    finish()
    await vi.advanceTimersByTimeAsync(0)
    void r.refresh()
    expect(load).toHaveBeenCalledTimes(2)
    r.dispose()
  })

  it('survives a failed load and stops for good once disposed', async () => {
    const load = vi.fn().mockRejectedValue(new Error('boom'))
    const r = createRefresher(load)
    r.setShown(true)
    await vi.advanceTimersByTimeAsync(REFRESH_INTERVAL_MS)
    expect(load).toHaveBeenCalledTimes(2)
    r.dispose()
    expect(vi.getTimerCount()).toBe(0)
    r.setShown(true)
    await vi.advanceTimersByTimeAsync(REFRESH_INTERVAL_MS)
    expect(load).toHaveBeenCalledTimes(2)
  })
})
