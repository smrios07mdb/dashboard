import {
  useEffect,
  useRef,
  useState,
  type ChangeEvent,
  type FormEvent,
} from 'react'
import { ArrowRight, Check } from 'lucide-react'
import { toast } from 'sonner'

import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { supabase } from '@/lib/supabase'

const RESEND_COOLDOWN_SECONDS = 30
const CODE_LENGTH = 6

function callbackUrl() {
  return window.location.origin + import.meta.env.BASE_URL + 'auth/callback'
}

export default function Login() {
  const [email, setEmail] = useState('')
  const [sent, setSent] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [cooldown, setCooldown] = useState(0)

  const [code, setCode] = useState('')
  const [verifying, setVerifying] = useState(false)
  const [codeError, setCodeError] = useState<string | null>(null)
  // Guards the auto-submit-on-6-digits path against re-firing if React batches
  // the state update before the network call resolves.
  const autoSubmittedFor = useRef<string | null>(null)
  const codeInputRef = useRef<HTMLInputElement | null>(null)

  useEffect(() => {
    if (!cooldown) return
    const t = setTimeout(() => setCooldown((c) => c - 1), 1000)
    return () => clearTimeout(t)
  }, [cooldown])

  useEffect(() => {
    if (sent) codeInputRef.current?.focus()
  }, [sent])

  async function sendLink(targetEmail: string) {
    setSubmitting(true)
    const { error } = await supabase.auth.signInWithOtp({
      email: targetEmail,
      options: { emailRedirectTo: callbackUrl() },
    })
    setSubmitting(false)
    if (error) {
      toast.error(error.message || 'Could not send magic link. Try again.')
      return false
    }
    setSent(true)
    setCooldown(RESEND_COOLDOWN_SECONDS)
    return true
  }

  async function verify(token: string) {
    if (verifying) return
    setVerifying(true)
    setCodeError(null)
    const { error } = await supabase.auth.verifyOtp({
      email,
      token,
      type: 'email',
    })
    setVerifying(false)
    if (error) {
      setCodeError(
        'Invalid or expired code. Check your email or request a new one.',
      )
      autoSubmittedFor.current = null
      return
    }
    // Success: the global auth listener (chunk 3) flips Protected over to
    // the dashboard. Nothing else to do here.
  }

  function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault()
    if (!email || submitting) return
    void sendLink(email)
  }

  function onResend() {
    if (cooldown > 0 || submitting) return
    void sendLink(email)
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

  function resetToEmail() {
    setSent(false)
    setCooldown(0)
    setCode('')
    setCodeError(null)
    autoSubmittedFor.current = null
  }

  return (
    <main className="flex min-h-svh items-center justify-center bg-background px-6 py-12">
      <div className="w-full max-w-[380px]">
        {/* Wordmark lockup — serif "hupomnemata" + emerald TEXT period.
            Decision A: login uses a text period (not the HupoMark glyph the
            header uses) because that's what 01-login.png renders at hero size. */}
        <div className="mb-8 text-center">
          <div className="inline-flex items-baseline gap-px font-display text-[38px] font-medium lowercase tracking-[-0.025em] text-ink">
            <span>hupomnemata</span>
            <span className="font-medium text-work">.</span>
          </div>
          <div className="label mt-[14px] text-[9px] tracking-[0.22em]">
            PERSONAL · QUIET · YOURS
          </div>
        </div>

        {/* Both states sit inside one --surface card. */}
        <div className="rounded-lg border border-line bg-surface px-[30px] pb-[26px] pt-[30px] shadow-md">
          {!sent ? (
            <form onSubmit={onSubmit} noValidate>
              <h1 className="m-0 font-display text-[27px] font-medium tracking-[-0.01em] text-ink">
                Sign in
              </h1>
              <p className="mb-7 mt-2 text-[13px] leading-[1.6] text-ink-3">
                Enter your email and we&rsquo;ll send a magic link. No password,
                no tracking.
              </p>

              <label htmlFor="login-email" className="label mb-1.5 block">
                Email
              </label>
              <Input
                id="login-email"
                type="email"
                autoComplete="email"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="you@example.com"
                className="h-[42px] bg-card"
              />

              <Button
                type="submit"
                size="lg"
                disabled={!email || submitting}
                className="mt-3.5 h-11 w-full text-[14px]"
              >
                {submitting ? 'Sending…' : (
                  <>
                    Send magic link <ArrowRight className="size-4" />
                  </>
                )}
              </Button>

              <p className="mt-[18px] text-center text-[11px] leading-[1.6] text-ink-3">
                By signing in you agree to keep tasks tasks, not work.
              </p>
            </form>
          ) : (
            <div role="status" aria-live="polite">
              <div className="mb-[18px] inline-flex size-11 items-center justify-center rounded-full bg-accent-soft text-accent">
                <Check className="size-[22px]" />
              </div>
              <h1 className="m-0 font-display text-[27px] font-medium tracking-[-0.01em] text-ink">
                Check your email
              </h1>
              <p className="mb-6 mt-2 text-[13px] leading-[1.6] text-ink-3">
                We sent a sign-in link and a 6-digit code to{' '}
                <strong className="text-ink">{email}</strong>. Tap the link or
                enter the code below. Expires in 10 minutes.
              </p>

              <form onSubmit={onVerifySubmit} noValidate>
                <label htmlFor="login-code" className="label mb-1.5 block">
                  6-digit code
                </label>
                <Input
                  ref={codeInputRef}
                  id="login-code"
                  type="text"
                  inputMode="numeric"
                  autoComplete="one-time-code"
                  pattern="\d{6}"
                  maxLength={CODE_LENGTH}
                  value={code}
                  onChange={onCodeChange}
                  placeholder="123456"
                  aria-invalid={codeError ? true : undefined}
                  aria-describedby={codeError ? 'login-code-error' : undefined}
                  className="h-[42px] bg-card font-mono tracking-[0.3em] text-[16px]"
                />
                {codeError ? (
                  <p
                    id="login-code-error"
                    role="alert"
                    className="mt-2 text-[12px] leading-[1.5] text-destructive"
                  >
                    {codeError}
                  </p>
                ) : null}

                <Button
                  type="submit"
                  size="lg"
                  disabled={code.length !== CODE_LENGTH || verifying}
                  className="mt-3.5 h-11 w-full text-[14px]"
                >
                  {verifying ? 'Verifying…' : 'Verify code'}
                </Button>
              </form>

              <div className="mt-5 flex flex-wrap items-center gap-3 border-t border-line pt-5">
                <Button
                  variant="outline"
                  onClick={onResend}
                  disabled={cooldown > 0 || submitting}
                  className="h-11"
                >
                  {cooldown > 0
                    ? `Resend in ${cooldown}s`
                    : submitting
                      ? 'Sending…'
                      : 'Resend email'}
                </Button>
                <button
                  type="button"
                  onClick={resetToEmail}
                  className="text-[13px] text-ink-3 underline underline-offset-2 hover:text-ink"
                >
                  Use a different email
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </main>
  )
}
