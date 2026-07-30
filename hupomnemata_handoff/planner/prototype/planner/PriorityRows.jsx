// Screen 3 — Priority on the task list. A slice of the existing dashboard rows:
// priority chip after title, 3px --destructive left edge for P1 (existing convention),
// chip/menu opens the 3-option priority picker, sort control on the list header.

function PriorityPicker({ value, onPick, onClose }) {
  const ref = React.useRef(null);
  React.useEffect(() => {
    const h = (e) => { if (ref.current && !ref.current.contains(e.target)) onClose(); };
    document.addEventListener('mousedown', h);
    return () => document.removeEventListener('mousedown', h);
  }, []);
  return (
    <div ref={ref} style={{
      position: 'absolute', top: 30, right: 40, zIndex: 30, width: 216,
      background: 'var(--surface)', border: '1px solid var(--line)', borderRadius: 'var(--radius)',
      boxShadow: '0 12px 32px rgba(31,29,26,.10)', padding: 4, animation: 'fadein .12s forwards',
    }}>
      <div className="label" style={{ padding: '6px 10px 4px', fontSize: 9 }}>Priority</div>
      {[1, 2, 3].map(p => (
        <button key={p} onClick={() => { onPick(p); onClose(); }}
          onMouseEnter={(e)=>e.currentTarget.style.background='var(--bg-alt)'}
          onMouseLeave={(e)=>e.currentTarget.style.background='transparent'}
          style={{ width: '100%', display: 'grid', gridTemplateColumns: '30px 1fr auto',
            alignItems: 'center', gap: 8, padding: '8px 10px', borderRadius: 4, textAlign: 'left' }}>
          <PriorityChip p={p}/>
          <span>
            <span style={{ display: 'block', fontSize: 13, fontWeight: 500, color: 'var(--ink)' }}>{P_META[p].name}</span>
            <span style={{ display: 'block', fontSize: 11, color: 'var(--ink-3)' }}>{P_META[p].desc}</span>
          </span>
          {value === p && <ICheck s={14} style={{ color: 'var(--accent)' }}/>}
        </button>
      ))}
    </div>
  );
}

function PrioTaskRow({ task, onSetP, onToggle }) {
  const [pickerOpen, setPickerOpen] = React.useState(false);
  const done = !!task.done;
  const p1 = task.p === 1 && !done;
  return (
    <div onMouseEnter={(e)=>e.currentTarget.style.background='var(--bg-alt)'}
      onMouseLeave={(e)=>e.currentTarget.style.background='transparent'}
      style={{
        position: 'relative', display: 'grid', gridTemplateColumns: '24px 1fr auto auto',
        alignItems: 'center', gap: 10, padding: '8px 8px 8px ' + (p1 ? '7px' : '10px'),
        borderBottom: '1px solid var(--line)',
        borderLeft: p1 ? '3px solid var(--destructive)' : '3px solid transparent',
        opacity: done ? .5 : 1, transition: 'background .12s',
      }}>
      <Check checked={done} onChange={onToggle} size={16}/>
      <span style={{ display: 'flex', alignItems: 'center', gap: 8, minWidth: 0 }}>
        <span style={{ fontSize: 13, color: 'var(--ink)', whiteSpace: 'nowrap', overflow: 'hidden',
          textOverflow: 'ellipsis', textDecoration: done ? 'line-through' : 'none',
          textDecorationColor: 'var(--ink-3)' }}>{task.title}</span>
        {!done && <PriorityChip p={task.p} onClick={() => setPickerOpen(true)}/>}
      </span>
      <span className="num mono" style={{ fontSize: 12, color: 'var(--ink-3)' }}>{fmtMin(task.est)}</span>
      <Menu items={[
        { icon: <IFilter s={14}/>, label: 'Set priority', right: P_META[task.p].k, onClick: () => setPickerOpen(true) },
        { icon: <ICal s={14}/>, label: 'Block time' },
        { icon: <IBell s={14}/>, label: 'Set reminder' },
        '-',
        { icon: <ITrash s={14}/>, label: 'Delete', tone: 'danger' },
      ]}/>
      {pickerOpen && <PriorityPicker value={task.p} onPick={onSetP} onClose={() => setPickerOpen(false)}/>}
    </div>
  );
}

function PrioColumn({ name, initial }) {
  const [tasks, setTasks] = React.useState(initial);
  const [sort, setSort] = React.useState('Priority');
  const c = catColor(name);
  const open = tasks.filter(t => !t.done);
  const total = open.reduce((s, t) => s + t.est, 0);
  const sorted = [...tasks].sort((a, b) => {
    if (a.done !== b.done) return a.done ? 1 : -1;
    if (sort === 'Priority') return a.p - b.p;
    if (sort === 'Due') return (a.due ?? 99) - (b.due ?? 99);
    return a.est - b.est;
  });
  const patch = (id, fn) => setTasks(ts => ts.map(t => t.id === id ? fn(t) : t));
  return (
    <section style={{ minWidth: 0 }}>
      <header style={{ display: 'grid', gridTemplateColumns: '5px 1fr auto auto', alignItems: 'center',
        gap: 14, padding: '2px 2px 14px' }}>
        <span style={{ alignSelf: 'stretch', width: 5, borderRadius: 3, minHeight: 30,
          background: c, boxShadow: '0 2px 8px -2px ' + c }}/>
        <h2 className="display" style={{ margin: 0, fontSize: 28, fontWeight: 500, letterSpacing: '-.018em', color: c }}>{name}</h2>
        <span className="num label" style={{ fontSize: 10.5, padding: '4px 10px', borderRadius: 999,
          background: c, color: '#fff', letterSpacing: '.1em', boxShadow: '0 5px 14px -5px ' + c }}>{open.length} open</span>
        <span className="num display" style={{ fontSize: 17, fontWeight: 500, color: 'var(--ink-2)' }}>{fmtMin(total)}</span>
      </header>
      <div style={{
        background: 'var(--surface)', border: '1px solid var(--line)', borderTop: '4px solid ' + c,
        borderRadius: 'var(--radius-md)', overflow: 'visible',
        boxShadow: 'var(--shadow-md), 0 10px 30px -16px ' + c,
        backgroundImage: `linear-gradient(180deg, color-mix(in srgb, ${c} 9%, transparent), transparent 120px)`,
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '10px 12px',
          borderBottom: '1px solid var(--line)' }}>
          <span className="label">Sort</span>
          <span style={{ marginLeft: 'auto' }}/>
          <SortSeg value={sort} onChange={setSort} options={['Priority', 'Due', 'Estimate']}/>
        </div>
        <div style={{ padding: '0 4px 4px' }}>
          {sorted.map(t => (
            <PrioTaskRow key={t.id} task={t}
              onSetP={(p) => patch(t.id, x => ({ ...x, p }))}
              onToggle={() => patch(t.id, x => ({ ...x, done: !x.done }))}/>
          ))}
        </div>
      </div>
    </section>
  );
}

function PriorityRows() {
  return (
    <div data-screen-label="Priority — Task list" style={{ maxWidth: 1080, margin: '0 auto' }}>
      <div className="label" style={{ display: 'block', marginBottom: 16 }}>Dashboard slice — priority chips, picker & sort</div>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 'clamp(24px, 3vw, 40px)' }}>
        <PrioColumn name="Work" initial={[
          { id: 'w1', p: 1, title: 'Fix billing webhook retries', est: 60, due: 2 },
          { id: 'w2', p: 2, title: 'Review Q3 hiring plan', est: 45, due: 4 },
          { id: 'w3', p: 2, title: 'Write API changelog', est: 30, due: 8 },
          { id: 'w4', p: 3, title: 'Clean up stale feature flags', est: 90, due: null },
          { id: 'w5', p: 2, title: 'Reply to security questionnaire', est: 20, due: 3, done: true },
        ]}/>
        <PrioColumn name="Personal" initial={[
          { id: 'p1', p: 1, title: 'Renew car insurance', est: 30, due: 3 },
          { id: 'p2', p: 2, title: 'Book flights to Lisbon', est: 40, due: 5 },
          { id: 'p3', p: 3, title: 'Sort photo library', est: 60, due: null },
          { id: 'p4', p: 3, title: 'Return library books', est: 15, due: 7 },
        ]}/>
      </div>
      <p style={{ maxWidth: 640, margin: '22px auto 0', fontSize: 12, color: 'var(--ink-3)', lineHeight: 1.6, textAlign: 'center' }}>
        Tap a chip (or ⋯ → Set priority) to open the picker. P1 keeps the existing 3px destructive edge;
        chips hide on completed rows.
      </p>
    </div>
  );
}

window.PriorityRows = PriorityRows;
