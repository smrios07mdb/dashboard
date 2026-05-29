import { useEffect } from 'react'

import { useSession } from '@/lib/auth'
import { createDefaultReminderPoller } from '@/lib/inAppReminders'

/**
 * Headless. Starts the in-app reminder poller once a user is authed and stops
 * it on sign-out / unmount. Mounted at the app root beside RealtimeBridge, and
 * gated on the session the same way (chunk 3 auth -> chunk 14 fallback).
 *
 * The poller claims due reminders via the race-safe `claim_due_reminders()`
 * RPC and surfaces only the rows it wins (Notification + toast) — the tab-open
 * fallback for when Web Push isn't installed/permitted (ARCHITECTURE.md §9).
 * Because the claim is mutually exclusive with the Edge Function's claim, this
 * never double-fires against the server sweep.
 */
export default function InAppReminders() {
  const { user } = useSession()
  const userId = user?.id ?? null

  useEffect(() => {
    if (!userId) return
    const poller = createDefaultReminderPoller()
    poller.start()
    return () => poller.stop()
  }, [userId])

  return null
}
