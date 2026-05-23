// Category drill-down (route view).
// Breadcrumb · big category title · all subcategories expanded, inline editable.

function Breadcrumb({ items }) {
  return (
    <nav style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, color: 'var(--ink-3)' }}>
      {items.map((it, i) => (
        <React.Fragment key={i}>
          {it.onClick ? (
            <button onClick={it.onClick} style={{ color: 'var(--ink-3)' }}
              onMouseEnter={e=>e.currentTarget.style.color='var(--ink-2)'}
              onMouseLeave={e=>e.currentTarget.style.color='var(--ink-3)'}>
              {it.label}
            </button>
          ) : <span style={{ color: 'var(--ink-2)', fontWeight: 500 }}>{it.label}</span>}
          {i < items.length - 1 && <IChevR s={12}/>}
        </React.Fragment>
      ))}
    </nav>
  );
}

function CategoryView({ data, categoryId, onBack, onDrillSub, onTaskAction, onAddSub, hideCompleted, compact }) {
  const category = data.categories.find(c => c.id === categoryId);
  const subs = data.subcategories.filter(s => s.categoryId === categoryId && !s.archivedAt);
  const tasksBySub = React.useMemo(() => {
    const m = {};
    data.tasks.forEach(t => { (m[t.subcategoryId] ||= []).push(t); });
    return m;
  }, [data.tasks]);

  const allTasks = subs.flatMap(s => tasksBySub[s.id] || []);
  const openTasks = allTasks.filter(t => !t.completedAt);
  const totalMin = openTasks.reduce((s,t) => s + t.estimateMinutes, 0);

  return (
    <div className="screen">
      <Breadcrumb items={[
        { label: 'All', onClick: onBack },
        { label: category.name },
      ]}/>
      <header style={{
        display: 'flex', alignItems: 'baseline', gap: 16, marginTop: 12, marginBottom: 24,
        flexWrap: 'wrap',
      }}>
        <div style={{
          width: 6, height: 36, borderRadius: 3,
          background: catColor(category.name),
        }}/>
        <h1 className="display" style={{
          margin: 0, fontSize: 44, fontWeight: 500, letterSpacing: '-.02em',
        }}>{category.name}</h1>
        <span className="label">{openTasks.length} open · {fmtMin(totalMin)}</span>
        <span style={{ marginLeft: 'auto' }}/>
        <Button variant="ghost" icon={<IPlus s={14}/>} onClick={onAddSub}>Add subcategory</Button>
      </header>

      <div style={{ background: 'var(--surface)', border: '1px solid var(--line)', borderRadius: 'var(--radius-md)' }}>
        {subs.map((sub, i) => {
          const ts = tasksBySub[sub.id] || [];
          const open = ts.filter(t => !t.completedAt);
          const visibleTs = hideCompleted ? open : ts;
          const completedCount = ts.length - open.length;
          const mins = open.reduce((s,t)=>s+t.estimateMinutes,0);
          return (
            <section key={sub.id} style={{ borderTop: i === 0 ? 0 : '1px solid var(--line)' }}>
              <div style={{
                display: 'grid', gridTemplateColumns: '4px 1fr auto auto auto',
                alignItems: 'baseline', gap: 14,
                padding: '20px 22px 14px',
              }}>
                <span style={{
                  alignSelf: 'stretch', width: 2, borderRadius: 1,
                  background: 'var(--line-strong)', marginTop: 4, marginBottom: 4,
                }}/>
                <button onClick={() => onDrillSub(sub.id)}
                  style={{ textAlign: 'left' }}>
                  <h3 className="display" style={{ margin: 0, fontSize: 22, fontWeight: 500, letterSpacing: '-.01em' }}>
                    {sub.name}
                  </h3>
                </button>
                <span className="num label">{open.length}</span>
                <span className="num" style={{ fontSize: 13, color: 'var(--ink-2)' }}>{fmtMin(mins)}</span>
                <button onClick={() => onDrillSub(sub.id)}
                  style={{ display: 'inline-flex', alignItems: 'center', gap: 4, color: 'var(--ink-3)', fontSize: 12 }}>
                  Open <IChevR s={12}/>
                </button>
              </div>
              <div>
                {visibleTs.length === 0 ? (
                  <div style={{ padding: '8px 26px 18px', fontSize: 12, color: 'var(--ink-3)', fontStyle: 'italic' }}>
                    {completedCount > 0 ? `All ${completedCount} done.` : 'No tasks. Click + to add one.'}
                  </div>
                ) : visibleTs.map(t => (
                  <TaskRow key={t.id} task={t} subName={sub.name} compact={compact}
                    onToggle={() => onTaskAction({ type: 'toggle', task: t })}
                    onEdit={(patch) => onTaskAction({ type: 'edit', task: t, patch })}
                    onDelete={() => onTaskAction({ type: 'delete', task: t })}
                    onBell={() => onTaskAction({ type: 'bell', task: t })}
                    onBlock={() => onTaskAction({ type: 'block', task: t })}
                    onMove={() => onTaskAction({ type: 'move', task: t })}
                  />
                ))}
                <button onClick={() => onTaskAction({ type: 'add', subcategoryId: sub.id })}
                  style={{
                    display: 'flex', alignItems: 'center', gap: 8,
                    padding: '12px 22px 18px 28px', fontSize: 13, color: 'var(--ink-3)',
                  }}>
                  <IPlus s={14}/><span>New task in {sub.name}</span>
                </button>
              </div>
            </section>
          );
        })}
      </div>
    </div>
  );
}

window.CategoryView = CategoryView;
window.Breadcrumb = Breadcrumb;
