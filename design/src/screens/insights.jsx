// Insights tab — stacked bar chart by day, segmented by subcategory + summary table.
// Chart is custom SVG (no recharts dependency) — matches editorial tone better.

function generateSeries(data, days, catFilter) {
  // Pseudo-deterministic synth: for each (sub, day) emit some minutes based on hash.
  // Real app pulls from completed task estimates.
  const subs = data.subcategories.filter(s => !s.archivedAt &&
    (catFilter === 'all' || data.categories.find(c=>c.id===s.categoryId).name.toLowerCase() === catFilter));
  const today = new Date();
  const series = [];
  for (let d = days - 1; d >= 0; d--) {
    const date = new Date(today); date.setDate(today.getDate() - d);
    const k = date.toISOString().slice(0, 10);
    const row = { date: k, label: date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) };
    subs.forEach((s, idx) => {
      const seed = (s.id.charCodeAt(2) * 13 + d * 7 + idx * 3) % 100;
      // Skip some days for realism
      if (seed < 18) row[s.id] = 0;
      else row[s.id] = Math.round((seed + d * 2 + idx * 5) % 95) + (idx === 0 ? 20 : 0);
    });
    series.push(row);
  }
  return { series, subs };
}

function pickPalette(subs, categories) {
  // Work = jade family (cool greens to teals). Personal = coral family (warm corals to roses to gold).
  const workShades = ['#4cc8a3', '#6bd5b3', '#88e0c1', '#5ec5d6', '#7dd9d6', '#3aa885', '#2f8a6c'];
  const persShades = ['#ff7d6b', '#ff9a8c', '#ef5da8', '#ff8466', '#e5b86a', '#ffac8b', '#d6826f'];
  const map = {};
  let w = 0, p = 0;
  subs.forEach(s => {
    const cat = categories.find(c => c.id === s.categoryId);
    if (cat.name === 'Work') map[s.id] = workShades[w++ % workShades.length];
    else map[s.id] = persShades[p++ % persShades.length];
  });
  return map;
}

function StackedChart({ series, subs, colors, height = 260 }) {
  if (series.length === 0) return null;
  const maxTotal = Math.max(1, ...series.map(r => subs.reduce((s, sub) => s + (r[sub.id] || 0), 0)));
  // Round axis up to nice number
  const niceMax = Math.ceil(maxTotal / 60) * 60;
  const padding = { top: 14, right: 8, bottom: 28, left: 38 };
  const W = Math.max(560, series.length * 28 + 80);
  const H = height;
  const cw = (W - padding.left - padding.right) / series.length;
  const barW = Math.min(20, cw * 0.7);

  const yTicks = 4;
  const tickStep = niceMax / yTicks;

  const [hover, setHover] = React.useState(null);

  return (
    <div style={{ overflowX: 'auto' }} className="lst">
      <svg width={W} height={H} style={{ display: 'block' }}>
        {/* y-axis ticks */}
        {Array.from({ length: yTicks + 1 }).map((_, i) => {
          const v = niceMax - i * tickStep;
          const y = padding.top + (i * (H - padding.top - padding.bottom) / yTicks);
          return (
            <g key={i}>
              <line x1={padding.left} x2={W - padding.right} y1={y} y2={y}
                stroke="var(--line)" strokeDasharray={i === yTicks ? '0' : '2 4'}/>
              <text x={padding.left - 8} y={y + 4} fontSize="10" textAnchor="end"
                fill="var(--ink-3)" fontFamily="var(--font-mono)">{Math.round(v)}m</text>
            </g>
          );
        })}
        {/* bars */}
        {series.map((row, i) => {
          let cum = 0;
          const x = padding.left + i * cw + (cw - barW) / 2;
          // Find which sub is the topmost (last non-zero) segment so we can round it.
          let topSubId = null;
          for (const sub of subs) if ((row[sub.id] || 0) > 0) topSubId = sub.id;
          return (
            <g key={i}
              onMouseEnter={()=>setHover(i)}
              onMouseLeave={()=>setHover(null)}>
              {subs.map(sub => {
                const v = row[sub.id] || 0;
                if (v === 0) return null;
                const h = (v / niceMax) * (H - padding.top - padding.bottom);
                const y = H - padding.bottom - cum - h;
                cum += h;
                const isTop = sub.id === topSubId;
                return (
                  <g key={sub.id}>
                    <rect x={x} y={y} width={barW} height={h}
                      rx={isTop ? Math.min(barW/2.5, 4) : 0}
                      ry={isTop ? Math.min(barW/2.5, 4) : 0}
                      fill={colors[sub.id]}
                      opacity={hover === null || hover === i ? 1 : 0.45}
                      style={{ transition: 'opacity .15s' }}/>
                    {/* inner highlight band for life */}
                    {h > 6 && (
                      <rect x={x} y={y} width={barW} height={Math.min(h, isTop ? 3 : 2)}
                        rx={isTop ? Math.min(barW/2.5, 4) : 0}
                        fill="white"
                        opacity={hover === null || hover === i ? 0.20 : 0.10}/>
                    )}
                  </g>
                );
              })}
              <text x={x + barW/2} y={H - padding.bottom + 14}
                fontSize="9.5" textAnchor="middle" fill="var(--ink-3)"
                fontFamily="var(--font-mono)">
                {i % Math.ceil(series.length / 14) === 0 ? row.label : ''}
              </text>
            </g>
          );
        })}
        {/* hover tooltip */}
        {hover !== null && (() => {
          const row = series[hover];
          const x = padding.left + hover * cw + cw / 2;
          const tipW = 140;
          const left = Math.min(W - tipW - 4, Math.max(4, x - tipW / 2));
          const rows = subs.map(s => ({ s, v: row[s.id] || 0 })).filter(r => r.v > 0).sort((a,b)=>b.v-a.v);
          const tipH = 22 + rows.length * 14;
          return (
            <g>
              <rect x={left} y={4} width={tipW} height={tipH}
                fill="var(--ink)" rx="6" opacity="0.96"/>
              <text x={left + 10} y={20} fontSize="11" fill="var(--bg)" fontWeight="600">{row.label}</text>
              {rows.map((r, ri) => (
                <g key={r.s.id}>
                  <rect x={left + 10} y={28 + ri*14 - 8} width={8} height={8} rx="2" fill={colors[r.s.id]}/>
                  <text x={left + 24} y={28 + ri*14} fontSize="10" fill="var(--bg)" opacity="0.85">
                    {r.s.name}
                  </text>
                  <text x={left + tipW - 10} y={28 + ri*14} fontSize="10" fill="var(--bg)"
                    textAnchor="end" fontFamily="var(--font-mono)">{r.v}m</text>
                </g>
              ))}
            </g>
          );
        })()}
      </svg>
    </div>
  );
}

function SummaryTable({ series, subs, colors, categories }) {
  const totals = subs.map(s => {
    const totMin = series.reduce((sum, r) => sum + (r[s.id] || 0), 0);
    // Approximate "tasks completed" from minutes / avg
    const tasks = Math.round(totMin / 25);
    return { sub: s, totMin, tasks, color: colors[s.id] };
  }).sort((a,b) => b.totMin - a.totMin);
  const grand = totals.reduce((s,r) => s + r.totMin, 0);

  return (
    <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13, marginTop: 24 }}>
      <thead>
        <tr style={{ borderBottom: '1px solid var(--line-strong)' }}>
          <th style={{ textAlign: 'left', padding: '10px 0', color: 'var(--ink-3)' }} className="label">Subcategory</th>
          <th style={{ textAlign: 'left', padding: '10px 0', color: 'var(--ink-3)' }} className="label">Category</th>
          <th style={{ textAlign: 'right', padding: '10px 0', color: 'var(--ink-3)' }} className="label">Tasks</th>
          <th style={{ textAlign: 'right', padding: '10px 0', color: 'var(--ink-3)' }} className="label">Minutes</th>
          <th style={{ textAlign: 'right', padding: '10px 0', color: 'var(--ink-3)' }} className="label">% total</th>
        </tr>
      </thead>
      <tbody>
        {totals.map(({ sub, totMin, tasks, color }) => {
          const cat = categories.find(c => c.id === sub.categoryId);
          const pct = grand ? (totMin / grand * 100) : 0;
          return (
            <tr key={sub.id} style={{ borderBottom: '1px solid var(--line)' }}>
              <td style={{ padding: '12px 0' }}>
                <span style={{ display: 'inline-flex', alignItems: 'center', gap: 10 }}>
                  <span style={{ width: 10, height: 10, borderRadius: 2, background: color }}/>
                  <span style={{ color: 'var(--ink)' }}>{sub.name}</span>
                </span>
              </td>
              <td style={{ padding: '12px 0', color: 'var(--ink-3)' }}>{cat.name}</td>
              <td style={{ padding: '12px 0', textAlign: 'right', color: 'var(--ink-2)' }} className="num">{tasks}</td>
              <td style={{ padding: '12px 0', textAlign: 'right', color: 'var(--ink-2)' }} className="num">{fmtMin(totMin)}</td>
              <td style={{ padding: '12px 0', textAlign: 'right', color: 'var(--ink-2)' }} className="num">{pct.toFixed(1)}%</td>
            </tr>
          );
        })}
        <tr>
          <td style={{ padding: '14px 0', fontWeight: 600 }}>Total</td>
          <td/>
          <td/>
          <td className="num" style={{ padding: '14px 0', textAlign: 'right', fontWeight: 600 }}>{fmtMin(grand)}</td>
          <td className="num" style={{ padding: '14px 0', textAlign: 'right', fontWeight: 600 }}>100.0%</td>
        </tr>
      </tbody>
    </table>
  );
}

function Insights({ data, mobile }) {
  const [range, setRange] = React.useState(30);
  const [catFilter, setCatFilter] = React.useState('all');

  const { series: rawSeries, subs: rawSubs } = React.useMemo(() => generateSeries(data, range, catFilter), [data, range, catFilter]);

  // Mobile: roll up subcategories into their parent categories for chart legibility.
  // The summary table below still shows per-subcategory detail.
  const { series, subs } = React.useMemo(() => {
    if (!mobile) return { series: rawSeries, subs: rawSubs };
    const rolled = data.categories.map(c => ({ id: 'roll-' + c.id, name: c.name, categoryId: c.id }));
    const includedCats = catFilter === 'all'
      ? rolled
      : rolled.filter(r => r.name.toLowerCase() === catFilter);
    const rolledSeries = rawSeries.map(r => {
      const out = { date: r.date, label: r.label };
      includedCats.forEach(rc => {
        out[rc.id] = rawSubs
          .filter(s => s.categoryId === rc.categoryId)
          .reduce((sum, s) => sum + (r[s.id] || 0), 0);
      });
      return out;
    });
    return { series: rolledSeries, subs: includedCats };
  }, [rawSeries, rawSubs, mobile, data.categories, catFilter]);

  const colors = React.useMemo(() => {
    if (mobile) {
      const m = {};
      subs.forEach(s => { m[s.id] = s.name === 'Work' ? 'var(--jewel-jade)' : 'var(--jewel-coral)'; });
      return m;
    }
    return pickPalette(subs, data.categories);
  }, [subs, data.categories, mobile]);

  // Full per-sub palette for the always-detailed summary table below.
  const rawColors = React.useMemo(() => pickPalette(rawSubs, data.categories), [rawSubs, data.categories]);

  const totalMinutes = series.reduce((s, r) => s + subs.reduce((sum,sub)=>sum+(r[sub.id]||0),0), 0);
  const dailyAvg = Math.round(totalMinutes / range);

  return (
    <div className="screen">
      <header style={{ display: 'flex', alignItems: 'baseline', gap: 14, marginBottom: 22, flexWrap: 'wrap' }}>
        <h1 className="display" style={{ margin: 0, fontSize: 32, fontWeight: 500, letterSpacing: '-.02em' }}>
          Insights
        </h1>
        <span className="label">Where the time went</span>
      </header>

      {/* Headline numbers */}
      <div style={{
        display: 'grid', gap: 1, marginBottom: 28,
        gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))',
        background: 'var(--line)', border: '1px solid var(--line)',
        borderRadius: 'var(--radius-md)', overflow: 'hidden',
      }}>
        {[
          { label: 'Last ' + range + ' days', val: fmtMin(totalMinutes), hint: 'total time logged', color: 'var(--jewel-jade)' },
          { label: 'Daily average', val: fmtMin(dailyAvg), hint: 'across all categories', color: 'var(--jewel-coral)' },
          { label: 'Active subcategories', val: subs.length, hint: 'with at least one task', color: 'var(--jewel-jade)' },
          { label: 'Most-touched', val: (subs[0] && subs.sort((a,b)=>{
              const sa = series.reduce((s,r)=>s+(r[a.id]||0),0);
              const sb = series.reduce((s,r)=>s+(r[b.id]||0),0);
              return sb - sa;
            })[0]?.name) || '—', hint: 'by minutes', color: 'var(--jewel-coral)' },
        ].map((s, i) => (
          <div key={i} style={{ background: 'var(--surface)', padding: '16px 18px', position: 'relative' }}>
            <div style={{
              position: 'absolute', top: 0, left: 0, right: 0, height: 2,
              background: `linear-gradient(90deg, ${s.color}, transparent 70%)`,
            }}/>
            <div className="label" style={{ marginBottom: 6, color: s.color, opacity: 0.85 }}>{s.label}</div>
            <div className="display" style={{ fontSize: 22, fontWeight: 600, letterSpacing: '-.02em' }}>{s.val}</div>
            <div style={{ fontSize: 11, color: 'var(--ink-3)', marginTop: 4 }}>{s.hint}</div>
          </div>
        ))}
      </div>

      {/* Filter bar */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 18, flexWrap: 'wrap' }}>
        <div style={{
          display: 'inline-flex', padding: 2, borderRadius: 999,
          background: 'var(--bg-alt)', border: '1px solid var(--line)',
        }}>
          {[7, 30, 90].map(r => (
            <button key={r} onClick={()=>setRange(r)}
              style={{
                padding: '6px 14px', borderRadius: 999, fontSize: 12,
                background: range === r ? 'var(--surface)' : 'transparent',
                boxShadow: range === r ? '0 1px 0 var(--line)' : 'none',
                fontWeight: range === r ? 600 : 500,
                color: range === r ? 'var(--ink)' : 'var(--ink-3)',
              }}>
              {r} days
            </button>
          ))}
        </div>
        <div style={{
          display: 'inline-flex', padding: 2, borderRadius: 999,
          background: 'var(--bg-alt)', border: '1px solid var(--line)',
        }}>
          {[{id:'all',label:'All'},{id:'work',label:'Work'},{id:'personal',label:'Personal'}].map(c => (
            <button key={c.id} onClick={()=>setCatFilter(c.id)}
              style={{
                padding: '6px 14px', borderRadius: 999, fontSize: 12,
                background: catFilter === c.id ? 'var(--surface)' : 'transparent',
                boxShadow: catFilter === c.id ? '0 1px 0 var(--line)' : 'none',
                fontWeight: catFilter === c.id ? 600 : 500,
                color: catFilter === c.id ? 'var(--ink)' : 'var(--ink-3)',
              }}>
              {c.label}
            </button>
          ))}
        </div>
      </div>

      <div style={{ background: 'var(--surface)', border: '1px solid var(--line)', borderRadius: 'var(--radius-md)', padding: '18px 20px' }}>
        {totalMinutes === 0 ? (
          <div style={{
            padding: '64px 24px', textAlign: 'center',
            color: 'var(--ink-3)', fontSize: 13, lineHeight: 1.6,
          }}>
            <div style={{
              width: 44, height: 44, borderRadius: '50%',
              background: 'var(--bg-alt)', color: 'var(--ink-3)',
              display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
              marginBottom: 14,
            }}><IFilter s={18}/></div>
            <div className="display" style={{
              fontSize: 16, fontWeight: 600, color: 'var(--ink-2)',
              letterSpacing: '-.01em', marginBottom: 4,
            }}>No time logged yet.</div>
            Complete a task and its estimated minutes show up here.<br/>
            Try a wider date range or change category filter.
          </div>
        ) : (
          <React.Fragment>
            <StackedChart series={series} subs={subs} colors={colors}/>

        {/* legend */}
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 14, marginTop: 14, paddingTop: 14, borderTop: '1px solid var(--line)' }}>
          {subs.map(s => (
            <div key={s.id} style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 12, color: 'var(--ink-2)' }}>
              <span style={{ width: 10, height: 10, borderRadius: 2, background: colors[s.id] }}/>{s.name}
            </div>
          ))}
        </div>
          </React.Fragment>
        )}
      </div>

      <SummaryTable series={rawSeries} subs={rawSubs} colors={rawColors} categories={data.categories}/>
    </div>
  );
}

window.Insights = Insights;
