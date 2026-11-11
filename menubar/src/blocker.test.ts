import { describe, expect, it, vi } from 'vitest'

import type { BlockGroup } from '@/db/types'

import { blocking, buildConfig, createBlockerSync, type BlockerConfig } from './blocker'

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
