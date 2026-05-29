/*
 * Web Push subscription management (ARCHITECTURE.md §9).
 *
 * `urlBase64ToUint8Array` is the only pure, unit-tested piece — it converts
 * the base64url VAPID public key into the `applicationServerKey` byte array
 * the PushManager wants. The subscribe / unsubscribe flows touch a live
 * ServiceWorkerRegistration + PushManager + the Notification permission
 * prompt, so they're exercised by the on-device runbook in
 * docs/notifications.md rather than mocked here.
 *
 * The push_subscriptions repo (add / removeByEndpoint) already exists from the
 * data layer; this module just feeds it the browser's subscription.
 */
import { repo } from '@/db/repo'
import { supabase } from '@/lib/supabase'

const VAPID_PUBLIC_KEY = import.meta.env.VITE_VAPID_PUBLIC_KEY as
  | string
  | undefined

/**
 * Decode a base64url string (the VAPID public key) into the `Uint8Array`
 * that `pushManager.subscribe({ applicationServerKey })` requires. Not a
 * browser built-in. Restores the URL-safe alphabet and the stripped `=`
 * padding before `atob`.
 */
export function urlBase64ToUint8Array(base64String: string): Uint8Array<ArrayBuffer> {
  const padding = '='.repeat((4 - (base64String.length % 4)) % 4)
  const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/')
  const rawData = atob(base64)
  const outputArray = new Uint8Array(rawData.length)
  for (let i = 0; i < rawData.length; i++) {
    outputArray[i] = rawData.charCodeAt(i)
  }
  return outputArray
}

/** Current Notification permission, or `'denied'` where the API is absent. */
export function getPermission(): NotificationPermission {
  if (typeof Notification === 'undefined') return 'denied'
  return Notification.permission
}

/** Whether this environment can subscribe to Web Push at all. */
export function isPushSupported(): boolean {
  return (
    typeof window !== 'undefined' &&
    'serviceWorker' in navigator &&
    'PushManager' in window &&
    typeof Notification !== 'undefined'
  )
}

/** Whether the active service worker registration holds a push subscription. */
export async function isSubscribed(): Promise<boolean> {
  if (!isPushSupported()) return false
  const reg = await navigator.serviceWorker.ready
  return (await reg.pushManager.getSubscription()) !== null
}

/**
 * Prompt for permission, subscribe via the service worker's PushManager, and
 * persist the subscription to `push_subscriptions`. Throws a user-facing
 * Error on any blocker (unsupported, denied, signed-out, missing VAPID key).
 * Idempotent: re-running while already subscribed reuses the existing
 * subscription and swallows the unique-constraint conflict on re-insert.
 */
export async function requestPermissionAndSubscribe(): Promise<void> {
  if (!isPushSupported()) {
    throw new Error('Notifications are not supported on this device.')
  }
  if (!VAPID_PUBLIC_KEY) {
    throw new Error('Notifications are not configured (missing VAPID key).')
  }

  const permission = await Notification.requestPermission()
  if (permission !== 'granted') {
    throw new Error('Notification permission was not granted.')
  }

  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) {
    throw new Error('You must be signed in to enable notifications.')
  }

  const reg = await navigator.serviceWorker.ready
  const existing = await reg.pushManager.getSubscription()
  const subscription =
    existing ??
    (await reg.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: urlBase64ToUint8Array(VAPID_PUBLIC_KEY),
    }))

  const json = subscription.toJSON()
  try {
    await repo.pushSubscriptions.add({
      userId: user.id,
      endpoint: subscription.endpoint,
      p256dh: json.keys?.p256dh ?? '',
      auth: json.keys?.auth ?? '',
    })
  } catch (e) {
    // unique(user_id, endpoint) violation => already subscribed on this
    // device. Treat as success; any other error propagates.
    const code = (e as { code?: string }).code
    const status = (e as { status?: number }).status
    if (code !== '23505' && status !== 409) throw e
  }
}

/**
 * Unsubscribe this device's PushManager subscription and delete its row from
 * `push_subscriptions`. No-op if there's nothing to unsubscribe.
 */
export async function unsubscribe(): Promise<void> {
  if (!isPushSupported()) return
  const reg = await navigator.serviceWorker.ready
  const subscription = await reg.pushManager.getSubscription()
  if (!subscription) return

  const { endpoint } = subscription
  try {
    await subscription.unsubscribe()
  } catch {
    // Browser-side unsubscribe failing shouldn't block removing the row —
    // a stale endpoint will be pruned server-side on the next 410 anyway.
  }
  await repo.pushSubscriptions.removeByEndpoint(endpoint)
}
