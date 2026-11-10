import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { signInWithOtp, verifyOtp } = vi.hoisted(() => ({
  signInWithOtp: vi.fn(),
  verifyOtp: vi.fn(),
}))

vi.mock('@/lib/supabase', () => ({
  supabase: { auth: { signInWithOtp, verifyOtp } },
}))

import SignIn, { INVALID_CODE_MESSAGE } from './SignIn'

async function reachCodeStep(user: ReturnType<typeof userEvent.setup>) {
  await user.type(screen.getByLabelText('Email'), 'me@example.com')
  await user.click(screen.getByRole('button', { name: 'Send code' }))
  return screen.findByLabelText('6-digit code')
}

describe('menubar SignIn', () => {
  beforeEach(() => {
    signInWithOtp.mockReset().mockResolvedValue({ error: null })
    verifyOtp.mockReset().mockResolvedValue({ error: null })
  })

  it('requests a code with no redirect option', async () => {
    const user = userEvent.setup()
    render(<SignIn />)
    await reachCodeStep(user)
    expect(signInWithOtp).toHaveBeenCalledTimes(1)
    expect(signInWithOtp).toHaveBeenCalledWith({ email: 'me@example.com' })
    const arg = signInWithOtp.mock.calls[0][0] as Record<string, unknown>
    expect(arg).not.toHaveProperty('options')
  })

  it("verifies the code with type 'email'", async () => {
    const user = userEvent.setup()
    render(<SignIn />)
    const code = await reachCodeStep(user)
    await user.type(code, '123456')
    expect(verifyOtp).toHaveBeenCalledTimes(1)
    expect(verifyOtp).toHaveBeenCalledWith({
      email: 'me@example.com',
      token: '123456',
      type: 'email',
    })
  })

  it('keeps digits only and does not verify a short code', async () => {
    const user = userEvent.setup()
    render(<SignIn />)
    const code = await reachCodeStep(user)
    await user.type(code, '12a3')
    expect(code).toHaveValue('123')
    expect(verifyOtp).not.toHaveBeenCalled()
  })

  it('shows the message Login shows when the code is rejected', async () => {
    verifyOtp.mockResolvedValue({ error: { message: 'Token has expired' } })
    const user = userEvent.setup()
    render(<SignIn />)
    const code = await reachCodeStep(user)
    await user.type(code, '654321')
    expect(await screen.findByRole('alert')).toHaveTextContent(
      INVALID_CODE_MESSAGE,
    )
    expect(code).toHaveAttribute('aria-invalid', 'true')
    // The same literal as the PWA's Login screen — pinned to its source.
    const login = readFileSync(
      resolve(process.cwd(), 'src/screens/Login.tsx'),
      'utf8',
    )
    expect(login).toContain(`'${INVALID_CODE_MESSAGE}'`)
  })

  it('stays on the email step when the code cannot be sent', async () => {
    signInWithOtp.mockResolvedValue({ error: { message: 'rate limited' } })
    const user = userEvent.setup()
    render(<SignIn />)
    await user.type(screen.getByLabelText('Email'), 'me@example.com')
    await user.click(screen.getByRole('button', { name: 'Send code' }))
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Could not send the code',
    )
    expect(screen.queryByLabelText('6-digit code')).toBeNull()
  })
})
