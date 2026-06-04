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
      background: 'color-mix(in srgb, var(--bg) 82%, transparent)',
      position: 'sticky', top: 0, zIndex: 20,
      backdropFilter: 'blur(14px) saturate(1.3)',
      boxShadow: '0 1px 0 var(--line), 0 8px 24px -18px rgba(70,48,22,.5)',
    }}>
      <div className="shell" style={{
        display: 'flex', alignItems: 'center', gap: 18,
        padding: '14px 28px',
      }}>
        {/* wordmark — short form in header (full "hupomnemata." on login) */}
        <button onClick={()=>setTab('dashboard')} style={{ display: 'inline-flex', alignItems: 'baseline', gap: 2 }}>
          <span className="display" style={{
            fontSize: 19, fontWeight: 600, letterSpacing: '-.02em',
            color: 'var(--ink)',
          }}>hupo</span>
          <span style={{
            fontSize: 20, lineHeight: 1, color: 'var(--work)', fontWeight: 600,
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
                  {active && (
                    <span style={{
                      position: 'absolute', left: 14, right: 14, bottom: -1, height: 2,
                      background: 'var(--accent)', borderRadius: 2,
                    }}/>
                  )}
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
  const play = {
    hero: t.hero !== 'off',
    celebrate: t.celebrate || 'full',
    colorPop: t.colorPop || 'vibrant',
  };
  React.useEffect(() => { window.__PLAY = play; }, [t.hero, t.celebrate, t.colorPop]);

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
        compact={compact} mobile={mobile} play={play}/>;
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
           data-pairing={t.pairing} data-mode={t.mode} data-spark={t.spark} data-catpalette={t.catPalette}>
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
         data-pairing={t.pairing} data-mode={t.mode} data-device={t.device} data-spark={t.spark} data-catpalette={t.catPalette}
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
      forest:    { accent:'#1f5142', soft:'rgba(31,81,66,.10)',  ink:'#1f5142' },
      terracotta:{ accent:'#bb4f2c', soft:'rgba(187,79,44,.11)', ink:'#bb4f2c' },
      plum:      { accent:'#774063', soft:'rgba(119,64,99,.11)', ink:'#774063' },
      ink:       { accent:'#2c2620', soft:'rgba(44,38,32,.07)',  ink:'#2c2620' },
    };
    const p = palettes[accent] || palettes.forest;
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
          { value: 'daylight',  label: 'Daylight' },
          { value: 'meadow',    label: 'Meadow' },
          { value: 'blush',     label: 'Blush' },
          { value: 'porcelain', label: 'Porcelain' },
        ]}
        onChange={(v)=>setTweak('aesthetic',v)}/>
      <TweakRadio  label="Type pairing" value={t.pairing}
        options={[
          { value: 'serif', label: 'Editorial' },
          { value: 'sans',  label: 'Clean' },
          { value: 'mono',  label: 'Mono' },
        ]}
        onChange={(v)=>setTweak('pairing',v)}/>
      <TweakRow label="Accent">
        <div style={{ display: 'flex', gap: 8 }}>
          {[
            { id: 'forest',     color: '#1f5142' },
            { id: 'terracotta', color: '#bb4f2c' },
            { id: 'plum',       color: '#774063' },
            { id: 'ink',        color: '#2c2620' },
          ].map(opt => {
            const on = t.accent === opt.id;
            return (
              <button key={opt.id} onClick={()=>setTweak('accent', opt.id)}
                title={opt.id} aria-label={opt.id}
                style={{
                  width: 22, height: 22, borderRadius: 999,
                  background: opt.color,
                  boxShadow: on ? '0 0 0 2px var(--surface), 0 0 0 3.5px ' + opt.color : '0 0 0 1px rgba(0,0,0,.14)',
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

      <TweakSection label="Play"/>
      <TweakRadio  label="Celebrations" value={t.celebrate}
        options={[
          { value: 'full',   label: 'Full' },
          { value: 'subtle', label: 'Subtle' },
          { value: 'off',    label: 'Off' },
        ]}
        onChange={(v)=>setTweak('celebrate',v)}/>
      <TweakRadio  label="Color pop" value={t.colorPop}
        options={[
          { value: 'vibrant', label: 'Vibrant' },
          { value: 'calm',    label: 'Calm' },
        ]}
        onChange={(v)=>setTweak('colorPop',v)}/>
      <TweakRadio  label="Progress hero" value={t.hero}
        options={[
          { value: 'on',  label: 'On' },
          { value: 'off', label: 'Off' },
        ]}
        onChange={(v)=>setTweak('hero',v)}/>
      <TweakRadio  label="Button glow" value={t.spark}
        options={[
          { value: 'purple',   label: 'Purple' },
          { value: 'lime',     label: 'Lime' },
          { value: 'aurora',   label: 'Aurora' },
          { value: 'electric', label: 'Electric' },
          { value: 'sunset',   label: 'Sunset' },
          { value: 'ocean',    label: 'Ocean' },
        ]}
        onChange={(v)=>setTweak('spark',v)}/>
      <TweakRadio  label="Category palette" value={t.catPalette}
        options={[
          { value: 'indigo',  label: 'Indigo & Rose' },
          { value: 'azure',   label: 'Azure & Tangerine' },
          { value: 'violet',  label: 'Violet & Magenta' },
          { value: 'emerald', label: 'Emerald & Rose' },
        ]}
        onChange={(v)=>setTweak('catPalette',v)}/>

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
