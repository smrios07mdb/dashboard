/*
 * In-app reminder fallback (ARCHITECTURE.md §9).
 *
 * While a tab is open, poll for due reminders and surface them locally. Each
 * tick CLAIMS rows via the `claim_due_reminders()` RPC — a conditional UPDATE
 * that flips `notified` false -> true and returns only the rows it won. That
 * is the same race-safe claim the Edge Function uses, so the two channels are
 * mutually exclusive: exactly one of them ever notifies a given reminder. The
 * fallback must NEVER degrade to read-then-notify, or it would double-fire
 * against the server sweep.
 *
 * `createReminderPoller` is the pure, unit-tested scheduler; `notifyReminder`
 * and `createDefaultReminderPoller` wire it to the live RPC + UI and are
 * operator-verified.
 */
import { toast } from 'sonner'

import { repo } from '@/db/repo'

/** A reminder the server let us claim — id + title is all we surface. */
export type ClaimedReminder = { id: string; title: string }

export type ReminderPollerDeps = {
  claim: () => Promise<ClaimedReminder[]>
  notify: (reminder: ClaimedReminder) => void
  /** Defaults to 60s (ARCH §9). */
  intervalMs?: number
}

export type ReminderPoller = {
  start: () => void
  stop: () => void
}

const DEFAULT_INTERVAL_MS = 60_000

/**
 * A self-guarding interval poller. Guarantees:
 *  - one `claim` per tick, and never two ticks overlapping (a slow claim
 *    suppresses the next interval's tick until it settles);
 *  - `start()` is idempotent — a second call while running is a no-op;
 *  - a rejected `claim` is swallowed so the loop keeps running (next tick
 *    retries; the server-side claim keeps exactly-once intact across misses);
 *  - `stop()` cleanly cancels.
 * It fires one tick immediately on `start()` so a reminder that came due while
 * the tab was closed is caught at once rather than up to a minute later.
 */
export function createReminderPoller(deps: ReminderPollerDeps): ReminderPoller {
  const intervalMs = deps.intervalMs ?? DEFAULT_INTERVAL_MS
  let timer: ReturnType<typeof setInterval> | null = null
  let ticking = false

  async function tick(): Promise<void> {
    if (ticking) return
    ticking = true
    try {
      const claimed = await deps.claim()
      for (const reminder of claimed) deps.notify(reminder)
    } catch {
      // best-effort; see the guarantees above.
    } finally {
      ticking = false
    }
  }

  return {
    start() {
      if (timer !== null) return
      timer = setInterval(() => void tick(), intervalMs)
      void tick()
    },
    stop() {
      if (timer !== null) {
        clearInterval(timer)
        timer = null
      }
    },
  }
}

/**
 * Default notifier for a claimed reminder: an OS Notification when permission
 * is already granted (tab-foreground path), plus an in-app toast so it's seen
 * even without notification permission.
 */
export function notifyReminder(reminder: ClaimedReminder): void {
  try {
    if (
      typeof Notification !== 'undefined' &&
      Notification.permission === 'granted'
    ) {
      new Notification('Reminder', { body: reminder.title })
    }
  } catch {
    // Some contexts disallow the Notification constructor; the toast still
    // surfaces the reminder.
  }
  toast(`Reminder: ${reminder.title}`)
}

/** Poller wired to the live claim RPC + default notifier. */
export function createDefaultReminderPoller(): ReminderPoller {
  return createReminderPoller({
    claim: () => repo.tasks.claimDueReminders(),
    notify: notifyReminder,
  })
}
