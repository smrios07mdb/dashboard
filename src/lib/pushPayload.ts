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

// Fixed origin used only to resolve/validate relative click-through URLs when
// no real registration scope is supplied (i.e. in unit tests). Production
// passes the worker's `self.registration.scope`, so the real origin is used
// there — this default never reaches a live navigation.
const DEFAULT_ORIGIN = 'https://localhost'

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
 * stashed on the Notification.
 *
 * Hardening (CLI-01 / SRV-04): the `url` came from a push payload, so it is
 * treated as untrusted. We accept it only when it resolves to a SAME-ORIGIN
 * path UNDER the app's `BASE_PATH` (`/dashboard/`); anything else — an absolute
 * cross-origin URL, a protocol-relative `//host`, a `javascript:` URI, or a
 * `..` traversal that escapes the base — falls back to the app root. This makes
 * a forged/cross-origin click-through inert before it reaches the worker's
 * `client.navigate` / `clients.openWindow`.
 *
 * `base` is injected (this module is deliberately global-free): production
 * passes `self.registration.scope` (the absolute registration URL, so the real
 * deployed origin is enforced); tests pass an explicit base.
 */
export function notificationTargetUrl(
  notificationData: unknown,
  base: string = `${DEFAULT_ORIGIN}${BASE_PATH}`,
): string {
  const data = notificationData as { url?: unknown } | null | undefined
  const url = data && asString(data.url)
  if (!url) return BASE_PATH
  try {
    const baseUrl = new URL(base)
    const resolved = new URL(url, baseUrl)
    if (
      resolved.origin === baseUrl.origin &&
      resolved.pathname.startsWith(BASE_PATH)
    ) {
      // Return the same-origin path (not the absolute href) so existing call
      // sites and tests keep their `/dashboard/...` expectations.
      return resolved.pathname + resolved.search + resolved.hash
    }
  } catch {
    // Malformed base or url — fall through to the safe default.
  }
  return BASE_PATH
}
