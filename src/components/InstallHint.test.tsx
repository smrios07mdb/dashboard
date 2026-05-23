import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import InstallHint from './InstallHint'

const IPHONE_UA =
  'Mozilla/5.0 (iPhone; CPU iPhone OS 17_4 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4 Mobile/15E148 Safari/604.1'
const MAC_UA =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4 Safari/605.1.15'

type EnvOptions = {
  userAgent?: string
  navigatorStandalone?: boolean
  displayModeStandalone?: boolean
  dismissed?: boolean
}

function setupEnv({
  userAgent = IPHONE_UA,
  navigatorStandalone = false,
  displayModeStandalone = false,
  dismissed = false,
}: EnvOptions = {}) {
  Object.defineProperty(window.navigator, 'userAgent', {
    value: userAgent,
    configurable: true,
  })
  Object.defineProperty(window.navigator, 'standalone', {
    value: navigatorStandalone,
    configurable: true,
  })
  window.matchMedia = vi.fn().mockImplementation((query: string) => ({
    matches:
      query === '(display-mode: standalone)' ? displayModeStandalone : false,
    media: query,
    onchange: null,
    addListener: vi.fn(),
    removeListener: vi.fn(),
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    dispatchEvent: vi.fn(),
  })) as unknown as typeof window.matchMedia
  localStorage.clear()
  if (dismissed) localStorage.setItem('install-hint-dismissed', '1')
}

describe('InstallHint', () => {
  beforeEach(() => {
    setupEnv()
  })

  afterEach(() => {
    localStorage.clear()
  })

  it('renders the banner on iOS Safari when not standalone and not dismissed', () => {
    render(<InstallHint />)
    expect(screen.getByText(/Add to Home Screen/i)).toBeInTheDocument()
  })

  it('does not render on non-iOS user agents', () => {
    setupEnv({ userAgent: MAC_UA })
    render(<InstallHint />)
    expect(screen.queryByText(/Add to Home Screen/i)).not.toBeInTheDocument()
  })

  it('does not render when navigator.standalone is true', () => {
    setupEnv({ navigatorStandalone: true })
    render(<InstallHint />)
    expect(screen.queryByText(/Add to Home Screen/i)).not.toBeInTheDocument()
  })

  it('does not render when display-mode media query matches standalone', () => {
    setupEnv({ displayModeStandalone: true })
    render(<InstallHint />)
    expect(screen.queryByText(/Add to Home Screen/i)).not.toBeInTheDocument()
  })

  it('does not render when previously dismissed', () => {
    setupEnv({ dismissed: true })
    render(<InstallHint />)
    expect(screen.queryByText(/Add to Home Screen/i)).not.toBeInTheDocument()
  })

  it('dismisses and persists the dismissal to localStorage', async () => {
    const user = userEvent.setup()
    render(<InstallHint />)
    expect(screen.getByText(/Add to Home Screen/i)).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: /dismiss/i }))
    expect(screen.queryByText(/Add to Home Screen/i)).not.toBeInTheDocument()
    expect(localStorage.getItem('install-hint-dismissed')).toBe('1')
  })
})
