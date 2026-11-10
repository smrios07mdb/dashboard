/*
 * Menu bar sign-in (chunk 91, D4): email → 6-digit code. The same two calls
 * `src/screens/Login.tsx` makes, minus the magic-link redirect — there is no
 * route to land on and no deep link. A successful verify needs nothing more
 * here: `useSession` in App flips to the Today list.
 */
import { useEffect, useRef, useState, type ChangeEvent, type FormEvent } from 'react'

import { supabase } from '@/lib/supabase'

const CODE_LENGTH = 6

/** The message Login shows for a rejected code (pinned by SignIn.test). */
export const INVALID_CODE_MESSAGE =
  'Invalid or expired code. Check your email or request a new one.'

export default function SignIn() {
  const [email, setEmail] = useState('')
  const [sent, setSent] = useState(false)
  const [sending, setSending] = useState(false)
  const [sendError, setSendError] = useState<string | null>(null)
  const [code, setCode] = useState('')
  const [verifying, setVerifying] = useState(false)
  const [codeError, setCodeError] = useState<string | null>(null)
  // Guards the auto-submit at six digits against firing twice (Login's guard).
  const autoSubmittedFor = useRef<string | null>(null)
  const codeRef = useRef<HTMLInputElement | null>(null)

  useEffect(() => {
    if (sent) codeRef.current?.focus()
  }, [sent])

  async function send(e: FormEvent<HTMLFormElement>) {
    e.preventDefault()
    const target = email.trim()
    if (!target || sending) return
    setSending(true)
    setSendError(null)
    const { error } = await supabase.auth.signInWithOtp({ email: target })
    setSending(false)
    if (error) {
      setSendError('Could not send the code — retry')
      return
    }
    setSent(true)
  }

  async function verify(token: string) {
    if (verifying) return
    setVerifying(true)
    setCodeError(null)
    const { error } = await supabase.auth.verifyOtp({
      email: email.trim(),
      token,
      type: 'email',
    })
    setVerifying(false)
    if (error) {
      setCodeError(INVALID_CODE_MESSAGE)
      autoSubmittedFor.current = null
    }
  }

  function onCodeChange(e: ChangeEvent<HTMLInputElement>) {
    const next = e.target.value.replace(/\D/g, '').slice(0, CODE_LENGTH)
    setCode(next)
    if (codeError) setCodeError(null)
    if (
      next.length === CODE_LENGTH &&
      autoSubmittedFor.current !== next &&
      !verifying
    ) {
      autoSubmittedFor.current = next
      void verify(next)
    }
  }

  function onVerifySubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault()
    if (code.length !== CODE_LENGTH || verifying) return
    autoSubmittedFor.current = code
    void verify(code)
  }

  function reset() {
    setSent(false)
    setCode('')
    setCodeError(null)
    autoSubmittedFor.current = null
  }

  if (!sent) {
    return (
      <form className="mb-sec mb-form" onSubmit={send} noValidate>
        <h1 className="mb-h">Sign in</h1>
        <p className="mb-p">We&rsquo;ll email you a 6-digit code.</p>
        <label className="mb-label" htmlFor="mb-email">
          Email
        </label>
        <input
          id="mb-email"
          className="mb-input"
          type="email"
          autoComplete="email"
          autoFocus
          required
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          placeholder="you@example.com"
          aria-invalid={sendError ? true : undefined}
          aria-describedby={sendError ? 'mb-email-error' : undefined}
        />
        {sendError ? (
          <p id="mb-email-error" role="alert" className="mb-error">
            {sendError}
          </p>
        ) : null}
        <button
          type="submit"
          className="mb-btn"
          disabled={!email.trim() || sending}
        >
          {sending ? 'Sending…' : 'Send code'}
        </button>
      </form>
    )
  }

  return (
    <form className="mb-sec mb-form" onSubmit={onVerifySubmit} noValidate>
      <h1 className="mb-h">Check your email</h1>
      <p className="mb-p">
        Enter the 6-digit code sent to <strong>{email.trim()}</strong>.
      </p>
      <label className="mb-label" htmlFor="mb-code">
        6-digit code
      </label>
      <input
        ref={codeRef}
        id="mb-code"
        className="mb-input mb-code"
        type="text"
        inputMode="numeric"
        autoComplete="one-time-code"
        pattern="\d{6}"
        maxLength={CODE_LENGTH}
        value={code}
        onChange={onCodeChange}
        placeholder="123456"
        aria-invalid={codeError ? true : undefined}
        aria-describedby={codeError ? 'mb-code-error' : undefined}
      />
      {codeError ? (
        <p id="mb-code-error" role="alert" className="mb-error">
          {codeError}
        </p>
      ) : null}
      <button
        type="submit"
        className="mb-btn"
        disabled={code.length !== CODE_LENGTH || verifying}
      >
        {verifying ? 'Verifying…' : 'Verify code'}
      </button>
      <button type="button" className="mb-link" onClick={reset}>
        Use a different email
      </button>
    </form>
  )
}
