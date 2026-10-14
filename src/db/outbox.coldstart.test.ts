import { beforeEach, describe, expect, it, vi } from 'vitest'

/*
 * Chunk 85: an op queued at cold start, before the app-wide auth listener has
 * fired (or when it fires with no session: offline with an expired access
 * token), is stamped with the last-known user persisted at sign-in, so it
 * replays instead of being dropped as a no-user row.
 */

const { fromMock, isOnlineMock } = vi.hoisted(() => ({
  fromMock: vi.fn(),
  isOnlineMock: vi.fn(() => false),
}))

vi.mock('@/lib/supabase', () => ({ supabase: { from: fromMock } }))
vi.mock('@/lib/network', () => ({ isOnline: isOnlineMock }))

const LAST_UID_KEY = 'hup:lastUserId'

function okChain() {
  const c: object = new Proxy(
    {},
    {
      get(_t, prop) {
        if (prop === 'then') {
          return (ok: (v: unknown) => unknown) =>
            Promise.resolve({ data: null, error: null }).then(ok)
        }
        return () => c
      },
    },
  )
  return c
}

/** A fresh module graph: what a cold start sees before any auth event. */
async function coldStart() {
  vi.resetModules()
  const { db } = await import('./dexie')
  const repoMod = await import('./repo')
  const outbox = await import('./outbox')
  return { db, ...repoMod, ...outbox }
}

beforeEach(async () => {
  localStorage.clear()
  fromMock.mockReset()
  fromMock.mockImplementation(() => okChain())
  isOnlineMock.mockReturnValue(false)
  const { db } = await import('./dexie')
  await db.outbox.clear()
})

describe('outbox — cold-start stamp (chunk 85)', () => {
  it('(1) an op queued before the listener fires is stamped with the last-known user and replays', async () => {
    localStorage.setItem(LAST_UID_KEY, 'u-a')
    const { db, repo, drainOutbox } = await coldStart()

    await repo.tasks.delete('t-a')
    const rows = await db.outbox.toArray()
    expect(rows).toHaveLength(1)
    expect(rows[0].uid).toBe('u-a')

    isOnlineMock.mockReturnValue(true)
    const res = await drainOutbox()
    expect(fromMock).toHaveBeenCalledWith('tasks')
    expect(res).toEqual({ processed: 1, failed: 0, remaining: 0 })
    expect(await db.outbox.count()).toBe(0)
  })

  it('(2) setting the user persists it; clearing it removes it', async () => {
    const { setOutboxUser } = await coldStart()
    setOutboxUser('u-a')
    expect(localStorage.getItem(LAST_UID_KEY)).toBe('u-a')
    setOutboxUser(undefined)
    expect(localStorage.getItem(LAST_UID_KEY)).toBeNull()

    const again = await coldStart()
    expect(again.outboxUser()).toBeUndefined()
  })

  it('(3) with nothing persisted (never signed in) the stamp stays empty', async () => {
    const { outboxUser } = await coldStart()
    expect(outboxUser()).toBeUndefined()
  })
})
