import { describe, expect, it } from 'vitest'

import { useUIStore } from './uiStore'

describe('uiStore refresh keys (chunk 37 revisions R2)', () => {
  it('forceBusyRefresh bumps only busyRefreshKey; forceDashboardRefresh only dashboardRefreshKey', () => {
    const before = useUIStore.getState()
    useUIStore.getState().forceBusyRefresh()
    let after = useUIStore.getState()
    expect(after.busyRefreshKey).toBe(before.busyRefreshKey + 1)
    expect(after.dashboardRefreshKey).toBe(before.dashboardRefreshKey)
    expect(after.availableMinutes).toBe(before.availableMinutes)

    useUIStore.getState().forceDashboardRefresh()
    after = useUIStore.getState()
    expect(after.dashboardRefreshKey).toBe(before.dashboardRefreshKey + 1)
    expect(after.busyRefreshKey).toBe(before.busyRefreshKey + 1)
  })
})
