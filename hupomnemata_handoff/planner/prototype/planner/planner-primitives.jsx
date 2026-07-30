// Week Planner — shared primitives + mock data. Daylight tokens only.
// Exports on window at the bottom. Style objects use unique names (plnStyles).

const PL = { h0: 7 * 60, h1: 21 * 60, hourH: 52, gutter: 56, mHourH: 48, mGutter: 46,
  winCollapsedS: 8 * 60, winCollapsedE: 19 * 60, winFullS: 7 * 60, winFullE: 21 * 60,
  workS: 9 * 60, workE: 18 * 60 };

const pad2 = (n) => String(n).padStart(2, '0');
const fmtClock = (m) => `${pad2(Math.floor(m / 60))}:${pad2(m % 60)}`;
const fmtRange = (s, e) => `${fmtClock(s)}–${fmtClock(e)}`;
const snap15 = (m) => Math.round(m / 15) * 15;
const ceil15 = (m) => Math.ceil(m / 15) * 15;

// ---- Mock data: week of Mon May 4 – Sun May 10, 2026. Today = Wed 6, now 11:20.
const PLANNER_DATA = {
  weekLabel: 'May 4 – 10',
  weekMeta: 'WEEK 19 · 2026',
  days: [
    { d: 'MON', n: 4 }, { d: 'TUE', n: 5 }, { d: 'WED', n: 6 }, { d: 'THU', n: 7 },
    { d: 'FRI', n: 8 }, { d: 'SAT', n: 9 }, { d: 'SUN', n: 10 },
  ],
  today: 2,
  now: 11 * 60 + 20,
  staleSince: '09:14',
  busy: [
    { day: 0, s: 570, e: 600,  t: 'Standup',            src: 'outlook' },
    { day: 0, s: 840, e: 930,  t: 'Roadmap review',     src: 'outlook' },
    { day: 1, s: 660, e: 750,  t: 'Design crit',        src: 'outlook' },
    { day: 2, s: 540, e: 570,  t: 'Standup',            src: 'outlook' },
    { day: 3, s: 780, e: 870,  t: 'Quarterly planning', src: 'outlook' },
    { day: 4, s: 600, e: 660,  t: '1:1 — Maya',         src: 'outlook' },
    { day: 0, s: 1110, e: 1170, t: 'Pilates',           src: 'icloud' },
    { day: 1, s: 990, e: 1050, t: 'Dentist',            src: 'icloud' },
    { day: 2, s: 450, e: 495,  t: 'Gym',                src: 'icloud' },
    { day: 3, s: 1140, e: 1260, t: 'Dinner with Ana',   src: 'icloud' },
    { day: 5, s: 600, e: 690,  t: 'Brunch',             src: 'icloud' },
    { day: 6, s: 900, e: 960,  t: 'Call parents',       src: 'icloud' },
  ],
  scheduled: [
    { id: 's1', day: 0, s: 600, e: 645, title: 'Draft launch brief', cat: 'work', p: 1 },
    { id: 's2', day: 1, s: 540, e: 630, title: 'Migration plan review', cat: 'work', p: 2, done: true },
    { id: 's3', day: 2, s: 810, e: 855, title: 'Renew passport application', cat: 'personal', p: 2 },
    { id: 's4', day: 3, s: 900, e: 990, title: 'Prep board one-pager', cat: 'work', p: 2 },
    { id: 's5', day: 4, s: 480, e: 525, title: 'Plan weekend trip', cat: 'personal', p: 3 },
  ],
  tray: [
    { id: 'u1', p: 1, cat: 'work', title: 'Fix billing webhook retries', est: 60, due: 1, dueLabel: 'Due Tue 5' },
    { id: 'u2', p: 1, cat: 'personal', title: 'Renew car insurance', est: 30, due: 3, dueLabel: 'Due Thu 7' },
    { id: 'u3', p: 2, cat: 'work', title: 'Review Q3 hiring plan', est: 45, due: 4, dueLabel: 'Due Fri 8' },
    { id: 'u4', p: 2, cat: 'work', title: 'Write API changelog', est: 30, due: 8, dueLabel: 'Due May 12' },
    { id: 'u5', p: 2, cat: 'personal', title: 'Book flights to Lisbon', est: 40, due: 5, dueLabel: 'Due Sat 9' },
    { id: 'u6', p: 3, cat: 'work', title: 'Clean up stale feature flags', est: 90, due: null, dueLabel: null },
    { id: 'u7', p: 3, cat: 'personal', title: 'Sort photo library', est: 60, due: null, dueLabel: null },
    { id: 'u8', p: 3, cat: 'personal', title: 'Return library books', est: 15, due: 7, dueLabel: 'Due May 11' },
  ],
};

const isOverdue = (t) => t.due != null && t.due < PLANNER_DATA.today;
const isPastBlock = (t) => t.day < PLANNER_DATA.today || (t.day === PLANNER_DATA.today && t.e <= PLANNER_DATA.now);
const catC = (cat) => cat === 'work' ? 'var(--work)' : 'var(--personal)';

// ---- Priority meta. P2 tint derives from --warn via color-mix (no new colors).
const P_META = {
  1: { k: 'P1', name: 'Urgent',   desc: 'Needs to happen today',
       bg: 'var(--destructive-soft)', fg: 'var(--destructive)' },
  2: { k: 'P2', name: 'Soon',     desc: 'This week',
       bg: 'color-mix(in srgb, var(--warn) 16%, transparent)', fg: 'color-mix(in srgb, var(--warn) 62%, var(--ink))' },
  3: { k: 'P3', name: 'Whenever', desc: 'No pressure',
       bg: 'var(--bg-alt)', fg: 'var(--ink-3)' },
};

const PriorityChip = ({ p, size = 'md', onClick, style }) => {
  const m = P_META[p];
  const sm = size === 'sm';
  return (
    <span onClick={onClick} className="mono" style={{
      display: 'inline-flex', alignItems: 'center', flexShrink: 0,
      padding: sm ? '1px 4px' : '2px 6px', borderRadius: 'var(--radius-sm)',
      fontSize: sm ? 9 : 9.5, fontWeight: 600, letterSpacing: '.1em',
      background: m.bg, color: m.fg, cursor: onClick ? 'pointer' : 'default',
      lineHeight: '14px', ...style,
    }}>{m.k}</span>
  );
};

const CatDot = ({ cat, s = 8 }) => (
  <span style={{ width: s, height: s, borderRadius: 3, flexShrink: 0, background: catC(cat) }}/>
);

// Segmented sort control — matches Settings' merge/replace segment.
const SortSeg = ({ value, onChange, options, grow }) => (
  <div style={{
    display: 'inline-flex', padding: 2, borderRadius: 999,
    background: 'var(--bg-alt)', border: '1px solid var(--line)', width: grow ? '100%' : 'auto',
  }}>
    {options.map(o => (
      <button key={o} onClick={() => onChange(o)} style={{
        padding: '4px 10px', borderRadius: 999, fontSize: 11, flex: grow ? 1 : 'none',
        background: value === o ? 'var(--surface)' : 'transparent',
        boxShadow: value === o ? '0 1px 0 var(--line)' : 'none',
        fontWeight: value === o ? 600 : 500,
        color: value === o ? 'var(--ink)' : 'var(--ink-3)',
      }}>{o}</button>
    ))}
  </div>
);

// ---- Timeline blocks ------------------------------------------------------
// Clamped position within a visible window [h0,h1]. Returns null when fully outside.
const blockPos = (s, e, hourH, h0, h1) => {
  const cs = Math.max(s, h0), ce = Math.min(e, h1);
  if (ce <= h0 || cs >= h1) return null;
  return {
    top: (cs - h0) / 60 * hourH + 1,
    height: Math.max((ce - cs) / 60 * hourH - 2, 14),
    clipTop: s < h0, clipBot: e > h1,
  };
};

const ClipMark = ({ dir, m }) => (
  <span className="num mono" style={{ position: 'absolute', right: 5, fontSize: 8, color: 'var(--ink-3)',
    ...(dir === 'up' ? { top: 2 } : { bottom: 2 }) }}>{dir === 'up' ? '↑' : '↓'} {fmtClock(m)}</span>
);

// Busy overlay — context, not content. iCloud: plain neutral tint.
// Outlook: slightly cooler tint + fine 135° hatch. Stale Outlook: lighter + cached stamp.
const BusyBlock = ({ b, hourH, h0 = PL.h0, h1 = PL.h1, stale, onClick }) => {
  const pos = blockPos(b.s, b.e, hourH, h0, h1);
  if (!pos) return null;
  const cool = b.src === 'outlook';
  const isStale = stale && cool;
  return (
    <div onClick={onClick ? (e) => { e.stopPropagation(); onClick(b, pos); } : undefined} style={{
      position: 'absolute', left: 1, right: 1, top: pos.top, height: pos.height, zIndex: 1,
      borderRadius: 'var(--radius-sm)', opacity: isStale ? .55 : 1,
      background: cool
        ? 'repeating-linear-gradient(135deg, var(--busy-outlook-hatch) 0 1px, transparent 1px 6px), var(--busy-outlook)'
        : 'var(--busy-icloud)',
      boxShadow: `inset 0 0 0 1px ${cool ? 'var(--busy-outlook-ln)' : 'var(--busy-icloud-ln)'}`,
      padding: '4px 7px', overflow: 'hidden', display: 'flex', flexDirection: 'column',
      cursor: onClick ? 'pointer' : 'default',
    }}>
      {pos.height >= 26 && (
        <span style={{ fontSize: 10.5, fontWeight: 500, color: 'var(--ink-3)',
          whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{b.t}</span>
      )}
      {pos.height >= 46 && (
        <span className="label" style={{ fontSize: 8.5, letterSpacing: '.14em', opacity: .8, marginTop: 'auto' }}>
          {cool ? (isStale ? `OUTLOOK · ${PLANNER_DATA.staleSince}` : 'OUTLOOK') : 'ICLOUD'}
        </span>
      )}
      {pos.clipTop && <ClipMark dir="up" m={b.s}/>}
      {pos.clipBot && !pos.clipTop && <ClipMark dir="down" m={b.e}/>}
    </div>
  );
};

// Popover for a busy block — source, sync state, deep link. Read-only but inspectable.
function BusyPopover({ b, stale, top, alignRight, onClose }) {
  const ref = React.useRef(null);
  React.useEffect(() => {
    const h = (e) => { if (ref.current && !ref.current.contains(e.target)) onClose(); };
    document.addEventListener('mousedown', h);
    return () => document.removeEventListener('mousedown', h);
  }, []);
  const cool = b.src === 'outlook';
  const isStale = stale && cool;
  return (
    <div ref={ref} onClick={(e) => e.stopPropagation()} style={{
      position: 'absolute', top, [alignRight ? 'right' : 'left']: 2, zIndex: 25, width: 216,
      background: 'var(--surface)', border: '1px solid var(--line)', borderRadius: 'var(--radius)',
      boxShadow: '0 12px 32px rgba(31,29,26,.10)', padding: '11px 13px', animation: 'fadein .12s forwards',
    }}>
      <div style={{ fontSize: 13, fontWeight: 500, color: 'var(--ink)' }}>{b.t}</div>
      <div className="num mono" style={{ fontSize: 11, color: 'var(--ink-3)', marginTop: 2 }}>{fmtRange(b.s, b.e)}</div>
      <hr className="hairline" style={{ margin: '9px 0' }}/>
      <div className="label" style={{ fontSize: 8.5 }}>{cool ? 'OUTLOOK · WORK FEED' : 'ICLOUD · PERSONAL'}</div>
      <div className="num mono" style={{ fontSize: 11, marginTop: 4,
        color: isStale ? 'color-mix(in srgb, var(--warn) 62%, var(--ink))' : 'var(--ink-3)' }}>
        {isStale ? `Cached at ${PLANNER_DATA.staleSince} — feed unreachable` : 'Synced 12m ago'}
      </div>
      <a href="#" onClick={(e) => e.preventDefault()} style={{ display: 'inline-flex', alignItems: 'center', gap: 5,
        fontSize: 12, marginTop: 8, textDecoration: 'none' }}>
        Open in {cool ? 'Outlook' : 'Apple Calendar'} <IArrowR s={11}/>
      </a>
    </div>
  );
}

// Scheduled task block — the real content. done = quiet record; past + not done = carryover.
const SchedBlock = ({ t, hourH, h0 = PL.h0, h1 = PL.h1, onToggleDone, onCarryMove,
  onBodyDown, onResizeDown, dimmed, touch }) => {
  const pos = blockPos(t.s, t.e, hourH, h0, h1);
  const [hov, setHov] = React.useState(false);
  if (!pos) return null;
  const c = catC(t.cat);
  const carry = isPastBlock(t) && !t.done;
  const tight = pos.height < 40;
  const showActions = pos.height >= 24 && (touch ? (t.done || carry) : (hov || t.done));
  return (
    <div onMouseEnter={() => setHov(true)} onMouseLeave={() => setHov(false)}
      onPointerDown={onBodyDown ? (e) => onBodyDown(e, t) : undefined}
      style={{
        position: 'absolute', left: 3, right: 3, top: pos.top, height: pos.height, zIndex: 3,
        background: carry ? 'color-mix(in srgb, var(--surface) 55%, transparent)' : 'var(--surface)',
        border: carry ? '1px dashed var(--line-strong)' : '1px solid var(--line)',
        borderLeft: `3px solid ${t.done || carry ? `color-mix(in srgb, ${c} 45%, transparent)` : c}`,
        borderRadius: 'var(--radius)', opacity: dimmed ? .3 : t.done ? .72 : 1,
        boxShadow: carry || t.done ? 'none' : 'var(--shadow-sm)',
        padding: tight ? '3px 7px' : '5px 8px', overflow: 'hidden',
        display: 'flex', flexDirection: 'column', gap: 1,
        cursor: onBodyDown ? 'grab' : 'default', userSelect: 'none', touchAction: 'none',
      }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, minWidth: 0 }}>
        <span style={{ fontSize: 11.5, fontWeight: 500, lineHeight: 1.25, flex: 1, minWidth: 0,
          color: t.done ? 'var(--ink-3)' : carry ? 'var(--ink-2)' : 'var(--ink)',
          textDecoration: t.done ? 'line-through' : 'none', textDecorationColor: 'var(--ink-3)',
          whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{t.title}</span>
        {t.p === 1 && !tight && !t.done && <PriorityChip p={1} size="sm"/>}
        {showActions && carry && onCarryMove && (
          <button title="Move to next open slot" onPointerDown={(e) => e.stopPropagation()}
            onClick={(e) => { e.stopPropagation(); onCarryMove(t); }}
            style={{ display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
              width: 16, height: 16, borderRadius: 4, flexShrink: 0,
              border: '1px solid var(--line-strong)', background: 'var(--surface)', color: 'var(--ink-2)' }}>
            <IArrowR s={10}/>
          </button>
        )}
        {showActions && onToggleDone && (
          <button title={t.done ? 'Mark not done' : 'Mark done'} onPointerDown={(e) => e.stopPropagation()}
            onClick={(e) => { e.stopPropagation(); onToggleDone(t); }}
            style={{ display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
              width: 16, height: 16, borderRadius: 4, flexShrink: 0,
              border: `1.4px solid ${t.done ? c : 'var(--line-strong)'}`,
              background: t.done ? c : 'var(--surface)', color: '#fff' }}>
            {t.done && <ICheck s={10}/>}
          </button>
        )}
      </div>
      {!tight && (
        <span className="num mono" style={{ fontSize: 9.5, color: 'var(--ink-3)' }}>
          {fmtRange(t.s, t.e)}{carry ? ' · unfinished' : ''}
        </span>
      )}
      {pos.clipBot && <ClipMark dir="down" m={t.e}/>}
      {onResizeDown && !t.done && (
        <div onPointerDown={(e) => { e.stopPropagation(); onResizeDown(e, t); }}
          style={{ position: 'absolute', left: 0, right: 0, bottom: 0, height: 7, cursor: 'ns-resize' }}/>
      )}
    </div>
  );
};

// Drop-target / preview slot — category tint when clear, destructive when overlapping busy.
const DropSlot = ({ s, e, cat, kind, hourH, h0 = PL.h0, h1 = PL.h1, note }) => {
  const pos = blockPos(s, e, hourH, h0, h1);
  if (!pos) return null;
  const c = kind === 'conflict' ? 'var(--destructive)' : catC(cat);
  return (
    <div style={{
      position: 'absolute', left: 3, right: 3, top: pos.top, height: pos.height, zIndex: 4,
      borderRadius: 'var(--radius)', pointerEvents: 'none',
      border: `1.5px dashed color-mix(in srgb, ${c} 55%, transparent)`,
      background: `color-mix(in srgb, ${c} 7%, transparent)`,
      padding: '4px 8px', display: 'flex', flexDirection: 'column', gap: 2, overflow: 'hidden',
    }}>
      <span className="num mono" style={{ fontSize: 10, fontWeight: 600, color: c }}>{fmtRange(s, e)}</span>
      {kind === 'conflict' && (
        <span className="label" style={{ fontSize: 8.5, letterSpacing: '.12em', color: 'var(--destructive)', whiteSpace: 'normal', lineHeight: 1.35 }}>
          {note || 'CONFLICTS WITH BUSY'}
        </span>
      )}
    </div>
  );
};

// Auto-fit proposal block — not yet real, so no surface, just a category-tinted intent.
const ProposalBlock = ({ p, hourH, h0, h1 }) => {
  const pos = blockPos(p.s, p.e, hourH, h0, h1);
  if (!pos) return null;
  const c = catC(p.task.cat);
  return (
    <div style={{
      position: 'absolute', left: 3, right: 3, top: pos.top, height: pos.height, zIndex: 3,
      borderRadius: 'var(--radius)', border: `1.5px dashed color-mix(in srgb, ${c} 50%, transparent)`,
      background: `color-mix(in srgb, ${c} 6%, var(--surface))`,
      padding: pos.height < 40 ? '3px 7px' : '5px 8px', overflow: 'hidden',
      display: 'flex', flexDirection: 'column', gap: 1,
    }}>
      <span style={{ fontSize: 11.5, fontWeight: 500, color: 'var(--ink-2)', lineHeight: 1.25,
        whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{p.task.title}</span>
      {pos.height >= 40 && (
        <span className="num mono" style={{ fontSize: 9.5, color: c }}>{fmtRange(p.s, p.e)} · proposed</span>
      )}
    </div>
  );
};

const NowLine = ({ now, hourH, h0 = PL.h0, h1 = PL.h1 }) => {
  if (now < h0 || now > h1) return null;
  return (
    <div style={{ position: 'absolute', left: 0, right: 0, zIndex: 2, top: (now - h0) / 60 * hourH }}>
      <div style={{ height: 2, background: 'var(--work)', borderRadius: 1 }}/>
      <span style={{ position: 'absolute', left: -3, top: -2.5, width: 7, height: 7,
        borderRadius: '50%', background: 'var(--work)' }}/>
    </div>
  );
};

// Collapse rail — quiet expander for early-morning / evening hours.
const WindowRail = ({ expanded, onToggle, label, hiddenCount, side }) => (
  <button onClick={onToggle} className="mono" style={{
    display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6, width: '100%',
    padding: '5px 0', fontSize: 9, fontWeight: 500, letterSpacing: '.12em', textTransform: 'uppercase',
    color: 'var(--ink-3)', transition: 'color .12s',
    ...(side === 'bottom' ? { borderTop: '1px solid var(--line)' } : {}),
  }}
    onMouseEnter={(e)=>e.currentTarget.style.color='var(--ink-2)'}
    onMouseLeave={(e)=>e.currentTarget.style.color='var(--ink-3)'}>
    {expanded ? <IChevU s={10}/> : <IChevD s={10}/>}
    {expanded ? `HIDE ${label}` : `SHOW ${label}`}
    {!expanded && hiddenCount > 0 && <span style={{ color: 'var(--ink-4)' }}>· {hiddenCount} HIDDEN</span>}
  </button>
);

// ---- Tray card -------------------------------------------------------------
const TrayCard = ({ t, ghost, onClick, onPointerDown, proposedLabel }) => {
  const overdue = isOverdue(t);
  return (
    <div onClick={onClick} onPointerDown={onPointerDown} style={{
      background: 'var(--surface)', border: ghost ? '1px dashed var(--line-strong)' : '1px solid var(--line)',
      borderLeft: overdue && !ghost ? '3px solid var(--destructive)' : undefined,
      borderRadius: 'var(--radius)', padding: overdue && !ghost ? '10px 12px 10px 10px' : '10px 12px',
      boxShadow: ghost ? 'none' : 'var(--shadow-sm)', opacity: ghost ? .45 : proposedLabel ? .6 : 1,
      cursor: onClick || onPointerDown ? 'grab' : 'default', transition: 'border-color .12s',
      userSelect: 'none', touchAction: 'none',
    }}
      onMouseEnter={(e)=>{ if(!ghost) e.currentTarget.style.borderColor='var(--line-strong)'; }}
      onMouseLeave={(e)=>{ e.currentTarget.style.borderColor = ghost ? 'var(--line-strong)' : 'var(--line)'; }}>
      <div style={{ display: 'flex', alignItems: 'flex-start', gap: 8 }}>
        <PriorityChip p={t.p} style={{ marginTop: 1 }}/>
        <span style={{ fontSize: 13, fontWeight: 500, color: 'var(--ink)', lineHeight: 1.35, flex: 1, minWidth: 0 }}>{t.title}</span>
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 7, marginTop: 7 }}>
        <CatDot cat={t.cat}/>
        {proposedLabel ? (
          <span className="num mono" style={{ fontSize: 10.5, color: 'var(--accent-ink)', fontWeight: 600 }}>→ {proposedLabel}</span>
        ) : t.dueLabel && (
          <span style={{ fontSize: 11, color: overdue ? 'var(--destructive)' : t.due === PLANNER_DATA.today ? 'var(--ink-2)' : 'var(--ink-3)',
            fontWeight: overdue || t.due === PLANNER_DATA.today ? 500 : 400 }}>
            {overdue ? `Overdue · ${t.dueLabel.replace('Due ', '')}` : t.dueLabel}
          </span>
        )}
        <span style={{ marginLeft: 'auto' }}/>
        <span className="num mono" style={{ fontSize: 11, color: 'var(--ink-2)' }}>{fmtMin(t.est)}</span>
      </div>
    </div>
  );
};

// Stale-feed chip for planner headers.
const StaleChip = () => (
  <span className="mono" style={{
    display: 'inline-flex', alignItems: 'center', gap: 6, padding: '3px 9px', borderRadius: 999,
    background: 'color-mix(in srgb, var(--warn) 13%, transparent)',
    border: '1px solid color-mix(in srgb, var(--warn) 28%, transparent)',
    fontSize: 9, fontWeight: 600, letterSpacing: '.13em',
    color: 'color-mix(in srgb, var(--warn) 62%, var(--ink))',
  }}>
    <span style={{ width: 6, height: 6, borderRadius: '50%', background: 'var(--warn)' }}/>
    OUTLOOK FEED STALE
  </span>
);

// ---- Sorting & math --------------------------------------------------------
const sortTray = (tray, mode) => {
  const a = [...tray];
  if (mode === 'Priority') a.sort((x, y) => x.p - y.p || (x.due ?? 99) - (y.due ?? 99));
  if (mode === 'Due date') a.sort((x, y) => (x.due ?? 99) - (y.due ?? 99) || x.p - y.p);
  if (mode === 'Estimate') a.sort((x, y) => x.est - y.est);
  return a;
};

const clipWin = (s, e, wS, wE) => Math.max(0, Math.min(e, wE) - Math.max(s, wS));

// Week capacity: planned = all scheduled; free = Mon–Fri 09:00–18:00 minus busy minus scheduled.
const computeCapacity = (busy, scheduled) => {
  let busyM = 0, schedInWin = 0, planned = 0;
  busy.forEach(b => { if (b.day < 5) busyM += clipWin(b.s, b.e, PL.workS, PL.workE); });
  scheduled.forEach(t => { planned += t.e - t.s; if (t.day < 5) schedInWin += clipWin(t.s, t.e, PL.workS, PL.workE); });
  return { planned, free: Math.max(0, 5 * (PL.workE - PL.workS) - busyM - schedInWin) };
};

// Per-day remaining free minutes in the 09:00–18:00 window (today: from now).
const computeDayFree = (day, busy, scheduled) => {
  const D = PLANNER_DATA;
  if (day < D.today) return null;
  const wS = day === D.today ? Math.max(PL.workS, ceil15(D.now)) : PL.workS;
  let occ = 0;
  [...busy, ...scheduled].forEach(o => { if (o.day === day) occ += clipWin(o.s, o.e, wS, PL.workE); });
  return Math.max(0, (PL.workE - wS) - occ);
};

// Merged occupied ranges for a day.
const dayOcc = (day, busy, scheduled, extra = []) =>
  [...busy.filter(b => b.day === day), ...scheduled.filter(t => t.day === day), ...extra.filter(x => x.day === day)]
    .map(o => [o.s, o.e]).sort((a, b) => a[0] - b[0]);

// Open slots on a day, around busy + already-scheduled ranges. 08:00–20:00.
const findOpenSlots = (day, dur, busy, scheduled, isToday, now) => {
  const occ = dayOcc(day, busy, scheduled);
  let cur = isToday ? Math.max(480, ceil15(now + 10)) : 480;
  cur = ceil15(cur);
  const out = [];
  for (const [s, e] of occ) {
    if (s - cur >= dur && out.length < 3) out.push({ s: cur, e: cur + dur, until: s });
    cur = ceil15(Math.max(cur, e));
  }
  while (out.length < 3 && cur + dur <= 1200) { out.push({ s: cur, e: cur + dur, until: 1200 }); cur += Math.max(dur, 60) + 60; }
  return out.slice(0, 3);
};

// First open weekday slot from now, scanning today → Sunday (09:00–18:00).
const nextOpenSlot = (dur, busy, scheduled) => {
  const D = PLANNER_DATA;
  for (let d = D.today; d < 7; d++) {
    const occ = dayOcc(d, busy, scheduled);
    let cur = d === D.today ? Math.max(PL.workS, ceil15(D.now + 10)) : PL.workS;
    for (const [s, e] of occ) {
      if (s - cur >= dur) return { day: d, s: cur };
      cur = ceil15(Math.max(cur, e));
    }
    if (PL.workE - cur >= dur) return { day: d, s: cur };
  }
  return null;
};

// Auto-fit: propose earliest open weekday slots for every P1/P2 tray task.
const autoFill = (tray, busy, scheduled) => {
  const D = PLANNER_DATA;
  const cands = tray.filter(t => t.p <= 2).sort((a, b) => a.p - b.p || (a.due ?? 99) - (b.due ?? 99));
  const placed = [];
  for (const t of cands) {
    let hit = null;
    for (let d = D.today; d < 5 && !hit; d++) {
      const occ = dayOcc(d, busy, scheduled, placed);
      let cur = d === D.today ? Math.max(PL.workS, ceil15(D.now + 10)) : PL.workS;
      for (const [s, e] of occ) {
        if (s - cur >= t.est) { hit = { day: d, s: cur }; break; }
        cur = ceil15(Math.max(cur, e));
      }
      if (!hit && PL.workE - cur >= t.est) hit = { day: d, s: cur };
    }
    if (hit) placed.push({ id: 'ap-' + t.id, task: t, day: hit.day, s: hit.s, e: hit.s + t.est });
  }
  return placed;
};

// Busy overlap for a candidate range → { title, mins } | null.
const overlapBusy = (day, s, e, busy) => {
  let best = null;
  busy.forEach(b => {
    if (b.day !== day) return;
    const m = Math.max(0, Math.min(e, b.e) - Math.max(s, b.s));
    if (m > 0 && (!best || m > best.mins)) best = { title: b.t, mins: m };
  });
  return best;
};

// ---- Settings row/section (mirrors the app's Settings pattern) --------------
function PSettingsRow({ title, hint, children, align = 'top' }) {
  return (
    <div style={{
      display: 'grid', gridTemplateColumns: 'minmax(180px, 220px) 1fr', gap: 28, padding: '20px 0',
      borderBottom: '1px solid var(--line)', alignItems: align === 'center' ? 'center' : 'start',
    }}>
      <div>
        <div style={{ fontSize: 14, fontWeight: 500, color: 'var(--ink)' }}>{title}</div>
        {hint && <div style={{ fontSize: 12, color: 'var(--ink-3)', marginTop: 4, lineHeight: 1.5 }}>{hint}</div>}
      </div>
      <div>{children}</div>
    </div>
  );
}
function PSettingsSection({ title, kicker, children }) {
  return (
    <section style={{ marginBottom: 36 }}>
      <header style={{ marginBottom: 6 }}>
        <span className="label">{kicker}</span>
        <h2 className="display" style={{ margin: '6px 0 0', fontSize: 22, fontWeight: 500, letterSpacing: '-.01em' }}>{title}</h2>
      </header>
      {children}
    </section>
  );
}

Object.assign(window, {
  PL, PLANNER_DATA, P_META, fmtClock, fmtRange, snap15, ceil15,
  isOverdue, isPastBlock, catC, blockPos,
  PriorityChip, CatDot, SortSeg, BusyBlock, BusyPopover, SchedBlock, DropSlot,
  ProposalBlock, NowLine, WindowRail, TrayCard, StaleChip,
  sortTray, computeCapacity, computeDayFree, dayOcc, findOpenSlots, nextOpenSlot,
  autoFill, overlapBusy, PSettingsRow, PSettingsSection,
});
