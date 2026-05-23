import { useEffect, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'

import { supabase } from '@/lib/supabase'
import { useSession } from '@/lib/auth'

/**
 * Reads error details from either the query string (PKCE flow) or the
 * URL hash (implicit flow). Supabase puts the human-readable message in
 * `error_description`.
 */
function readUrlError(): string | null {
  const params = new URLSearchParams(window.location.search)
  const hashParams = new URLSearchParams(window.location.hash.replace(/^#/, ''))
  const desc =
    params.get('error_description') ?? hashParams.get('error_description')
  const code = params.get('error') ?? hashParams.get('error')
  if (desc) return desc
  if (code) return code
  return null
}

export default function AuthCallback() {
  const navigate = useNavigate()
  const { session, loading } = useSession()
  const [error, setError] = useState<string | null>(readUrlError())

  // detectSessionInUrl on the client does the exchange automatically.
  // Fall back to a manual exchange if a ?code= is present and we still
  // have no session after ~1.5s.
  useEffect(() => {
    if (error || session || loading) return
    const code = new URLSearchParams(window.location.search).get('code')
    if (!code) return
    const t = setTimeout(async () => {
      const { error: exchangeError } =
        await supabase.auth.exchangeCodeForSession(window.location.href)
      if (exchangeError) setError(exchangeError.message)
    }, 1500)
    return () => clearTimeout(t)
  }, [session, loading, error])

  // Once a session is present, leave the callback URL.
  useEffect(() => {
    if (session && !error) navigate('/', { replace: true })
  }, [session, error, navigate])

  return (
    <main className="flex min-h-svh items-center justify-center bg-background px-6 py-12">
      <div className="w-full max-w-[380px] text-center">
        {error ? (
          <>
            <h1
              className="m-0 text-[22px] font-semibold"
              style={{ letterSpacing: '-0.01em' }}
            >
              Sign-in didn&rsquo;t complete
            </h1>
            <p className="mb-6 mt-2 text-[13px] leading-[1.6] text-muted-foreground">
              {error}
            </p>
            <Link
              to="/"
              replace
              className="text-[13px] text-muted-foreground underline underline-offset-2 hover:text-foreground"
            >
              Back to login
            </Link>
          </>
        ) : (
          <>
            <div className="label mb-3">Signing you in</div>
            <p className="text-[13px] leading-[1.6] text-muted-foreground">
              One moment…
            </p>
          </>
        )}
      </div>
    </main>
  )
}
