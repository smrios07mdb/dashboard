// Login screen — magic link, "Check your email" success state.

function Login({ onSignIn, defaultEmail = 'sam@hupo.app' }) {
  const [email, setEmail] = React.useState(defaultEmail);
  const [sent, setSent] = React.useState(false);
  const [cooldown, setCooldown] = React.useState(0);

  React.useEffect(() => {
    if (!cooldown) return;
    const t = setTimeout(() => setCooldown(c => c - 1), 1000);
    return () => clearTimeout(t);
  }, [cooldown]);

  const send = () => { setSent(true); setCooldown(30); };

  return (
    <div className="screen" style={{
      minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center',
      background: 'var(--bg)', padding: 24,
    }}>
      <div style={{ width: '100%', maxWidth: 380 }}>

        {/* wordmark */}
        <div style={{ marginBottom: 60, textAlign: 'center' }}>
          <div className="display" style={{
            fontSize: 32, fontWeight: 600, letterSpacing: '-.04em',
            color: 'var(--ink)',
            display: 'inline-flex', alignItems: 'baseline', gap: 2,
          }}>
            <span>hupomnemata</span>
            <span style={{ color: 'var(--jewel-jade)', fontWeight: 600 }}>.</span>
          </div>
          <div className="label" style={{ marginTop: 14, fontSize: 9 }}>
            <span style={{ color: 'var(--ink-2)', letterSpacing: '.16em' }}>PERSONAL · QUIET · YOURS</span>
          </div>
        </div>

        {!sent ? (
          <React.Fragment>
            <h1 style={{ margin: 0, fontSize: 22, fontWeight: 600, letterSpacing: '-.01em' }}>Sign in</h1>
            <p style={{ marginTop: 8, marginBottom: 28, color: 'var(--ink-3)', fontSize: 13, lineHeight: 1.6 }}>
              Enter your email and we&rsquo;ll send a magic link. No password, no tracking.
            </p>
            <label className="label" style={{ display: 'block', marginBottom: 6 }}>Email</label>
            <Input value={email} onChange={(e) => setEmail(e.target.value)}
              placeholder="you@example.com" type="email"
              style={{ height: 42 }}/>
            <Button variant="primary" size="lg" onClick={send}
              style={{ width: '100%', marginTop: 14, height: 44 }}>
              Send magic link <IArrowR s={16}/>
            </Button>
            <p style={{ marginTop: 18, fontSize: 11, color: 'var(--ink-3)', lineHeight: 1.6, textAlign: 'center' }}>
              By signing in you agree to keep tasks tasks, not work. <br/>
              <button onClick={() => onSignIn && onSignIn(email)} style={{ marginTop: 6, fontSize: 11, color: 'var(--accent)', textDecoration: 'underline' }}>
                Skip → enter the prototype
              </button>
            </p>
          </React.Fragment>
        ) : (
          <React.Fragment>
            <div style={{
              width: 44, height: 44, borderRadius: '50%',
              background: 'var(--accent-soft)', color: 'var(--accent)',
              display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
              marginBottom: 18,
            }}><ICheck s={22}/></div>
            <h1 style={{ margin: 0, fontSize: 22, fontWeight: 600, letterSpacing: '-.01em' }}>Check your email</h1>
            <p style={{ marginTop: 8, marginBottom: 24, color: 'var(--ink-3)', fontSize: 13, lineHeight: 1.6 }}>
              We sent a sign-in link to <strong style={{ color: 'var(--ink)' }}>{email}</strong>.
              It expires in 10 minutes.
            </p>
            <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
              <Button onClick={send} disabled={cooldown > 0}
                style={cooldown > 0 ? { opacity: .5, cursor: 'not-allowed' } : undefined}>
                {cooldown > 0 ? `Resend in ${cooldown}s` : 'Resend link'}
              </Button>
              <button onClick={() => { setSent(false); setCooldown(0); }}
                style={{ color: 'var(--ink-3)', fontSize: 13, textDecoration: 'underline' }}>
                Use a different email
              </button>
            </div>
            <Button variant="primary" onClick={() => onSignIn && onSignIn(email)}
              style={{ marginTop: 28, width: '100%' }}>
              Continue to demo <IArrowR s={16}/>
            </Button>
          </React.Fragment>
        )}
      </div>
    </div>
  );
}

window.Login = Login;
