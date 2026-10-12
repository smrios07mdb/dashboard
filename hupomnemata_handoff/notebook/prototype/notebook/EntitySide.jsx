// Entity side: where an attached note shows up — task rows (Dashboard / Category / Subcategory),
// the task ⋯ menu's "Notes" (a sheet, replacing EditNotesDialog), the subcategory drill-down's
// Notes section, and the planner block action sheet.

const useNoteSheet = (notes, setNotes, onToast) => {
  const [taskId, setTaskId] = React.useState(null);
  const [noteId, setNoteId] = React.useState(null);
  const openFor = (t) => {
    const existing = nbTaskNotes(notes, t.id);
    if (existing.length === 0) {
      const id = 'n-' + Date.now();
      setNotes(ns => [{ id, title: '', body: '', pinned: false, createdAt: NB_NOW.toISOString(), updatedAt: NB_NOW.toISOString(), attachment: { kind: 'task', id: t.id } }, ...ns]);
      setNoteId(id);
    } else setNoteId(existing.length === 1 ? existing[0].id : null); // many → list first
    setTaskId(t.id);
  };
  return { taskId, noteId, setNoteId, openFor, close: () => { setTaskId(null); setNoteId(null); } };
};

// Task row — the dashboard grid with the note indicator between title and estimate. `notes` = this task's notes.
const TaskRowNB = ({ task, notes, onNotes, touch, hue, onOpenNote }) => {
  const completed = !!task.completedAt; const p1 = task.priority === 1 && !completed;
  const s = touch ? 44 : 24; const count = notes.length; const note = notes[0];
  return (
    <div onMouseEnter={(e) => e.currentTarget.style.background = 'var(--bg-alt)'} onMouseLeave={(e) => e.currentTarget.style.background = 'transparent'}
      style={{ display: 'grid', gridTemplateColumns: `18px 1fr auto auto ${touch ? '' : 'auto auto '}auto`, alignItems: 'center', gap: 10, padding: touch ? '6px 10px 6px 12px' : 'var(--row-pad)', paddingLeft: p1 ? 9 : 12, borderTop: '1px solid var(--line)', borderLeft: '3px solid ' + (p1 ? 'var(--destructive)' : 'transparent'), opacity: completed ? .5 : 1, transition: 'background .12s' }}>
      <Check checked={completed} size={18}/>
      <span style={{ fontSize: 13, color: 'var(--ink)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', textDecoration: completed ? 'line-through' : 'none', textDecorationColor: 'var(--ink-3)' }}>{task.title}</span>
      <span style={{ minWidth: s, display: 'inline-flex', justifyContent: 'center' }}>
        {note ? <IconBtn label={count > 1 ? `${count} notes` : `Open note: ${nbFirstLine(note)}`} size={s} tone="ink" onClick={() => onOpenNote(task)} style={{ width: 'auto', padding: '0 4px', gap: 3 }}><INote s={14}/>{count > 1 && <span className="num" style={{ fontSize: 11 }}>{count}</span>}</IconBtn> : null}
      </span>
      <span className="num" style={{ fontSize: 12, color: 'var(--ink-3)' }}>{fmtMin(task.estimateMinutes)}</span>
      {!touch && <IconBtn label="Set reminder" size={24}><IBell s={14}/></IconBtn>}
      {!touch && <IconBtn label="Delete" size={24}><ITrash s={14}/></IconBtn>}
      <span style={{ width: s, height: s, display: 'inline-flex', alignItems: 'center', justifyContent: 'center' }}>
        <Menu items={[
          { icon: <IMove s={14}/>, label: 'Move to…' }, { icon: <IFilter s={14}/>, label: 'Set priority…', right: task.priority ? 'P' + task.priority : '' }, { icon: <IBell s={14}/>, label: 'Set reminder…' }, { icon: <IClock s={14}/>, label: 'Block time' },
          { icon: <INote s={14}/>, label: count > 1 ? `Notes` : note ? 'Notes' : 'Add a note', onClick: () => onNotes(task), right: count > 1 ? String(count) : note ? nbRel(note.updatedAt) : '' },
          '-', { icon: <ITrash s={14}/>, label: 'Delete', tone: 'danger' },
        ]}/>
      </span>
    </div>
  );
};

// The task-side sheet: the SAME notes the Notebook shows, seen from the task. One note → editor;
// several → a list first, then the editor with a back chevron.
const TaskNoteSheet = ({ taskId, noteId, setNoteId, notes, setNotes, onClose, onOpenInNotebook, touch, saveState, onToast }) => {
  const task = taskId ? nbTask(taskId) : null;
  const taskNotes = task ? nbTaskNotes(notes, task.id) : [];
  const note = noteId ? notes.find(n => n.id === noteId) : null;
  const [picker, setPicker] = React.useState(false);
  const update = (p) => setNotes(ns => ns.map(n => n.id === note.id ? { ...n, ...p, updatedAt: NB_NOW.toISOString() } : n));
  const sub = task ? nbSub(task.subcategoryId) : null;
  const addAnother = () => { const id = 'n-' + Date.now(); setNotes(ns => [{ id, title: '', body: '', pinned: false, createdAt: NB_NOW.toISOString(), updatedAt: NB_NOW.toISOString(), attachment: { kind: 'task', id: task.id } }, ...ns]); setNoteId(id); };
  const titleEl = (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8, minWidth: 0 }}>
      {note && taskNotes.length > 1 && <IconBtn label="All notes on this task" size={touch ? 40 : 28} tone="ink" onClick={() => setNoteId(null)} style={{ marginLeft: -8 }}><IChevL s={18}/></IconBtn>}
      <span style={{ width: 8, height: 8, borderRadius: '50%', flexShrink: 0, background: sub ? catColor(nbCatOf(sub).name) : undefined }}/>
      <span style={{ fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{task && task.title}</span>
      {!note && taskNotes.length > 1 && <span className="num" style={{ fontSize: 11, color: 'var(--ink-3)' }}>{taskNotes.length} notes</span>}
    </span>
  );
  return (
    <Sheet open={!!task} onClose={onClose} width={480} title={titleEl}>
      {task && !note && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          <div style={{ border: '1px solid var(--line)', borderRadius: 'var(--radius-md)', overflow: 'hidden' }}>
            {taskNotes.map(n => (
              <button key={n.id} onClick={() => setNoteId(n.id)} onMouseEnter={(e) => e.currentTarget.style.background = 'var(--bg-alt)'} onMouseLeave={(e) => e.currentTarget.style.background = 'transparent'}
                style={{ display: 'grid', gridTemplateColumns: '1fr auto', gap: '2px 12px', width: '100%', textAlign: 'left', padding: '12px 14px', minHeight: 44, borderBottom: '1px solid var(--line)' }}>
                <span style={{ fontSize: 13.5, fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', color: n.title ? 'var(--ink)' : 'var(--ink-2)', fontStyle: n.title ? 'normal' : 'italic' }}>{nbFirstLine(n)}</span>
                <span className="num" style={{ fontSize: 11, color: 'var(--ink-3)' }}>{nbRel(n.updatedAt)}</span>
                <span style={{ gridColumn: '1 / -1', fontSize: 12.5, color: 'var(--ink-2)', display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden' }}>{nbExcerpt(n)}</span>
              </button>
            ))}
          </div>
          <div style={{ display: 'flex', gap: 8 }}>
            <Button variant="ghost" icon={<IPlus s={14}/>} onClick={addAnother}>New note</Button>
            <Button variant="plain" icon={<IBook s={14}/>} onClick={() => { onClose(); onOpenInNotebook(taskNotes[0].id); }}>Open in Notebook</Button>
          </div>
        </div>
      )}
      {note && <NoteEditor key={note.id} note={note} embedded touch={touch} saveState={saveState} autoFocusBody={!note.body}
        onChange={update} onDelete={() => { setNotes(ns => ns.filter(n => n.id !== note.id)); if (taskNotes.length > 1) setNoteId(null); else onClose(); onToast('Note deleted.'); }}
        onAttach={() => setPicker(true)} onDetach={() => { update({ attachment: null }); onClose(); onToast(`Detached from ${task.title}. It is now a freeform note.`); }}
        onOpenInNotebook={() => { onClose(); onOpenInNotebook(note.id); }} onAddAnother={addAnother}/>}
      {note && <AttachPicker open={picker} onClose={() => setPicker(false)} notes={notes} note={note} onPick={(att) => { setPicker(false); update({ attachment: att }); if (!att || att.kind !== 'task' || att.id !== task.id) { onClose(); onToast(att ? 'Note moved.' : `Detached from ${task.title}.`); } }}/>}
    </Sheet>
  );
};

// Dashboard excerpt: the Work column card with one subcategory section open.
function DashboardSide({ notes, setNotes, device, onOpenInNotebook, saveState, onToast }) {
  const touch = device !== 'desktop'; const phone = device === 'phone';
  const sheet = useNoteSheet(notes, setNotes, onToast);
  const sub = nbSub('s-atlas'); const tasks = NB_TASKS.filter(t => t.subcategoryId === sub.id);
  const subNotes = nbNotesFor(notes, 'subcategory', sub.id);
  return (
    <div style={{ padding: phone ? '18px 16px 90px' : '24px 28px' }}>
      <header style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 14 }}>
        <span style={{ width: 6, height: 30, borderRadius: 3, background: 'var(--work)', boxShadow: '0 0 14px var(--work-soft)' }}/>
        <span className="display" style={{ fontSize: phone ? 26 : 31, fontWeight: 500, color: 'var(--work)', letterSpacing: '-.02em' }}>Work</span>
        <span style={{ background: 'var(--work)', color: '#fff', borderRadius: 999, padding: '2px 9px', fontSize: 11, fontWeight: 600, boxShadow: 'var(--shadow-sm)' }}>{tasks.filter(t => !t.completedAt).length + 1} OPEN</span>
        <span className="num" style={{ fontSize: 12, color: 'var(--ink-3)' }}>4h 25m</span>
        <span style={{ marginLeft: 'auto' }}/><IconBtn label="Open Work" size={touch ? 44 : 28}><IChevR s={16}/></IconBtn>
      </header>
      <div style={{ background: 'var(--surface)', borderTop: '3px solid var(--work)', borderRadius: 'var(--radius-md)', boxShadow: 'var(--shadow-md)', overflow: 'hidden', maxWidth: 640 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '12px 12px 10px' }}>
          <IChevD s={14} style={{ color: 'var(--ink-3)' }}/>
          <span style={{ width: 9, height: 9, borderRadius: '50%', background: sub.hue, boxShadow: `0 0 0 3px color-mix(in srgb, ${sub.hue} 18%, transparent)` }}/>
          <span style={{ fontSize: 14, fontWeight: 600, flex: 1, minWidth: 0, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{sub.name}</span>
          <span className="num" style={{ fontSize: 11, color: 'var(--ink-3)', whiteSpace: 'nowrap' }}>{tasks.filter(t => !t.completedAt).length} open{!phone && ' · 3h 15m'}</span>
          {subNotes.length > 0 && <span title={`${subNotes.length} note${subNotes.length > 1 ? 's' : ''} on this list`} style={{ display: 'inline-flex', alignItems: 'center', gap: 4, color: 'var(--ink-3)', fontSize: 11 }} className="num"><INote s={13}/>{subNotes.length}</span>}
          <IconBtn label="Open list" size={touch ? 44 : 24}><IChevR s={14}/></IconBtn>
        </div>
        {tasks.map(t => <TaskRowNB key={t.id} task={t} notes={nbTaskNotes(notes, t.id)} touch={touch} onNotes={sheet.openFor} onOpenNote={sheet.openFor}/>)}
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '12px 12px 10px', borderTop: '1px solid var(--line)' }}>
          <IChevR s={14} style={{ color: 'var(--ink-3)' }}/><span style={{ width: 9, height: 9, borderRadius: '50%', background: nbSub('s-hiring').hue }}/><span style={{ fontSize: 14, fontWeight: 600, flex: 1, minWidth: 0 }}>Hiring</span><span className="num" style={{ fontSize: 11, color: 'var(--ink-3)', whiteSpace: 'nowrap' }}>1 open{!phone && ' · 40m'}</span>
        </div>
      </div>
      <p style={{ maxWidth: 640, marginTop: 14, fontSize: 12, color: 'var(--ink-3)' }}>The note glyph marks tasks that have notes; a count follows it when there are several. Tap it, or ⋯ → Notes, to open them in a sheet. Lists with notes show a count beside the list name.</p>
      <TaskNoteSheet taskId={sheet.taskId} noteId={sheet.noteId} setNoteId={sheet.setNoteId} notes={notes} setNotes={setNotes} onClose={sheet.close} onOpenInNotebook={onOpenInNotebook} touch={touch} saveState={saveState} onToast={onToast}/>
    </div>
  );
}

// Subcategory drill-down with its Notes section.
function SubcategorySide({ notes, setNotes, device, onOpenInNotebook, saveState, onToast }) {
  const touch = device !== 'desktop'; const phone = device === 'phone';
  const sheet = useNoteSheet(notes, setNotes, onToast);
  const sub = nbSub('s-atlas'); const cat = nbCatOf(sub); const tasks = NB_TASKS.filter(t => t.subcategoryId === sub.id);
  const subNotes = notes.filter(n => n.attachment && ((n.attachment.kind === 'subcategory' && n.attachment.id === sub.id) || (n.attachment.kind === 'task' && tasks.some(t => t.id === n.attachment.id)))).sort((a, b) => new Date(b.updatedAt) - new Date(a.updatedAt));
  const newHere = () => { const id = 'n-' + Date.now(); setNotes(ns => [{ id, title: '', body: '', pinned: false, createdAt: NB_NOW.toISOString(), updatedAt: NB_NOW.toISOString(), attachment: { kind: 'subcategory', id: sub.id } }, ...ns]); onOpenInNotebook(id); };
  return (
    <div style={{ padding: phone ? '14px 16px 90px' : '20px 28px 40px', maxWidth: 820 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, color: 'var(--ink-3)' }}><span>All</span><IChevR s={12}/><span>{cat.name}</span><IChevR s={12}/><span style={{ color: 'var(--ink)' }}>{sub.name}</span></div>
      <header style={{ display: 'flex', alignItems: 'baseline', gap: 14, margin: '12px 0 20px', flexWrap: 'wrap' }}>
        <span style={{ width: 6, height: 34, borderRadius: 3, background: catColor(cat.name), alignSelf: 'center' }}/>
        <h1 className="display" style={{ margin: 0, fontSize: phone ? 30 : 40, fontWeight: 500, letterSpacing: '-.02em' }}>{sub.name}</h1>
        <span className="label">{tasks.filter(t => !t.completedAt).length} open · 3h 15m · {subNotes.length} notes</span>
      </header>
      <div style={{ background: 'var(--surface)', border: '1px solid var(--line)', borderRadius: 'var(--radius-md)', overflow: 'hidden' }}>
        <div style={{ display: 'flex', padding: '8px 12px', background: 'var(--bg-alt)' }}><span className="label">Tasks</span></div>
        {tasks.map(t => <TaskRowNB key={t.id} task={t} notes={nbTaskNotes(notes, t.id)} touch={touch} onNotes={sheet.openFor} onOpenNote={sheet.openFor}/>)}
      </div>

      <section style={{ marginTop: 28 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 10 }}>
          <span className="label">Notes · {subNotes.length}</span><span style={{ marginLeft: 'auto' }}/>
          <Button variant="ghost" size={touch ? 'md' : 'sm'} icon={<IPlus s={13}/>} onClick={newHere}>New note here</Button>
        </div>
        <div style={{ background: 'var(--surface)', border: '1px solid var(--line)', borderRadius: 'var(--radius-md)', overflow: 'hidden' }}>
          {subNotes.length === 0 && <div style={{ padding: '24px 16px', textAlign: 'center', fontSize: 13, color: 'var(--ink-3)' }}>No notes on this list yet.</div>}
          {subNotes.map(n => { const r = nbResolve(n.attachment); return (
            <button key={n.id} onClick={() => r.task ? sheet.openFor(r.task) : onOpenInNotebook(n.id)} onMouseEnter={(e) => e.currentTarget.style.background = 'var(--bg-alt)'} onMouseLeave={(e) => e.currentTarget.style.background = 'transparent'}
              style={{ display: 'grid', gridTemplateColumns: '1fr auto', gap: '2px 12px', width: '100%', textAlign: 'left', padding: touch ? '13px 14px' : '10px 14px', minHeight: 44, borderBottom: '1px solid var(--line)' }}>
              <span style={{ fontSize: 13.5, fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', color: n.title ? 'var(--ink)' : 'var(--ink-2)', fontStyle: n.title ? 'normal' : 'italic' }}>{nbFirstLine(n)}</span>
              <span className="num" style={{ fontSize: 11, color: 'var(--ink-3)' }}>{nbRel(n.updatedAt)}</span>
              <span style={{ gridColumn: '1 / -1', fontSize: 12, color: 'var(--ink-3)', display: 'flex', alignItems: 'center', gap: 6 }}>{r.taskTitle ? <React.Fragment><INote s={12}/>{r.taskTitle}</React.Fragment> : 'On this list'}</span>
            </button>
          ); })}
        </div>
      </section>
      <TaskNoteSheet taskId={sheet.taskId} noteId={sheet.noteId} setNoteId={sheet.setNoteId} notes={notes} setNotes={setNotes} onClose={sheet.close} onOpenInNotebook={onOpenInNotebook} touch={touch} saveState={saveState} onToast={onToast}/>
    </div>
  );
}

// Planner block action sheet with the task's note: read-only preview + Open.
function PlannerBlockSide({ notes, device, onOpenInNotebook }) {
  const phone = device === 'phone';
  const task = nbTask('t-pricing'); const taskNotes = nbTaskNotes(notes, task.id); const note = taskNotes[0]; const sub = nbSub(task.subcategoryId);
  const [open, setOpen] = React.useState(true);
  return (
    <div style={{ padding: phone ? '18px 16px 90px' : '24px 28px', position: 'relative', minHeight: 420 }}>
      <div className="label" style={{ marginBottom: 10 }}>Wed 14 · 10:00–11:30</div>
      <button onClick={() => setOpen(true)} style={{ display: 'block', width: phone ? '100%' : 220, textAlign: 'left', background: 'var(--surface)', borderLeft: '3px solid ' + catColor(nbCatOf(sub).name), borderRadius: 'var(--radius)', boxShadow: 'var(--shadow-sm)', padding: '6px 8px' }}>
        <div style={{ fontSize: 12.5, fontWeight: 600, display: 'flex', alignItems: 'center', gap: 6 }}>{task.title}{note && <INote s={12} style={{ color: 'var(--ink-3)' }}/>}</div>
        <div className="num" style={{ fontSize: 10.5, color: 'var(--ink-3)' }}>10:00–11:30</div>
      </button>
      <p style={{ marginTop: 14, fontSize: 12, color: 'var(--ink-3)', maxWidth: 420 }}>Tap the block to open its action sheet. The block's note is the task's note, previewed read-only.</p>
      {open && (
        <React.Fragment>
          <div onClick={() => setOpen(false)} style={{ position: 'absolute', inset: 0, background: 'rgba(34,31,40,.30)', backdropFilter: 'blur(3px)', zIndex: 60, animation: 'fadein .15s ease-out forwards' }}/>
          <div style={{ position: 'absolute', left: phone ? 0 : '50%', right: phone ? 0 : 'auto', bottom: phone ? 0 : 'auto', top: phone ? 'auto' : '50%', transform: phone ? 'none' : 'translate(-50%,-50%)', width: phone ? 'auto' : 420, background: 'var(--surface)', borderRadius: phone ? '18px 18px 0 0' : 'var(--radius-md)', boxShadow: 'var(--shadow-lg)', zIndex: 61, padding: phone ? '14px 16px 24px' : 20, border: '1px solid var(--line)' }}>
            <div style={{ fontSize: 15, fontWeight: 600, letterSpacing: '-.01em' }}>{task.title}</div>
            <div className="num mono" style={{ fontSize: 11, color: 'var(--ink-3)', marginTop: 2 }}>10:00–11:30</div>
            {note && (
              <div style={{ margin: '14px 0 4px', padding: '10px 12px', borderRadius: 'var(--radius)', background: 'var(--surface-2)', border: '1px solid var(--line)' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}><span className="label">{taskNotes.length > 1 ? `Notes · ${taskNotes.length}` : 'Note'}</span><span className="num" style={{ fontSize: 10, color: 'var(--ink-3)' }}>{taskNotes.length > 1 ? 'latest ' : 'updated '}{nbRel(note.updatedAt)}</span><span style={{ marginLeft: 'auto' }}/><Button variant="plain" size="sm" onClick={() => onOpenInNotebook(note.id)} style={{ height: 28, padding: '0 6px', color: 'var(--accent-ink)' }}>Open<IArrowR s={13}/></Button></div>
                {note.title && <div style={{ fontSize: 13, fontWeight: 600, marginTop: 6 }}>{note.title}</div>}
                <div style={{ fontSize: 12.5, color: 'var(--ink-2)', lineHeight: 1.5, marginTop: 4, display: '-webkit-box', WebkitLineClamp: 3, WebkitBoxOrient: 'vertical', overflow: 'hidden' }}>{nbExcerpt(note)}</div>
              </div>
            )}
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginTop: 14 }}>
              <Button variant="ghost" style={{ height: 40 }}>Mark done</Button>
              <Button variant="ghost" style={{ height: 40, color: 'var(--destructive)' }}>Unschedule</Button>
              <Button variant="plain" style={{ height: 40 }} onClick={() => setOpen(false)}>Cancel</Button>
            </div>
          </div>
        </React.Fragment>
      )}
    </div>
  );
}

Object.assign(window, { TaskRowNB, TaskNoteSheet, DashboardSide, SubcategorySide, PlannerBlockSide });
