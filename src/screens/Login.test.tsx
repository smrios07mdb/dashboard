import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { signInWithOtp, verifyOtp } = vi.hoisted(() => ({
  signInWithOtp: vi.fn(),
  verifyOtp: vi.fn(),
}))

vi.mock('@/lib/supabase', () => ({
  supabase: {
    auth: {
      signInWithOtp,
      verifyOtp,
    },
  },
}))

import Login from './Login'

describe('Login', () => {
  beforeEach(() => {
    signInWithOtp.mockReset()
    verifyOtp.mockReset()
  })

  it('renders the magic-link form by default', () => {
    render(<Login />)
    expect(
      screen.getByRole('heading', { level: 1, name: /sign in/i }),
    ).toBeInTheDocument()
    expect(
      screen.getByRole('button', { name: /send magic link/i }),
    ).toBeInTheDocument()
  })

  it('sends a magic link and transitions to the code-input view', async () => {
    signInWithOtp.mockResolvedValue({ error: null, data: {} })
    const user = userEvent.setup()
    render(<Login />)

    await user.type(screen.getByLabelText(/email/i), 'foo@bar.com')
    await user.click(screen.getByRole('button', { name: /send magic link/i }))

    expect(signInWithOtp).toHaveBeenCalledWith(
      expect.objectContaining({ email: 'foo@bar.com' }),
    )
    expect(
      await screen.findByRole('heading', { level: 1, name: /check your email/i }),
    ).toBeInTheDocument()
    expect(screen.getByLabelText(/6-digit code/i)).toBeInTheDocument()
    expect(screen.getByText(/foo@bar\.com/)).toBeInTheDocument()
  })

  it('auto-submits verifyOtp when 6 digits are entered', async () => {
    signInWithOtp.mockResolvedValue({ error: null, data: {} })
    verifyOtp.mockResolvedValue({
      error: null,
      data: { session: null, user: null },
    })
    const user = userEvent.setup()
    render(<Login />)

    await user.type(screen.getByLabelText(/email/i), 'foo@bar.com')
    await user.click(screen.getByRole('button', { name: /send magic link/i }))
    const codeInput = await screen.findByLabelText(/6-digit code/i)
    await user.type(codeInput, '123456')

    await waitFor(() => {
      expect(verifyOtp).toHaveBeenCalledWith({
        email: 'foo@bar.com',
        token: '123456',
        type: 'email',
      })
    })
  })

  it('strips non-digit characters from the code input', async () => {
    signInWithOtp.mockResolvedValue({ error: null, data: {} })
    verifyOtp.mockResolvedValue({
      error: null,
      data: { session: null, user: null },
    })
    const user = userEvent.setup()
    render(<Login />)

    await user.type(screen.getByLabelText(/email/i), 'foo@bar.com')
    await user.click(screen.getByRole('button', { name: /send magic link/i }))
    const codeInput = (await screen.findByLabelText(
      /6-digit code/i,
    )) as HTMLInputElement
    await user.type(codeInput, '1a2b3c4d5e6f')

    expect(codeInput.value).toBe('123456')
  })

  it('verifies via the Verify button when clicked', async () => {
    signInWithOtp.mockResolvedValue({ error: null, data: {} })
    verifyOtp.mockResolvedValue({
      error: null,
      data: { session: null, user: null },
    })
    const user = userEvent.setup()
    render(<Login />)

    await user.type(screen.getByLabelText(/email/i), 'foo@bar.com')
    await user.click(screen.getByRole('button', { name: /send magic link/i }))
    const codeInput = await screen.findByLabelText(/6-digit code/i)
    // Type only 5 digits — no auto-submit
    await user.type(codeInput, '12345')
    expect(verifyOtp).not.toHaveBeenCalled()
    // Type the 6th digit; auto-submit fires once
    await user.type(codeInput, '6')
    await waitFor(() => {
      expect(verifyOtp).toHaveBeenCalledTimes(1)
    })
  })

  it('shows an inline error when verifyOtp fails', async () => {
    signInWithOtp.mockResolvedValue({ error: null, data: {} })
    verifyOtp.mockResolvedValue({
      error: { name: 'AuthApiError', message: 'Token expired', status: 400 },
      data: { session: null, user: null },
    })
    const user = userEvent.setup()
    render(<Login />)

    await user.type(screen.getByLabelText(/email/i), 'foo@bar.com')
    await user.click(screen.getByRole('button', { name: /send magic link/i }))
    const codeInput = await screen.findByLabelText(/6-digit code/i)
    await user.type(codeInput, '000000')

    expect(
      await screen.findByText(/invalid or expired code/i),
    ).toBeInTheDocument()
  })

  it('"Use a different email" resets back to the magic-link form', async () => {
    signInWithOtp.mockResolvedValue({ error: null, data: {} })
    const user = userEvent.setup()
    render(<Login />)

    await user.type(screen.getByLabelText(/email/i), 'foo@bar.com')
    await user.click(screen.getByRole('button', { name: /send magic link/i }))
    await screen.findByLabelText(/6-digit code/i)

    await user.click(screen.getByRole('button', { name: /different email/i }))

    expect(
      screen.getByRole('heading', { level: 1, name: /sign in/i }),
    ).toBeInTheDocument()
    expect(screen.queryByLabelText(/6-digit code/i)).not.toBeInTheDocument()
  })
})
