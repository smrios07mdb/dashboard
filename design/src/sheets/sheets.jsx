// Sheets: AI Triage ("What's next?") + Block Time + Install banner + Reminder time picker.

function AITriageSheet({ open, onClose, data, available, onPushToast }) {
  const [thinking, setThinking] = React.useState(false);
  const [result, setResult] = React.useState(null);
  const [mins, setMins] = React.useState(available);

  React.useEffect(() => { if (open) { setResult(null); setMins(available); } }, [open, available]);

  const run = () => {
    setThinking(true);
    setTimeout(() => {
      setThinking(false);
      // Pick 1-3 task IDs that fit in time
      const open = data.tasks.filter(t => !t.completedAt).sort((a,b)=>(a.priority||9)-(b.priority||9));
      let acc = 0; const picks = [];
      for (const t of open) {
        if (acc + t.estimateMinutes <= mins && picks.length < 3) { picks.push(t); acc += t.estimateMinutes; }
        if (picks.length >= 3) break;
      }
      const reasons = [
        'High priority, due soon — moves the team forward.',
        'Short, high-leverage. Knock it out while you have momentum.',
        'A quiet, ambient task — fits the remaining 15 minutes.',
      ];
      setResult({
        recommendations: picks.map((t, i) => ({ task: t, reason: reasons[i] })),
        note: picks.length
          ? `Three tasks fit your ${mins} minutes with ${mins - acc}m to spare. Start with the top of the list.`
          : 'Nothing fits — consider breaking a task into a smaller estimate.',
        total: acc,
      });
    }, 900);
  };

  return (
    <Sheet open={open} onClose={onClose} title="What's next?">
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 16 }}>
        <span className="label">I have</span>
        <Input value={mins} type="number" min="0" step="15"
          onChange={(e)=>setMins(Number(e.target.value)||0)}
          suffix="minutes" style={{ width: 140 }}/>
        <span style={{ marginLeft: 'auto' }}/>
        <Button variant="primary" icon={<ISparkles s={14}/>} onClick={run} disabled={thinking}>
          {thinking ? 'Thinking…' : 'Decide'}
        </Button>
      </div>

      {!result && !thinking && (
        <div style={{
          padding: '24px 20px', borderRadius: 'var(--radius-md)',
          border: '1px dashed var(--line-strong)', background: 'var(--bg-alt)',
          color: 'var(--ink-3)', fontSize: 13, lineHeight: 1.6,
        }}>
          <strong style={{ color: 'var(--ink-2)', display: 'block', marginBottom: 4 }}>Decide with Claude</strong>
          Tell me how much time you have. I&rsquo;ll rank 1&ndash;3 tasks from your list with a one-line reason for each. Uses your Anthropic key.
        </div>
      )}

      {thinking && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '16px 0', color: 'var(--ink-3)' }}>
          <span style={{
            width: 16, height: 16, borderRadius: '50%',
            border: '2px solid var(--accent-soft)', borderTopColor: 'var(--accent)',
            animation: 'spin .8s linear infinite',
          }}/>
          Reading your task list…
        </div>
      )}

      {result && (
        <div>
          {result.recommendations.length === 0 ? (
            <p style={{ color: 'var(--ink-3)' }}>{result.note}</p>
          ) : (
            <ol style={{ listStyle: 'none', padding: 0, margin: 0 }}>
              {result.recommendations.map((r, i) => {
                const sub = data.subcategories.find(s => s.id === r.task.subcategoryId);
                const cat = data.categories.find(c => c.id === sub.categoryId);
                return (
                  <li key={r.task.id} style={{
                    padding: '14px 16px', marginBottom: 10,
                    background: 'var(--surface)', border: '1px solid var(--line)',
                    borderLeft: '3px solid ' + catColor(cat.name),
                    borderRadius: 'var(--radius)',
                  }}>
                    <div style={{ display: 'flex', alignItems: 'baseline', gap: 8 }}>
                      <span className="num display" style={{ fontSize: 14, fontWeight: 600, color: 'var(--ink-3)' }}>{i+1}.</span>
                      <h4 style={{ margin: 0, fontSize: 14, fontWeight: 500, flex: 1, letterSpacing: '-.005em' }}>
                        {r.task.title}
                      </h4>
                      <span className="num" style={{ fontSize: 12, color: 'var(--ink-3)' }}>{fmtMin(r.task.estimateMinutes)}</span>
                    </div>
                    <div style={{ fontSize: 12, color: 'var(--ink-3)', marginTop: 6, marginLeft: 24, fontStyle: 'italic' }}>
                      &ldquo;{r.reason}&rdquo;
                    </div>
                    <div style={{ display: 'flex', gap: 8, marginTop: 12, marginLeft: 24 }}>
                      <Button size="sm" variant="primary">Start now</Button>
                      <Button size="sm" icon={<ICal s={14}/>} onClick={()=>{ onClose(); onPushToast('Opening block-time…'); }}>Block time</Button>
                      <Button size="sm" variant="plain">Skip</Button>
                    </div>
                  </li>
                );
              })}
            </ol>
          )}
          <div style={{ marginTop: 12, padding: '10px 14px', borderRadius: 'var(--radius)', background: 'var(--accent-soft)', color: 'var(--accent-ink)', fontSize: 13, lineHeight: 1.55 }}>
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontWeight: 500, marginRight: 6 }}><ISparkles s={13}/>Claude</span>
            {result.note}
          </div>
        </div>
      )}
    </Sheet>
  );
}

function BlockTimeSheet({ open, onClose, task, data, onPushToast }) {
  const [picked, setPicked] = React.useState(0);
  if (!task) return null;

  // Synthesize 3 candidate slots within next 24h, 09:00–18:00 window.
  const now = new Date();
  const slots = [];
  const offsets = [60, 180, 24*60 - 120]; // mins from now
  offsets.forEach(off => {
    const start = new Date(now.getTime() + off * 60000);
    start.setMinutes(Math.ceil(start.getMinutes() / 15) * 15, 0, 0);
    const end = new Date(start.getTime() + task.estimateMinutes * 60000);
    slots.push({ start, end });
  });

  const fmtTime = (d) => d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
  const fmtDate = (d) => {
    const today = new Date(); today.setHours(0,0,0,0);
    const tom = new Date(today); tom.setDate(tom.getDate()+1);
    const dd = new Date(d); dd.setHours(0,0,0,0);
    if (+dd === +today) return 'Today';
    if (+dd === +tom) return 'Tomorrow';
    return d.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });
  };

  return (
    <Sheet open={open} onClose={onClose} title="Block time"
      footer={
        <React.Fragment>
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="primary" icon={<ICal s={14}/>}
            onClick={()=>{ onClose(); onPushToast(`Event created on Apple Calendar for ${fmtDate(slots[picked].start)} ${fmtTime(slots[picked].start)}.`); }}>
            Add to Apple Calendar
          </Button>
        </React.Fragment>
      }>
      <div style={{
        padding: '14px 16px', borderRadius: 'var(--radius)',
        background: 'var(--bg-alt)', marginBottom: 18,
      }}>
        <div className="label" style={{ marginBottom: 4 }}>Task</div>
        <div style={{ fontSize: 15, fontWeight: 500 }}>{task.title}</div>
        <div style={{ marginTop: 4, fontSize: 12, color: 'var(--ink-3)' }} className="num">
          {fmtMin(task.estimateMinutes)} estimate · 09:00–18:00 working window
        </div>
      </div>
      <span className="label">Proposed slots</span>
      <div style={{ marginTop: 10 }}>
        {slots.map((s, i) => (
          <button key={i} onClick={()=>setPicked(i)}
            style={{
              display: 'block', width: '100%', textAlign: 'left',
              padding: '14px 16px', marginBottom: 8,
              border: '1px solid ' + (picked === i ? 'var(--accent)' : 'var(--line)'),
              background: picked === i ? 'var(--accent-soft)' : 'var(--surface)',
              borderRadius: 'var(--radius)',
            }}>
            <div style={{ display: 'flex', alignItems: 'baseline', gap: 12 }}>
              <span className="display" style={{ fontSize: 18, fontWeight: 500 }} className="num">
                {fmtTime(s.start)} – {fmtTime(s.end)}
              </span>
              <span style={{ color: 'var(--ink-3)', fontSize: 13 }}>{fmtDate(s.start)}</span>
              <span style={{ marginLeft: 'auto' }}/>
              {picked === i && <Pill tone="accent">Selected</Pill>}
            </div>
            <div style={{ fontSize: 12, color: 'var(--ink-3)', marginTop: 6 }}>
              No conflicts with your <span className="mono">{data.settings.caldavCalendarUrl.split('/').slice(-2,-1)}</span> calendar.
            </div>
          </button>
        ))}
      </div>
    </Sheet>
  );
}

function ReminderSheet({ open, onClose, task, onSave, onClear, onPushToast }) {
  const presets = [
    { label: 'In 1 hour', mins: 60 },
    { label: 'In 3 hours', mins: 180 },
    { label: 'This evening (6pm)', mins: 'eve' },
    { label: 'Tomorrow morning (9am)', mins: 'tom' },
  ];
  // Default custom value = tomorrow 9am, formatted for datetime-local input.
  const defaultCustom = React.useMemo(() => {
    const d = new Date(); d.setDate(d.getDate() + 1); d.setHours(9, 0, 0, 0);
    const pad = (n) => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
  }, [open]);
  const [custom, setCustom] = React.useState(defaultCustom);
  React.useEffect(() => { setCustom(defaultCustom); }, [defaultCustom]);

  if (!task) return null;
  return (
    <Sheet open={open} onClose={onClose} title="Set reminder">
      <div style={{ padding: '14px 16px', borderRadius: 'var(--radius)', background: 'var(--bg-alt)', marginBottom: 18 }}>
        <div className="label" style={{ marginBottom: 4 }}>Task</div>
        <div style={{ fontSize: 14, fontWeight: 500 }}>{task.title}</div>
      </div>
      <span className="label">Quick choices</span>
      <div style={{ display: 'grid', gap: 8, marginTop: 10 }}>
        {presets.map((p, i) => (
          <button key={i} onClick={()=>{ onSave(p); onClose(); onPushToast('Reminder set.'); }}
            style={{
              padding: '12px 14px', textAlign: 'left',
              border: '1px solid var(--line)', borderRadius: 'var(--radius)',
              background: 'var(--surface)', display: 'flex', alignItems: 'center', gap: 10,
            }}
            onMouseEnter={(e)=>e.currentTarget.style.borderColor='var(--line-strong)'}
            onMouseLeave={(e)=>e.currentTarget.style.borderColor='var(--line)'}>
            <IClock s={16} style={{ color: 'var(--ink-3)' }}/>
            <span style={{ fontSize: 14 }}>{p.label}</span>
          </button>
        ))}
      </div>

      <div style={{ marginTop: 22, paddingTop: 18, borderTop: '1px solid var(--line)' }}>
        <span className="label">Custom</span>
        <div style={{ display: 'flex', gap: 8, marginTop: 10 }}>
          <input type="datetime-local"
            value={custom}
            onChange={(e)=>setCustom(e.target.value)}
            style={{
              flex: 1, height: 40, padding: '0 12px',
              border: '1px solid var(--line)', borderRadius: 'var(--radius)',
              background: 'var(--surface)', color: 'var(--ink)',
              fontSize: 13, fontFamily: 'var(--font-mono)',
              colorScheme: 'dark',
            }}/>
          <Button variant="primary"
            onClick={()=>{
              const target = new Date(custom);
              if (isNaN(+target)) return;
              const mins = Math.round((target.getTime() - Date.now()) / 60000);
              onSave({ mins, label: target.toLocaleString() });
              onClose();
              onPushToast('Reminder set for ' + target.toLocaleString() + '.');
            }}>
            Set
          </Button>
        </div>
      </div>

      {task.remindAt && (
        <div style={{ marginTop: 22, paddingTop: 18, borderTop: '1px solid var(--line)' }}>
          <span className="label">Currently set</span>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginTop: 8 }}>
            <span style={{ fontSize: 13, color: 'var(--ink-2)' }} className="mono">
              {new Date(task.remindAt).toLocaleString()}
            </span>
            <span style={{ marginLeft: 'auto' }}/>
            <Button onClick={()=>{ onClear(); onClose(); onPushToast('Reminder cleared.'); }}
              variant="danger" size="sm">
              <IX s={14}/> Clear
            </Button>
          </div>
        </div>
      )}
    </Sheet>
  );
}

function InstallBanner({ onDismiss }) {
  return (
    <div style={{
      display: 'flex', alignItems: 'center', gap: 12,
      padding: '10px 14px',
      background: 'var(--ink)', color: 'var(--bg)',
      borderRadius: 'var(--radius)', marginBottom: 14, fontSize: 13,
    }}>
      <span style={{ flex: 1 }}>
        <strong style={{ fontWeight: 500 }}>Install Hupomnemata to Home Screen</strong>
        <span style={{ opacity: .7, marginLeft: 8 }}>for notifications and full-screen use — tap <span className="mono">⎙</span> in Safari, then &ldquo;Add to Home Screen&rdquo;.</span>
      </span>
      <button onClick={onDismiss} style={{ color: 'var(--bg)', opacity: .7, padding: 4 }} aria-label="Dismiss">
        <IX s={14}/>
      </button>
    </div>
  );
}

function CaldavBanner({ onOpenSettings, onDismiss }) {
  return (
    <div style={{
      display: 'flex', alignItems: 'center', gap: 12,
      padding: '12px 14px',
      background: 'rgba(201,122,106,.08)',
      border: '1px solid rgba(201,122,106,.30)',
      color: 'var(--ink)',
      borderRadius: 'var(--radius)', marginBottom: 14, fontSize: 13,
    }}>
      <span style={{
        display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
        width: 28, height: 28, borderRadius: '50%',
        background: 'rgba(201,122,106,.18)', color: 'var(--destructive)',
        flexShrink: 0,
      }}><IInfo s={16}/></span>
      <span style={{ flex: 1, minWidth: 0 }}>
        <strong style={{ fontWeight: 600 }}>Apple Calendar disconnected.</strong>{' '}
        <span style={{ color: 'var(--ink-2)' }}>Block-time and busy-range features pause until you reconnect.</span>
      </span>
      <Button size="sm" variant="ghost" onClick={onOpenSettings} style={{
        background: 'var(--surface)', borderColor: 'var(--line-strong)',
      }}>Reconnect</Button>
      <IconBtn label="Dismiss" onClick={onDismiss}><IX s={14}/></IconBtn>
    </div>
  );
}

Object.assign(window, { AITriageSheet, BlockTimeSheet, ReminderSheet, InstallBanner, CaldavBanner });

// Spin keyframe
const _spinSt = document.createElement('style');
_spinSt.textContent = '@keyframes spin{to{transform:rotate(360deg)}}';
document.head.appendChild(_spinSt);
