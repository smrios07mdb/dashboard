import { afterEach, describe, expect, it, vi } from 'vitest'

import { __clockOverride, today } from './clock'

const TZ = 'America/New_York'

describe('clock — __clockOverride', () => {
  afterEach(() => {
    // Reset between tests so override state never leaks. The override
    // is module-level — vitest doesn't reset it for us.
    __clockOverride?.clear()
  })

  it('is defined in the test/DEV context', () => {
    // Vitest sets `import.meta.env.DEV === true`, so the ternary in
    // `clock.ts` resolves to the override object. The "undefined in
    // prod" half of the contract is covered by the build-time grep on
    // dist/ — see the Revisions chunk-10 acceptance criteria.
    expect(__clockOverride).toBeDefined()
  })

  it('set(dateKey) pins today() to that dateKey regardless of timezone arg', () => {
    __clockOverride!.set('1999-06-01')
    expect(today(TZ)).toBe('1999-06-01')
    expect(today('Pacific/Kiritimati')).toBe('1999-06-01')
    expect(today('Asia/Tokyo')).toBe('1999-06-01')
  })

  it('clear() reverts today() to the live timezone-based value', () => {
    __clockOverride!.set('1999-06-01')
    expect(today(TZ)).toBe('1999-06-01')
    __clockOverride!.clear()
    const live = today(TZ)
    expect(live).toMatch(/^\d{4}-\d{2}-\d{2}$/)
    // Encoding "real today" here would make the test go red on a
    // matching wall-clock; we only assert the override is gone.
    expect(live).not.toBe('1999-06-01')
  })

  it('get() reflects the current override value', () => {
    expect(__clockOverride!.get()).toBe(null)
    __clockOverride!.set('1999-06-02')
    expect(__clockOverride!.get()).toBe('1999-06-02')
    __clockOverride!.clear()
    expect(__clockOverride!.get()).toBe(null)
  })

  it('set() throws on anything that is not YYYY-MM-DD', () => {
    expect(() => __clockOverride!.set('not-a-date')).toThrow(/YYYY-MM-DD/)
    expect(() => __clockOverride!.set('06-01')).toThrow(/YYYY-MM-DD/)
    expect(() => __clockOverride!.set('2026-6-1')).toThrow(/YYYY-MM-DD/)
    expect(() => __clockOverride!.set('2026/06/01')).toThrow(/YYYY-MM-DD/)
    expect(() => __clockOverride!.set('')).toThrow(/YYYY-MM-DD/)
  })

  it('today() ignores override when it is null (cleared)', () => {
    // Belt-and-suspenders: confirm the `&& __override` guard short-
    // circuits when the override is null even though DEV is true.
    expect(__clockOverride!.get()).toBe(null)
    const live = today(TZ)
    expect(live).toMatch(/^\d{4}-\d{2}-\d{2}$/)
  })

  it('set() writes to sessionStorage; clear() removes it', () => {
    __clockOverride!.set('1999-06-04')
    expect(sessionStorage.getItem('__clockOverride')).toBe('1999-06-04')
    __clockOverride!.clear()
    expect(sessionStorage.getItem('__clockOverride')).toBe(null)
  })

  it('a fresh module load (simulated reload) picks up the stored override', async () => {
    // The smoke-pass harness uses this exact flow: set → reload → use.
    // Simulate the reload by writing the storage value, dropping the
    // module cache, and re-importing.
    sessionStorage.setItem('__clockOverride', '1999-06-05')
    vi.resetModules()
    const fresh = await import('./clock')
    expect(fresh.today(TZ)).toBe('1999-06-05')
    expect(fresh.__clockOverride!.get()).toBe('1999-06-05')
    // Cleanup goes through the fresh module so its in-memory variable
    // is also reset, not just sessionStorage.
    fresh.__clockOverride!.clear()
  })

  it('a fresh module load with malformed sessionStorage value ignores it', async () => {
    sessionStorage.setItem('__clockOverride', 'garbage')
    vi.resetModules()
    const fresh = await import('./clock')
    expect(fresh.__clockOverride!.get()).toBe(null)
    expect(fresh.today(TZ)).toMatch(/^\d{4}-\d{2}-\d{2}$/)
    expect(fresh.today(TZ)).not.toBe('garbage')
  })
})
