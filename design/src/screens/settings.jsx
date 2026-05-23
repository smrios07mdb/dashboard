// Settings tab.

function SettingsRow({ title, hint, children, align = 'top' }) {
  return (
    <div style={{
      display: 'grid', gridTemplateColumns: 'minmax(180px, 220px) 1fr',
      gap: 28, padding: '20px 0',
      borderBottom: '1px solid var(--line)',
      alignItems: align === 'center' ? 'center' : 'start',
    }}>
      <div>
        <div style={{ fontSize: 14, fontWeight: 500, color: 'var(--ink)' }}>{title}</div>
        {hint && <div style={{ fontSize: 12, color: 'var(--ink-3)', marginTop: 4, lineHeight: 1.5 }}>{hint}</div>}
      </div>
      <div>{children}</div>
    </div>
  );
}

function SettingsSection({ title, kicker, children }) {
  return (
    <section style={{ marginBottom: 36 }}>
      <header style={{ marginBottom: 6 }}>
        <span className="label">{kicker}</span>
        <h2 className="display" style={{ margin: '6px 0 0', fontSize: 22, fontWeight: 500, letterSpacing: '-.01em' }}>{title}</h2>
      </header>
      {children}
    </section>
  );
}

function Settings({ data, mode, setMode, hideCompleted, setHideCompleted, caldavStatus, setCaldavStatus, onSignOut, onPushToast, isDev = true }) {
  const [appleId, setAppleId] = React.useState(data.settings.caldavAppleId || '');
  const [appPass, setAppPass] = React.useState('');
  const [showPass, setShowPass] = React.useState(false);
  const [apiKey, setApiKey] = React.useState(data.settings.aiApiKey || '');
  const [calStatus, setCalStatus] = React.useState(caldavStatus);
  React.useEffect(() => { setCalStatus(caldavStatus); }, [caldavStatus]);
  const updateCalStatus = (s) => { setCalStatus(s); setCaldavStatus && setCaldavStatus(s); };
  const [calendars, setCalendars] = React.useState([]);
  const [pickedCal, setPickedCal] = React.useState(data.settings.caldavCalendarUrl);
  // PWA detection — would normally come from window.matchMedia('(display-mode: standalone)')
  // For prototype, default to "not installed" so the gating story is visible.
  const [isInstalledPWA, setIsInstalledPWA] = React.useState(false);
  const [notifPerm, setNotifPerm] = React.useState('default');
  const [importMode, setImportMode] = React.useState('merge');
  const [wipeOpen, setWipeOpen] = React.useState(false);
  const [wipeConfirm, setWipeConfirm] = React.useState('');

  const testConn = () => {
    updateCalStatus('testing');
    setTimeout(() => {
      updateCalStatus('ok');
      setCalendars([
        { url: 'https://p123.caldav.icloud.com/12345/calendars/personal/', name: 'Personal' },
        { url: 'https://p123.caldav.icloud.com/12345/calendars/work/', name: 'Work' },
        { url: 'https://p123.caldav.icloud.com/12345/calendars/family/', name: 'Family' },
      ]);
      onPushToast('Connection verified — pick a calendar.');
    }, 800);
  };

  const statusPill = (() => {
    if (calStatus === 'ok') return <Pill tone="accent">✓ Connected · verified 2m ago</Pill>;
    if (calStatus === 'testing') return <Pill tone="warn">Testing…</Pill>;
    if (calStatus === 'auth_failed') return <Pill tone="danger">Reconnect needed</Pill>;
    return <Pill tone="neutral">Not configured</Pill>;
  })();

  return (
    <div className="screen">
      <header style={{ marginBottom: 28 }}>
        <h1 className="display" style={{ margin: 0, fontSize: 32, fontWeight: 500, letterSpacing: '-.02em' }}>Settings</h1>
        <span className="label">{data.email}</span>
      </header>

      {/* Account */}
      <SettingsSection kicker="01" title="Account">
        <SettingsRow title="Email" align="center">
          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            <span style={{ fontSize: 14, color: 'var(--ink)' }} className="mono">{data.email}</span>
            <span style={{ marginLeft: 'auto' }}/>
            <Button onClick={onSignOut} size="sm">Sign out</Button>
          </div>
        </SettingsRow>
        <SettingsRow title="Appearance" hint="Dark by default. Light mode is available if you need it.">
          <div style={{ display: 'flex', gap: 8 }}>
            {[
              { id: 'dark',  label: 'Dark',  icon: <IMoon s={14}/> },
              { id: 'light', label: 'Light', icon: <ISun s={14}/> },
            ].map(o => (
              <button key={o.id} onClick={()=>setMode(o.id)}
                style={{
                  padding: '8px 14px', borderRadius: 'var(--radius)',
                  border: '1px solid ' + (mode === o.id ? 'var(--ink)' : 'var(--line)'),
                  background: mode === o.id ? 'var(--ink)' : 'transparent',
                  color: mode === o.id ? 'var(--bg)' : 'var(--ink-2)',
                  fontSize: 13, display: 'inline-flex', alignItems: 'center', gap: 8,
                }}>{o.icon}{o.label}</button>
            ))}
          </div>
        </SettingsRow>
        <SettingsRow title="Completed tasks" hint="Whether finished tasks stay visible in your lists.">
          <div style={{ display: 'flex', gap: 8 }}>
            {[
              { id: true,  label: 'Hide' },
              { id: false, label: 'Show' },
            ].map(o => (
              <button key={String(o.id)} onClick={()=>setHideCompleted(o.id)}
                style={{
                  padding: '8px 14px', borderRadius: 'var(--radius)',
                  border: '1px solid ' + (hideCompleted === o.id ? 'var(--ink)' : 'var(--line)'),
                  background: hideCompleted === o.id ? 'var(--ink)' : 'transparent',
                  color: hideCompleted === o.id ? 'var(--bg)' : 'var(--ink-2)',
                  fontSize: 13,
                }}>{o.label}</button>
            ))}
          </div>
        </SettingsRow>
      </SettingsSection>

      {/* Calendar */}
      <SettingsSection kicker="02" title="Apple Calendar">
        <SettingsRow title="Status" align="center">
          <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
            {statusPill}
            <span style={{ color: 'var(--ink-3)', fontSize: 12, flex: 1, minWidth: 200 }}>
              CalDAV via our serverless proxy. App-specific password is encrypted at rest.
            </span>
            <button onClick={()=>updateCalStatus(calStatus === 'auth_failed' ? 'ok' : 'auth_failed')}
              style={{
                fontSize: 11, letterSpacing: '.08em', textTransform: 'uppercase',
                fontFamily: 'var(--font-mono)', fontWeight: 500,
                color: 'var(--ink-3)', padding: '4px 8px', borderRadius: 4,
                border: '1px dashed var(--line-strong)',
              }}>
              {calStatus === 'auth_failed' ? 'Restore' : 'Simulate fail'}
            </button>
          </div>
        </SettingsRow>
        <SettingsRow title="Apple ID" hint="Your iCloud email.">
          <Input value={appleId} onChange={e=>setAppleId(e.target.value)} placeholder="you@icloud.com"/>
        </SettingsRow>
        <SettingsRow title="App-specific password" hint={<>Create one at <a href="#" style={{ color: 'var(--accent)' }}>appleid.apple.com</a> → Sign-In & Security → App-Specific Passwords.</>}>
          <Input value={appPass} onChange={e=>setAppPass(e.target.value)}
            type={showPass ? 'text' : 'password'}
            placeholder="xxxx-xxxx-xxxx-xxxx"
            trailing={<IconBtn label={showPass?'Hide':'Show'} onClick={()=>setShowPass(!showPass)}>{showPass ? <IEyeOff s={14}/> : <IEye s={14}/>}</IconBtn>}/>
          <div style={{ marginTop: 10, display: 'flex', gap: 8 }}>
            <Button onClick={testConn} icon={<ILink s={14}/>}>Test connection</Button>
            {calendars.length > 0 && (
              <select value={pickedCal || ''} onChange={e=>setPickedCal(e.target.value)}
                style={{
                  height: 36, padding: '0 10px', border: '1px solid var(--line)',
                  borderRadius: 'var(--radius)', background: 'var(--surface)', fontSize: 13,
                }}>
                {calendars.map(c => <option key={c.url} value={c.url}>{c.name}</option>)}
              </select>
            )}
            {pickedCal && <Button variant="primary" onClick={()=>onPushToast('Calendar saved.')}>Save</Button>}
          </div>
        </SettingsRow>
      </SettingsSection>

      {/* AI */}
      <SettingsSection kicker="03" title="AI assist">
        <SettingsRow title="Anthropic API key" hint="Stored encrypted, used only for the “What’s next?” call. Visible in browser traffic on your device (documented tradeoff).">
          <Input value={apiKey} onChange={e=>setApiKey(e.target.value)} type="password" placeholder="sk-ant-…"/>
          <div style={{ marginTop: 10, display: 'flex', gap: 8, alignItems: 'center' }}>
            <Button onClick={()=>onPushToast('Key saved locally.')}>Save key</Button>
            <span style={{ fontSize: 11, color: 'var(--ink-3)' }}>Uses <span className="mono">claude-sonnet-4-5</span>.</span>
          </div>
        </SettingsRow>
      </SettingsSection>

      {/* Notifications */}
      <SettingsSection kicker="04" title="Notifications">
        <SettingsRow title="Web push" hint="Push notifications fire when reminders come due, even if the app isn't open.">
          {!isInstalledPWA ? (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              <div style={{
                display: 'flex', alignItems: 'flex-start', gap: 10,
                padding: '12px 14px', borderRadius: 'var(--radius)',
                background: 'var(--bg-alt)', border: '1px solid var(--line)',
              }}>
                <IInfo s={16} style={{ color: 'var(--ink-3)', marginTop: 2, flexShrink: 0 }}/>
                <div style={{ fontSize: 12, color: 'var(--ink-2)', lineHeight: 1.55 }}>
                  <strong style={{ color: 'var(--ink)', fontWeight: 600, display: 'block', marginBottom: 2 }}>
                    Install to Home Screen first.
                  </strong>
                  iOS Safari requires the PWA to be added to your Home Screen (iOS 16.4+) before it will accept push permission. On Mac &amp; iPad you can enable below — iPhone needs the install step first.
                </div>
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
                <Button onClick={()=>setIsInstalledPWA(true)} icon={<IDownload s={14}/>}>
                  I&rsquo;ve installed it
                </Button>
                <span className="mono" style={{ fontSize: 11, color: 'var(--ink-3)' }}>
                  display-mode: browser
                </span>
              </div>
            </div>
          ) : (
            <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
              <Button onClick={()=>setNotifPerm('granted')} icon={<IBell s={14}/>}
                disabled={notifPerm === 'granted'}
                style={notifPerm === 'granted' ? { opacity: .6 } : undefined}>
                {notifPerm === 'granted' ? 'Granted' : 'Enable notifications'}
              </Button>
              <Pill tone={notifPerm === 'granted' ? 'accent' : 'neutral'}>
                {notifPerm === 'granted' ? 'Permission granted' : 'Permission ' + notifPerm}
              </Pill>
              <span style={{ marginLeft: 'auto' }}/>
              <button onClick={()=>setIsInstalledPWA(false)}
                style={{ fontSize: 11, color: 'var(--ink-3)', textTransform: 'uppercase',
                  letterSpacing: '.08em', fontFamily: 'var(--font-mono)' }}>
                Reset demo
              </button>
            </div>
          )}
        </SettingsRow>
      </SettingsSection>

      {/* Data */}
      <SettingsSection kicker="05" title="Data">
        <SettingsRow title="Export" hint="Downloads everything as a single JSON file.">
          <Button onClick={()=>onPushToast('Export started.')} icon={<IExport s={14}/>}>Export all data</Button>
        </SettingsRow>
        <SettingsRow title="Import">
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
            <Button icon={<IImport s={14}/>}>Choose file…</Button>
            <div style={{
              display: 'inline-flex', padding: 2, borderRadius: 999,
              background: 'var(--bg-alt)', border: '1px solid var(--line)',
            }}>
              {['merge', 'replace'].map(m => (
                <button key={m} onClick={()=>setImportMode(m)}
                  style={{
                    padding: '6px 14px', borderRadius: 999, fontSize: 12,
                    background: importMode === m ? 'var(--surface)' : 'transparent',
                    boxShadow: importMode === m ? '0 1px 0 var(--line)' : 'none',
                    fontWeight: importMode === m ? 600 : 500,
                    color: importMode === m ? 'var(--ink)' : 'var(--ink-3)',
                    textTransform: 'capitalize',
                  }}>{m}{m==='replace'?' all':''}</button>
              ))}
            </div>
            {importMode === 'replace' && (
              <span style={{ fontSize: 12, color: 'var(--destructive)' }}>
                Will overwrite everything — confirmation required.
              </span>
            )}
          </div>
        </SettingsRow>
        <SettingsRow title="Local cache" hint="Wipes the Dexie cache on this device. Supabase data is untouched.">
          <Button variant="danger" onClick={()=>setWipeOpen(true)}>Wipe local cache</Button>
        </SettingsRow>
      </SettingsSection>

      {/* Developer */}
      {isDev && (
        <SettingsSection kicker="06" title="Developer">
          <SettingsRow title="Sample data" hint="Only rendered when import.meta.env.DEV is true.">
            <Button onClick={()=>onPushToast('Sample data loaded.')}>Load sample data</Button>
          </SettingsRow>
        </SettingsSection>
      )}

      {/* About */}
      <SettingsSection kicker="07" title="About">
        <SettingsRow title="Build" align="center">
          <span className="mono" style={{ fontSize: 13, color: 'var(--ink-2)' }}>v0.1.0-design-preview · commit 93481415</span>
        </SettingsRow>
        <SettingsRow title="Source" align="center">
          <a href="https://github.com/smrios07mdb/dashboard" style={{ color: 'var(--accent)', fontSize: 13, display: 'inline-flex', alignItems: 'center', gap: 6 }}>
            <ILink s={14}/>smrios07mdb/dashboard
          </a>
        </SettingsRow>
      </SettingsSection>

      {/* Wipe confirm */}
      <Dialog open={wipeOpen} title="Wipe local cache"
        onClose={()=>{ setWipeOpen(false); setWipeConfirm(''); }}
        actions={
          <React.Fragment>
            <Button onClick={()=>{ setWipeOpen(false); setWipeConfirm(''); }}>Cancel</Button>
            <Button variant="primary" disabled={wipeConfirm !== 'wipe'}
              style={wipeConfirm !== 'wipe' ? { opacity: .5 } : { background: 'var(--destructive)', borderColor: 'var(--destructive)' }}
              onClick={()=>{ setWipeOpen(false); setWipeConfirm(''); onPushToast('Local cache wiped.'); }}>
              Wipe cache
            </Button>
          </React.Fragment>
        }>
        <p>
          This clears the local IndexedDB cache only. Your data lives in Supabase
          and will re-sync on next load.
        </p>
        <p style={{ marginTop: 12 }}>Type <span className="mono" style={{ background: 'var(--bg-alt)', padding: '1px 6px', borderRadius: 3 }}>wipe</span> to confirm:</p>
        <Input value={wipeConfirm} onChange={e=>setWipeConfirm(e.target.value)} placeholder="wipe"
          style={{ marginTop: 8 }}/>
      </Dialog>
    </div>
  );
}

window.Settings = Settings;
