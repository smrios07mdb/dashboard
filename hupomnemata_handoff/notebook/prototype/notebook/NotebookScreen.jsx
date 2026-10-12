// Notebook tab: list + editor. Desktop / iPad = two panes. Phone = list → full-screen editor.
// Also the app chrome used by every screen in this reference (6-tab top nav, 6-item bottom nav).

const NB_TABS = [
  { id: 'dashboard', label: 'Dashboard', mobile: 'Tasks', icon: <ITag s={20}/> },
  { id: 'planner', label: 'Planner', mobile: 'Planner', icon: <ICal s={20}/> },
  { id: 'routines', label: 'Routines', mobile: 'Routines', icon: <ISun s={20}/> },
  { id: 'insights', label: 'Insights', mobile: 'Insights', icon: <IFilter s={20}/> },
  { id: 'notebook', label: 'Notebook', mobile: 'Notebook', icon: <IBook s={20}/> },
  { id: 'settings', label: 'Settings', mobile: 'Settings', icon: <IUser s={20}/> },
];

// Desktop/iPad header: wordmark · six tabs (active = ink 600 + 2px --accent underline) · sync · avatar.
const AppChrome = ({ active, compact, saveState }) => (
  <header style={{ borderBottom: '1px solid var(--line)', background: 'color-mix(in srgb, var(--bg) 82%, transparent)', backdropFilter: 'blur(14px)', position: 'sticky', top: 0, zIndex: 20 }}>
    <div style={{ display: 'flex', alignItems: 'center', gap: compact ? 6 : 18, padding: compact ? '10px 16px' : '12px 28px' }}>
      <span style={{ display: 'inline-flex', alignItems: 'baseline', gap: 2 }}><span className="display" style={{ fontSize: 19, fontWeight: 600, letterSpacing: '-.02em' }}>hupo</span><span style={{ fontSize: 20, lineHeight: 1, color: 'var(--work)', fontWeight: 600 }}>.</span></span>
      <nav style={{ display: 'flex', gap: 0, marginLeft: compact ? 4 : 16 }}>
        {NB_TABS.map(t => { const on = t.id === active; return (
          <span key={t.id} style={{ padding: compact ? '8px 9px' : '8px 14px', fontSize: 13, fontWeight: on ? 600 : 500, color: on ? 'var(--ink)' : 'var(--ink-3)', position: 'relative' }}>
            {t.label}{on && <span style={{ position: 'absolute', left: compact ? 9 : 14, right: compact ? 9 : 14, bottom: -1, height: 2, background: 'var(--accent)', borderRadius: 2 }}/>}
          </span>
        ); })}
      </nav>
      <span style={{ marginLeft: 'auto' }}/>
      <SyncBadge state={saveState === 'saved' ? 'synced' : saveState === 'syncing' ? 'syncing' : 'offline'}/>
      <span style={{ width: 28, height: 28, borderRadius: '50%', background: 'var(--ink)', color: 'var(--bg)', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', fontSize: 12, fontWeight: 600 }}>S</span>
    </div>
  </header>
);

// Phone bottom nav with six items at 375px: 62.5px per cell, 60px tall (icon 20 + 4 gap + 10px label + 10/12 padding).
const PhoneNav = ({ active }) => (
  <nav aria-label="Primary" style={{ position: 'absolute', left: 0, right: 0, bottom: 0, zIndex: 40, display: 'grid', gridTemplateColumns: 'repeat(6, 1fr)', borderTop: '1px solid var(--line)', background: 'color-mix(in srgb, var(--surface) 90%, transparent)', backdropFilter: 'blur(12px)', paddingBottom: 14 }}>
    {NB_TABS.map(t => { const on = t.id === active; return (
      <button key={t.id} aria-current={on ? 'page' : undefined} style={{ position: 'relative', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4, padding: '10px 2px 12px', fontSize: 10, letterSpacing: '.02em', fontWeight: on ? 600 : 500, color: on ? 'var(--ink)' : 'var(--ink-3)' }}>
        {on && <span style={{ position: 'absolute', top: 0, left: '30%', right: '30%', height: 2, background: 'var(--accent)', borderRadius: '0 0 2px 2px' }}/>}
        {t.icon}<span>{t.mobile}</span>
      </button>
    ); })}
  </nav>
);

function NotebookScreen({ notes, setNotes, device, saveState, activeId, setActiveId, q, setQ, onToast, hideCompleted }) {
  const phone = device === 'phone', tablet = device === 'ipad', touch = phone || tablet;
  const [filter, setFilter] = React.useState('all');
  const [picker, setPicker] = React.useState(false);
  const [view, setView] = React.useState(activeId ? 'editor' : 'list'); // phone only
  const active = notes.find(n => n.id === activeId) || null;
  const update = (id, patch) => setNotes(ns => ns.map(n => n.id === id ? { ...n, ...patch, updatedAt: NB_NOW.toISOString() } : n));
  const select = (id) => { setActiveId(id); if (phone) setView('editor'); };
  const create = (attachment = null) => {
    const id = 'n-' + Date.now();
    setNotes(ns => [{ id, title: '', body: '', pinned: false, createdAt: NB_NOW.toISOString(), updatedAt: NB_NOW.toISOString(), attachment }, ...ns]);
    select(id);
  };
  const remove = (id) => { setNotes(ns => ns.filter(n => n.id !== id)); setActiveId(null); if (phone) setView('list'); onToast('Note deleted.'); };
  const detach = (n) => { const r = nbResolve(n.attachment); update(n.id, { attachment: null }); onToast(`Detached from ${r ? (r.taskTitle || r.subName) : 'its list'}.`); };
  const pick = (att) => { setPicker(false); if (!att) { detach(active); return; } update(active.id, { attachment: att }); const r = nbResolve(att); onToast(`Attached to ${r.taskTitle || r.subName}.`); };

  const newBtn = <Button variant="primary" size={touch ? 'md' : 'sm'} icon={<IPlus s={14}/>} onClick={() => create()} style={{ height: touch ? 40 : 32 }}>New note</Button>;
  const listHeader = phone ? (
    <div style={{ display: 'flex', alignItems: 'flex-end', justifyContent: 'space-between', padding: '22px 16px 14px' }}>
      <div><h1 className="title" style={{ margin: 0, fontSize: 32 }}>Notebook</h1><div className="label" style={{ marginTop: 6 }}>{notes.length} notes · {notes.filter(n => n.attachment).length} attached</div></div>
      <IconBtn label="New note" size={44} tone="ink" onClick={() => create()} style={{ background: 'var(--accent)', color: 'var(--bg)', borderRadius: 999 }}><IPlus s={20}/></IconBtn>
    </div>
  ) : (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '18px 14px 12px' }}>
      <div><h1 className="title" style={{ margin: 0, fontSize: 26 }}>Notebook</h1></div>{newBtn}
    </div>
  );

  const editorEl = active ? (
    <NoteEditor key={active.id} note={active} touch={touch} phone={phone} saveState={saveState}
      onChange={(p) => update(active.id, p)} onDelete={() => remove(active.id)} onAttach={() => setPicker(true)} onDetach={() => detach(active)} onBack={phone ? () => setView('list') : undefined}/>
  ) : (
    <div style={{ height: '100%', display: 'grid', placeItems: 'center', color: 'var(--ink-3)', fontSize: 13, textAlign: 'center', padding: 24 }}>
      {notes.length ? 'Select a note, or start a new one.' : ''}
    </div>
  );

  if (phone) return (
    <div style={{ position: 'relative', height: '100%', display: 'flex', flexDirection: 'column', background: 'var(--bg)' }}>
      <div style={{ flex: 1, minHeight: 0, paddingBottom: view === 'list' ? 74 : 0, display: 'flex', flexDirection: 'column' }}>
        {view === 'list' ? <NoteList notes={notes} activeId={activeId} onSelect={select} onNew={() => create()} filter={filter} setFilter={setFilter} q={q} setQ={setQ} touch phone header={listHeader} hideCompleted={hideCompleted}/>
          : <div style={{ flex: 1, minHeight: 0, background: 'var(--surface)' }}>{editorEl}</div>}
      </div>
      {view === 'list' && <PhoneNav active="notebook"/>}
      <AttachPicker open={picker} onClose={() => setPicker(false)} notes={notes} note={active} onPick={pick}/>
    </div>
  );

  return (
    <div style={{ height: '100%', display: 'flex', flexDirection: 'column', background: 'var(--bg)' }}>
      <AppChrome active="notebook" compact={tablet} saveState={saveState}/>
      <div style={{ flex: 1, minHeight: 0, display: 'grid', gridTemplateColumns: tablet ? '300px minmax(0,1fr)' : '340px minmax(0,1fr)' }}>
        <aside style={{ borderRight: '1px solid var(--line)', minHeight: 0, background: 'color-mix(in srgb, var(--surface) 55%, transparent)' }}>
          <NoteList notes={notes} activeId={activeId} onSelect={select} onNew={() => create()} filter={filter} setFilter={setFilter} q={q} setQ={setQ} touch={touch} header={listHeader} hideCompleted={hideCompleted}/>
        </aside>
        <section style={{ minHeight: 0, background: 'var(--surface)' }}>{editorEl}</section>
      </div>
      <AttachPicker open={picker} onClose={() => setPicker(false)} notes={notes} note={active} onPick={pick}/>
    </div>
  );
}

Object.assign(window, { NotebookScreen, AppChrome, PhoneNav, NB_TABS });
