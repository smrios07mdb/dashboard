// Note editor. One component for the Notebook pane, the phone full-screen view and the task-side sheet.
// Formatting entry: Markdown-as-you-type. The prototype approximates it as source-on-focus /
// rendered-on-blur; production uses a live editor with the same four shortcuts (#, ##, -, links).

const EditorHint = () => (
  <span style={{ fontSize: 12, color: 'var(--ink-3)' }}>Write. <span className="mono">#</span> for a heading, <span className="mono">-</span> for a list, paste a link to link it.</span>
);

function NoteEditor({ note, onChange, onDelete, onAttach, onDetach, saveState = 'saved', touch, phone, onBack, embedded, onOpenInNotebook, onAddAnother, autoFocusBody }) {
  const [editingBody, setEditingBody] = React.useState(!!autoFocusBody || (!note.body && !note.title));
  const [confirm, setConfirm] = React.useState(false);
  const taRef = React.useRef(null);
  React.useEffect(() => { setEditingBody(!!autoFocusBody || (!note.body && !note.title)); setConfirm(false); }, [note.id]);
  React.useEffect(() => { if (editingBody && taRef.current) { const el = taRef.current; el.style.height = 'auto'; el.style.height = el.scrollHeight + 'px'; } }, [editingBody, note.body]);
  const res = nbResolve(note.attachment);
  const detached = !res && note.detachedFrom;
  const ctl = touch ? 40 : 28;
  const icon = touch ? 18 : 16;

  const attachControl = res ? (
    <div style={{ display: 'inline-flex', alignItems: 'center', gap: 2, minWidth: 0, maxWidth: '100%' }}>
      <AttachChip res={res} onClick={onAttach} size={touch || embedded ? 'sm' : 'md'} style={{ minHeight: ctl, flex: '0 1 auto', minWidth: 0 }}/>
      <IconBtn label={`Detach from ${res.taskTitle || res.subName}`} size={ctl} onClick={onDetach} style={{ flexShrink: 0 }}><IUnlink s={icon - 1}/></IconBtn>
    </div>
  ) : (
    <Button variant="ghost" size={touch ? 'md' : 'sm'} icon={<ILink s={14}/>} onClick={onAttach} style={{ color: 'var(--ink-2)', height: ctl }}>Attach</Button>
  );

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', minHeight: 0 }}>
      <header style={{ display: 'flex', alignItems: 'center', gap: 8, padding: phone ? '8px 10px 8px 6px' : embedded ? '0 0 12px' : '14px 18px', borderBottom: embedded ? 0 : '1px solid var(--line)', flexWrap: 'nowrap', minWidth: 0 }}>
        {onBack && <IconBtn label="Back to notes" size={44} onClick={onBack} tone="ink"><IChevL s={20}/></IconBtn>}
        <div style={{ minWidth: 0, flex: 1, display: 'flex', alignItems: 'center', gap: 8, overflow: 'hidden' }}>{attachControl}</div>
        <SaveState state={saveState} compact={phone || embedded}/>
        <IconBtn label={note.pinned ? 'Unpin' : 'Pin'} size={ctl} tone={note.pinned ? 'accent' : 'ghost'} onClick={() => onChange({ pinned: !note.pinned })}>{note.pinned ? <IPinOn s={icon}/> : <IPin s={icon}/>}</IconBtn>
        {embedded && onOpenInNotebook
          ? <Menu items={[{ icon: <IBook s={14}/>, label: 'Open in Notebook', onClick: onOpenInNotebook }, onAddAnother && { icon: <IPlus s={14}/>, label: 'New note on this task', onClick: onAddAnother }, '-', { icon: <ITrash s={14}/>, label: 'Delete note', tone: 'danger', onClick: () => setConfirm(true) }].filter(Boolean)}/>
          : <IconBtn label="Delete note" size={ctl} onClick={() => setConfirm(true)}><ITrash s={icon}/></IconBtn>}
      </header>

      <div className="lst" style={{ flex: 1, overflowY: 'auto', minHeight: 0, padding: phone ? '14px 20px 40px' : embedded ? '4px 0 20px' : '26px 36px 60px', maxWidth: embedded ? undefined : 720, width: '100%' }}>
        {detached && (
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 16, padding: '9px 12px', borderRadius: 'var(--radius)', background: 'var(--bg-alt)', fontSize: 12.5, color: 'var(--ink-2)' }}>
            <IUnlink s={14} style={{ color: 'var(--ink-3)' }}/>
            <span style={{ flex: 1 }}>Detached from <strong style={{ fontWeight: 600, color: 'var(--ink)' }}>{detached.name}</strong>, which was deleted on {nbDate(detached.deletedAt)}. The note was kept.</span>
          </div>
        )}
        <input value={note.title} onChange={(e) => onChange({ title: e.target.value })} placeholder="Untitled" aria-label="Title"
          className="title" style={{ width: '100%', border: 0, outline: 'none', background: 'transparent', fontSize: phone ? 26 : embedded ? 22 : 30, padding: 0, marginBottom: phone ? 8 : 12, lineHeight: 1.15 }}/>
        {editingBody ? (
          <textarea ref={taRef} autoFocus value={note.body} onChange={(e) => onChange({ body: e.target.value })} onBlur={() => { if (note.body.trim()) setEditingBody(false); }}
            placeholder="Write. # for a heading, - for a list, paste a link to link it." aria-label="Note body"
            style={{ width: '100%', border: 0, outline: 'none', background: 'transparent', resize: 'none', fontSize: touch ? 16 : 15, lineHeight: 1.6, color: 'var(--ink)', padding: 0, minHeight: 160, fontFamily: 'var(--font-ui)' }}/>
        ) : (
          <div onClick={() => setEditingBody(true)} role="button" tabIndex={0} onKeyDown={(e) => { if (e.key === 'Enter') setEditingBody(true); }} aria-label="Edit note body" style={{ cursor: 'text', minHeight: 120 }}>
            <NbMarkdown body={note.body} style={{ fontSize: touch ? 16 : 15 }}/>
          </div>
        )}
        <div style={{ marginTop: 28, display: 'flex', alignItems: 'center', gap: 14, flexWrap: 'wrap' }}>
          <span className="label">Created {nbDate(note.createdAt)} · Updated {nbRel(note.updatedAt) === 'now' ? 'just now' : nbRel(note.updatedAt).match(/^\d/) ? nbRel(note.updatedAt) + ' ago' : nbRel(note.updatedAt)}</span>
          {editingBody && !phone && <EditorHint/>}
        </div>
      </div>

      <Dialog open={confirm} title="Delete this note?" onClose={() => setConfirm(false)}
        actions={<React.Fragment><Button variant="ghost" onClick={() => setConfirm(false)}>Cancel</Button><Button variant="solid" style={{ background: 'var(--destructive)', borderColor: 'var(--destructive)' }} onClick={() => { setConfirm(false); onDelete(); }}>Delete</Button></React.Fragment>}>
        {res ? <span>This cannot be undone. The {res.taskTitle ? 'task' : 'list'} <strong style={{ color: 'var(--ink)', fontWeight: 600 }}>{res.taskTitle || res.subName}</strong> is not affected.</span> : 'This cannot be undone.'}
      </Dialog>
    </div>
  );
}

Object.assign(window, { NoteEditor, EditorHint });
