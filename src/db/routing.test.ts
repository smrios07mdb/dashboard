import { beforeEach, describe, expect, it, vi } from 'vitest'

/*
 * Chunk 89: repo.routing (pending + apply) and the routing_proposals realtime
 * binding. Online-only — no Dexie, no outbox.
 */

const { fromMock, rpcMock, channelMock, bindings } = vi.hoisted(() => {
  const bindings = new Map<string, (payload: unknown) => unknown>()
  const channel = {
    on(_e: string, filter: { table: string }, handler: (p: unknown) => unknown) {
      bindings.set(filter.table, handler)
      return channel
    },
    subscribe: () => channel,
  }
  return {
    fromMock: vi.fn(),
    rpcMock: vi.fn(),
    channelMock: vi.fn(() => channel),
    bindings,
  }
})

vi.mock('@/lib/supabase', () => ({
  supabase: {
    from: fromMock,
    rpc: rpcMock,
    channel: channelMock,
    removeChannel: vi.fn(),
  },
}))

import { startRealtime, stopRealtime } from './realtime'
import { repo } from './repo'
import { useUIStore } from '@/state/uiStore'

const calls: { method: string; args: unknown[] }[] = []
function chain(result: { data: unknown; error: unknown }) {
  const c: unknown = new Proxy(
    {},
    {
      get(_t, prop) {
        if (prop === 'then') {
          return (ok: (v: unknown) => unknown, ko?: (e: unknown) => unknown) =>
            Promise.resolve(result).then(ok, ko)
        }
        return (...args: unknown[]) => {
          calls.push({ method: String(prop), args })
          return c
        }
      },
    },
  )
  return c
}

const GENERAL = 'sub-general'
function row(id: string, task: { subcategory_id?: string; completed_at?: string | null } | null) {
  return {
    id,
    task_id: `t-${id}`,
    from_subcategory_id: GENERAL,
    to_subcategory_id: 'sub-taxes',
    new_list_name: null,
    new_list_category_id: null,
    reason: 'why',
    created_at: '2026-10-21T10:00:00Z',
    tasks: task && {
      title: `title ${id}`,
      subcategory_id: task.subcategory_id ?? GENERAL,
      completed_at: task.completed_at ?? null,
    },
  }
}

beforeEach(() => {
  vi.clearAllMocks()
  calls.length = 0
})

describe('repo.routing.pending', () => {
  it('reads pending rows joined to their task', async () => {
    fromMock.mockReturnValueOnce(chain({ data: [row('a', {})], error: null }))
    const out = await repo.routing.pending()
    expect(fromMock).toHaveBeenCalledWith('routing_proposals')
    expect(calls.find((c) => c.method === 'eq')?.args).toEqual(['status', 'pending'])
    expect(String(calls.find((c) => c.method === 'select')?.args[0])).toContain('tasks!inner(')
    expect(out).toEqual([
      {
        id: 'a',
        taskId: 't-a',
        title: 'title a',
        fromSubcategoryId: GENERAL,
        toSubcategoryId: 'sub-taxes',
        newListName: null,
        newListCategoryId: null,
        reason: 'why',
        createdAt: '2026-10-21T10:00:00Z',
      },
    ])
  })

  it('hides proposals whose task left General, was completed or is gone (D8)', async () => {
    fromMock.mockReturnValueOnce(
      chain({
        data: [
          row('keep', {}),
          row('moved', { subcategory_id: 'sub-elsewhere' }),
          row('done', { completed_at: '2026-10-21T11:00:00Z' }),
          row('gone', null),
        ],
        error: null,
      }),
    )
    const out = await repo.routing.pending()
    expect(out.map((p) => p.id)).toEqual(['keep'])
  })

  it('throws on a read error', async () => {
    fromMock.mockReturnValueOnce(chain({ data: null, error: { message: 'x', status: 500 } }))
    await expect(repo.routing.pending()).rejects.toThrow()
  })
})

describe('repo.routing.apply', () => {
  it('calls apply_routing once with the payload and returns its counts', async () => {
    const payload = { new_lists: [], items: [{ proposal_id: 'a', to: null }] }
    rpcMock.mockResolvedValueOnce({
      data: { moved: 0, kept: 1, stale: 0, created_lists: 0 },
      error: null,
    })
    const out = await repo.routing.apply(payload)
    expect(rpcMock).toHaveBeenCalledTimes(1)
    expect(rpcMock).toHaveBeenCalledWith('apply_routing', { p: payload })
    expect(out).toEqual({ moved: 0, kept: 1, stale: 0, created_lists: 0 })
  })

  it('throws when the RPC rejects (nothing applied)', async () => {
    rpcMock.mockResolvedValueOnce({ data: null, error: { message: 'not pending', code: '22023' } })
    await expect(repo.routing.apply({ new_lists: [], items: [] })).rejects.toThrow()
  })
})

describe('realtime — routing_proposals', () => {
  it('a change refreshes the dashboard (and so the chip count)', async () => {
    vi.useFakeTimers()
    bindings.clear()
    startRealtime('u-1')
    const handler = bindings.get('routing_proposals')
    expect(handler).toBeDefined()
    const before = useUIStore.getState().dashboardRefreshKey
    handler!({ eventType: 'INSERT', new: { id: 'x' }, old: {} })
    vi.advanceTimersByTime(250)
    expect(useUIStore.getState().dashboardRefreshKey).toBe(before + 1)
    stopRealtime()
    vi.useRealTimers()
  })
})
