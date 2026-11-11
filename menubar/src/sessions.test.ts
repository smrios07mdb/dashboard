import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import {
  createSessionSync,
  toSessionRow,
  type LedgerEntry,
  type SessionRow,
} from './sessions'

/*
 * Chunk 98 (D14) — the web view's drain: read the shell's ledger, write each
 * entry, acknowledge what was written.
 */

const USER = '11111111-2222-4333-8444-555555555555'
const T0 = 1_800_000_000_000

function entry(seq: number, over: Partial<LedgerEntry> = {}): LedgerEntry {
  return {
    seq,
    kind: 'focus',
    startedAt: T0 + seq * 3_600_000,
    endedAt: T0 + seq * 3_600_000 + 1_500_000,
    plannedMs: 1_500_000,
    activeMs: 1_500_000,
    outcome: 'completed',
    taskId: null,
    taskTitle: null,
    ...over,
  }
}

const clientError = () => Object.assign(new Error('check'), { status: 400 })
const isClientError = (e: unknown) => {
  const status = (e as { status?: number } | null)?.status
  return typeof status === 'number' && status >= 400 && status < 500
}

/** A ledger the fake shell holds, with the calls made on it. */
function harness(ledger: LedgerEntry[]) {
  const acks: number[][] = []
  const written: SessionRow[] = []
  const deps = {
    pending: vi.fn(async () => [...ledger]),
    ack: vi.fn(async (seqs: number[]) => {
      acks.push(seqs)
      for (const s of seqs) {
        const i = ledger.findIndex((e) => e.seq === s)
        if (i >= 0) ledger.splice(i, 1)
      }
    }),
    clear: vi.fn(async () => {
      ledger.length = 0
    }),
    write: vi.fn(async (row: SessionRow) => {
      written.push(row)
    }),
    isClientError,
    userId: USER,
  }
  return { deps, acks, written, ledger, sync: createSessionSync(deps) }
}

beforeEach(() => {
  vi.spyOn(console, 'error').mockImplementation(() => {})
})
afterEach(() => {
  vi.restoreAllMocks()
  vi.useRealTimers()
})

describe('toSessionRow', () => {
  it('builds the row: ISO times, planned rounded, active rounded down', async () => {
    const row = await toSessionRow(
      {
        seq: 4,
        kind: 'focus',
        startedAt: T0,
        endedAt: T0 + 95_700,
        plannedMs: 119_600,
        activeMs: 75_999,
        outcome: 'skipped',
        taskId: 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee',
        taskTitle: 'Write the report',
      },
      USER,
    )
    expect(row).toEqual({
      // The id is `sessionId(user, kind, startedAt)` — its golden value.
      id: 'b57c0a63-a227-83f2-9f8a-49a164405cab',
      userId: USER,
      kind: 'focus',
      startedAt: '2027-01-15T08:00:00.000Z',
      endedAt: '2027-01-15T08:01:35.700Z',
      plannedSeconds: 120,
      activeSeconds: 75,
      outcome: 'skipped',
      taskId: 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee',
      taskTitle: 'Write the report',
    })
    expect(row).not.toHaveProperty('seq')
  })

  it('a breathing session has no task and its own id', async () => {
    const row = await toSessionRow(
      entry(1, { kind: 'meditation', outcome: 'ended', startedAt: T0 }),
      USER,
    )
    expect(row).toMatchObject({
      id: 'e6cbfa59-d1da-800d-ba77-8d4960d8aadc',
      kind: 'meditation',
      taskId: null,
      taskTitle: null,
    })
  })
})

describe('createSessionSync — drain', () => {
  it('writes every entry, then acknowledges them in one call', async () => {
    const h = harness([entry(1), entry(2), entry(3)])
    await h.sync.drain()
    expect(h.written).toHaveLength(3)
    expect(h.written.map((r) => r.userId)).toEqual([USER, USER, USER])
    expect(new Set(h.written.map((r) => r.id)).size).toBe(3)
    // Batched: one ack for the drain, after the last write.
    expect(h.acks).toEqual([[1, 2, 3]])
    expect(h.deps.ack.mock.invocationCallOrder[0]).toBeGreaterThan(
      h.deps.write.mock.invocationCallOrder[2],
    )
    expect(h.ledger).toEqual([])
  })

  it('an empty ledger writes and acknowledges nothing', async () => {
    const h = harness([])
    await h.sync.drain()
    expect(h.deps.write).not.toHaveBeenCalled()
    expect(h.deps.ack).not.toHaveBeenCalled()
  })

  it('outside Tauri (no ledger) it does nothing', async () => {
    const h = harness([])
    h.deps.pending.mockResolvedValueOnce(null as never)
    await h.sync.drain()
    expect(h.deps.write).not.toHaveBeenCalled()
  })

  it('a write that was queued in the outbox resolves, so it is acknowledged', async () => {
    // `repo.trackedSessions.save` resolves with the optimistic row offline.
    const h = harness([entry(1)])
    h.deps.write.mockImplementationOnce(async (row: SessionRow) => {
      h.written.push(row)
      return { ...row, createdAt: 'queued' } as never
    })
    await h.sync.drain()
    expect(h.acks).toEqual([[1]])
  })

  it('a 4xx is acknowledged anyway and the rest go on', async () => {
    const h = harness([entry(1), entry(2), entry(3)])
    h.deps.write.mockImplementationOnce(async () => {
      throw clientError()
    })
    await h.sync.drain()
    expect(h.deps.write).toHaveBeenCalledTimes(3)
    expect(h.written).toHaveLength(2)
    expect(h.acks).toEqual([[1, 2, 3]])
    expect(console.error).toHaveBeenCalled()
  })

  it('anything else thrown stops the drain; what was written is acknowledged', async () => {
    const h = harness([entry(1), entry(2), entry(3)])
    h.deps.write
      .mockImplementationOnce(async (row: SessionRow) => {
        h.written.push(row)
      })
      .mockImplementationOnce(async () => {
        throw new TypeError('Failed to fetch')
      })
    await h.sync.drain()
    // The third is not tried; the second stays in the ledger.
    expect(h.deps.write).toHaveBeenCalledTimes(2)
    expect(h.acks).toEqual([[1]])
    expect(h.ledger.map((e) => e.seq)).toEqual([2, 3])

    // The next trigger retries from there.
    await h.sync.drain()
    expect(h.acks).toEqual([[1], [2, 3]])
    expect(h.ledger).toEqual([])
  })

  it('a first write that throws acknowledges nothing', async () => {
    const h = harness([entry(1)])
    h.deps.write.mockRejectedValueOnce(new Error('boom'))
    await h.sync.drain()
    expect(h.deps.ack).not.toHaveBeenCalled()
    expect(h.ledger).toHaveLength(1)
  })

  it('a ledger that cannot be read, or an ack that fails, never rejects', async () => {
    const h = harness([entry(1)])
    h.deps.pending.mockRejectedValueOnce(new Error('no shell'))
    await expect(h.sync.drain()).resolves.toBeUndefined()
    expect(h.deps.write).not.toHaveBeenCalled()

    h.deps.ack.mockRejectedValueOnce(new Error('lost'))
    await expect(h.sync.drain()).resolves.toBeUndefined()
    // Still in the ledger: the next drain writes it again, onto the same row.
    expect(h.ledger).toHaveLength(1)
    await h.sync.drain()
    expect(h.written.map((r) => r.id)).toEqual([h.written[0].id, h.written[0].id])
    expect(h.ledger).toEqual([])
  })

  it('a drain asked for while one runs runs once more after it, not at the same time', async () => {
    const h = harness([entry(1)])
    let release: () => void = () => {}
    let inFlight = 0
    let most = 0
    h.deps.write.mockImplementation(async (row: SessionRow) => {
      inFlight += 1
      most = Math.max(most, inFlight)
      if (h.written.length === 0) {
        await new Promise<void>((resolve) => {
          release = resolve
        })
      }
      h.written.push(row)
      inFlight -= 1
    })

    const first = h.sync.drain()
    await vi.waitFor(() => expect(h.deps.write).toHaveBeenCalledTimes(1))
    // A session ends while the first drain is still writing; three triggers
    // arrive for it.
    h.ledger.push(entry(2))
    const second = h.sync.drain()
    void h.sync.drain()
    void h.sync.drain()
    expect(h.deps.pending).toHaveBeenCalledTimes(1)
    release()
    await Promise.all([first, second])

    // Exactly one more pass, which found the new entry.
    expect(h.deps.pending).toHaveBeenCalledTimes(2)
    expect(most).toBe(1)
    expect(h.acks).toEqual([[1], [2]])
    expect(h.ledger).toEqual([])

    // Idle again: a later drain is a new run.
    await h.sync.drain()
    expect(h.deps.pending).toHaveBeenCalledTimes(3)
  })

  it('clear empties the shell ledger', async () => {
    const h = harness([entry(1)])
    await h.sync.clear()
    expect(h.deps.clear).toHaveBeenCalledTimes(1)
  })
})

describe('createSessionSync — drainWithin', () => {
  it('resolves as soon as the drain is done', async () => {
    const h = harness([entry(1)])
    await h.sync.drainWithin(3000)
    expect(h.acks).toEqual([[1]])
  })

  it('gives up after the time allowed', async () => {
    vi.useFakeTimers()
    const h = harness([entry(1)])
    h.deps.write.mockImplementation(() => new Promise<void>(() => {}))
    let done = false
    void h.sync.drainWithin(3000).then(() => {
      done = true
    })
    await vi.advanceTimersByTimeAsync(2999)
    expect(done).toBe(false)
    await vi.advanceTimersByTimeAsync(1)
    expect(done).toBe(true)
    expect(h.deps.ack).not.toHaveBeenCalled()
  })
})
