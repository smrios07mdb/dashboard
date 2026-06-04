import { beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, useLocation } from 'react-router-dom'

import SyncIndicator from './SyncIndicator'
import { useSyncStore } from '@/db/syncStore'
import { useUIStore } from '@/state/uiStore'

/*
 * Chunk 24: SyncIndicator now renders the SyncBadge primitive as its trigger.
 * Verifies the wiring is intact — badge-per-state, the popover (last sync +
 * Force resync → refresh-key bump), the sync_issues click-through to Settings,
 * and the polite live region. Drives the real zustand stores via setState.
 */

// Radix Popover (popper + pointer dismissal) needs these jsdom shims.
beforeAll(() => {
  Element.prototype.hasPointerCapture ??= () => false
  Element.prototype.releasePointerCapture ??= () => {}
  Element.prototype.scrollIntoView ??= () => {}
  if (typeof globalThis.ResizeObserver === 'undefined') {
    globalThis.ResizeObserver = class {
      observe() {}
      unobserve() {}
      disconnect() {}
    } as unknown as typeof ResizeObserver
  }
})

function LocationProbe() {
  const { pathname } = useLocation()
  return <div data-testid="pathname">{pathname}</div>
}

function renderIndicator(path = '/') {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <SyncIndicator />
      <LocationProbe />
    </MemoryRouter>,
  )
}

describe('SyncIndicator — SyncBadge trigger + preserved behavior (Chunk 24)', () => {
  beforeEach(() => {
    useSyncStore.setState({
      state: 'synced',
      lastSyncAt: '2026-06-04T12:00:00.000Z',
    })
  })

  it('renders the SyncBadge for the current state', () => {
    renderIndicator()
    expect(
      screen.getByRole('button', { name: /sync status: synced/i }),
    ).toBeInTheDocument()
  })

  it('reflects the offline state on the badge', () => {
    useSyncStore.setState({ state: 'offline', lastSyncAt: null })
    renderIndicator()
    expect(
      screen.getByRole('button', { name: /sync status: offline/i }),
    ).toBeInTheDocument()
  })

  it('announces the state in a polite live region', () => {
    const { container } = renderIndicator()
    const live = container.querySelector('[aria-live="polite"]')
    expect(live).toHaveTextContent('Synced')
  })

  it('opens a popover (last sync + Force resync) and Force resync bumps the refresh key', async () => {
    const user = userEvent.setup()
    const before = useUIStore.getState().dashboardRefreshKey
    renderIndicator()
    await user.click(
      screen.getByRole('button', { name: /sync status: synced/i }),
    )
    expect(await screen.findByText('Last sync')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: /force resync/i }))
    expect(useUIStore.getState().dashboardRefreshKey).toBe(before + 1)
  })

  it('sync_issues clicks through to /settings with no popover', async () => {
    const user = userEvent.setup()
    useSyncStore.setState({ state: 'sync_issues', lastSyncAt: null })
    renderIndicator()
    await user.click(
      screen.getByRole('button', { name: /sync status: sync issues/i }),
    )
    expect(screen.getByTestId('pathname')).toHaveTextContent('/settings')
    expect(screen.queryByText('Last sync')).not.toBeInTheDocument()
  })
})
