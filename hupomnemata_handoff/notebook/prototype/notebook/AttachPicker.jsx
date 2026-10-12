// Attach picker: Work / Personal → list → (optionally) task. Same cascade as "Move to…", but a
// stepped list in a Dialog so it works identically on touch (≥44pt rows, no hover submenus).
// A task may hold many notes (operator decision 2026-10-12), so there is no conflict case.

const PickRow = ({ onClick, children, right, disabled, muted }) => (
  <button onClick={onClick} disabled={disabled}
    onMouseEnter={(e) => { if (!disabled) e.currentTarget.style.background = 'var(--bg-alt)'; }}
    onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent'; }}
    style={{ display: 'flex', alignItems: 'center', gap: 10, width: '100%', minHeight: 44, padding: '0 12px', borderRadius: 'var(--radius)', textAlign: 'left', fontSize: 14, color: muted ? 'var(--ink-3)' : 'var(--ink)', cursor: disabled ? 'default' : 'pointer', opacity: disabled ? .6 : 1 }}>
    <span style={{ flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{children}</span>
    {right}
  </button>
);

function AttachPicker({ open, onClose, notes, note, onPick }) {
  const [cat, setCat] = React.useState(null);
  const [sub, setSub] = React.useState(null);
  React.useEffect(() => { if (open) { const r = nbResolve(note && note.attachment); setCat(r ? NB_CATEGORIES.find(c => c.name === r.catName) : null); setSub(r ? r.sub : null); } }, [open]);
  if (!open) return null;
  const current = note.attachment;
  const isCurrent = (kind, id) => current && current.kind === kind && current.id === id;
  const pickTask = (t) => onPick({ kind: 'task', id: t.id });
  const crumbs = [{ label: 'Attach to', onClick: () => { setCat(null); setSub(null); } }, cat && { label: cat.name, onClick: () => setSub(null) }, sub && { label: sub.name }].filter(Boolean);
  const title = (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, flexWrap: 'wrap', fontSize: 15, fontWeight: 600 }}>
      {crumbs.map((c, i) => <React.Fragment key={i}>{i > 0 && <IChevR s={13} style={{ color: 'var(--ink-4)' }}/>}{c.onClick && i < crumbs.length - 1 ? <button onClick={c.onClick} style={{ color: 'var(--ink-3)', fontWeight: 500 }}>{c.label}</button> : <span>{c.label}</span>}</React.Fragment>)}
    </span>
  );
  const dot = (name) => <span style={{ width: 8, height: 8, borderRadius: '50%', background: catColor(name), flexShrink: 0 }}/>;
  const subDot = (s) => <span style={{ width: 8, height: 8, borderRadius: '50%', background: s.hue, boxShadow: `0 0 0 3px color-mix(in srgb, ${s.hue} 18%, transparent)`, flexShrink: 0 }}/>;
  const check = <ICheck s={15} style={{ color: 'var(--accent)' }}/>;
  const chev = <IChevR s={15} style={{ color: 'var(--ink-4)' }}/>;

  return (
    <React.Fragment>
      <Dialog open title={title} onClose={onClose}>
        <div style={{ margin: '4px -8px 0', color: 'var(--ink)' }}>
          {!cat && NB_CATEGORIES.map(c => <PickRow key={c.id} onClick={() => setCat(c)} right={chev}><span style={{ display: 'inline-flex', alignItems: 'center', gap: 10 }}>{dot(c.name)}{c.name}</span></PickRow>)}
          {cat && !sub && NB_SUBS.filter(s => s.categoryId === cat.id).map(s => (
            <PickRow key={s.id} onClick={() => setSub(s)} right={isCurrent('subcategory', s.id) ? check : chev}><span style={{ display: 'inline-flex', alignItems: 'center', gap: 10 }}>{subDot(s)}{s.name}</span></PickRow>
          ))}
          {sub && (
            <React.Fragment>
              <PickRow onClick={() => onPick({ kind: 'subcategory', id: sub.id })} right={isCurrent('subcategory', sub.id) ? check : null}>
                <span style={{ fontWeight: 600 }}>{isCurrent('subcategory', sub.id) ? 'Attached to this list' : 'Attach to this list'}</span>
              </PickRow>
              <div className="label" style={{ padding: '12px 12px 4px' }}>Or a task in {sub.name}</div>
              {NB_TASKS.filter(t => t.subcategoryId === sub.id).map(t => {
                const count = nbTaskNotes(notes, t.id).filter(n => n.id !== note.id).length; const mine = isCurrent('task', t.id);
                return <PickRow key={t.id} onClick={() => pickTask(t)} muted={!!t.completedAt} right={mine ? check : count ? <span className="label" style={{ fontSize: 9 }}>{count} {count === 1 ? 'note' : 'notes'}</span> : null}>
                  <span style={{ textDecoration: t.completedAt ? 'line-through' : 'none' }}>{t.title}</span>
                </PickRow>;
              })}
            </React.Fragment>
          )}
        </div>
        {current && (
          <div style={{ marginTop: 14, paddingTop: 12, borderTop: '1px solid var(--line)', display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 10 }}>
            <span style={{ fontSize: 12, color: 'var(--ink-3)' }}>Detaching keeps the note as freeform.</span>
            <Button variant="plain" size="sm" icon={<IUnlink s={13}/>} onClick={() => onPick(null)}>Detach</Button>
          </div>
        )}
      </Dialog>
    </React.Fragment>
  );
}

Object.assign(window, { AttachPicker, PickRow });
