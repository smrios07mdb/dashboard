import { act, render, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const { categoriesList, subcategoriesList, tasksList } = vi.hoisted(() => ({
  categoriesList: vi.fn(),
  subcategoriesList: vi.fn(),
  tasksList: vi.fn(),
}))

vi.mock('@/db/repo', () => ({
  repo: {
    categories: { list: categoriesList },
    subcategories: { list: subcategoriesList },
    tasks: { list: tasksList },
  },
}))

import Dashboard from './Dashboard'
import { useSyncStore } from '@/db/syncStore'
import { useUIStore } from '@/state/uiStore'

function renderDashboard() {
  return render(
    <MemoryRouter>
      <Dashboard />
    </MemoryRouter>,
  )
}

describe('Dashboard', () => {
  beforeEach(() => {
    categoriesList.mockReset()
    subcategoriesList.mockReset()
    tasksList.mockReset()
    // Reset stores between tests so refresh-key counts don't bleed across cases.
    useSyncStore.setState({ state: 'synced', lastSyncAt: null })
    useUIStore.setState({ dashboardRefreshKey: 0 })
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('does not refetch when lastSyncAt ticks', async () => {
    categoriesList.mockResolvedValue([])
    subcategoriesList.mockResolvedValue([])
    tasksList.mockResolvedValue([])

    renderDashboard()

    // Wait for the initial mount + load to settle (loading -> rendered).
    await waitFor(() => {
      expect(categoriesList).toHaveBeenCalledTimes(1)
      expect(subcategoriesList).toHaveBeenCalledTimes(1)
      expect(tasksList).toHaveBeenCalledTimes(1)
    })

    // Tick lastSyncAt three times the way the repo's markSyncedNow would.
    for (let i = 0; i < 3; i++) {
      await act(async () => {
        useSyncStore.setState({ lastSyncAt: new Date().toISOString() })
        // Microtask flush so any (incorrect) effect re-run could have fired.
        await Promise.resolve()
      })
    }

    // Regression: pre-fix the effect dep was lastSyncAt and each tick
    // re-ran the load. Post-fix the dep is dashboardRefreshKey and
    // lastSyncAt ticks must not retrigger the reads.
    expect(categoriesList).toHaveBeenCalledTimes(1)
    expect(subcategoriesList).toHaveBeenCalledTimes(1)
    expect(tasksList).toHaveBeenCalledTimes(1)
  })

  it('renders chevrons on every category and subcategory header', async () => {
    const workId = 'cat-work'
    const personalId = 'cat-personal'
    categoriesList.mockResolvedValue([
      {
        id: workId,
        name: 'Work',
        userId: 'u1',
      },
      {
        id: personalId,
        name: 'Personal',
        userId: 'u1',
      },
    ])
    subcategoriesList.mockResolvedValue([
      {
        id: 'sw1',
        name: 'Inbox',
        categoryId: workId,
        sortOrder: 0,
        userId: 'u1',
        archivedAt: null,
      },
      {
        id: 'sw2',
        name: 'Projects',
        categoryId: workId,
        sortOrder: 1,
        userId: 'u1',
        archivedAt: null,
      },
      {
        id: 'sw3',
        name: 'Admin',
        categoryId: workId,
        sortOrder: 2,
        userId: 'u1',
        archivedAt: null,
      },
      {
        id: 'sp1',
        name: 'Errands',
        categoryId: personalId,
        sortOrder: 0,
        userId: 'u1',
        archivedAt: null,
      },
      {
        id: 'sp2',
        name: 'Health',
        categoryId: personalId,
        sortOrder: 1,
        userId: 'u1',
        archivedAt: null,
      },
      {
        id: 'sp3',
        name: 'Home',
        categoryId: personalId,
        sortOrder: 2,
        userId: 'u1',
        archivedAt: null,
      },
    ])
    tasksList.mockResolvedValue([])

    const { container } = renderDashboard()

    // Wait until the load has settled and the columns have rendered.
    await waitFor(() => {
      expect(container.textContent).toContain('Work')
      expect(container.textContent).toContain('Personal')
      expect(container.textContent).toContain('Inbox')
    })

    const chevronCount = (container.textContent?.match(/›/g) ?? []).length
    // 2 category headers + 6 subcategory headers = 8 chevrons minimum.
    expect(chevronCount).toBeGreaterThanOrEqual(8)
  })
})
