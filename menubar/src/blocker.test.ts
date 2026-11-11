import { describe, expect, it, vi } from 'vitest'

import type { BlockGroup } from '@/db/types'

import { midnightsFrom } from './blockSchedule'
import {
  blocking,
  buildConfig,
  createBlockerSync,
  disabledConfig,
  type BlockerConfig,
} from './blocker'

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
    createdAt: 'x',
    updatedAt: 'x',
    ...over,
  }
}

const NOW = new Date(2026, 10, 11, 10)

describe('buildConfig (chunk 99, D19)', () => {
  it('keeps only groups that can block something', () => {
    const groups = [
      aGroup({ id: 'a' }),
      aGroup({ id: 'off', enabled: false }),
      aGroup({ id: 'empty', domains: [] }),
      aGroup({ id: 'none', blockInFocus: false }),
      aGroup({ id: 'sched', blockInFocus: false, blockOnSchedule: true }),
    ]
    expect(blocking(groups).map((g) => g.id)).toEqual(['a', 'sched'])
  })

  it('sends parallel lists with epoch-ms windows', () => {
    const c = buildConfig(
      true,
      [
        aGroup({ name: 'Social', domains: ['x.com', 'reddit.com'] }),
        aGroup({ name: 'News', blockInFocus: false, blockOnSchedule: true }),
      ],
      NOW,
    )
    expect(c.enabled).toBe(true)
    expect(c.names).toEqual(['Social', 'News'])
    expect(c.domains).toEqual([['x.com', 'reddit.com'], ['x.com']])
    expect(c.focus).toEqual([true, false])
    expect(c.starts[0]).toEqual([])
    expect(c.starts[1][0]).toBe(new Date(2026, 10, 11, 9).getTime())
    expect(c.ends[1][0]).toBe(new Date(2026, 10, 11, 17).getTime())
    expect(c.starts[1]).toHaveLength(c.ends[1].length)
  })

  it('keeps a group whose only trigger is the allowance (chunk 100)', () => {
    const groups = [
      aGroup({ id: 'limit', blockInFocus: false, dailyLimitOn: true }),
      aGroup({ id: 'none', blockInFocus: false, dailyLimitMinutes: 90 }),
      aGroup({ id: 'off', enabled: false, blockInFocus: false, dailyLimitOn: true }),
      aGroup({ id: 'empty', domains: [], blockInFocus: false, dailyLimitOn: true }),
    ]
    expect(blocking(groups).map((g) => g.id)).toEqual(['limit'])
  })

  it('sends ids, limits and midnights (chunk 100)', () => {
    const c = buildConfig(
      true,
      [
        aGroup({ id: 'a', dailyLimitOn: true, dailyLimitMinutes: 45 }),
        // Off: 0, whatever the minutes say.
        aGroup({ id: 'b', dailyLimitOn: false, dailyLimitMinutes: 90 }),
        aGroup({ id: 'c', blockInFocus: false, dailyLimitOn: true, dailyLimitMinutes: 1 }),
      ],
      NOW,
    )
    expect(c.ids).toEqual(['a', 'b', 'c'])
    expect(c.limits).toEqual([45, 0, 1])
    expect(c.focus).toEqual([true, true, false])
    expect(c.midnights).toEqual(midnightsFrom(NOW))
    expect(c.midnights).toHaveLength(16)
    expect(c.midnights[0]).toBe(new Date(2026, 10, 11).getTime())
    // One entry per group in every list.
    for (const list of [c.names, c.domains, c.starts, c.ends, c.limits]) {
      expect(list).toHaveLength(c.ids.length)
    }
  })

  it('the disabled configuration still carries the midnights', () => {
    expect(disabledConfig(NOW)).toEqual({
      enabled: false,
      ids: [],
      names: [],
      domains: [],
      focus: [],
      starts: [],
      ends: [],
      limits: [],
      midnights: midnightsFrom(NOW),
    })
  })

  it('carries the Mac switch', () => {
    expect(buildConfig(false, [aGroup()], NOW).enabled).toBe(false)
  })
})

describe('createBlockerSync', () => {
  function setup(listGroups = vi.fn(async () => [aGroup()])) {
    const sent: BlockerConfig[] = []
    const configure = vi.fn(async (c: BlockerConfig) => {
      sent.push(c)
    })
    const s = createBlockerSync({ listGroups, configure, enabled: () => true, now: () => NOW })
    return { s, sent, configure, listGroups }
  }

  it('reads and sends once', async () => {
    const { s, sent } = setup()
    await s.sync()
    expect(sent).toHaveLength(1)
    expect(sent[0].names).toEqual(['Social'])
  })

  it('a sync asked for mid-flight runs once more, not twice', async () => {
    let release!: () => void
    const gate = new Promise<void>((r) => (release = r))
    const listGroups = vi.fn(async () => {
      await gate
      return [aGroup()]
    })
    const { s, sent } = setup(listGroups)
    const first = s.sync()
    void s.sync()
    void s.sync()
    release()
    await first
    expect(listGroups).toHaveBeenCalledTimes(2)
    expect(sent).toHaveLength(2)
  })

  it('a failed read sends nothing', async () => {
    const err = vi.spyOn(console, 'error').mockImplementation(() => {})
    const { s, configure } = setup(vi.fn(async () => Promise.reject(new Error('down'))))
    await s.sync()
    expect(configure).not.toHaveBeenCalled()
    err.mockRestore()
  })

  it('stop blocks a send still in flight and any later sync', async () => {
    let release!: () => void
    const gate = new Promise<void>((r) => (release = r))
    const { s, configure } = setup(
      vi.fn(async () => {
        await gate
        return [aGroup()]
      }),
    )
    const p = s.sync()
    s.stop()
    release()
    await p
    await s.sync()
    expect(configure).not.toHaveBeenCalled()
  })
})
