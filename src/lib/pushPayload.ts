/*
 * Pure helpers shared by the service worker's `push` / `notificationclick`
 * handlers (src/sw.ts) and the unit tests. Kept free of DOM / worker globals
 * so it compiles under both the app (DOM) and worker (WebWorker) lib targets
 * and is importable by Vitest.
 *
 * The Edge Function (supabase/functions/notify-due-reminders) sends the
 * payload shape below; the in-app fallback builds its own Notification from
 * the claimed row and does NOT go through here.
 *
 * Everything is served under the `/dashboard/` base path (ARCHITECTURE.md §3),
 * so the icon, the default click-through URL, and any deep link carry that
 * prefix — otherwise the icon 404s and click-through misroutes.
 */

const BASE_PATH = '/dashboard/'
const ICON_PATH = '/dashboard/icons/icon-192.png'
const DEFAULT_TITLE = 'Reminder'

/** Wire shape of the JSON body the Edge Function pushes. */
export type PushPayload = {
  title?: string
  body?: string
  taskId?: string
  url?: string
}

/** Normalized arguments for `registration.showNotification(title, options)`. */
export type ParsedNotification = {
  title: string
  options: NotificationOptions
}

function asString(value: unknown): string | undefined {
  return typeof value === 'string' ? value : undefined
}

/**
 * Normalize an arbitrary push payload into a title + `NotificationOptions`.
 * Tolerates a non-object / malformed payload (a stray push with no data, a
 * non-JSON body) by falling back to sensible defaults rather than throwing in
 * the worker.
 */
export function parsePushPayload(raw: unknown): ParsedNotification {
  const data: PushPayload =
    raw && typeof raw === 'object' ? (raw as PushPayload) : {}

  const rawTitle = asString(data.title)?.trim()
  const title = rawTitle ? rawTitle : DEFAULT_TITLE
  const url = asString(data.url) || BASE_PATH

  const options: NotificationOptions = {
    body: asString(data.body),
    icon: ICON_PATH,
    data: { taskId: asString(data.taskId), url },
  }

  return { title, options }
}

/**
 * Resolve where a `notificationclick` should navigate, from the data we
 * stashed on the Notification. Falls back to the app root under the base path.
 */
export function notificationTargetUrl(notificationData: unknown): string {
  const data = notificationData as { url?: unknown } | null | undefined
  const url = data && asString(data.url)
  return url || BASE_PATH
}
