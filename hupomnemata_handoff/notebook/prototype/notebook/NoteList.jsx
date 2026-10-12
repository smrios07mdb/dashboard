// Notebook list pane: header, filter segment, search, pinned-first rows, empty states.

const Segment = ({ value, onChange, items, touch }) => (
  <div role="tablist" style={{ display: 'inline-flex', padding: 2, borderRadius: 999, background: 'var(--bg-alt)', gap: 2 }}>
    {items.map(it => { const on = it.id === value; return (
      <button key={it.id} role="tab" aria-selected={on} onClick={() => onChange(it.id)}
        style={{ padding: touch ? '0 14px' : '0 12px', height: touch ? 32 : 26, borderRadius: 999, fontSize: 12, fontWeight: on ? 600 : 500, color: on ? 'var(--ink)' : 'var(--ink-2)', background: on ? 'var(--surface)' : 'transparent', boxShadow: on ? 'var(--shadow-sm)' : 'none', transition: 'background .14s' }}>{it.label}</button>
    ); })}
  </div>
);

const NoteRow = ({ note, active, q, onClick, touch }) => {
  const res = nbResolve(note.attachment);
  const matchLine = q ? nbMatchLine(note, q) : null;
  const excerpt = matchLine || nbExcerpt(note);
  return (
    <button onClick={onClick} aria-current={active ? 'true' : undefined}
      onMouseEnter={(e) => { if (!active) e.currentTarget.style.background = 'var(--bg-alt)'; }}
      onMouseLeave={(e) => { if (!active) e.currentTarget.style.background = 'transparent'; }}
      style={{ display: 'grid', gridTemplateColumns: '1fr auto', gap: '2px 12px', width: '100%', textAlign: 'left', padding: touch ? '13px 16px' : '11px 14px', minHeight: 44,
        borderBottom: '1px solid var(--line)', background: active ? 'var(--accent-soft)' : 'transparent', borderLeft: '3px solid ' + (active ? 'var(--accent)' : 'transparent'), transition: 'background .12s' }}>
      <span style={{ fontSize: 14, fontWeight: 600, letterSpacing: '-.005em', color: note.title ? 'var(--ink)' : 'var(--ink-2)', fontStyle: note.title ? 'normal' : 'italic', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{nbMark(nbFirstLine(note), q)}</span>
      <span className="num" style={{ fontSize: 11, color: 'var(--ink-3)', paddingTop: 2 }}>{nbRel(note.updatedAt)}</span>
      <span style={{ gridColumn: '1 / -1', fontSize: 12.5, lineHeight: 1.45, color: 'var(--ink-2)', display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden', textWrap: 'pretty' }}>{nbMark(excerpt, q)}</span>
      {(res || note.detachedFrom) && <span style={{ gridColumn: '1 / -1', marginTop: 5, display: 'flex' }}><AttachChip res={res} detached={!res ? note.detachedFrom : null} size="sm"/></span>}
    </button>
  );
};

const DashedCard = ({ title, body, action, compact }) => (
  <div style={{ margin: compact ? 16 : 24, padding: compact ? '32px 20px' : '48px 24px', textAlign: 'center', border: '2px dashed var(--line-strong)', borderRadius: 'var(--radius-md)', background: 'color-mix(in srgb, var(--surface) 30%, transparent)' }}>
    <div className="title" style={{ fontSize: compact ? 20 : 22, marginBottom: 8 }}>{title}</div>
    <p style={{ margin: '0 auto', maxWidth: 300, fontSize: 13, lineHeight: 1.55, color: 'var(--ink-2)', textWrap: 'pretty' }}>{body}</p>
    {action && <div style={{ marginTop: 18 }}>{action}</div>}
  </div>
);

function NoteList({ notes, activeId, onSelect, onNew, filter, setFilter, q, setQ, touch, phone, header, hideCompleted }) {
  const [showDone, setShowDone] = React.useState(false);
  const matched = notes.filter(n => filter === 'all' ? true : filter === 'freeform' ? !n.attachment : !!n.attachment)
    .filter(n => !q || (n.title + '\n' + n.body).toLowerCase().includes(q.toLowerCase()));
  const hidden = hideCompleted && !showDone ? matched.filter(nbOnCompleted) : [];
  const filtered = matched.filter(n => !hidden.includes(n))
    .sort((a, b) => new Date(b.updatedAt) - new Date(a.updatedAt));
  const pinned = filtered.filter(n => n.pinned), rest = filtered.filter(n => !n.pinned);
  const empty = notes.length === 0;
  return (
    <div style={{ display: 'flex', flexDirection: 'column', minHeight: 0, height: '100%' }}>
      {header}
      {!empty && (
        <div style={{ padding: phone ? '0 16px 10px' : '0 14px 10px', display: 'flex', flexDirection: 'column', gap: 10 }}>
          <Input leading={<ISearch s={15} style={{ color: 'var(--ink-3)' }}/>} placeholder="Search notes" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Search notes"
            trailing={q ? <IconBtn label="Clear search" size={touch ? 32 : 24} onClick={() => setQ('')}><IX s={14}/></IconBtn> : null}
            style={{ height: touch ? 44 : 36, borderColor: 'var(--line-strong)' }} inputStyle={{ fontSize: touch ? 16 : 13 }}/>
          <Segment touch={touch} value={filter} onChange={setFilter} items={[{ id: 'all', label: 'All' }, { id: 'freeform', label: 'Freeform' }, { id: 'attached', label: 'Attached' }]}/>
        </div>
      )}
      <div className="lst" style={{ flex: 1, overflowY: 'auto', minHeight: 0 }}>
        {empty && <DashedCard compact={phone} title="Nothing written yet." body="Notes can stand alone or sit beside a task or list. Start one here, or from any task's menu." action={<Button variant="primary" icon={<IPlus s={14}/>} onClick={onNew}>New note</Button>}/>}
        {!empty && filtered.length === 0 && (
          <DashedCard compact title={q ? <span>No notes match “{q}”.</span> : 'No notes here.'} body={q ? 'Search looks at titles and bodies. Try another word, or clear the filter.' : filter === 'attached' ? 'Attach a note to a task or list from its header, or from a task’s menu.' : 'Every note is attached to a task or list. Start a freeform one with New note.'}/>
        )}
        {pinned.length > 0 && <div className="label" style={{ padding: '10px 16px 4px' }}>Pinned</div>}
        {pinned.map(n => <NoteRow key={n.id} note={n} q={q} touch={touch} active={n.id === activeId} onClick={() => onSelect(n.id)}/>)}
        {pinned.length > 0 && rest.length > 0 && <div className="label" style={{ padding: '14px 16px 4px' }}>Recent</div>}
        {rest.map(n => <NoteRow key={n.id} note={n} q={q} touch={touch} active={n.id === activeId} onClick={() => onSelect(n.id)}/>)}
        {hidden.length > 0 && (
          <button onClick={() => setShowDone(true)} className="label" style={{ display: 'block', width: '100%', textAlign: 'left', padding: '14px 16px', minHeight: 44, color: 'var(--ink-3)' }}
            onMouseEnter={(e) => e.currentTarget.style.color = 'var(--ink-2)'} onMouseLeave={(e) => e.currentTarget.style.color = 'var(--ink-3)'}>+{hidden.length} on completed tasks</button>
        )}
        {hideCompleted && showDone && matched.some(nbOnCompleted) && (
          <button onClick={() => setShowDone(false)} className="label" style={{ display: 'block', width: '100%', textAlign: 'left', padding: '14px 16px', minHeight: 44, color: 'var(--ink-3)' }}>Hide completed tasks’ notes</button>
        )}
      </div>
    </div>
  );
}

Object.assign(window, { NoteList, NoteRow, Segment, DashedCard });
