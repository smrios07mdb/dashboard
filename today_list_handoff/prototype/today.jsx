// "Today" — the day's plan, surfaced on the dashboard alongside the lists.
// A task lands in Today when it is overdue, has a reminder due today, is flagged
// Priority 1, OR the user pins it (the sun toggle). Three layouts: section / rail / banner.

// ── derivation ──────────────────────────────────────────────────────────────
function _todayBounds() {
  const s = new Date(); s.setHours(0, 0, 0, 0);
  const e = new Date(); e.setHours(23, 59, 59, 999);
  return [s.getTime(), e.getTime()];
}

// Why is this task on today's plan? Highest-precedence reason wins.
function todayReason(task) {
  if (!task || task.completedAt) return null;
  const [s, e] = _todayBounds();
  const now = Date.now();
  const r = task.remindAt ? new Date(task.remindAt).getTime() : null;
  if (r != null && r < now)            return { key: 'overdue',  label: 'Overdue',   color: 'var(--jewel-rose)',  rank: 0 };
  if (r != null && r >= s && r <= e)   return { key: 'due',      label: 'Due today', color: 'var(--accent)',      rank: 1 };
  if (task.priority === 1)             return { key: 'priority', label: 'Priority',  color: 'var(--personal)',    rank: 2 };
  return null;
}

// Ids the app auto-plans for today (before the user's manual pins/removes).
function autoTodayIds(tasks) {
  const ids = new Set();
  (tasks || []).forEach(t => { if (todayReason(t)) ids.add(t.id); });
  return ids;
}

// Resolve the final, ordered list of today tasks given the live pin set.
function resolveToday(data, todaySet) {
  const subName = {}, catOf = {};
  data.subcategories.forEach(s => {
    subName[s.id] = s.name;
    const cat = data.categories.find(c => c.id === s.categoryId);
    catOf[s.id] = cat ? cat.name : '';
  });
  const rows = data.tasks
    .filter(t => todaySet.has(t.id))
    .map(t => {
      const reason = todayReason(t) || { key: 'pinned', label: 'Pinned', color: 'var(--ink-3)', rank: 3 };
      return { task: t, reason, subName: subName[t.subcategoryId], catName: catOf[t.subcategoryId] };
    });
  rows.sort((a, b) =>
    (a.task.completedAt ? 1 : 0) - (b.task.completedAt ? 1 : 0) ||
    a.reason.rank - b.reason.rank ||
    (a.task.estimateMinutes - b.task.estimateMinutes));
  return rows;
}

function _todayDate() {
  return new Date().toLocaleDateString(undefined, { weekday: 'long', month: 'short', day: 'numeric' });
}

// ── one task line inside the Today plan ─────────────────────────────────────
function TodayRow({ row, onToggle, onRemove, compact }) {
  const { task, reason, subName, catName } = row;
  const completed = !!task.completedAt;
  const cat = catColor(catName);
  return (
    <div
      onMouseEnter={(e) => e.currentTarget.style.background = 'var(--bg-alt)'}
      onMouseLeave={(e) => e.currentTarget.style.background = 'transparent'}
      style={{
        position: 'relative',
        display: 'grid',
        gridTemplateColumns: '22px 1fr auto auto',
        alignItems: 'center', gap: 11,
        padding: compact ? '7px 10px' : '9px 12px',
        borderRadius: 'var(--radius)',
        borderLeft: '3px solid ' + (completed ? 'transparent' : cat),
        paddingLeft: completed ? (compact ? 10 : 12) : (compact ? 7 : 9),
        opacity: completed ? 0.5 : 1,
        transition: 'background .12s, opacity .35s ease',
      }}>
      <Check checked={completed} onChange={onToggle} size={16} />
      <div style={{ minWidth: 0 }}>
        <div style={{
          fontSize: 13.5, color: 'var(--ink)', lineHeight: 1.35,
          textDecoration: completed ? 'line-through' : 'none',
          textDecorationColor: 'var(--ink-3)',
          overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
        }} title={task.title}>{task.title}</div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: 4, minWidth: 0 }}>
          <span style={{
            display: 'inline-flex', alignItems: 'center', gap: 5, flexShrink: 0,
            fontSize: 11, fontWeight: 500, color: cat,
            padding: '2px 8px 2px 6px', borderRadius: 999,
            background: `color-mix(in srgb, ${cat} 10%, transparent)`,
            border: `1px solid color-mix(in srgb, ${cat} 22%, transparent)`,
            maxWidth: 170, overflow: 'hidden',
          }} title={catName + ' · ' + subName}>
            <span style={{ width: 6, height: 6, borderRadius: 2, background: cat, flexShrink: 0 }} />
            <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{subName}</span>
          </span>
          {!completed && (
            <span style={{
              flexShrink: 0,
              fontFamily: 'var(--font-mono)', fontSize: 9, fontWeight: 600,
              letterSpacing: '.08em', textTransform: 'uppercase',
              color: cat,
              padding: '1px 6px', borderRadius: 999,
              background: `color-mix(in srgb, ${cat} 12%, transparent)`,
            }}>{reason.label}</span>
          )}
        </div>
      </div>
      <span className="num" style={{ fontSize: 12, color: 'var(--ink-3)', whiteSpace: 'nowrap' }}>{fmtMin(task.estimateMinutes)}</span>
      <IconBtn size={24} label="Remove from today" onClick={onRemove} tone="ghost">
        <IX s={13} />
      </IconBtn>
    </div>
  );
}

// compact chip used by the banner layout
function TodayChip({ row, onToggle }) {
  const { task, catName } = row;
  const completed = !!task.completedAt;
  const cat = catColor(catName);
  return (
    <button onClick={onToggle} title={task.title}
      style={{
        display: 'inline-flex', alignItems: 'center', gap: 8,
        padding: '7px 12px 7px 9px', borderRadius: 999,
        background: 'var(--surface)', border: '1px solid var(--line)',
        boxShadow: 'var(--shadow-sm)', maxWidth: 280,
        opacity: completed ? 0.5 : 1,
      }}>
      <span aria-hidden style={{
        width: 15, height: 15, borderRadius: 5, flexShrink: 0,
        border: '1.4px solid ' + (completed ? 'var(--accent)' : cat),
        background: completed ? 'var(--accent)' : 'transparent',
        display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
      }}>
        {completed && <svg width="9" height="9" viewBox="0 0 24 24" fill="none" stroke="var(--bg)" strokeWidth="3.4" strokeLinecap="round" strokeLinejoin="round"><path d="M4 12l5 5L20 6" /></svg>}
      </span>
      <span style={{
        fontSize: 12.5, color: 'var(--ink)', fontWeight: 500,
        textDecoration: completed ? 'line-through' : 'none', textDecorationColor: 'var(--ink-3)',
        overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
      }}>{task.title}</span>
      <span className="num" style={{ fontSize: 11, color: 'var(--ink-3)', flexShrink: 0 }}>{fmtMin(task.estimateMinutes)}</span>
    </button>
  );
}

// ── the panel ───────────────────────────────────────────────────────────────
// variant: 'section' (full-width card above the lists) | 'rail' (narrow side column) | 'banner' (top strip)
function TodayPanel({ data, todaySet, onToggleToday, onTaskAction, variant = 'section', compact, mobile }) {
  // let a just-completed task linger ~1s so the strike-through reads before it drops
  const [linger, setLinger] = React.useState(() => new Set());
  const prev = React.useRef(data.tasks);
  React.useEffect(() => {
    const pm = new Map(prev.current.map(t => [t.id, t]));
    const newlyDone = data.tasks.filter(t => t.completedAt && pm.has(t.id) && !pm.get(t.id).completedAt);
    prev.current = data.tasks;
    if (newlyDone.length) {
      setLinger(s => { const n = new Set(s); newlyDone.forEach(t => n.add(t.id)); return n; });
      newlyDone.forEach(t => setTimeout(() =>
        setLinger(s => { const n = new Set(s); n.delete(t.id); return n; }), 1000));
    }
  }, [data.tasks]);

  const all = resolveToday(data, todaySet);
  const open = all.filter(r => !r.task.completedAt);
  const visible = all.filter(r => !r.task.completedAt || linger.has(r.task.id));
  const doneCount = all.length - open.length;
  const minutes = open.reduce((s, r) => s + r.task.estimateMinutes, 0);
  const pct = all.length ? doneCount / all.length : 0;

  const toggle = (r) => onTaskAction({ type: 'toggle', task: r.task });
  const remove = (r) => onToggleToday(r.task.id, false);

  const banner = variant === 'banner';
  const rail = variant === 'rail';

  // ── resizable list height (stacked/rail only, persisted) ──
  const MIN_H = 120, MAX_H = 760, DEFAULT_H = 360;
  const [listH, setListH] = React.useState(() => {
    const v = parseInt(localStorage.getItem('hup:todayHeight'), 10);
    return Number.isFinite(v) ? Math.min(MAX_H, Math.max(MIN_H, v)) : DEFAULT_H;
  });
  const onResizeStart = (e) => {
    e.preventDefault();
    const startY = e.touches ? e.touches[0].clientY : e.clientY;
    const startH = listH;
    let latest = startH;
    const move = (ev) => {
      const y = ev.touches ? ev.touches[0].clientY : ev.clientY;
      if (ev.cancelable) ev.preventDefault();
      latest = Math.min(MAX_H, Math.max(MIN_H, startH + (y - startY)));
      setListH(latest);
    };
    const up = () => {
      window.removeEventListener('mousemove', move);
      window.removeEventListener('mouseup', up);
      window.removeEventListener('touchmove', move);
      window.removeEventListener('touchend', up);
      document.body.style.userSelect = '';
      localStorage.setItem('hup:todayHeight', String(Math.round(latest)));
    };
    window.addEventListener('mousemove', move);
    window.addEventListener('mouseup', up);
    window.addEventListener('touchmove', move, { passive: false });
    window.addEventListener('touchend', up);
    document.body.style.userSelect = 'none';
  };
  const resetH = () => { setListH(DEFAULT_H); localStorage.setItem('hup:todayHeight', String(DEFAULT_H)); };

  // ── header ──
  const header = (
    <div style={{
      display: 'flex', alignItems: banner ? 'center' : 'flex-end',
      justifyContent: 'space-between', gap: 14,
      flexWrap: banner ? 'wrap' : 'nowrap',
    }}>
      <div style={{ minWidth: 0 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 9 }}>
          <span style={{
            display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
            width: 22, height: 22, borderRadius: 7, flexShrink: 0,
            background: 'color-mix(in srgb, var(--accent) 14%, transparent)', color: 'var(--accent)',
          }}><ISun s={14} /></span>
          <h2 className="display" style={{
            margin: 0, fontSize: rail ? 19 : 22, fontWeight: 500,
            letterSpacing: '-.015em', color: 'var(--ink)',
          }}>Today</h2>
          <span className="label" style={{ fontSize: 9.5 }}>{_todayDate()}</span>
        </div>
        {!banner && (
          <p style={{ margin: '7px 0 0 31px', fontSize: 12.5, color: 'var(--ink-3)' }}>
            {open.length === 0
              ? (doneCount > 0 ? 'Plan cleared — every today task done.' : 'Nothing planned yet.')
              : <React.Fragment><span className="num" style={{ color: 'var(--ink)', fontWeight: 600 }}>{open.length}</span> to do · <span className="num">{fmtMin(minutes)}</span>{doneCount > 0 && <span> · <span className="num">{doneCount}</span> done</span>}</React.Fragment>}
          </p>
        )}
      </div>
      {/* progress dial-as-bar */}
      {all.length > 0 && (
        <div style={{ flexShrink: 0, textAlign: 'right', minWidth: banner ? 'auto' : 92 }}>
          <div style={{ display: 'flex', alignItems: 'baseline', gap: 5, justifyContent: 'flex-end' }}>
            <span className="num display" style={{ fontSize: 18, fontWeight: 600, color: 'var(--ink)' }}>{doneCount}</span>
            <span className="num" style={{ fontSize: 12, color: 'var(--ink-3)' }}>/ {all.length}</span>
          </div>
          <div style={{ height: 5, width: banner ? 96 : '100%', minWidth: 72, borderRadius: 999, background: 'var(--bg-alt)', overflow: 'hidden', marginTop: 5 }}>
            <div style={{
              height: '100%', width: `${pct * 100}%`, borderRadius: 999,
              background: 'linear-gradient(90deg, var(--work), var(--accent))',
              transition: 'width .9s cubic-bezier(.2,.7,.2,1)',
            }} />
          </div>
        </div>
      )}
    </div>
  );

  // ── body ──
  let bodyEl;
  if (banner) {
    bodyEl = visible.length === 0 ? null : (
      <div style={{ display: 'flex', alignItems: 'center', gap: 9, flexWrap: 'wrap', marginTop: 12 }}>
        {visible.map(r => <TodayChip key={r.task.id} row={r} onToggle={() => toggle(r)} />)}
      </div>
    );
  } else if (visible.length === 0) {
    bodyEl = (
      <div style={{
        marginTop: 14, padding: '20px 16px', textAlign: 'center',
        border: '1px dashed var(--line-strong)', borderRadius: 'var(--radius)',
      }}>
        <p style={{ margin: 0, fontSize: 12.5, color: 'var(--ink-3)', lineHeight: 1.5 }}>
          {doneCount > 0 ? 'All done for today. ' : ''}Tap the <ISun s={12} style={{ display: 'inline', verticalAlign: '-2px', margin: '0 1px' }} /> on any task to plan your day.
        </p>
      </div>
    );
  } else {
    bodyEl = (
      <React.Fragment>
      <div style={{
        marginTop: 12,
        display: 'flex', flexDirection: 'column', gap: 2,
        maxHeight: mobile ? 'none' : listH,
        overflowY: mobile ? 'visible' : 'auto',
      }} className="lst">
        {visible.map(r => (
          <TodayRow key={r.task.id} row={r} compact={compact}
            onToggle={() => toggle(r)} onRemove={() => remove(r)} />
        ))}
      </div>
      {!mobile && (
        <div
          onMouseDown={onResizeStart} onTouchStart={onResizeStart}
          onDoubleClick={resetH}
          title="Drag to resize · double-click to reset"
          role="separator" aria-orientation="horizontal"
          style={{
            marginTop: 4, height: 16, cursor: 'ns-resize',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            touchAction: 'none',
          }}
          onMouseEnter={(e) => e.currentTarget.firstChild.style.background = 'var(--ink-3)'}
          onMouseLeave={(e) => e.currentTarget.firstChild.style.background = 'var(--line-strong)'}>
          <span style={{
            width: 34, height: 4, borderRadius: 999,
            background: 'var(--line-strong)', transition: 'background .12s',
          }} />
        </div>
      )}
      </React.Fragment>
    );
  }

  return (
    <div style={{
      background: rail
        ? 'linear-gradient(180deg, color-mix(in srgb, var(--accent) 7%, var(--surface)), var(--surface))'
        : 'linear-gradient(135deg, var(--surface), var(--surface-2))',
      border: '1px solid var(--line)',
      borderTop: rail ? '3px solid var(--accent)' : '1px solid var(--line)',
      borderRadius: 'var(--radius-md)',
      boxShadow: 'var(--shadow-md)',
      padding: banner ? '14px 18px' : '18px 18px 16px',
      position: rail && !mobile ? 'sticky' : 'static',
      top: rail && !mobile ? 84 : 'auto',
    }}>
      {header}
      {bodyEl}
    </div>
  );
}

Object.assign(window, {
  todayReason, autoTodayIds, resolveToday, TodayPanel, TodayRow, TodayChip,
});
