// Subcategory drill-down (route view).
// Breadcrumb · big sub name · bulk-selectable list · sort menu · bulk toolbar.

function SubcategoryView({ data, subcategoryId, onBack, onBackCategory, onTaskAction, hideCompleted, compact }) {
  const sub = data.subcategories.find(s => s.id === subcategoryId);
  const category = data.categories.find(c => c.id === sub.categoryId);
  const allTasks = data.tasks.filter(t => t.subcategoryId === subcategoryId);

  const [selected, setSelected] = React.useState(new Set());
  const [sortBy, setSortBy] = React.useState('created');
  const [localHide, setLocalHide] = React.useState(hideCompleted);
  React.useEffect(() => setLocalHide(hideCompleted), [hideCompleted]);

  const tasks = localHide ? allTasks.filter(t => !t.completedAt) : allTasks;

  const sorted = React.useMemo(() => {
    const list = [...tasks];
    if (sortBy === 'minutes') list.sort((a,b)=>b.estimateMinutes-a.estimateMinutes);
    else if (sortBy === 'priority') list.sort((a,b)=>(a.priority||9)-(b.priority||9));
    else if (sortBy === 'title') list.sort((a,b)=>a.title.localeCompare(b.title));
    return list;
  }, [tasks, sortBy]);

  const open = allTasks.filter(t => !t.completedAt);
  const completedCount = allTasks.length - open.length;
  const totalMin = open.reduce((s,t)=>s+t.estimateMinutes,0);

  const toggleAll = () => {
    if (selected.size === tasks.length) setSelected(new Set());
    else setSelected(new Set(tasks.map(t => t.id)));
  };
  const toggleOne = (id) => {
    const next = new Set(selected);
    if (next.has(id)) next.delete(id); else next.add(id);
    setSelected(next);
  };

  const runBulk = (action) => {
    const ids = [...selected];
    setSelected(new Set());
    onTaskAction({ type: 'bulk', action, ids, subcategoryId: sub.id });
  };

  return (
    <div className="screen">
      <Breadcrumb items={[
        { label: 'All', onClick: onBack },
        { label: category.name, onClick: () => onBackCategory(category.id) },
        { label: sub.name },
      ]}/>
      <header style={{ display: 'flex', alignItems: 'baseline', gap: 16, marginTop: 12, marginBottom: 24, flexWrap: 'wrap' }}>
        <div style={{ width: 6, height: 36, borderRadius: 3, background: catColor(category.name) }}/>
        <h1 className="display" style={{ margin: 0, fontSize: 40, fontWeight: 500, letterSpacing: '-.02em' }}>
          {sub.name}
        </h1>
        <span className="label">{open.length} open · {fmtMin(totalMin)}</span>
        {completedCount > 0 && (
          <button onClick={()=>setLocalHide(v=>!v)}
            style={{
              fontSize: 11, letterSpacing: '.08em', textTransform: 'uppercase',
              fontFamily: 'var(--font-mono)', fontWeight: 500,
              color: 'var(--ink-3)', padding: '4px 8px', borderRadius: 4,
              border: '1px solid var(--line)',
            }}
            onMouseEnter={(e)=>{e.currentTarget.style.background='var(--bg-alt)';e.currentTarget.style.color='var(--ink-2)';}}
            onMouseLeave={(e)=>{e.currentTarget.style.background='transparent';e.currentTarget.style.color='var(--ink-3)';}}>
            {localHide ? `Show ${completedCount} done` : `Hide ${completedCount} done`}
          </button>
        )}
        <span style={{ marginLeft: 'auto' }}/>
        <div style={{ display: 'flex', gap: 8 }}>
          <Menu items={[
            { label: 'Created (default)', onClick: () => setSortBy('created'), right: sortBy==='created'?'✓':'' },
            { label: 'Estimate (high → low)', onClick: () => setSortBy('minutes'), right: sortBy==='minutes'?'✓':'' },
            { label: 'Priority (1 → 3)', onClick: () => setSortBy('priority'), right: sortBy==='priority'?'✓':'' },
            { label: 'Title (A → Z)', onClick: () => setSortBy('title'), right: sortBy==='title'?'✓':'' },
          ]}/>
          <Button variant="primary" icon={<IPlus s={14}/>} onClick={()=>onTaskAction({type:'add',subcategoryId:sub.id})}>Add task</Button>
        </div>
      </header>

      {/* Bulk toolbar */}
      {selected.size > 0 && (
        <div style={{
          position: 'sticky', top: 12, zIndex: 5,
          display: 'flex', alignItems: 'center', gap: 12,
          padding: '10px 16px', marginBottom: 14,
          background: 'var(--ink)', color: 'var(--bg)',
          borderRadius: 999, boxShadow: '0 8px 24px rgba(0,0,0,.32)',
        }}>
          <span style={{ fontSize: 13, fontWeight: 600 }}>{selected.size} selected</span>
          <span style={{ width: 1, height: 14, background: 'rgba(255,255,255,.18)' }}/>
          <button onClick={()=>runBulk('move')}
            onMouseEnter={(e)=>e.currentTarget.style.opacity='.7'}
            onMouseLeave={(e)=>e.currentTarget.style.opacity='1'}
            style={{ color: 'var(--bg)', fontSize: 13, display: 'inline-flex', alignItems: 'center', gap: 6 }}>
            <IMove s={14}/>Move to…
          </button>
          <button onClick={()=>runBulk('complete')}
            onMouseEnter={(e)=>e.currentTarget.style.opacity='.7'}
            onMouseLeave={(e)=>e.currentTarget.style.opacity='1'}
            style={{ color: 'var(--bg)', fontSize: 13, display: 'inline-flex', alignItems: 'center', gap: 6 }}>
            <ICheck s={14}/>Mark complete
          </button>
          <button onClick={()=>runBulk('delete')}
            onMouseEnter={(e)=>e.currentTarget.style.opacity='.7'}
            onMouseLeave={(e)=>e.currentTarget.style.opacity='1'}
            style={{ color: 'var(--destructive)', fontSize: 13, display: 'inline-flex', alignItems: 'center', gap: 6, marginLeft: 'auto' }}>
            <ITrash s={14}/>Delete
          </button>
          <button onClick={()=>setSelected(new Set())} style={{ color: 'var(--bg)', opacity: .6, fontSize: 12 }}>Cancel</button>
        </div>
      )}

      <div style={{ background: 'var(--surface)', border: '1px solid var(--line)', borderRadius: 'var(--radius-md)', overflow: 'hidden' }}>
        {/* list header */}
        <div style={{
          display: 'grid', gridTemplateColumns: '40px 24px 1fr 80px 28px 28px 28px',
          alignItems: 'center', gap: 10, padding: '8px 12px',
          background: 'var(--bg-alt)', borderBottom: '1px solid var(--line)',
        }}>
          <Check checked={selected.size === tasks.length && tasks.length > 0}
            indeterminate={selected.size > 0 && selected.size < tasks.length}
            onChange={toggleAll} size={16}/>
          <span/>
          <span className="label" style={{ fontSize: 10 }}>Task</span>
          <span className="label" style={{ fontSize: 10, textAlign: 'right' }}>Est.</span>
          <span/><span/><span/>
        </div>
        {sorted.map(t => {
          const isSel = selected.has(t.id);
          const completed = !!t.completedAt;
          const isPriority = t.priority === 1 && !completed;
          return (
            <div key={t.id}
              onMouseEnter={(e)=>e.currentTarget.style.background=isSel?'var(--accent-soft)':'var(--bg-alt)'}
              onMouseLeave={(e)=>e.currentTarget.style.background=isSel?'var(--accent-soft)':'transparent'}
              style={{
                display: 'grid', gridTemplateColumns: '40px 24px 1fr 80px 28px 28px 28px',
                alignItems: 'center', gap: 10, padding: compact ? '6px 12px' : '10px 12px',
                paddingLeft: isPriority ? 9 : 12,
                borderBottom: '1px solid var(--line)',
                borderLeft: isPriority ? '3px solid var(--destructive)' : '3px solid transparent',
                background: isSel ? 'var(--accent-soft)' : 'transparent',
                opacity: completed ? .5 : 1, transition: 'background .12s',
              }}>
              <Check checked={isSel} onChange={()=>toggleOne(t.id)} size={16}/>
              <Check checked={completed} onChange={() => onTaskAction({ type: 'toggle', task: t })} size={16}/>
              <span style={{ fontSize: 13, color: 'var(--ink)', textDecoration: completed?'line-through':'none', textDecorationColor: 'var(--ink-3)' }}>
                {t.title}
              </span>
              <span className="num" style={{ fontSize: 12, color: 'var(--ink-3)', textAlign: 'right' }}>{fmtMin(t.estimateMinutes)}</span>
              <IconBtn label={t.remindAt?'Edit reminder':'Add reminder'} onClick={()=>onTaskAction({type:'bell',task:t})}
                tone={t.remindAt?'accent':'ghost'} size={24}>
                {t.remindAt ? <IBellOn s={14}/> : <IBell s={14}/>}
              </IconBtn>
              <IconBtn label="Delete" onClick={()=>onTaskAction({type:'delete',task:t})} size={24}><ITrash s={14}/></IconBtn>
              <Menu items={[
                { icon: <ISparkles s={14}/>, label: 'Block time', onClick: ()=>onTaskAction({type:'block',task:t}) },
                { icon: <IMove s={14}/>, label: 'Move to…', onClick: ()=>onTaskAction({type:'move',task:t}) },
                '-',
                { icon: <ITrash s={14}/>, label: 'Delete', tone: 'danger', onClick: ()=>onTaskAction({type:'delete',task:t}) },
              ]}/>
            </div>
          );
        })}
        {tasks.length === 0 && (
          <div style={{ padding: '32px 20px', textAlign: 'center', color: 'var(--ink-3)', fontSize: 13 }}>
            No tasks here yet.
          </div>
        )}
      </div>
    </div>
  );
}

window.SubcategoryView = SubcategoryView;
