// Gamification layer — progress ring, daily hero, XP/level/streak, confetti,
// per-subcategory color. Tasteful & subtle; tone is "a grown-up game".
// Reads CSS vars from index.html. Loaded before dashboard.jsx.

// ── Color: every subcategory gets its own jewel hue ─────────────────────────
const JEWELS = [
  'var(--jewel-jade)', 'var(--jewel-coral)', 'var(--jewel-sapphire)',
  'var(--jewel-gold)', 'var(--jewel-amethyst)', 'var(--jewel-teal)',
  'var(--jewel-rose)', 'var(--jewel-citron)',
];
function subColor(id) {
  let h = 0;
  for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) >>> 0;
  return JEWELS[h % JEWELS.length];
}
// colorPop = 'calm' → fall back to the parent category color
function subTint(sub, catName, colorPop) {
  if (colorPop === 'calm') return catName === 'Work' ? 'var(--work)' : 'var(--personal)';
  return subColor(sub.id);
}

// ── Scoring ─────────────────────────────────────────────────────────────────
const taskXP = (t) => 10 + (t.estimateMinutes || 0);
function calcStats(data) {
  const all = data.tasks;
  const done = all.filter(t => t.completedAt);
  const open = all.filter(t => !t.completedAt);
  const xp = done.reduce((s, t) => s + taskXP(t), 0);
  const level = 1 + Math.floor(xp / 300);
  const intoLevel = (xp % 300) / 300;
  const ratio = all.length ? done.length / all.length : 0;
  return { total: all.length, done: done.length, open: open.length, xp, level, intoLevel, ratio };
}
// "Showed up" streak — consecutive days back from today with ≥1 routine log.
function calcStreak(logs) {
  const days = new Set((logs || []).filter(l => l.completed).map(l => l.dateKey));
  const base = new Date();
  let streak = 0;
  for (let i = 0; i < 400; i++) {
    const d = new Date(base); d.setDate(base.getDate() - i);
    const key = d.toISOString().slice(0, 10);
    if (days.has(key)) streak++;
    else if (i > 0) break; // today may not be done yet; keep going from yesterday
  }
  return streak;
}
function catProgress(data, catName) {
  const cat = data.categories.find(c => c.name === catName);
  if (!cat) return { done: 0, total: 0, ratio: 0 };
  const subIds = new Set(data.subcategories.filter(s => s.categoryId === cat.id).map(s => s.id));
  const ts = data.tasks.filter(t => subIds.has(t.subcategoryId));
  const done = ts.filter(t => t.completedAt).length;
  return { done, total: ts.length, ratio: ts.length ? done / ts.length : 0 };
}

// ── Progress ring ───────────────────────────────────────────────────────────
function ProgressRing({ value = 0, size = 84, stroke = 8, children, gradientId = 'ring-grad' }) {
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;
  const [shown, setShown] = React.useState(0);
  React.useEffect(() => {
    const t = setTimeout(() => setShown(value), 80);
    return () => clearTimeout(t);
  }, [value]);
  return (
    <div style={{ position: 'relative', width: size, height: size, flexShrink: 0 }}>
      <svg width={size} height={size} style={{ transform: 'rotate(-90deg)', overflow: 'visible' }}>
        <defs>
          <linearGradient id={gradientId} x1="0" y1="0" x2="1" y2="1">
            <stop offset="0%" stopColor="var(--work)" />
            <stop offset="100%" stopColor="var(--personal)" />
          </linearGradient>
        </defs>
        <circle cx={size / 2} cy={size / 2} r={r} fill="none"
          stroke="var(--bg-alt)" strokeWidth={stroke} />
        {/* faint full-circle tint so the ring reads as colorful even when near-empty */}
        <circle cx={size / 2} cy={size / 2} r={r} fill="none"
          stroke={`url(#${gradientId})`} strokeWidth={stroke} strokeLinecap="round"
          opacity={0.16} />
        <circle cx={size / 2} cy={size / 2} r={r} fill="none"
          stroke={`url(#${gradientId})`} strokeWidth={stroke} strokeLinecap="round"
          strokeDasharray={c} strokeDashoffset={c * (1 - shown)}
          style={{ transition: 'stroke-dashoffset 1.1s cubic-bezier(.2,.7,.2,1)',
            filter: 'drop-shadow(0 2px 6px color-mix(in srgb, var(--work) 45%, transparent))' }} />
      </svg>
      <div style={{
        position: 'absolute', inset: 0, display: 'flex', flexDirection: 'column',
        alignItems: 'center', justifyContent: 'center', textAlign: 'center', lineHeight: 1,
      }}>{children}</div>
    </div>
  );
}

// small animated count-up number (interval-based so it always converges)
function CountUp({ value, dur = 700, className, style }) {
  const [n, setN] = React.useState(value);
  const prev = React.useRef(value);
  React.useEffect(() => {
    const from = prev.current, to = value; prev.current = value;
    if (from === to) { setN(to); return; }
    const steps = 24; let i = 0;
    const id = setInterval(() => {
      i++;
      const k = i / steps;
      const e = 1 - Math.pow(1 - k, 3);
      setN(Math.round(from + (to - from) * e));
      if (i >= steps) { clearInterval(id); setN(to); }
    }, dur / steps);
    return () => { clearInterval(id); setN(to); };
  }, [value]);
  return <span className={className} style={style}>{n.toLocaleString()}</span>;
}

// ── Category progress bar ───────────────────────────────────────────────────
function CatBar({ name, done, total, ratio, color }) {
  const [w, setW] = React.useState(0);
  React.useEffect(() => { const t = setTimeout(() => setW(ratio), 120); return () => clearTimeout(t); }, [ratio]);
  return (
    <div style={{ flex: 1, minWidth: 0 }}>
      <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', marginBottom: 6 }}>
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 7 }}>
          <span style={{ width: 8, height: 8, borderRadius: 3, background: color }} />
          <span style={{ fontSize: 12.5, fontWeight: 600, color: 'var(--ink)' }}>{name}</span>
        </span>
        <span className="num" style={{ fontSize: 11, color: 'var(--ink-3)' }}>{done}/{total}</span>
      </div>
      <div style={{ height: 7, borderRadius: 999, background: 'var(--bg-alt)', overflow: 'hidden' }}>
        <div style={{
          height: '100%', width: `${w * 100}%`, borderRadius: 999,
          background: `linear-gradient(90deg, ${color}, color-mix(in srgb, ${color} 60%, white))`,
          transition: 'width 1s cubic-bezier(.2,.7,.2,1)',
          boxShadow: `0 0 10px -2px ${color}`,
        }} />
      </div>
    </div>
  );
}

// ── Daily hero ──────────────────────────────────────────────────────────────
function greeting() {
  const h = new Date().getHours();
  if (h < 5) return 'Still up';
  if (h < 12) return 'Good morning';
  if (h < 17) return 'Good afternoon';
  if (h < 22) return 'Good evening';
  return 'Winding down';
}
function encourage(s) {
  if (s.total === 0) return 'A clean slate. Add something to chase.';
  if (s.done === 0) return 'Nothing done yet — knock out the first one.';
  if (s.ratio >= 1) return 'Every task cleared. Beautifully done.';
  if (s.ratio >= 0.66) return 'Almost there — the finish line is close.';
  if (s.ratio >= 0.33) return "You're on a roll. Keep the momentum.";
  return 'Good start. One at a time.';
}

function DailyHero({ data, available, setAvailable, onWhatsNext, play }) {
  const s = calcStats(data);
  const streak = calcStreak(data.routineLogs);
  const work = catProgress(data, 'Work');
  const personal = catProgress(data, 'Personal');
  const pct = Math.round(s.ratio * 100);

  return (
    <div style={{
      position: 'relative', overflow: 'hidden',
      background: 'linear-gradient(135deg, var(--surface), var(--surface-2))',
      border: '1px solid var(--line)', borderRadius: 'var(--radius-lg)',
      boxShadow: 'var(--shadow-md)', padding: '20px 22px',
    }}>
      <div aria-hidden style={{
        position: 'absolute', top: -90, right: -40, width: 280, height: 280,
        background: 'radial-gradient(circle, var(--work) 0%, transparent 70%)',
        opacity: 0.13, pointerEvents: 'none',
      }} />
      <div aria-hidden style={{
        position: 'absolute', bottom: -110, right: 160, width: 240, height: 240,
        background: 'radial-gradient(circle, var(--personal) 0%, transparent 70%)',
        opacity: 0.10, pointerEvents: 'none',
      }} />

      {/* top row */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 20, flexWrap: 'wrap', position: 'relative' }}>
        <ProgressRing value={s.ratio} size={88} stroke={9}>
          <span className="num display" style={{ fontSize: 21, fontWeight: 600, color: 'var(--ink)' }}>{pct}<span style={{ fontSize: 11, color: 'var(--ink-3)' }}>%</span></span>
          <span className="label" style={{ fontSize: 8, marginTop: 2 }}>today</span>
        </ProgressRing>

        <div style={{ flex: '1 1 240px', minWidth: 0 }}>
          <h1 className="display" style={{ margin: 0, fontSize: 28, fontWeight: 500, letterSpacing: '-.015em', color: 'var(--ink)', lineHeight: 1.12 }}>
            {greeting()}, Sam
          </h1>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', marginTop: 10 }}>
            {/* streak chip */}
            <span title="Check-in streak" style={{
              display: 'inline-flex', alignItems: 'center', gap: 5, padding: '4px 10px',
              borderRadius: 999, background: 'rgba(201,148,47,.14)',
              border: '1px solid rgba(201,148,47,.28)',
            }}>
              <IFlame s={13} style={{ color: '#c9942f' }} />
              <span className="num" style={{ fontSize: 12.5, fontWeight: 700, color: '#a9772a' }}>{streak}</span>
              <span style={{ fontSize: 11, color: 'var(--ink-3)' }}>day{streak === 1 ? '' : 's'}</span>
            </span>
            {/* level chip */}
            <span title={`${s.xp.toLocaleString()} XP`} style={{
              display: 'inline-flex', alignItems: 'center', gap: 6, padding: '4px 10px',
              borderRadius: 999, background: 'color-mix(in srgb, var(--jewel-amethyst) 13%, transparent)',
              border: '1px solid color-mix(in srgb, var(--jewel-amethyst) 34%, transparent)',
            }}>
              <span className="label" style={{ fontSize: 8.5, color: 'var(--jewel-amethyst)' }}>LVL</span>
              <span className="num" style={{ fontSize: 12.5, fontWeight: 700, color: 'var(--jewel-amethyst)' }}>{s.level}</span>
              <span style={{ width: 1, height: 11, background: 'color-mix(in srgb, var(--jewel-amethyst) 30%, transparent)' }} />
              <CountUp value={s.xp} className="num" style={{ fontSize: 11.5, color: 'var(--ink-2)', fontWeight: 700 }} />
              <span style={{ fontSize: 10, color: 'var(--ink-3)' }}>xp</span>
            </span>
          </div>
          <p style={{ margin: '7px 0 0', fontSize: 13.5, color: 'var(--ink-2)' }}>
            {encourage(s)} <span className="num" style={{ color: 'var(--ink-3)' }}>· {s.done}/{s.total} done</span>
          </p>
          {/* level progress sliver */}
          <div style={{ marginTop: 10, height: 5, borderRadius: 999, background: 'var(--bg-alt)', overflow: 'hidden', maxWidth: 320 }}>
            <div style={{
              height: '100%', width: `${s.intoLevel * 100}%`,
              background: 'linear-gradient(90deg, var(--jewel-amethyst), var(--jewel-sapphire))',
              transition: 'width 1s cubic-bezier(.2,.7,.2,1)',
              boxShadow: '0 0 10px -1px var(--jewel-amethyst)',
            }} />
          </div>
        </div>

        {/* action: I have __ min / What's next? */}
        <div style={{ display: 'flex', alignItems: 'stretch', position: 'relative', flexShrink: 0,
          borderRadius: 999, background: 'var(--bg)', border: '1px solid var(--line)',
          overflow: 'hidden', whiteSpace: 'nowrap', alignSelf: 'center',
        }}>
          <label style={{ display: 'inline-flex', alignItems: 'center', gap: 6, padding: '0 6px 0 14px' }}>
            <span className="label" style={{ fontSize: 9 }}>I have</span>
            <input value={available} type="number" min="0" step="15"
              onChange={(e) => setAvailable(Number(e.target.value) || 0)} className="num"
              aria-label="Available minutes"
              style={{ width: 42, border: 0, outline: 'none', background: 'transparent',
                fontSize: 15, fontWeight: 600, textAlign: 'right', color: 'var(--ink)' }} />
            <span className="num" style={{ fontSize: 11, color: 'var(--ink-3)' }}>min</span>
          </label>
          <button onClick={onWhatsNext} style={{
            display: 'inline-flex', alignItems: 'center', gap: 7, padding: '10px 16px',
            fontSize: 13, fontWeight: 700, color: 'var(--spark-ink, #fff)', whiteSpace: 'nowrap',
            background: 'var(--spark-grad)',
            boxShadow: 'inset 0 1px 0 rgba(255,255,255,.30), 0 6px 20px -5px var(--spark-glow)',
          }}>
            <ISparkles s={14} />What&rsquo;s next?
          </button>
        </div>
      </div>

      {/* category progress bars */}
      <div style={{ display: 'flex', gap: 22, marginTop: 18, paddingTop: 16, borderTop: '1px solid var(--line)', position: 'relative', flexWrap: 'wrap' }}>
        <CatBar name="Work" {...work} color="var(--work)" />
        <CatBar name="Personal" {...personal} color="var(--personal)" />
      </div>
    </div>
  );
}

Object.assign(window, {
  subColor, subTint, calcStats, calcStreak, catProgress, taskXP,
  ProgressRing, CountUp, CatBar, DailyHero,
});

// ── keyframes & helper classes for the gamified bits ────────────────────────
const gmStyle = document.createElement('style');
gmStyle.textContent = `
  @keyframes xpFloat{
    0%{ transform:translateY(2px) scale(.8); opacity:0 }
    25%{ transform:translateY(-4px) scale(1); opacity:1 }
    100%{ transform:translateY(-26px) scale(1); opacity:0 }
  }
  @keyframes checkPop{
    0%{ transform:scale(1) } 40%{ transform:scale(1.32) } 70%{ transform:scale(.92) } 100%{ transform:scale(1) }
  }
  @keyframes rowFlush{
    0%{ background:var(--flush) } 100%{ background:transparent }
  }
  @keyframes comboPop{
    0%{ transform:translate(-50%,6px) scale(.85); opacity:0 }
    20%{ transform:translate(-50%,0) scale(1); opacity:1 }
    80%{ transform:translate(-50%,0) scale(1); opacity:1 }
    100%{ transform:translate(-50%,-8px) scale(1); opacity:0 }
  }
  .xp-floater{ position:absolute; right:34px; top:50%; transform:translateY(-50%);
    font-family:var(--font-mono); font-weight:700; font-size:12px; pointer-events:none;
    animation:xpFloat 1s ease-out forwards; z-index:5; }
  .combo-badge{ position:fixed; left:50%; bottom:84px; transform:translateX(-50%); z-index:88;
    display:inline-flex; align-items:center; gap:8px; padding:9px 16px; border-radius:999px;
    background:var(--ink); color:var(--bg); font-weight:700; font-size:13px;
    box-shadow:var(--shadow-lg); animation:comboPop 1.5s ease-out forwards; }
`;
document.head.appendChild(gmStyle);
