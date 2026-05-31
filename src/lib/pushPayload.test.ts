import { describe, expect, it } from 'vitest'

import { notificationTargetUrl, parsePushPayload } from './pushPayload'

/*
 * `pushPayload` is the one piece of the Web Push path that is pure and so
 * worth unit-testing: it normalizes the server payload into the args for
 * `showNotification`, and resolves the click-through URL. The service
 * worker (src/sw.ts) imports these so the handlers stay thin; the SW
 * registration + delivery themselves are operator-verified on-device.
 */
describe('parsePushPayload', () => {
  it('maps a full payload to a title + notification options', () => {
    const { title, options } = parsePushPayload({
      title: 'Reminder',
      body: 'Buy milk',
      taskId: 't1',
      url: '/dashboard/subcategory/s1',
    })
    expect(title).toBe('Reminder')
    expect(options.body).toBe('Buy milk')
    expect(options.icon).toBe('/dashboard/icons/icon-192.png')
    expect((options.data as { url: string }).url).toBe(
      '/dashboard/subcategory/s1',
    )
    expect((options.data as { taskId?: string }).taskId).toBe('t1')
  })

  it('defaults the title to "Reminder" when missing or blank', () => {
    expect(parsePushPayload({ body: 'x' }).title).toBe('Reminder')
    expect(parsePushPayload({ title: '   ' }).title).toBe('Reminder')
  })

  it('defaults the click-through url to the app base when missing', () => {
    const { options } = parsePushPayload({ title: 'R' })
    expect((options.data as { url: string }).url).toBe('/dashboard/')
  })

  it('tolerates a non-object payload without throwing', () => {
    expect(parsePushPayload(null).title).toBe('Reminder')
    expect(parsePushPayload(undefined).title).toBe('Reminder')
    expect(parsePushPayload('garbage').title).toBe('Reminder')
    expect(
      (parsePushPayload(null).options.data as { url: string }).url,
    ).toBe('/dashboard/')
  })
})

describe('notificationTargetUrl', () => {
  it('returns the url embedded in the notification data', () => {
    expect(notificationTargetUrl({ url: '/dashboard/subcategory/s1' })).toBe(
      '/dashboard/subcategory/s1',
    )
  })

  it('falls back to the app base for missing or invalid data', () => {
    expect(notificationTargetUrl(null)).toBe('/dashboard/')
    expect(notificationTargetUrl({})).toBe('/dashboard/')
    expect(notificationTargetUrl({ url: 123 })).toBe('/dashboard/')
  })
})

describe('notificationTargetUrl — same-origin / BASE_PATH guard (CLI-01)', () => {
  // The SW passes its real `self.registration.scope` as the base; tests inject
  // an explicit absolute base so the guard is origin-independent and the
  // assertions don't depend on the test runner's location.
  const base = 'https://app.example/dashboard/'

  it('falls back to BASE_PATH for an absolute external URL', () => {
    expect(notificationTargetUrl({ url: 'https://evil.example/x' }, base)).toBe(
      '/dashboard/',
    )
  })

  it('falls back to BASE_PATH for a path-traversal escaping the base', () => {
    // new URL normalizes '/dashboard/../evil' to '/evil' — no longer under
    // BASE_PATH, so it must not pass through.
    expect(notificationTargetUrl({ url: '/dashboard/../evil' }, base)).toBe(
      '/dashboard/',
    )
  })

  it('falls back to BASE_PATH for a protocol-relative URL', () => {
    expect(notificationTargetUrl({ url: '//evil.com/x' }, base)).toBe(
      '/dashboard/',
    )
  })

  it('falls back to BASE_PATH for a javascript: URI', () => {
    // new URL('javascript:…') has an opaque ('null') origin, so the
    // origin-equality check rejects it before it can reach navigate().
    expect(notificationTargetUrl({ url: 'javascript:alert(1)' }, base)).toBe(
      '/dashboard/',
    )
  })

  it('passes through a valid same-origin path under BASE_PATH', () => {
    expect(
      notificationTargetUrl({ url: '/dashboard/subcategory/s1' }, base),
    ).toBe('/dashboard/subcategory/s1')
  })
})
