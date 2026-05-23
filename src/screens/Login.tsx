import { useEffect, useState, type FormEvent } from 'react'
import { ArrowRight, Check } from 'lucide-react'
import { toast } from 'sonner'

import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { supabase } from '@/lib/supabase'

const RESEND_COOLDOWN_SECONDS = 30

function callbackUrl() {
  return window.location.origin + import.meta.env.BASE_URL + 'auth/callback'
}

export default function Login() {
  const [email, setEmail] = useState('')
  const [sent, setSent] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [cooldown, setCooldown] = useState(0)

  useEffect(() => {
    if (!cooldown) return
    const t = setTimeout(() => setCooldown((c) => c - 1), 1000)
    return () => clearTimeout(t)
  }, [cooldown])

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

  function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault()
    if (!email || submitting) return
    sendLink(email)
  }

  function onResend() {
    if (cooldown > 0 || submitting) return
    sendLink(email)
  }

  return (
    <main className="flex min-h-svh items-center justify-center bg-background px-6 py-12">
      <div className="w-full max-w-[380px]">
        <div className="mb-[60px] text-center">
          <div
            className="inline-flex items-baseline gap-[2px] text-[32px] font-semibold text-foreground"
            style={{ letterSpacing: '-0.04em' }}
          >
            <span>hupomnemata</span>
            <span style={{ color: 'var(--jewel-jade)' }}>.</span>
          </div>
          <div className="label mt-[14px] text-[9px]">
            Personal · quiet · yours
          </div>
        </div>

        {!sent ? (
          <form onSubmit={onSubmit} noValidate>
            <h1
              className="m-0 text-[22px] font-semibold"
              style={{ letterSpacing: '-0.01em' }}
            >
              Sign in
            </h1>
            <p className="mb-7 mt-2 text-[13px] leading-[1.6] text-muted-foreground">
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

            <p className="mt-[18px] text-center text-[11px] leading-[1.6] text-muted-foreground">
              By signing in you agree to keep tasks tasks, not work.
            </p>
          </form>
        ) : (
          <div role="status" aria-live="polite">
            <div
              className="mb-[18px] inline-flex size-11 items-center justify-center rounded-full"
              style={{
                background: 'var(--accent-soft)',
                color: 'hsl(var(--accent))',
              }}
            >
              <Check className="size-[22px]" />
            </div>
            <h1
              className="m-0 text-[22px] font-semibold"
              style={{ letterSpacing: '-0.01em' }}
            >
              Check your email
            </h1>
            <p className="mb-6 mt-2 text-[13px] leading-[1.6] text-muted-foreground">
              We sent a sign-in link to{' '}
              <strong className="text-foreground">{email}</strong>. It expires
              in 10 minutes.
            </p>

            <div className="flex flex-wrap items-center gap-3">
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
                    : 'Resend link'}
              </Button>
              <button
                type="button"
                onClick={() => {
                  setSent(false)
                  setCooldown(0)
                }}
                className="text-[13px] text-muted-foreground underline underline-offset-2 hover:text-foreground"
              >
                Use a different email
              </button>
            </div>
          </div>
        )}
      </div>
    </main>
  )
}
