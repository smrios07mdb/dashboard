// Screen 2 — Week Planner, mobile ≤640 (rendered in a 390px frame).
// No drag-and-drop: tap an unscheduled task → Schedule sheet with proposed slots.
// Shares done/carryover/stale/collapse mechanics with desktop.
// Props: week, stale, sheetOpen (tweak), onToast.

const DAY_FULL = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];

function WPMScheduleSheet({ task, day, busy, scheduled, onClose, onAdd }) {
  const D = PLANNER_DATA;
  const slots = findOpenSlots(day, task.est, busy, scheduled, day === D.today, D.now);
  const [sel, setSel] = React.useState(0);
  const [custom, setCustom] = React.useState(slots[0] ? fmtClock(slots[0].s) : '09:00');
  const start = sel === 'custom'
    ? (() => { const [h, m] = custom.split(':').map(Number); return h * 60 + (m || 0); })()
    : (slots[sel] ? slots[sel].s : 540);
  return (
    <React.Fragment>
      <div onClick={onClose} style={{ position: 'absolute', inset: 0, zIndex: 10,
        background: 'rgba(40,28,14,.30)', animation: 'fadein .15s ease-out forwards' }}/>
      <div style={{ position: 'absolute', left: 0, right: 0, bottom: 0, zIndex: 11,
        background: 'var(--surface)', borderTop: '1px solid var(--line)',
        borderRadius: '18px 18px 0 0', boxShadow: 'var(--shadow-lg)',
        animation: 'wpmSlideUp .22s cubic-bezier(.2,.7,.2,1) forwards' }}>
        <header style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '16px 18px 10px' }}>
          <h3 style={{ margin: 0, fontSize: 15, fontWeight: 600, letterSpacing: '-.01em' }}>Schedule</h3>
          <IconBtn label="Close" onClick={onClose}><IX s={16}/></IconBtn>
        </header>
        <div style={{ padding: '0 18px' }}>
          <div style={{ padding: '12px 14px', borderRadius: 'var(--radius)', background: 'var(--bg-alt)' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <PriorityChip p={task.p}/>
              <span style={{ fontSize: 14, fontWeight: 500, flex: 1, minWidth: 0 }}>{task.title}</span>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 7, marginTop: 6 }}>
              <CatDot cat={task.cat}/>
              <span className="num mono" style={{ fontSize: 11, color: 'var(--ink-3)' }}>{fmtMin(task.est)} estimate</span>
              {isOverdue(task) && <span className="label" style={{ fontSize: 8.5, color: 'var(--destructive)' }}>OVERDUE</span>}
            </div>
          </div>
          <div className="label" style={{ marginTop: 16, display: 'block' }}>
            Open slots — {PLANNER_DATA.days[day].d} {PLANNER_DATA.days[day].n}
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginTop: 9 }}>
            {slots.map((s, i) => (
              <button key={i} onClick={() => setSel(i)} style={{
                display: 'flex', alignItems: 'baseline', gap: 10, padding: '12px 14px', textAlign: 'left',
                border: '1px solid ' + (sel === i ? 'var(--accent)' : 'var(--line)'),
                background: sel === i ? 'var(--accent-soft)' : 'var(--surface)',
                borderRadius: 'var(--radius)',
              }}>
                <span className="num mono" style={{ fontSize: 15, fontWeight: 600, color: 'var(--ink)' }}>{fmtRange(s.s, s.e)}</span>
                <span className="num mono" style={{ fontSize: 11, color: 'var(--ink-3)' }}>free until {fmtClock(s.until)}</span>
                <span style={{ marginLeft: 'auto' }}/>
                {sel === i && <Pill tone="accent">Selected</Pill>}
              </button>
            ))}
            {slots.length === 0 && (
              <div style={{ padding: '14px 4px', fontSize: 12, color: 'var(--ink-3)' }}>
                No open slot fits {fmtMin(task.est)} today. Pick a time below.
              </div>
            )}
          </div>
          <div style={{ marginTop: 14, paddingTop: 12, borderTop: '1px solid var(--line)', paddingBottom: 14 }}>
            <span className="label">Custom</span>
            <div onClick={() => setSel('custom')} style={{ display: 'flex', alignItems: 'center', gap: 10, marginTop: 8 }}>
              <input type="time" value={custom} onChange={(e) => { setCustom(e.target.value); setSel('custom'); }}
                style={{ height: 38, padding: '0 10px', borderRadius: 'var(--radius)',
                  border: '1px solid ' + (sel === 'custom' ? 'var(--accent)' : 'var(--line)'),
                  background: sel === 'custom' ? 'var(--accent-soft)' : 'var(--surface)',
                  color: 'var(--ink)', fontSize: 13, fontFamily: 'var(--font-mono)' }}/>
              <span className="num mono" style={{ fontSize: 11, color: 'var(--ink-3)' }}>+ {fmtMin(task.est)}</span>
            </div>
          </div>
        </div>
        <footer style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', padding: '12px 18px 18px', borderTop: '1px solid var(--line)' }}>
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="primary" onClick={() => onAdd(start)}>Add to {DAY_FULL[day]}</Button>
        </footer>
      </div>
    </React.Fragment>
  );
}

function WeekPlannerMobile({ week, stale, sheetOpen, onToast }) {
  const D = PLANNER_DATA;
  const empty = week === 'empty';
  const [day, setDay] = React.useState(D.today);
  const [sched, setSched] = React.useState(empty ? [] : D.scheduled);
  const [tray, setTray] = React.useState(empty ? [] : D.tray);
  const [openTask, setOpenTask] = React.useState(null);
  const [topX, setTopX] = React.useState(false);
  const [botX, setBotX] = React.useState(false);
  React.useEffect(() => { setSched(empty ? [] : D.scheduled); setTray(empty ? [] : D.tray); setOpenTask(null); }, [week]);
  React.useEffect(() => { if (sheetOpen && tray.length) setOpenTask(tray[0]); if (!sheetOpen) setOpenTask(null); }, [sheetOpen]);

  const h0 = topX ? PL.winFullS : PL.winCollapsedS;
  const h1 = botX ? PL.winFullE : PL.winCollapsedE;
  const H = (h1 - h0) / 60 * PL.mHourH;
  const hours = []; for (let m = h0; m <= h1; m += 60) hours.push(m);
  const daySched = sched.filter(t => t.day === day);
  const dayBusy = D.busy.filter(b => b.day === day);
  const dayAll = [...dayBusy, ...daySched];
  const topHidden = dayAll.filter(o => o.s < PL.winCollapsedS).length;
  const botHidden = dayAll.filter(o => o.e > PL.winCollapsedE).length;
  const free = computeDayFree(day, D.busy, sched);
  const overdueN = tray.filter(isOverdue).length;

  const add = (start) => {
    const t = openTask;
    setSched(s => [...s, { id: 'n' + t.id, day, s: start, e: start + t.est, title: t.title, cat: t.cat, p: t.p }]);
    setTray(s => s.filter(x => x.id !== t.id));
    setOpenTask(null);
    const ol = overlapBusy(day, start, start + t.est, D.busy);
    onToast && onToast(ol
      ? `Scheduled ${fmtClock(start)} — overlaps ${ol.title} by ${ol.mins}m.`
      : `Scheduled for ${DAY_FULL[day].slice(0, 3)} ${D.days[day].n}, ${fmtClock(start)}.`);
  };
  const toggleDone = (t) => setSched(s => s.map(x => x.id === t.id ? { ...x, done: !x.done } : x));
  const carryMove = (t) => {
    const slot = nextOpenSlot(t.e - t.s, D.busy, sched.filter(x => x.id !== t.id));
    if (!slot) { onToast && onToast('No open slot left this week.'); return; }
    setSched(s => s.map(x => x.id === t.id ? { ...x, day: slot.day, s: slot.s, e: slot.s + (t.e - t.s) } : x));
    onToast && onToast(`Moved to ${D.days[slot.day].d} ${D.days[slot.day].n}, ${fmtClock(slot.s)}.`);
  };

  return (
    <div data-screen-label="Week Planner — Mobile" style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 10 }}>
      <div style={{ width: 390, height: 812, position: 'relative', overflow: 'hidden',
        background: 'var(--bg)', border: '1px solid var(--line-strong)',
        borderRadius: 22, boxShadow: 'var(--shadow-md)' }}>
        <div className="lst" style={{ position: 'absolute', inset: 0, overflowY: 'auto' }}>
          <header style={{ padding: '20px 16px 0' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              <div style={{ flex: 1 }}>
                <h1 className="title" style={{ margin: 0, fontSize: 23 }}>{D.weekLabel}</h1>
                <span className="label" style={{ fontSize: 8.5 }}>{D.weekMeta}</span>
              </div>
              <IconBtn label="Previous week"><IChevL s={15}/></IconBtn>
              <IconBtn label="Next week"><IChevR s={15}/></IconBtn>
            </div>
            {stale && <div style={{ marginTop: 10 }}><StaleChip/></div>}
          </header>

          <div style={{ display: 'flex', gap: 3, padding: '14px 12px 6px' }}>
            {D.days.map((d, i) => {
              const selD = i === day;
              return (
                <button key={i} onClick={() => setDay(i)} style={{
                  flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 1,
                  padding: '7px 0 6px', borderRadius: 'var(--radius)',
                  background: selD ? 'var(--ink)' : 'transparent',
                }}>
                  <span className="label" style={{ fontSize: 8.5, color: selD ? 'var(--bg)' : 'var(--ink-3)', opacity: selD ? .75 : 1 }}>{d.d}</span>
                  <span className="num mono" style={{ fontSize: 13, fontWeight: 600, color: selD ? 'var(--bg)' : 'var(--ink-2)' }}>{d.n}</span>
                  <span style={{ width: 4, height: 4, borderRadius: '50%',
                    background: i === D.today ? (selD ? 'var(--bg)' : 'var(--work)') : 'transparent' }}/>
                </button>
              );
            })}
          </div>
          <div className="num mono" style={{ padding: '0 16px 8px', fontSize: 10, color: 'var(--ink-3)' }}>
            {DAY_FULL[day]} · {free === null ? 'past' : `${fmtMin(free)} free 09–18`}
          </div>

          <WindowRail side="top" expanded={topX} onToggle={() => setTopX(x => !x)}
            label="07 – 08" hiddenCount={topHidden}/>
          <div style={{ position: 'relative', display: 'grid', gridTemplateColumns: `${PL.mGutter}px 1fr`,
            borderTop: '1px solid var(--line-strong)' }}>
            <div style={{ position: 'relative', height: H }}>
              {hours.map(m => (
                <span key={m} className="num mono" style={{ position: 'absolute', right: 8,
                  top: (m - h0) / 60 * PL.mHourH - (m === h0 ? 0 : m === h1 ? 13 : 6),
                  fontSize: 9, color: 'var(--ink-3)' }}>{fmtClock(m)}</span>
              ))}
            </div>
            <div style={{ position: 'relative', height: H, borderLeft: '1px solid var(--line)', marginRight: 12,
              backgroundImage: `repeating-linear-gradient(to bottom, var(--line) 0 1px, transparent 1px ${PL.mHourH}px)` }}>
              {dayBusy.map((b, j) => <BusyBlock key={j} b={b} hourH={PL.mHourH} h0={h0} h1={h1} stale={stale}/>)}
              {daySched.map(t => (
                <SchedBlock key={t.id} t={t} hourH={PL.mHourH} h0={h0} h1={h1} touch
                  onToggleDone={toggleDone} onCarryMove={carryMove}/>
              ))}
              {day === D.today && <NowLine now={D.now} hourH={PL.mHourH} h0={h0} h1={h1}/>}
              {empty && daySched.length === 0 && (
                <div style={{ position: 'absolute', left: 0, right: 0, top: H * .35, textAlign: 'center' }}>
                  <div className="serif" style={{ fontSize: 15, color: 'var(--ink-2)' }}>Nothing planned yet.</div>
                  <div style={{ fontSize: 11.5, color: 'var(--ink-3)', marginTop: 4 }}>Tap an unscheduled task to give it a time.</div>
                </div>
              )}
            </div>
          </div>
          <WindowRail side="bottom" expanded={botX} onToggle={() => setBotX(x => !x)}
            label="19 – 21" hiddenCount={botHidden}/>

          <section style={{ borderTop: '1px solid var(--line-strong)', padding: '14px 16px 90px', marginTop: 10 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
              <span className="label">Unscheduled</span>
              <Pill tone="neutral"><span className="num mono">{tray.length}</span></Pill>
              {overdueN > 0 && <span className="label" style={{ fontSize: 8.5, color: 'var(--destructive)' }}>{overdueN} OVERDUE</span>}
            </div>
            {tray.length === 0 ? (
              <div style={{ padding: '16px 0', fontSize: 12, color: 'var(--ink-3)' }}>No unscheduled tasks.</div>
            ) : sortTray(tray, 'Priority').map(t => (
              <button key={t.id} onClick={() => setOpenTask(t)} style={{
                display: 'grid', gridTemplateColumns: 'auto 1fr auto auto auto', alignItems: 'center', gap: 9,
                width: '100%', textAlign: 'left', padding: '11px 2px', borderBottom: '1px solid var(--line)',
              }}>
                <PriorityChip p={t.p}/>
                <span style={{ minWidth: 0, display: 'flex', alignItems: 'center', gap: 7 }}>
                  <span style={{ fontSize: 13, fontWeight: 500, color: 'var(--ink)',
                    whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{t.title}</span>
                  {isOverdue(t) && <span className="label" style={{ fontSize: 8, color: 'var(--destructive)' }}>OVERDUE</span>}
                </span>
                <CatDot cat={t.cat}/>
                <span className="num mono" style={{ fontSize: 11, color: 'var(--ink-2)' }}>{fmtMin(t.est)}</span>
                <IChevR s={13} style={{ color: 'var(--ink-4)' }}/>
              </button>
            ))}
          </section>
        </div>

        {openTask && (
          <WPMScheduleSheet task={openTask} day={day} busy={D.busy} scheduled={sched}
            onClose={() => setOpenTask(null)} onAdd={add}/>
        )}
      </div>
      <span className="label" style={{ fontSize: 8.5 }}>390 × 812 · NO DRAG ON MOBILE — TAP TO SCHEDULE</span>
    </div>
  );
}

window.WeekPlannerMobile = WeekPlannerMobile;

const _wpmSt = document.createElement('style');
_wpmSt.textContent = '@keyframes wpmSlideUp{from{transform:translateY(40px);opacity:.001}to{transform:none;opacity:1}}';
document.head.appendChild(_wpmSt);
