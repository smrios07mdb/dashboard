import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

const { settingsGetMock, settingsUpdateMock } = vi.hoisted(() => ({
  settingsGetMock: vi.fn(),
  settingsUpdateMock: vi.fn(),
}))

vi.mock('@/db/repo', () => ({
  repo: { settings: { get: settingsGetMock, update: settingsUpdateMock } },
}))

vi.mock('@/lib/auth', () => ({
  useSession: () => ({ user: { id: 'u1' }, session: null, loading: false }),
}))

// The Developer section is lazy-loaded behind a dev gate; stub it so the
// test doesn't pull in sample-data machinery.
vi.mock('@/components/DeveloperSection', () => ({ default: () => null }))

import Settings from './Settings'

describe('Settings — AI key', () => {
  beforeEach(() => {
    settingsGetMock.mockResolvedValue({
      userId: 'u1',
      aiApiKey: 'sk-ant-existing',
      caldavAppleId: null,
      caldavCalendarUrl: null,
      caldavStatus: 'unconfigured',
      timezone: 'America/New_York',
      lastDailyReset: null,
    })
    settingsUpdateMock.mockImplementation(async (_id, changes) => ({
      userId: 'u1',
      aiApiKey: null,
      caldavAppleId: null,
      caldavCalendarUrl: null,
      caldavStatus: 'unconfigured',
      timezone: 'America/New_York',
      lastDailyReset: null,
      ...changes,
    }))
  })
  afterEach(() => vi.clearAllMocks())

  it('loads the existing key into the field', async () => {
    render(<Settings />)
    await waitFor(() =>
      expect(
        (screen.getByLabelText(/anthropic api key/i) as HTMLInputElement).value,
      ).toBe('sk-ant-existing'),
    )
  })

  it('saves a new key via repo.settings.update', async () => {
    const user = userEvent.setup()
    render(<Settings />)
    const input = await screen.findByLabelText(/anthropic api key/i)
    await waitFor(() =>
      expect((input as HTMLInputElement).value).toBe('sk-ant-existing'),
    )
    await user.clear(input)
    await user.type(input, 'sk-ant-new')
    await user.click(screen.getByRole('button', { name: /save key/i }))
    await waitFor(() =>
      expect(settingsUpdateMock).toHaveBeenCalledWith('u1', {
        aiApiKey: 'sk-ant-new',
      }),
    )
  })

  it('stores null (not an empty string) when the key is cleared', async () => {
    const user = userEvent.setup()
    render(<Settings />)
    const input = await screen.findByLabelText(/anthropic api key/i)
    await waitFor(() =>
      expect((input as HTMLInputElement).value).toBe('sk-ant-existing'),
    )
    await user.clear(input)
    await user.click(screen.getByRole('button', { name: /save key/i }))
    await waitFor(() =>
      expect(settingsUpdateMock).toHaveBeenCalledWith('u1', { aiApiKey: null }),
    )
  })

  it('reveals the key when the show toggle is pressed', async () => {
    const user = userEvent.setup()
    render(<Settings />)
    const input = await screen.findByLabelText(/anthropic api key/i)
    expect(input).toHaveAttribute('type', 'password')
    // Specific to the AI-key toggle — the Calendar section (chunk 13) adds its
    // own "Show password" toggle, so a bare /show/ query would now be ambiguous.
    await user.click(screen.getByRole('button', { name: /show api key/i }))
    expect(input).toHaveAttribute('type', 'text')
  })
})
