// Routines tab — Morning + Night with streak + 14-day dot grid + edit mode.

function streakFor(items, logs, routine) {
  const its = items.filter(i => i.routine === routine && !i.archivedAt);
  const today = new Date();
  let streak = 0;
  for (let d = 0; d < 90; d++) {
    const date = new Date(today); date.setDate(today.getDate() - d);
    const k = date.toISOString().slice(0, 10);
    // required items: those whose createdAt <= start of that day
    const startOfDay = new Date(date); startOfDay.setHours(0,0,0,0);
    const req = its.filter(i => new Date(i.createdAt) <= startOfDay);
    if (req.length === 0) break;
    const doneIds = new Set(logs.filter(l => l.dateKey === k && l.completed).map(l => l.routineItemId));
    const allDone = req.every(i => doneIds.has(i.id));
    if (d === 0) {
      // today only counts if all done; otherwise we look at yesterday's onward
      if (allDone) streak++;
      else { /* skip today, start from yesterday */ }
      continue;
    }
    if (allDone) streak++;
    else break;
  }
  return streak;
}

function DayGrid({ items, logs, routine }) {
  const today = new Date();
  const cells = [];
  for (let d = 13; d >= 0; d--) {
    const date = new Date(today); date.setDate(today.getDate() - d);
    const k = date.toISOString().slice(0, 10);
    const startOfDay = new Date(date); startOfDay.setHours(0,0,0,0);
    const req = items.filter(i => i.routine === routine && !i.archivedAt && new Date(i.createdAt) <= startOfDay);
    let state = 'empty';
    if (req.length === 0) state = 'faded';
    else {
      const doneIds = new Set(logs.filter(l => l.dateKey === k && l.completed).map(l => l.routineItemId));
      const all = req.every(i => doneIds.has(i.id));
      const some = req.some(i => doneIds.has(i.id));
      state = all ? 'full' : some ? 'partial' : 'empty';
    }
    cells.push({ k, state, isToday: d === 0,
      dow: ['S','M','T','W','T','F','S'][date.getDay()] });
  }
  return (
    <div style={{
      display: 'grid', gridTemplateColumns: 'repeat(14, 1fr)',
      gap: 6, marginTop: 18,
    }}>
      {cells.map((c, i) => (
        <div key={i} style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4 }}>
          <span style={{
            width: 20, height: 20, borderRadius: '50%',
            background:
              c.state === 'full' ? (routine === 'morning' ? '#e5b86a' : '#a78bfa') :
              c.state === 'partial' ? (routine === 'morning' ? 'rgba(229,184,106,.20)' : 'rgba(167,139,250,.20)') :
              c.state === 'faded' ? 'transparent' : 'var(--bg-alt)',
            border: c.state === 'faded' ? '1px dashed var(--line)' :
                    c.state === 'full' ? 'none' : '1px solid var(--line)',
            outline: c.isToday ? '2px solid var(--ink)' : 'none',
            outlineOffset: 2,
          }}/>
          <span className="num" style={{ fontSize: 10, color: 'var(--ink-4)' }}>{c.dow}</span>
        </div>
      ))}
    </div>
  );
}

function RoutinePanel({ routine, items, logs, todayKey, onToggle, onAdd, onRename, onRemove, onReorder, editing, setEditing }) {
  const my = items.filter(i => i.routine === routine && !i.archivedAt);
  const doneIds = new Set(logs.filter(l => l.dateKey === todayKey && l.completed).map(l => l.routineItemId));
  const streak = streakFor(items, logs, routine);
  const Icon = routine === 'morning' ? ISun : IMoon;
  const dotColor = routine === 'morning' ? '#e5b86a' : '#a78bfa';
  const [draft, setDraft] = React.useState('');
  const [renaming, setRenaming] = React.useState(null);
  const [renameVal, setRenameVal] = React.useState('');

  const allDone = my.length > 0 && my.every(i => doneIds.has(i.id));

  return (
    <section style={{
      background: 'var(--surface)', border: '1px solid var(--line)',
      borderRadius: 'var(--radius-md)', padding: 22,
    }}>
      <header style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 18 }}>
        <span style={{
          width: 32, height: 32, borderRadius: '50%',
          background: routine === 'morning' ? 'rgba(229,184,106,.15)' : 'rgba(167,139,250,.15)',
          color: routine === 'morning' ? '#e5b86a' : '#a78bfa',
          display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
        }}><Icon s={16}/></span>
        <h2 className="display" style={{ margin: 0, fontSize: 22, fontWeight: 500, letterSpacing: '-.01em' }}>
          {routine === 'morning' ? 'Morning' : 'Night'}
        </h2>
        <div style={{
          display: 'inline-flex', alignItems: 'center', gap: 5,
          padding: '4px 10px', borderRadius: 999,
          background: streak > 0 ? 'rgba(229,184,106,.13)' : 'var(--bg-alt)',
          color: streak > 0 ? '#f0d292' : 'var(--ink-3)',
          fontSize: 11, fontWeight: 500,
          letterSpacing: streak > 0 ? '0' : '.04em',
          textTransform: streak > 0 ? 'none' : 'uppercase',
          fontFamily: streak > 0 ? 'var(--font-ui)' : 'var(--font-mono)',
        }}>
          {streak > 0 ? (
            <React.Fragment>
              <IFlame s={12} style={{ color: '#e5b86a' }}/>
              <span className="num" style={{ color: '#f0d292', fontSize: 12 }}>{streak}</span>
              <span style={{ color: 'var(--ink-3)', fontSize: 12 }}>day{streak === 1 ? '' : 's'}</span>
            </React.Fragment>
          ) : (
            <span>Start today</span>
          )}
        </div>
        <span style={{ marginLeft: 'auto' }}/>
        <Button size="sm" variant={editing ? 'solid' : 'ghost'} onClick={() => setEditing(!editing)}>
          {editing ? 'Done' : 'Edit list'}
        </Button>
      </header>

      <div>
        {my.map((it, idx) => {
          const done = doneIds.has(it.id);
          if (editing) {
            return (
              <div key={it.id} style={{
                display: 'grid', gridTemplateColumns: '24px 1fr 28px',
                alignItems: 'center', gap: 10, padding: '8px 4px',
                borderBottom: idx === my.length - 1 ? 'none' : '1px solid var(--line)',
              }}>
                <span style={{ color: 'var(--ink-4)', cursor: 'grab' }}><IGrip s={14}/></span>
                {renaming === it.id ? (
                  <input autoFocus value={renameVal} onChange={e=>setRenameVal(e.target.value)}
                    onBlur={()=>{ onRename(it.id, renameVal); setRenaming(null); }}
                    onKeyDown={e=>{ if(e.key==='Enter'){ onRename(it.id, renameVal); setRenaming(null);} if (e.key==='Escape'){ setRenaming(null);} }}
                    style={{ border: 0, outline: 'none', background: 'var(--bg-alt)', borderRadius: 4, padding: '6px 8px', fontSize: 14 }}/>
                ) : (
                  <button onClick={()=>{ setRenameVal(it.label); setRenaming(it.id); }}
                    style={{ textAlign: 'left', fontSize: 14, color: 'var(--ink)' }}>{it.label}</button>
                )}
                <IconBtn label="Remove" onClick={()=>onRemove(it.id)} tone="danger"><IX s={14}/></IconBtn>
              </div>
            );
          }
          return (
            <label key={it.id}
              style={{
                display: 'flex', alignItems: 'center', gap: 14, padding: '10px 4px',
                borderBottom: idx === my.length - 1 ? 'none' : '1px solid var(--line)',
                cursor: 'pointer',
              }}
              onMouseEnter={(e)=>e.currentTarget.style.background='var(--bg-alt)'}
              onMouseLeave={(e)=>e.currentTarget.style.background='transparent'}>
              <Check checked={done} onChange={()=>onToggle(it.id, !done)} size={20}/>
              <span style={{
                fontSize: 14.5, color: done ? 'var(--ink-3)' : 'var(--ink)',
                textDecoration: done ? 'line-through' : 'none',
                textDecorationColor: 'var(--ink-3)', flex: 1,
              }}>{it.label}</span>
            </label>
          );
        })}

        {editing && (
          <div style={{ display: 'flex', gap: 8, marginTop: 14 }}>
            <Input value={draft} onChange={e=>setDraft(e.target.value)}
              placeholder="Add a new item…" style={{ flex: 1, height: 36 }}
              onKeyDown={e=>{ if(e.key==='Enter' && draft.trim()){ onAdd(draft.trim()); setDraft(''); } }}/>
            <Button onClick={()=>{ if(draft.trim()){ onAdd(draft.trim()); setDraft(''); } }} icon={<IPlus s={14}/>}>Add</Button>
          </div>
        )}

        {!editing && allDone && my.length > 0 && (
          <div style={{
            marginTop: 14, padding: '10px 14px', borderRadius: 'var(--radius)',
            background: routine === 'morning' ? 'rgba(229,184,106,.13)' : 'rgba(167,139,250,.13)',
            color: routine === 'morning' ? '#f0d292' : '#cdbefa',
            fontSize: 13, display: 'flex', alignItems: 'center', gap: 8,
          }}>
            <ICheck s={14}/> All done for today.
          </div>
        )}
      </div>

      <div style={{ marginTop: 20, paddingTop: 16, borderTop: '1px solid var(--line)' }}>
        <span className="label">Last 14 days</span>
        <DayGrid items={items} logs={logs} routine={routine}/>
      </div>
    </section>
  );
}

function Routines({ data, routineState, setRoutineState, mobile, mode, setMode }) {
  const todayKey = dayKey(0);
  const [editingM, setEditingM] = React.useState(false);
  const [editingN, setEditingN] = React.useState(false);

  const toggle = (id, val) => {
    setRoutineState(rs => {
      const others = rs.logs.filter(l => !(l.routineItemId === id && l.dateKey === todayKey));
      return {
        ...rs,
        logs: val ? [...others, { id: `l-${id}-${todayKey}`, routineItemId: id, dateKey: todayKey, completed: true }] : others,
      };
    });
  };

  const add = (routine, label) => {
    setRoutineState(rs => ({
      ...rs,
      items: [...rs.items, {
        id: `r-x-${Date.now()}`, routine, label, sortOrder: rs.items.length,
        archivedAt: null, createdAt: new Date().toISOString(),
      }],
    }));
  };
  const rename = (id, label) => {
    setRoutineState(rs => ({ ...rs, items: rs.items.map(i => i.id === id ? { ...i, label } : i) }));
  };
  const remove = (id) => {
    setRoutineState(rs => ({
      ...rs,
      items: rs.items.map(i => i.id === id ? { ...i, archivedAt: new Date().toISOString() } : i),
    }));
  };

  return (
    <div className="screen">
      <div style={{
        display: 'flex', alignItems: 'baseline', gap: 14, marginBottom: 22, flexWrap: 'wrap',
      }}>
        <h1 className="display" style={{ margin: 0, fontSize: 32, fontWeight: 500, letterSpacing: '-.02em' }}>
          Routines
        </h1>
        <span className="label">Daily rituals · streaks</span>
        <span style={{ marginLeft: 'auto' }}/>
        <Button size="sm" variant="ghost" icon={mode === 'light' ? <IMoon s={14}/> : <ISun s={14}/>}
          onClick={() => setMode(mode === 'light' ? 'dark' : 'light')}>
          {mode === 'light' ? 'Dark mode' : 'Light mode'}
        </Button>
      </div>

      <div style={{
        display: 'grid', gap: 22,
        gridTemplateColumns: mobile ? '1fr' : '1fr 1fr',
      }}>
        <RoutinePanel routine="morning"
          items={routineState.items} logs={routineState.logs} todayKey={todayKey}
          onToggle={toggle}
          onAdd={(label)=>add('morning', label)}
          onRename={rename} onRemove={remove}
          editing={editingM} setEditing={setEditingM}/>
        <RoutinePanel routine="night"
          items={routineState.items} logs={routineState.logs} todayKey={todayKey}
          onToggle={toggle}
          onAdd={(label)=>add('night', label)}
          onRename={rename} onRemove={remove}
          editing={editingN} setEditing={setEditingN}/>
      </div>
    </div>
  );
}

window.Routines = Routines;
