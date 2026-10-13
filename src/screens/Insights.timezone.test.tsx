import { render, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

/*
 * Chunk 61: the Insights window and its buckets follow `settings.timezone`.
 * Zone America/Los_Angeles, clock pinned to 2026-05-21T03:00Z — 20:00 PDT on
 * May 20, so the user's "today" is still the 20th while UTC is on the 21st.
 *
 * The screen renders no per-day text (chartLabel takes only range + filter and
 * the table is per-subcategory), so the zone hand-off to the aggregation core
 * is asserted through a passthrough spy on `aggregateForChart`.
 */

const { tasksList, subsList, catsList, aggregateSpy } = vi.hoisted(() => ({
  tasksList: vi.fn(),
  subsList: vi.fn(),
  catsList: vi.fn(),
  aggregateSpy: vi.fn(),
}))

vi.mock('@/db/repo', () => ({
  repo: {
    tasks: { listCompletedInRange: tasksList },
    subcategories: { list: subsList },
    categories: { list: catsList },
  },
}))

vi.mock('@/lib/userTimezone', () => ({
  browserTimezone: () => 'America/Los_Angeles',
  loadUserTimezone: async () => 'America/Los_Angeles',
}))

vi.mock('@/lib/insights', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/insights')>()
  return {
    ...actual,
    aggregateForChart: (
      ...args: Parameters<typeof actual.aggregateForChart>
    ) => {
      aggregateSpy(...args)
      return actual.aggregateForChart(...args)
    },
  }
})

import Insights from './Insights'

describe('Insights — settings.timezone window (chunk 61)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(new Date('2026-05-21T03:00:00.000Z'))
    tasksList.mockResolvedValue([])
    subsList.mockResolvedValue([])
    catsList.mockResolvedValue([])
  })
  afterEach(() => {
    vi.useRealTimers()
  })

  it('(1) fetches from local midnight of the first day in the zone', async () => {
    render(<Insights />)

    await waitFor(() => expect(tasksList).toHaveBeenCalled())
    expect(tasksList.mock.calls[0][0]).toBe('2026-04-21T07:00:00.000Z')
  })

  it('(2) passes the zone and zone-local day keys to aggregateForChart', async () => {
    render(<Insights />)
    await waitFor(() => expect(tasksList).toHaveBeenCalled())

    await waitFor(() => {
      const last = aggregateSpy.mock.calls.at(-1)!
      expect(last[4]).toBe('America/Los_Angeles')
      expect(last[3]).toHaveLength(30)
      expect(last[3]!.at(-1)).toBe('2026-05-20')
    })
  })
})
