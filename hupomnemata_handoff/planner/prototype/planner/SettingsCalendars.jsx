// Screen 4 — Settings › Calendars. Extends the existing settings-row pattern.
// Apple row restyled only; Outlook (work) ICS feed row is new.
// Props: apple ('connected'|'reconnect'), stale (bool), onToast.

function SettingsCalendars({ apple, stale, onToast }) {
  const [url, setUrl] = React.useState('https://outlook.office365.com/owa/calendar/…/calendar.ics');
  const [vstate, setVstate] = React.useState('ok'); // idle | testing | ok
  const verify = () => {
    setVstate('testing');
    setTimeout(() => { setVstate('ok'); onToast && onToast('Feed verified — 14 busy events this week.'); }, 900);
  };
  return (
    <div data-screen-label="Settings — Calendars" style={{ maxWidth: 780, margin: '0 auto' }}>
      <header style={{ marginBottom: 28 }}>
        <h1 className="display" style={{ margin: 0, fontSize: 32, fontWeight: 500, letterSpacing: '-.02em' }}>Settings</h1>
        <span className="label">s.rios@mdb.com</span>
      </header>

      <PSettingsSection kicker="02" title="Calendars">
        <PSettingsRow title="Apple Calendar" hint="CalDAV via the serverless proxy. Busy times feed the Week Planner." align="center">
          <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
            {apple === 'connected'
              ? <Pill tone="accent">✓ Connected · verified 2m ago</Pill>
              : <Pill tone="danger">Reconnect needed</Pill>}
            {apple === 'connected'
              ? <span style={{ fontSize: 12, color: 'var(--ink-3)' }}>Personal · <span className="num mono">3</span> calendars</span>
              : <React.Fragment>
                  <span style={{ fontSize: 12, color: 'var(--ink-3)' }}>Busy times paused since <span className="num mono">May 5</span>.</span>
                  <Button size="sm" icon={<ILink s={13}/>}>Reconnect</Button>
                </React.Fragment>}
          </div>
        </PSettingsRow>

        <PSettingsRow title="Outlook (work)" hint="Read-only busy overlay on the Week Planner. Nothing is written back.">
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
              <Input value={url} onChange={(e) => setUrl(e.target.value)}
                placeholder="Paste a published ICS calendar link"
                inputStyle={{ fontFamily: 'var(--font-mono)', fontSize: 12 }}
                style={{ flex: 1, minWidth: 280 }}/>
              <Button onClick={verify} disabled={vstate === 'testing'} icon={<ILink s={14}/>}>
                {vstate === 'testing' ? 'Verifying…' : 'Verify feed'}
              </Button>
            </div>

            {vstate === 'ok' && !stale && (
              <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
                <Pill tone="accent">✓ Feed verified</Pill>
                <span style={{ fontSize: 13, fontWeight: 500, color: 'var(--ink)' }}>Meetings — S. Ríos</span>
                <span className="num mono" style={{ fontSize: 12, color: 'var(--ink-3)' }}>Last refreshed 12m ago</span>
                <span style={{ marginLeft: 'auto' }}/>
                <IconBtn label="Refresh now" onClick={() => onToast && onToast('Feed refreshed.')}><IRefresh s={14}/></IconBtn>
              </div>
            )}

            {vstate === 'ok' && stale && (
              <div style={{
                padding: '11px 14px', borderRadius: 'var(--radius)',
                border: '1px solid color-mix(in srgb, var(--warn) 32%, transparent)',
                background: 'color-mix(in srgb, var(--warn) 8%, transparent)',
              }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
                  <span style={{ width: 7, height: 7, borderRadius: '50%', background: 'var(--warn)', flexShrink: 0 }}/>
                  <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--ink)' }}>
                    Feed unreachable since <span className="num mono">09:14</span>.
                  </span>
                  <span style={{ marginLeft: 'auto' }}/>
                  <Button size="sm" onClick={() => onToast && onToast('Retrying feed…')}>Retry now</Button>
                </div>
                <div style={{ fontSize: 12, color: 'var(--ink-2)', marginTop: 5, paddingLeft: 17 }}>
                  The planner shows busy times cached at <span className="num mono">09:14</span>. Retries every <span className="num mono">15</span> minutes.
                </div>
              </div>
            )}

            <div style={{ fontSize: 12, color: 'var(--ink-3)', lineHeight: 1.5 }}>
              In Outlook: Settings → Shared calendars → Publish a calendar → copy the ICS link.
            </div>
          </div>
        </PSettingsRow>
      </PSettingsSection>
    </div>
  );
}

window.SettingsCalendars = SettingsCalendars;
