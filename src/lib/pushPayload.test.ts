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
