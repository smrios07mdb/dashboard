import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, useLocation } from 'react-router-dom'

const { session } = vi.hoisted(() => ({
  session: { email: 'sm@example.com' as string | undefined },
}))

vi.mock('@/lib/auth', () => ({
  useSession: () => ({
    user: session.email === undefined ? null : { email: session.email },
  }),
}))

vi.mock('@/lib/supabase', () => ({
  supabase: { auth: { signOut: vi.fn() } },
}))

import AccountMenu from './AccountMenu'

/*
 * Chunk 68 (UX audit #2): below `sm` the trigger is a round initial, the full
 * email comes back at >=sm. jsdom applies no breakpoints, so both spans are in
 * the DOM and these assert the structure; real widths are the smoke's job.
 */

// Radix DropdownMenu (popper + pointer dismissal) needs these jsdom shims.
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

function renderMenu(email?: string) {
  session.email = email
  return render(
    <MemoryRouter>
      <AccountMenu />
      <LocationProbe />
    </MemoryRouter>,
  )
}

describe('AccountMenu — phone-width trigger (chunk 68)', () => {
  beforeEach(() => {
    session.email = 'sm@example.com'
  })

  it('names the trigger "Account: <email>" and keeps the email as its title', () => {
    renderMenu('sm@example.com')
    const trigger = screen.getByRole('button', {
      name: 'Account: sm@example.com',
    })
    expect(trigger).toHaveAttribute('aria-label', 'Account: sm@example.com')
    expect(trigger).toHaveAttribute('title', 'sm@example.com')
  })

  it('holds a phone-only initial and a >=sm email inside the one trigger', () => {
    renderMenu('sm@example.com')
    const trigger = screen.getByRole('button', {
      name: 'Account: sm@example.com',
    })

    const initial = screen.getByText('S')
    expect(trigger).toContainElement(initial)
    expect(initial).toHaveClass('sm:hidden')

    const email = screen.getByText('sm@example.com')
    expect(trigger).toContainElement(email)
    const wide = email.closest('.hidden')
    expect(wide).not.toBeNull()
    expect(wide).toHaveClass('sm:inline-flex')
    expect(trigger).toContainElement(wide as HTMLElement)
    // No chevron beside the initial: it lives in the >=sm group only.
    expect(wide!.querySelector('svg')).not.toBeNull()
    expect(initial.querySelector('svg')).toBeNull()
    expect(trigger.querySelectorAll('svg')).toHaveLength(1)

    expect(trigger).toHaveClass('size-11', 'rounded-full', 'sm:min-h-11')
  })

  it('takes the initial from the first letter or digit, else "?"', () => {
    const first = renderMenu('_42x@y.z')
    expect(
      screen
        .getByRole('button', { name: 'Account: _42x@y.z' })
        .querySelector('.sm\\:hidden'),
    ).toHaveTextContent(/^4$/)
    first.unmount()

    renderMenu('@@')
    expect(
      screen
        .getByRole('button', { name: 'Account: @@' })
        .querySelector('.sm\\:hidden'),
    ).toHaveTextContent(/^\?$/)
  })

  it('renders nothing without an email', () => {
    renderMenu(undefined)
    expect(screen.queryByRole('button')).toBeNull()
    expect(screen.queryByText('S')).toBeNull()
  })

  it('still opens to "Signed in as", the email and "Sign out"', async () => {
    const user = userEvent.setup()
    renderMenu('sm@example.com')
    await user.click(
      screen.getByRole('button', { name: 'Account: sm@example.com' }),
    )

    const menu = await screen.findByRole('menu')
    expect(menu).toHaveTextContent('Signed in as')
    expect(menu).toHaveTextContent('sm@example.com')
    expect(
      screen.getByRole('menuitem', { name: 'Sign out' }),
    ).toBeInTheDocument()
  })

  // Chunk 79: Settings left the tab bar; the account menu is its home.
  it('lists Settings between the email and "Sign out", and it opens /settings', async () => {
    const user = userEvent.setup()
    renderMenu('sm@example.com')
    await user.click(
      screen.getByRole('button', { name: 'Account: sm@example.com' }),
    )

    const menu = await screen.findByRole('menu')
    const items = Array.from(
      menu.querySelectorAll('[role="menuitem"]'),
    ).map((el) => el.textContent?.trim())
    expect(items).toEqual(['sm@example.com', 'Settings', 'Sign out'])
    const settings = screen.getByRole('menuitem', { name: 'Settings' })
    expect(settings.querySelector('svg')).toHaveClass('lucide-settings')

    await user.click(settings)
    expect(screen.getByTestId('pathname')).toHaveTextContent('/settings')
  })
})
