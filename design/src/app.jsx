// App shell — wires everything together.
// State-based routing (no react-router): tab + drilldown overlay.

function AppHeader({ email, syncState, onSignOut, onCycleSync, tab, setTab, mobile, density }) {
  const [acctOpen, setAcctOpen] = React.useState(false);
  const ref = React.useRef(null);
  React.useEffect(() => {
    const h = (e) => { if (ref.current && !ref.current.contains(e.target)) setAcctOpen(false); };
    if (acctOpen) document.addEventListener('mousedown', h);
    return () => document.removeEventListener('mousedown', h);
  }, [acctOpen]);

  const tabs = [
    { id: 'dashboard', label: 'Dashboard' },
    { id: 'routines',  label: 'Routines' },
    { id: 'insights',  label: 'Insights' },
    { id: 'settings',  label: 'Settings' },
  ];

  return (
    <header style={{
      borderBottom: '1px solid var(--line)',
      background: 'var(--bg)',
      position: 'sticky', top: 0, zIndex: 20,
      backdropFilter: 'blur(8px)',
    }}>
      <div className="shell" style={{
        display: 'flex', alignItems: 'center', gap: 18,
        padding: '14px 28px',
      }}>
        {/* wordmark — short form in header (full "hupomnemata." on login) */}
        <button onClick={()=>setTab('dashboard')} style={{ display: 'inline-flex', alignItems: 'baseline', gap: 2 }}>
          <span className="display" style={{
            fontSize: 17, fontWeight: 700, letterSpacing: '-.045em',
            color: 'var(--ink)',
          }}>hupo</span>
          <span style={{
            fontSize: 18, lineHeight: 1, color: 'var(--jewel-jade)', fontWeight: 700,
          }}>.</span>
        </button>

        {!mobile && (
          <nav style={{ display: 'flex', gap: 2, marginLeft: 16 }}>
            {tabs.map(t => {
              const active = t.id === tab;
              return (
                <button key={t.id} onClick={()=>setTab(t.id)}
                  style={{
                    padding: '8px 14px', fontSize: 13,
                    fontWeight: active ? 600 : 500,
                    color: active ? 'var(--ink)' : 'var(--ink-3)',
                    borderRadius: 'var(--radius)', position: 'relative',
                  }}
                  onMouseEnter={(e)=>{ if(!active) e.currentTarget.style.color='var(--ink)'; }}
                  onMouseLeave={(e)=>{ if(!active) e.currentTarget.style.color='var(--ink-3)'; }}>
                  {t.label}
                </button>
              );
            })}
          </nav>
        )}

        <span style={{ marginLeft: 'auto' }}/>

        <SyncBadge state={syncState} onClick={onCycleSync}/>

        {/* Account */}
        <div ref={ref} style={{ position: 'relative' }}>
          <button onClick={()=>setAcctOpen(o=>!o)}
            style={{
              display: 'inline-flex', alignItems: 'center', gap: 8,
              padding: 4, borderRadius: 999,
            }}>
            <span style={{
              width: 28, height: 28, borderRadius: '50%',
              background: 'var(--ink)', color: 'var(--bg)',
              display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
              fontSize: 12, fontWeight: 600,
            }}>{(email[0] || 'S').toUpperCase()}</span>
          </button>
          {acctOpen && (
            <div style={{
              position: 'absolute', top: 40, right: 0, minWidth: 220,
              background: 'var(--surface)', border: '1px solid var(--line)',
              borderRadius: 'var(--radius)', padding: 4, zIndex: 30,
              boxShadow: '0 12px 32px rgba(31,29,26,.10)',
              animation: 'fadein .12s forwards',
            }}>
              <div style={{ padding: '10px 12px', borderBottom: '1px solid var(--line)' }}>
                <div className="label" style={{ marginBottom: 4 }}>Signed in</div>
                <div className="mono" style={{ fontSize: 12, color: 'var(--ink-2)' }}>{email}</div>
              </div>
              <button onClick={()=>{ setAcctOpen(false); setTab('settings'); }}
                onMouseEnter={(e)=>e.currentTarget.style.background='var(--bg-alt)'}
                onMouseLeave={(e)=>e.currentTarget.style.background='transparent'}
                style={{ display: 'flex', width: '100%', alignItems: 'center', gap: 8, padding: '8px 10px', fontSize: 13, borderRadius: 4 }}>
                <IUser s={14}/>Settings
              </button>
              <button onClick={onSignOut}
                onMouseEnter={(e)=>e.currentTarget.style.background='var(--bg-alt)'}
                onMouseLeave={(e)=>e.currentTarget.style.background='transparent'}
                style={{ display: 'flex', width: '100%', alignItems: 'center', gap: 8, padding: '8px 10px', fontSize: 13, color: 'var(--destructive)', borderRadius: 4 }}>
                <IArrowR s={14}/>Sign out
              </button>
            </div>
          )}
        </div>
      </div>
    </header>
  );
}

function App() {
  const [t, setTweak] = useTweaks(window.__TWEAK_DEFAULTS);
  const [signedIn, setSignedIn] = React.useState(false);
  const [tab, setTab] = React.useState('dashboard');
  const [route, setRoute] = React.useState({ name: 'home' }); // 'home' | 'category' | 'subcategory'
  const [available, setAvailable] = React.useState(90);
  const [expandedSubs, setExpandedSubs] = React.useState(new Set(['s-atlas', 's-home']));
  const [syncState, setSyncState] = React.useState('synced');
  const [installBanner, setInstallBanner] = React.useState(true);
  const [hideCompleted, setHideCompleted] = React.useState(true);
  const [toast, setToast] = React.useState('');

  // Data state — rebuild when mockData changes
  const [data, setData] = React.useState(() => buildData(t.mockData));
  React.useEffect(() => { setData(buildData(t.mockData)); }, [t.mockData]);
  const [routineState, setRoutineState] = React.useState({ items: data.routineItems, logs: data.routineLogs });
  React.useEffect(() => { setRoutineState({ items: data.routineItems, logs: data.routineLogs }); }, [data]);

  // CalDAV status — initialized from data.settings, mutable for demo
  const [caldavStatus, setCaldavStatus] = React.useState(data.settings.caldavStatus);

  // Sheets
  const [whatsNextOpen, setWhatsNextOpen] = React.useState(false);
  const [blockTask, setBlockTask] = React.useState(null);
  const [reminderTask, setReminderTask] = React.useState(null);

  const [vw, setVw] = React.useState(typeof window !== 'undefined' ? window.innerWidth : 1024);
  React.useEffect(() => {
    const h = () => setVw(window.innerWidth);
    window.addEventListener('resize', h);
    return () => window.removeEventListener('resize', h);
  }, []);

  const mobile = t.device === 'mobile' || vw < 640;
  const compact = t.density === 'compact';

  const pushToast = (msg) => setToast(msg);

  const toggleSub = (sid) => {
    setExpandedSubs(prev => {
      const next = new Set(prev);
      if (next.has(sid)) next.delete(sid); else next.add(sid);
      return next;
    });
  };

  const onTaskAction = (a) => {
    if (a.type === 'toggle') {
      setData(d => ({ ...d, tasks: d.tasks.map(t => t.id === a.task.id ?
        { ...t, completedAt: t.completedAt ? null : new Date().toISOString() } : t) }));
    } else if (a.type === 'edit') {
      setData(d => ({ ...d, tasks: d.tasks.map(t => t.id === a.task.id ? { ...t, ...a.patch, updatedAt: new Date().toISOString() } : t) }));
    } else if (a.type === 'delete') {
      setData(d => ({ ...d, tasks: d.tasks.filter(t => t.id !== a.task.id) }));
      pushToast('Task deleted.');
    } else if (a.type === 'bell') {
      setReminderTask(a.task);
    } else if (a.type === 'block') {
      setBlockTask(a.task);
    } else if (a.type === 'move') {
      pushToast(`Move "${a.task.title.slice(0,30)}…" — picker coming.`);
    } else if (a.type === 'bulk') {
      if (a.action === 'delete') {
        setData(d => ({ ...d, tasks: d.tasks.filter(t => !a.ids.includes(t.id)) }));
        pushToast(`Deleted ${a.ids.length} task${a.ids.length === 1 ? '' : 's'}.`);
      } else if (a.action === 'complete') {
        setData(d => ({ ...d, tasks: d.tasks.map(t =>
          a.ids.includes(t.id) ? { ...t, completedAt: new Date().toISOString() } : t) }));
        pushToast(`Marked ${a.ids.length} complete.`);
      } else if (a.action === 'move') {
        pushToast(`Move ${a.ids.length} task${a.ids.length === 1 ? '' : 's'} — picker coming.`);
      }
    } else if (a.type === 'add') {
      const id = 't-new-' + Date.now();
      setData(d => ({ ...d, tasks: [...d.tasks, {
        id, subcategoryId: a.subcategoryId,
        title: 'New task', notes: null, estimateMinutes: 15,
        dueAt: null, remindAt: null, notified: false,
        priority: null, completedAt: null,
        createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
      }] }));
      pushToast('Task added.');
    }
  };

  const cycleSync = () => {
    const order = ['synced','syncing','offline','sync_issues'];
    setSyncState(s => order[(order.indexOf(s)+1)%order.length]);
  };

  // Per-tab content
  let body;
  if (tab === 'dashboard') {
    if (route.name === 'category') {
      body = <CategoryView data={data} categoryId={route.id}
        onBack={()=>setRoute({name:'home'})}
        onDrillSub={(sid)=>setRoute({name:'subcategory',id:sid})}
        onTaskAction={onTaskAction}
        onAddSub={()=>pushToast('Add subcategory — coming.')}
        hideCompleted={hideCompleted} compact={compact}/>;
    } else if (route.name === 'subcategory') {
      body = <SubcategoryView data={data} subcategoryId={route.id}
        onBack={()=>setRoute({name:'home'})}
        onBackCategory={(cid)=>setRoute({name:'category',id:cid})}
        onTaskAction={onTaskAction}
        hideCompleted={hideCompleted} compact={compact}/>;
    } else {
      body = <Dashboard data={data}
        expandedSubs={expandedSubs} onToggleSub={toggleSub}
        onDrillCat={(cid)=>setRoute({name:'category',id:cid})}
        onDrillSub={(sid)=>setRoute({name:'subcategory',id:sid})}
        onTaskAction={onTaskAction}
        available={available} setAvailable={setAvailable}
        onWhatsNext={()=>setWhatsNextOpen(true)}
        hideCompleted={hideCompleted} setHideCompleted={setHideCompleted}
        compact={compact} mobile={mobile}/>;
    }
  } else if (tab === 'routines') {
    body = <Routines data={data} routineState={routineState} setRoutineState={setRoutineState}
      mobile={mobile} mode={t.mode} setMode={(m)=>setTweak('mode',m)}/>;
  } else if (tab === 'insights') {
    body = <Insights data={data} mobile={mobile}/>;
  } else if (tab === 'settings') {
    body = <Settings data={data} mode={t.mode} setMode={(m)=>setTweak('mode',m)}
      hideCompleted={hideCompleted} setHideCompleted={setHideCompleted}
      caldavStatus={caldavStatus} setCaldavStatus={setCaldavStatus}
      onSignOut={()=>setSignedIn(false)} onPushToast={pushToast}/>;
  }

  // Reset to home when switching tabs (drilldowns are dashboard-only)
  React.useEffect(() => { setRoute({ name: 'home' }); }, [tab]);

  if (!signedIn) {
    return (
      <div data-aesthetic={t.aesthetic} data-density={t.density}
           data-pairing={t.pairing} data-mode={t.mode}>
        <Login onSignIn={()=>setSignedIn(true)}/>
        <TweaksUI t={t} setTweak={setTweak}/>
      </div>
    );
  }

  const tabIcons = {
    dashboard: <ITag s={20}/>, routines: <ISun s={20}/>,
    insights: <IFilter s={20}/>, settings: <IUser s={20}/>,
  };

  return (
    <div className="page" data-aesthetic={t.aesthetic} data-density={t.density}
         data-pairing={t.pairing} data-mode={t.mode} data-device={t.device}
         style={{ paddingBottom: mobile ? 80 : 0 }}>
      <ApplyAccent accent={t.accent}/>
      <AppHeader email={data.email} syncState={syncState}
        onSignOut={()=>setSignedIn(false)}
        onCycleSync={cycleSync}
        tab={tab} setTab={setTab} mobile={mobile} density={t.density}/>

      <main className="shell" style={{ padding: mobile ? '18px 16px 40px' : '24px 28px 60px' }}>
        {installBanner && mobile && tab === 'dashboard' && (
          <InstallBanner onDismiss={()=>setInstallBanner(false)}/>
        )}
        {caldavStatus === 'auth_failed' && tab !== 'settings' && (
          <CaldavBanner onOpenSettings={()=>setTab('settings')} onDismiss={()=>setCaldavStatus('ok')}/>
        )}
        {body}
      </main>

      {mobile && (
        <BottomTabs value={tab} onChange={setTab}
          items={[
            { id: 'dashboard', label: 'Tasks',    icon: tabIcons.dashboard },
            { id: 'routines',  label: 'Routines', icon: tabIcons.routines },
            { id: 'insights',  label: 'Insights', icon: tabIcons.insights },
            { id: 'settings',  label: 'Settings', icon: tabIcons.settings },
          ]}/>
      )}

      <AITriageSheet open={whatsNextOpen} onClose={()=>setWhatsNextOpen(false)}
        data={data} available={available} onPushToast={pushToast}/>
      <BlockTimeSheet open={!!blockTask} task={blockTask} onClose={()=>setBlockTask(null)}
        data={data} onPushToast={pushToast}/>
      <ReminderSheet open={!!reminderTask} task={reminderTask} onClose={()=>setReminderTask(null)}
        onSave={(p)=>{
          if (!reminderTask) return;
          const ms = p.mins === 'eve' ? (() => { const d = new Date(); d.setHours(18,0,0,0); return d.getTime() - Date.now(); })()
                   : p.mins === 'tom' ? (() => { const d = new Date(); d.setDate(d.getDate()+1); d.setHours(9,0,0,0); return d.getTime() - Date.now(); })()
                   : p.mins * 60000;
          const remindAt = new Date(Date.now() + ms).toISOString();
          setData(d => ({ ...d, tasks: d.tasks.map(t => t.id === reminderTask.id ? { ...t, remindAt, notified: false } : t) }));
        }}
        onClear={()=>{
          if (!reminderTask) return;
          setData(d => ({ ...d, tasks: d.tasks.map(t => t.id === reminderTask.id ? { ...t, remindAt: null, notified: false } : t) }));
        }}
        onPushToast={pushToast}/>

      <Toast msg={toast} onClose={()=>setToast('')}/>

      <TweaksUI t={t} setTweak={setTweak}/>
    </div>
  );
}

// Maps the accent palette tweak into root CSS vars.
// NOTE: work/personal stay jewel-toned via root CSS; accent only swaps the focal color.
function ApplyAccent({ accent }) {
  React.useEffect(() => {
    const palettes = {
      ice:     { accent:'#c8d2e2', soft:'rgba(200,210,226,.10)', ink:'#e8edf5' },
      ember:   { accent:'#ff8466', soft:'rgba(255,132,102,.13)', ink:'#ffd6c6' },
      emerald: { accent:'#4cc8a3', soft:'rgba(76,200,163,.13)',  ink:'#bce8d8' },
      pearl:   { accent:'#eaeaee', soft:'rgba(234,234,238,.10)', ink:'#ffffff' },
    };
    const p = palettes[accent] || palettes.ice;
    const root = document.documentElement;
    root.style.setProperty('--accent', p.accent);
    root.style.setProperty('--accent-soft', p.soft);
    root.style.setProperty('--accent-ink', p.ink);
  }, [accent]);
  return null;
}

function TweaksUI({ t, setTweak }) {
  return (
    <TweaksPanel>
      <TweakSection label="Aesthetic"/>
      <TweakRadio  label="Direction" value={t.aesthetic}
        options={[
          { value: 'obsidian',  label: 'Obsidian' },
          { value: 'carbon',    label: 'Carbon' },
          { value: 'slate',     label: 'Slate' },
        ]}
        onChange={(v)=>setTweak('aesthetic',v)}/>
      <TweakRadio  label="Type pairing" value={t.pairing}
        options={[
          { value: 'sans',  label: 'Sans only' },
          { value: 'serif', label: '+ serif' },
          { value: 'mono',  label: '+ mono' },
        ]}
        onChange={(v)=>setTweak('pairing',v)}/>
      <TweakRow label="Accent">
        <div style={{ display: 'flex', gap: 8 }}>
          {[
            { id: 'ice',     color: '#c8d2e2' },
            { id: 'ember',   color: '#ff8466' },
            { id: 'emerald', color: '#4cc8a3' },
            { id: 'pearl',   color: '#eaeaee' },
          ].map(opt => {
            const on = t.accent === opt.id;
            return (
              <button key={opt.id} onClick={()=>setTweak('accent', opt.id)}
                title={opt.id} aria-label={opt.id}
                style={{
                  width: 22, height: 22, borderRadius: 999,
                  background: opt.color,
                  boxShadow: on ? '0 0 0 2px rgba(0,0,0,.7), 0 0 0 3.5px ' + opt.color : '0 0 0 1px rgba(255,255,255,.18)',
                  transition: 'box-shadow .15s',
                }}/>
            );
          })}
        </div>
      </TweakRow>

      <TweakSection label="Layout"/>
      <TweakRadio  label="Density" value={t.density}
        options={[
          { value: 'comfortable', label: 'Comfortable' },
          { value: 'compact',     label: 'Compact' },
        ]}
        onChange={(v)=>setTweak('density',v)}/>
      <TweakRadio  label="Device" value={t.device}
        options={[
          { value: 'desktop', label: 'Desktop' },
          { value: 'mobile',  label: 'iPhone' },
        ]}
        onChange={(v)=>setTweak('device',v)}/>
      <TweakRadio  label="Mode" value={t.mode}
        options={[
          { value: 'dark',  label: 'Dark' },
          { value: 'light', label: 'Light' },
        ]}
        onChange={(v)=>setTweak('mode',v)}/>

      <TweakSection label="Data"/>
      <TweakRadio  label="Mock data" value={t.mockData}
        options={[
          { value: 'light', label: 'Light' },
          { value: 'mid',   label: 'Mid' },
          { value: 'heavy', label: 'Heavy' },
        ]}
        onChange={(v)=>setTweak('mockData',v)}/>
    </TweaksPanel>
  );
}

window.App = App;
