/*
 * Saved sessions (chunk 98): the web view's half of "Rust records, the web
 * view writes".
 *
 * The shell keeps every finished focus phase and breathing session in a
 * ledger (`sessions.rs`) until this side says it is written. A drain reads
 * the ledger, writes each entry through the app's own repo — online, or into
 * the outbox when offline — and acknowledges what was written, so the shell
 * can forget it. The row id is derived from the session itself
 * (`sessionId`), so an entry written twice (a lost ack, two drains) lands on
 * one row.
 *
 * Pure core: the shell and the writer are injected. No timer, no storage.
 */
import type { TrackedSession } from '@/db/types'
import { sessionId } from '@/lib/trackedSessions'

/** One ledger entry, as `sessions_pending` answers it. Times are epoch ms. */
export type LedgerEntry = {
  seq: number
  kind: 'focus' | 'meditation'
  startedAt: number
  endedAt: number
  plannedMs: number
  activeMs: number
  outcome: 'completed' | 'skipped' | 'stopped' | 'ended'
  taskId: string | null
  taskTitle: string | null
}

/** What `repo.trackedSessions.save` takes. */
export type SessionRow = Omit<TrackedSession, 'createdAt'>

export type SessionSyncDeps = {
  /** The shell's ledger, oldest first; `null` outside Tauri. */
  pending: () => Promise<LedgerEntry[] | null>
  ack: (seqs: number[]) => Promise<unknown>
  clear: () => Promise<unknown>
  /** Resolves when the row is on the server or queued in the outbox. */
  write: (row: SessionRow) => Promise<unknown>
  /** A 4xx: the server refused the row itself, a retry cannot help. */
  isClientError: (e: unknown) => boolean
  userId: string
}

/** The row for one entry. Active time rounds down, so it never exceeds the span. */
export async function toSessionRow(
  entry: LedgerEntry,
  userId: string,
): Promise<SessionRow> {
  return {
    id: await sessionId(userId, entry.kind, entry.startedAt),
    userId,
    kind: entry.kind,
    startedAt: new Date(entry.startedAt).toISOString(),
    endedAt: new Date(entry.endedAt).toISOString(),
    plannedSeconds: Math.round(entry.plannedMs / 1000),
    activeSeconds: Math.floor(entry.activeMs / 1000),
    outcome: entry.outcome,
    taskId: entry.taskId,
    taskTitle: entry.taskTitle,
  }
}

export type SessionSync = ReturnType<typeof createSessionSync>

export function createSessionSync(deps: SessionSyncDeps) {
  let running: Promise<void> | null = null
  let again = false

  async function once(): Promise<void> {
    let entries: LedgerEntry[]
    try {
      entries = (await deps.pending()) ?? []
    } catch (e) {
      console.error('menubar: sessions not read', e)
      return
    }
    const written: number[] = []
    for (const entry of entries) {
      let row: SessionRow
      try {
        row = await toSessionRow(entry, deps.userId)
      } catch (e) {
        // An entry no row can be built from must not block the rest.
        console.error('menubar: session entry dropped', e)
        written.push(entry.seq)
        continue
      }
      try {
        await deps.write(row)
        written.push(entry.seq)
      } catch (e) {
        if (deps.isClientError(e)) {
          // Refused by the server as it stands: acknowledged anyway, so a
          // malformed entry does not hold up every one after it.
          console.error('menubar: session refused, dropped', e)
          written.push(entry.seq)
          continue
        }
        // Anything else: stop here; the next trigger tries again.
        console.error('menubar: session not saved', e)
        break
      }
    }
    if (written.length === 0) return
    try {
      await deps.ack(written)
    } catch (e) {
      // Still in the ledger: the next drain writes them again, onto the
      // same rows.
      console.error('menubar: sessions not acknowledged', e)
    }
  }

  /**
   * Write what the ledger holds. At most one drain runs at a time; a drain
   * asked for while one runs runs once more after it. Never rejects.
   */
  function drain(): Promise<void> {
    if (running) {
      again = true
      return running
    }
    running = (async () => {
      do {
        again = false
        await once()
      } while (again)
    })().finally(() => {
      running = null
    })
    return running
  }

  return {
    drain,
    /** A drain, given up on after `ms` — for Quit and Sign out. */
    drainWithin(ms: number): Promise<void> {
      return new Promise<void>((resolve) => {
        const timer = setTimeout(resolve, ms)
        void drain().finally(() => {
          clearTimeout(timer)
          resolve()
        })
      })
    },
    /** Signed out: the next account never receives this one's entries. */
    clear: () => deps.clear(),
  }
}
