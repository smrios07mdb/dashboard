// Screen 1 — Week Planner, desktop ≥1024.
// Live mechanics: drag from tray, move blocks, resize (15m snap), auto-fit proposals,
// carryover for unfinished past blocks, done-toggle, busy popovers, collapsible hours.
// Props: week ('populated'|'empty'), drag (static demo: 'none'|'valid'|'conflict'),
// stale (bool), onToast.

const wpdU = [1, 1, 1, 1, 1, .55, .55]; // weekday / half-width weekend column units
const wpdUTotal = wpdU.reduce((a, b) => a + b, 0);
const wpdCols = `${PL.gutter}px repeat(5, 1fr) repeat(2, .55fr)`;
const wpdLines = (hourH) => `repeating-linear-gradient(to bottom, var(--line) 0 1px, transparent 1px ${hourH}px)`;

function WPDayHeader({ day, isToday, free }) {
  return (
    <div style={{ padding: '0 0 8px 12px' }}>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 7 }}>
        <span className="label" style={isToday ? { color: 'var(--ink-2)' } : undefined}>{day.d}</span>
        <span className="num mono" style={{ fontSize: 15, fontWeight: isToday ? 600 : 500,
          color: isToday ? 'var(--ink)' : 'var(--ink-2)' }}>{day.n}</span>
        {isToday && <span style={{ width: 5, height: 5, borderRadius: '50%', background: 'var(--work)', alignSelf: 'center' }}/>}
      </div>
      <div className="num mono" style={{ fontSize: 9, marginTop: 2,
        color: isToday ? 'var(--ink-2)' : 'var(--ink-3)', minHeight: 12 }}>
        {free === undefined ? '' : free === null ? '—' : `${fmtMin(free)} free`}
      </div>
    </div>
  );
}

function WPTray({ tasks, drag, onPointerDown, proposedMap }) {
  const [sort, setSort] = React.useState('Priority');
  const sorted = sortTray(tasks, sort);
  const overdueN = tasks.filter(isOverdue).length;
  const groups = sort === 'Priority'
    ? [1, 2, 3].map(p => ({ p, items: sorted.filter(t => t.p === p) })).filter(g => g.items.length)
    : [{ p: null, items: sorted }];
  return (
    <aside style={{ width: 300, flexShrink: 0, borderRight: '1px solid var(--line)', paddingRight: 24 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12 }}>
        <span className="label">Unscheduled</span>
        <Pill tone="neutral"><span className="num mono">{tasks.length}</span></Pill>
        {overdueN > 0 && <span className="label" style={{ fontSize: 9, color: 'var(--destructive)' }}>{overdueN} OVERDUE</span>}
      </div>
      <SortSeg grow value={sort} onChange={setSort} options={['Priority', 'Due date', 'Estimate']}/>
      {tasks.length === 0 ? (
        <div style={{ marginTop: 14, padding: '26px 18px', border: '1px dashed var(--line-strong)',
          borderRadius: 'var(--radius-md)', textAlign: 'center' }}>
          <div style={{ fontSize: 13, color: 'var(--ink-2)' }}>No unscheduled tasks.</div>
          <div style={{ fontSize: 12, color: 'var(--ink-3)', marginTop: 4 }}>New tasks wait here until you place them.</div>
        </div>
      ) : groups.map((g, gi) => (
        <div key={gi} style={{ marginTop: 16 }}>
          {g.p && (
            <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, marginBottom: 8 }}>
              <span className="label" style={{ color: P_META[g.p].fg }}>{P_META[g.p].k} — {P_META[g.p].name}</span>
              <span className="num mono" style={{ fontSize: 10, color: 'var(--ink-4)' }}>{g.items.length}</span>
            </div>
          )}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {g.items.map(t => (
              <TrayCard key={t.id} t={t} ghost={drag !== 'none' && t.id === 'u1'}
                proposedLabel={proposedMap[t.id]}
                onPointerDown={(e) => onPointerDown(e, t)}/>
            ))}
          </div>
        </div>
      ))}
    </aside>
  );
}

function WeekPlannerDesktop({ week, drag, stale, onToast }) {
  const D = PLANNER_DATA;
  const empty = week === 'empty';
  const [sched, setSched] = React.useState(empty ? [] : D.scheduled);
  const [tray, setTray] = React.useState(empty ? [] : D.tray);
  React.useEffect(() => { setSched(empty ? [] : D.scheduled); setTray(empty ? [] : D.tray); setProposals([]); }, [week]);
  const [topX, setTopX] = React.useState(false);
  const [botX, setBotX] = React.useState(false);
  const h0 = topX ? PL.winFullS : PL.winCollapsedS;
  const h1 = botX ? PL.winFullE : PL.winCollapsedE;
  const gridH = (h1 - h0) / 60 * PL.hourH;
  const [proposals, setProposals] = React.useState([]);
  const [openBusy, setOpenBusy] = React.useState(null);
  const [dragSt, setDragSt] = React.useState(null);
  const dragRef = React.useRef(null); dragRef.current = dragSt;
  const winRef = React.useRef({ h0, h1 }); winRef.current = { h0, h1 };
  const gridRef = React.useRef(null);

  const cap = computeCapacity(D.busy, sched);
  const hours = []; for (let m = h0; m <= h1; m += 60) hours.push(m);
  const all = [...D.busy, ...sched];
  const topHidden = all.filter(o => o.s < PL.winCollapsedS).length;
  const botHidden = all.filter(o => o.e > PL.winCollapsedE).length;
  const proposedMap = {}; proposals.forEach(p => { proposedMap[p.task.id] = `${D.days[p.day].d} ${fmtClock(p.s)}`; });

  // static demo states (Tweaks) — suppressed while a real drag is live
  const demoTask = D.tray[0];
  const demo = dragSt ? null
    : drag === 'valid' ? { day: 2, s: 900, e: 900 + demoTask.est, kind: 'valid' }
    : drag === 'conflict' ? { day: 3, s: 810, e: 810 + demoTask.est, kind: 'conflict' } : null;

  const posFromEvent = (ev) => {
    const el = gridRef.current; if (!el) return null;
    const r = el.getBoundingClientRect();
    const { h0: w0, h1: w1 } = winRef.current;
    const x = ev.clientX - r.left, y = ev.clientY - r.top;
    if (x < PL.gutter || x > r.width + 40 || y < -20 || y > (w1 - w0) / 60 * PL.hourH + 20) return null;
    const unit = (r.width - PL.gutter) / wpdUTotal;
    let acc = 0, day = 6;
    for (let i = 0; i < 7; i++) { const cw = unit * wpdU[i]; if (x - PL.gutter < acc + cw) { day = i; break; } acc += cw; }
    const m = w0 + snap15(Math.max(0, Math.min(y, (w1 - w0) / 60 * PL.hourH)) / PL.hourH * 60);
    return { day, m };
  };

  const startTray = (e, t) => {
    if (e.button !== 0) return;
    e.preventDefault();
    setDragSt({ kind: 'tray', task: t, px: e.clientX, py: e.clientY, over: null });
  };
  const startMove = (e, t) => {
    if (e.button !== 0 || t.done) return;
    e.preventDefault();
    const p = posFromEvent(e); if (!p) return;
    setDragSt({ kind: 'move', task: t, offset: p.m - t.s, over: { day: t.day, s: t.s, e: t.e } });
  };
  const startResize = (e, t) => {
    if (e.button !== 0) return;
    e.preventDefault();
    setDragSt({ kind: 'resize', task: t, over: { day: t.day, s: t.s, e: t.e } });
  };

  React.useEffect(() => {
    if (!dragSt) return;
    document.body.style.userSelect = 'none';
    document.body.style.cursor = dragSt.kind === 'resize' ? 'ns-resize' : 'grabbing';
    const mv = (e) => {
      const p = posFromEvent(e);
      const { h0: w0, h1: w1 } = winRef.current;
      setDragSt(st => {
        if (!st) return st;
        if (st.kind === 'tray') {
          const dur = st.task.est;
          const over = p ? { day: p.day, s: Math.max(w0, Math.min(p.m, w1 - dur)), e: 0 } : null;
          if (over) over.e = over.s + dur;
          return { ...st, px: e.clientX, py: e.clientY, over };
        }
        if (!p) return st;
        if (st.kind === 'move') {
          const dur = st.task.e - st.task.s;
          const s = Math.max(w0, Math.min(p.m - st.offset, w1 - dur));
          return { ...st, over: { day: p.day, s, e: s + dur } };
        }
        const e2 = Math.max(st.task.s + 15, Math.min(p.m, w1));
        return { ...st, over: { day: st.task.day, s: st.task.s, e: e2 } };
      });
    };
    const up = () => {
      const st = dragRef.current;
      if (st && st.over) {
        const ol = overlapBusy(st.over.day, st.over.s, st.over.e, D.busy);
        const where = `${D.days[st.over.day].d} ${fmtClock(st.over.s)}`;
        if (st.kind === 'tray') {
          setSched(s => [...s, { id: 'd-' + st.task.id, day: st.over.day, s: st.over.s, e: st.over.e,
            title: st.task.title, cat: st.task.cat, p: st.task.p }]);
          setTray(s => s.filter(x => x.id !== st.task.id));
          onToast && onToast(ol ? `Placed ${where} — overlaps ${ol.title} by ${ol.mins}m.` : `Placed ${where}.`);
        } else if (st.kind === 'move') {
          setSched(s => s.map(x => x.id === st.task.id ? { ...x, day: st.over.day, s: st.over.s, e: st.over.e } : x));
        } else {
          setSched(s => s.map(x => x.id === st.task.id ? { ...x, e: st.over.e } : x));
        }
      }
      setDragSt(null);
    };
    window.addEventListener('pointermove', mv);
    window.addEventListener('pointerup', up);
    return () => {
      window.removeEventListener('pointermove', mv);
      window.removeEventListener('pointerup', up);
      document.body.style.userSelect = '';
      document.body.style.cursor = '';
    };
  }, [!!dragSt]);

  const toggleDone = (t) => setSched(s => s.map(x => x.id === t.id ? { ...x, done: !x.done } : x));
  const carryMove = (t) => {
    const slot = nextOpenSlot(t.e - t.s, D.busy, sched.filter(x => x.id !== t.id));
    if (!slot) { onToast && onToast('No open slot left this week.'); return; }
    setSched(s => s.map(x => x.id === t.id ? { ...x, day: slot.day, s: slot.s, e: slot.s + (t.e - t.s) } : x));
    onToast && onToast(`Moved to ${D.days[slot.day].d} ${D.days[slot.day].n}, ${fmtClock(slot.s)}.`);
  };
  const fill = () => {
    const props = autoFill(tray, D.busy, sched);
    if (!props.length) { onToast && onToast('No open weekday slots for P1–P2 tasks.'); return; }
    setProposals(props);
  };
  const acceptFill = () => {
    setSched(s => [...s, ...proposals.map(p => ({ id: p.id, day: p.day, s: p.s, e: p.e,
      title: p.task.title, cat: p.task.cat, p: p.task.p }))]);
    setTray(s => s.filter(t => !proposals.some(p => p.task.id === t.id)));
    onToast && onToast(`${proposals.length} tasks placed.`);
    setProposals([]);
  };

  const displaySched = sched.map(t =>
    dragSt && dragSt.kind === 'resize' && dragSt.over && dragSt.task.id === t.id ? { ...t, e: dragSt.over.e } : t);
  const liveOver = dragSt && dragSt.over ? dragSt.over : null;
  const liveOl = liveOver ? overlapBusy(liveOver.day, liveOver.s, liveOver.e, D.busy) : null;
  const fillable = tray.some(t => t.p <= 2);

  return (
    <div data-screen-label="Week Planner — Desktop" style={{ display: 'flex', gap: 24, minWidth: 1024 }}>
      <WPTray tasks={tray} drag={drag} onPointerDown={startTray} proposedMap={proposedMap}/>
      <main style={{ flex: 1, minWidth: 0 }}>
        <header style={{ display: 'flex', alignItems: 'center', gap: 14, marginBottom: 14, flexWrap: 'wrap' }}>
          <div>
            <h1 className="title" style={{ margin: 0, fontSize: 27 }}>{D.weekLabel}</h1>
            <span className="label" style={{ fontSize: 9 }}>{D.weekMeta}</span>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
            <IconBtn label="Previous week"><IChevL s={15}/></IconBtn>
            <Button size="sm">Today</Button>
            <IconBtn label="Next week"><IChevR s={15}/></IconBtn>
          </div>
          <span style={{ marginLeft: 'auto' }}/>
          {stale && <StaleChip/>}
          {proposals.length === 0 && (
            <Button size="sm" icon={<ISparkles s={13}/>} onClick={fill}
              disabled={!fillable} style={!fillable ? { opacity: .45 } : undefined}>Fill my week</Button>
          )}
          <span className="num mono" style={{ fontSize: 11.5, color: 'var(--ink-3)' }}>
            <span style={{ color: 'var(--ink-2)', fontWeight: 600 }}>{fmtMin(cap.planned)} planned</span> · {fmtMin(cap.free)} free
          </span>
        </header>

        {proposals.length > 0 && (
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '8px 12px', marginBottom: 12,
            borderRadius: 'var(--radius)', background: 'var(--accent-soft)',
            border: '1px solid color-mix(in srgb, var(--accent) 22%, transparent)' }}>
            <ISparkles s={13} style={{ color: 'var(--accent-ink)' }}/>
            <span className="num mono" style={{ fontSize: 11.5, fontWeight: 600, color: 'var(--accent-ink)' }}>
              {proposals.length} proposals · {fmtMin(proposals.reduce((s, p) => s + p.task.est, 0))}
            </span>
            <span style={{ fontSize: 12, color: 'var(--ink-2)' }}>P1–P2 tasks into the earliest open weekday slots.</span>
            <span style={{ marginLeft: 'auto' }}/>
            <Button size="sm" variant="primary" onClick={acceptFill}>Place all</Button>
            <Button size="sm" variant="plain" onClick={() => setProposals([])}>Clear</Button>
          </div>
        )}

        <div style={{ display: 'grid', gridTemplateColumns: wpdCols }}>
          <div/>
          {D.days.map((d, i) => (
            <WPDayHeader key={i} day={d} isToday={i === D.today}
              free={i >= 5 ? undefined : empty && sched.length === 0 && i < D.today ? null : computeDayFree(i, D.busy, sched)}/>
          ))}
        </div>

        <WindowRail side="top" expanded={topX} onToggle={() => setTopX(x => !x)}
          label="07:00 – 08:00" hiddenCount={topHidden}/>

        <div ref={gridRef} style={{ position: 'relative', display: 'grid', gridTemplateColumns: wpdCols,
          borderTop: '1px solid var(--line-strong)' }}>
          <div style={{ position: 'relative', height: gridH }}>
            {hours.map(m => (
              <span key={m} className="num mono" style={{ position: 'absolute', right: 10,
                top: (m - h0) / 60 * PL.hourH - (m === h0 ? 0 : m === h1 ? 13 : 6),
                fontSize: 9.5, color: 'var(--ink-3)' }}>{fmtClock(m)}</span>
            ))}
          </div>
          {D.days.map((d, i) => {
            const wash = i === D.today
              ? ', linear-gradient(color-mix(in srgb, var(--surface) 60%, transparent), color-mix(in srgb, var(--surface) 60%, transparent))'
              : i >= 5 ? ', linear-gradient(color-mix(in srgb, var(--bg-alt) 45%, transparent), color-mix(in srgb, var(--bg-alt) 45%, transparent))' : '';
            return (
              <div key={i} style={{ position: 'relative', height: gridH, borderLeft: '1px solid var(--line)',
                backgroundImage: wpdLines(PL.hourH) + wash }}>
                {D.busy.filter(b => b.day === i).map((b, j) => (
                  <BusyBlock key={j} b={b} hourH={PL.hourH} h0={h0} h1={h1} stale={stale}
                    onClick={(bb, pos) => setOpenBusy({ b: bb, day: i, top: Math.min(pos.top + pos.height + 4, gridH - 150) })}/>
                ))}
                {displaySched.filter(t => t.day === i).map(t => (
                  <SchedBlock key={t.id} t={t} hourH={PL.hourH} h0={h0} h1={h1}
                    dimmed={dragSt && dragSt.kind === 'move' && dragSt.task.id === t.id}
                    onToggleDone={toggleDone} onCarryMove={carryMove}
                    onBodyDown={startMove} onResizeDown={startResize}/>
                ))}
                {proposals.filter(p => p.day === i).map(p => <ProposalBlock key={p.id} p={p} hourH={PL.hourH} h0={h0} h1={h1}/>)}
                {liveOver && liveOver.day === i && dragSt.kind !== 'resize' && (
                  <DropSlot s={liveOver.s} e={liveOver.e} cat={dragSt.task.cat}
                    kind={liveOl ? 'conflict' : 'valid'} hourH={PL.hourH} h0={h0} h1={h1}
                    note={liveOl ? `OVERLAPS ${liveOl.title} · ${liveOl.mins}M` : null}/>
                )}
                {demo && demo.day === i && (
                  <DropSlot s={demo.s} e={demo.e} cat={demoTask.cat} kind={demo.kind} hourH={PL.hourH} h0={h0} h1={h1}/>
                )}
                {i === D.today && <NowLine now={D.now} hourH={PL.hourH} h0={h0} h1={h1}/>}
                {openBusy && openBusy.day === i && (
                  <BusyPopover b={openBusy.b} stale={stale} top={openBusy.top}
                    alignRight={i >= 4} onClose={() => setOpenBusy(null)}/>
                )}
              </div>
            );
          })}

          {demo && (
            <div style={{
              position: 'absolute', width: 210, zIndex: 6,
              left: `calc(${PL.gutter}px + (100% - ${PL.gutter}px) / ${wpdUTotal} * ${demo.day} + 26px)`,
              top: (demo.s - h0) / 60 * PL.hourH + 22,
              transform: 'rotate(-2deg)', boxShadow: 'var(--shadow-lg)', borderRadius: 'var(--radius)',
              cursor: 'grabbing', pointerEvents: 'none',
            }}>
              <TrayCard t={demoTask}/>
            </div>
          )}

          {empty && sched.length === 0 && !demo && !dragSt && (
            <div style={{ position: 'absolute', left: PL.gutter, right: 0, top: gridH * .38, zIndex: 5,
              textAlign: 'center', pointerEvents: 'none' }}>
              <div className="serif" style={{ fontSize: 17, color: 'var(--ink-2)' }}>Nothing planned yet.</div>
              <div style={{ fontSize: 12, color: 'var(--ink-3)', marginTop: 5 }}>Drag a task from the tray onto a time.</div>
            </div>
          )}
        </div>

        <WindowRail side="bottom" expanded={botX} onToggle={() => setBotX(x => !x)}
          label="19:00 – 21:00" hiddenCount={botHidden}/>
      </main>

      {dragSt && dragSt.kind === 'tray' && (
        <div style={{ position: 'fixed', left: dragSt.px + 10, top: dragSt.py + 8, width: 210, zIndex: 100,
          pointerEvents: 'none', transform: 'rotate(-2deg)', boxShadow: 'var(--shadow-lg)', borderRadius: 'var(--radius)' }}>
          <TrayCard t={dragSt.task}/>
        </div>
      )}
    </div>
  );
}

window.WeekPlannerDesktop = WeekPlannerDesktop;
