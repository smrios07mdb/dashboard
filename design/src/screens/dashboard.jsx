// Unified Dashboard — landing screen.
// Two-column layout (Work / Personal). Inline-expand subcategories.
// Header strip with "Today: N tasks / M minutes" + available time + What's next?.

function TaskRow({ task, subName, onToggle, onEdit, onDelete, onMove, onBell, onBlock, compact }) {
  const [editing, setEditing] = React.useState(false);
  const [val, setVal] = React.useState(task.title);
  const [editMin, setEditMin] = React.useState(false);
  const [minVal, setMinVal] = React.useState(task.estimateMinutes);

  React.useEffect(() => setVal(task.title), [task.title]);
  React.useEffect(() => setMinVal(task.estimateMinutes), [task.estimateMinutes]);

  const commit = () => { setEditing(false); onEdit && onEdit({ title: val }); };
  const commitMin = () => { setEditMin(false); onEdit && onEdit({ estimateMinutes: Number(minVal) || 0 }); };

  const isOverdue = task.remindAt && new Date(task.remindAt) < new Date() && !task.notified;
  const completed = !!task.completedAt;

  return (
    <div onMouseEnter={(e)=>e.currentTarget.style.background='var(--bg-alt)'}
         onMouseLeave={(e)=>e.currentTarget.style.background='transparent'}
         style={{
      display: 'grid',
      gridTemplateColumns: '24px 1fr auto auto auto auto',
      alignItems: 'center', gap: 10,
      padding: compact ? '6px 8px 6px 4px' : '8px 8px 8px 6px',
      borderBottom: '1px solid var(--line)',
      borderLeft: task.priority === 1 && !completed
        ? '3px solid var(--destructive)' : '3px solid transparent',
      paddingLeft: task.priority === 1 && !completed
        ? (compact ? 5 : 7) : (compact ? 8 : 10),
      opacity: completed ? .5 : 1,
      transition: 'background .12s',
    }}>
      <Check checked={completed} onChange={onToggle} size={16}/>
      {!editing ? (
        <button onClick={() => setEditing(true)} style={{
          textAlign: 'left', overflow: 'hidden',
          textDecoration: completed ? 'line-through' : 'none',
          textDecorationColor: 'var(--ink-3)',
          color: 'var(--ink)', fontSize: 13, lineHeight: 1.4,
          whiteSpace: 'nowrap', textOverflow: 'ellipsis',
        }} title={task.title}>
          {task.title}
        </button>
      ) : (
        <input autoFocus value={val} onChange={e=>setVal(e.target.value)}
          onBlur={commit} onKeyDown={e=>{ if (e.key==='Enter') commit(); if (e.key==='Escape') {setVal(task.title); setEditing(false);} }}
          style={{
            border: 0, outline: 'none', background: 'var(--surface)',
            borderRadius: 4, padding: '4px 6px', fontSize: 13, width: '100%',
            boxShadow: 'inset 0 0 0 1px var(--accent)',
          }}/>
      )}
      {!editMin ? (
        <button onClick={()=>setEditMin(true)} className="num"
          style={{ color: 'var(--ink-3)', fontSize: 12, padding: '2px 4px' }}>
          {fmtMin(task.estimateMinutes)}
        </button>
      ) : (
        <input autoFocus type="number" min="0" step="5" value={minVal}
          onChange={e=>setMinVal(e.target.value)}
          onBlur={commitMin} onKeyDown={e=>{ if (e.key==='Enter') commitMin(); if (e.key==='Escape') {setMinVal(task.estimateMinutes); setEditMin(false);} }}
          style={{
            width: 56, border: 0, outline: 'none', background: 'var(--surface)',
            borderRadius: 4, padding: '4px 6px', fontSize: 12, textAlign: 'right',
            boxShadow: 'inset 0 0 0 1px var(--accent)',
          }}/>
      )}
      {task.remindAt ? (
        <IconBtn size={24} label="Edit reminder" onClick={onBell} tone={isOverdue ? 'danger' : 'accent'}>
          <IBellOn s={14}/>
        </IconBtn>
      ) : (
        <IconBtn size={24} label="Add reminder" onClick={onBell}><IBell s={14}/></IconBtn>
      )}
      <IconBtn size={24} label="Delete" onClick={onDelete}><ITrash s={14}/></IconBtn>
      <Menu items={[
        { icon: <ISparkles s={14}/>, label: 'Block time', onClick: onBlock },
        { icon: <IMove s={14}/>, label: 'Move to…', onClick: onMove, right: subName },
        { icon: <IClock s={14}/>, label: 'Set reminder', onClick: onBell },
        '-',
        { icon: <ITrash s={14}/>, label: 'Delete', tone: 'danger', onClick: onDelete },
      ]}/>
    </div>
  );
}

function SubcatSection({ sub, tasks, expanded, onToggleExpanded, onDrillIn, onMenu, onAddTask, onTaskAction, compact, hideCompleted }) {
  const minutes = tasks.reduce((s, t) => s + (t.completedAt ? 0 : t.estimateMinutes), 0);
  const count = tasks.filter(t => !t.completedAt).length;
  const completedCount = tasks.length - count;
  const [showDone, setShowDone] = React.useState(false);
  const visibleTasks = hideCompleted && !showDone
    ? tasks.filter(t => !t.completedAt)
    : tasks;
  return (
    <section style={{ borderTop: '1px solid var(--line)' }}>
      <div style={{
        display: 'grid', gridTemplateColumns: '18px 1fr auto auto auto',
        alignItems: 'center', gap: 10,
        padding: compact ? '10px 4px 10px 6px' : '14px 4px 14px 6px',
        cursor: 'pointer',
      }} onClick={onToggleExpanded}>
        <span style={{
          display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
          color: 'var(--ink-3)', transition: 'transform .18s',
          transform: expanded ? 'rotate(90deg)' : 'rotate(0deg)',
        }}><IChevR s={14}/></span>
        <div style={{ fontSize: 14, fontWeight: 500, color: 'var(--ink)', letterSpacing: '-.005em' }}>
          {sub.name}
        </div>
        <span className="num" style={{ fontSize: 12, color: 'var(--ink-3)' }}>{count}</span>
        <span className="num" style={{ fontSize: 12, color: 'var(--ink-3)', minWidth: 50, textAlign: 'right' }}>{fmtMin(minutes)}</span>
        <span onClick={(e)=>e.stopPropagation()}>
          <Menu items={[
            { icon: <IArrowR s={14}/>, label: 'Open '+sub.name, onClick: onDrillIn },
            { icon: <IPlus s={14}/>, label: 'Add task', onClick: onAddTask },
            '-',
            { icon: <ITag s={14}/>, label: 'Rename', onClick: onMenu },
            { icon: <IMove s={14}/>, label: 'Merge into…', onClick: onMenu },
            '-',
            { icon: <ITrash s={14}/>, label: 'Delete subcategory', tone: 'danger', onClick: onMenu },
          ]}/>
        </span>
      </div>
      {expanded && (
        <div style={{ paddingBottom: 8 }}>
          {visibleTasks.length === 0 ? (
            <div style={{
              borderTop: '1px solid var(--line)',
              padding: '14px 18px', fontSize: 12, color: 'var(--ink-3)', fontStyle: 'italic',
            }}>{completedCount > 0 ? `All done. ${completedCount} completed.` : 'No tasks here.'}</div>
          ) : visibleTasks.map(t => (
            <TaskRow key={t.id} task={t} subName={sub.name} compact={compact}
              onToggle={() => onTaskAction({ type: 'toggle', task: t })}
              onEdit={(patch) => onTaskAction({ type: 'edit', task: t, patch })}
              onDelete={() => onTaskAction({ type: 'delete', task: t })}
              onBell={() => onTaskAction({ type: 'bell', task: t })}
              onBlock={() => onTaskAction({ type: 'block', task: t })}
              onMove={() => onTaskAction({ type: 'move', task: t })}
            />
          ))}
          {hideCompleted && completedCount > 0 && (
            <button onClick={() => setShowDone(s => !s)}
              style={{
                display: 'flex', alignItems: 'center', gap: 6,
                padding: '8px 8px 8px 30px', fontSize: 11, color: 'var(--ink-3)',
                width: '100%', borderTop: '1px solid var(--line)',
                letterSpacing: '.04em', fontFamily: 'var(--font-mono)', fontWeight: 500,
              }}
              onMouseEnter={(e)=>e.currentTarget.style.color='var(--ink-2)'}
              onMouseLeave={(e)=>e.currentTarget.style.color='var(--ink-3)'}>
              <span style={{
                display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
                width: 14, height: 14, transition: 'transform .18s',
                transform: showDone ? 'rotate(180deg)' : 'rotate(0deg)',
              }}><IChevD s={12}/></span>
              {showDone ? 'HIDE COMPLETED' : `${completedCount} COMPLETED`}
            </button>
          )}
          <button onClick={onAddTask} style={{
            display: 'flex', alignItems: 'center', gap: 8,
            padding: '10px 8px 10px 30px', fontSize: 13, color: 'var(--ink-3)',
            width: '100%',
          }}>
            <IPlus s={14}/>
            <span>New task</span>
          </button>
        </div>
      )}
    </section>
  );
}

function CategoryColumn({ category, subcategories, tasksBySub, expandedSet, onToggleSub, onDrillCat, onDrillSub, onAddSub, onAddTask, onTaskAction, compact, accent, hideCompleted }) {
  const allTasks = subcategories.flatMap(s => tasksBySub[s.id] || []);
  const open = allTasks.filter(t => !t.completedAt);
  const total = open.reduce((s, t) => s + t.estimateMinutes, 0);

  return (
    <div style={{
      borderRadius: 'var(--radius-md)',
      background: 'transparent',
    }}>
      {/* Category header — full bleed, no card */}
      <header style={{
        display: 'grid', gridTemplateColumns: '8px 1fr auto auto auto',
        alignItems: 'baseline', gap: 14, padding: '4px 0 18px',
        cursor: 'pointer',
      }} onClick={onDrillCat}>
        <span style={{
          alignSelf: 'stretch', width: 4, borderRadius: 2,
          background: accent || catColor(category.name), marginTop: 6,
        }}/>
        <h2 className="display" style={{
          margin: 0, fontSize: 28,
          fontWeight: 600, letterSpacing: '-.025em',
          color: 'var(--ink)',
        }}>{category.name}</h2>
        <span className="num label" style={{ fontSize: 11, whiteSpace: 'nowrap' }}>{open.length} open</span>
        <span className="num display" style={{ fontSize: 18, fontWeight: 500, color: 'var(--ink-2)', whiteSpace: 'nowrap' }}>{fmtMin(total)}</span>
        <IconBtn label="Open category" onClick={(e)=>{ e.stopPropagation(); onDrillCat(); }}><IChevR s={16}/></IconBtn>
      </header>

      <div style={{ background: 'var(--surface)', border: '1px solid var(--line)', borderRadius: 'var(--radius-md)' }}>
        {subcategories.map(sub => (
          <SubcatSection key={sub.id} sub={sub}
            tasks={tasksBySub[sub.id] || []}
            compact={compact}
            hideCompleted={hideCompleted}
            expanded={expandedSet.has(sub.id)}
            onToggleExpanded={() => onToggleSub(sub.id)}
            onDrillIn={() => onDrillSub(sub.id)}
            onAddTask={() => onAddTask(sub.id)}
            onTaskAction={onTaskAction}
            onMenu={() => {}}
          />
        ))}

        <button onClick={onAddSub} style={{
          display: 'flex', alignItems: 'center', gap: 8,
          padding: '12px 16px', fontSize: 12, color: 'var(--ink-3)',
          width: '100%', borderTop: '1px solid var(--line)',
        }}>
          <IPlus s={14}/>
          <span className="label">Add subcategory</span>
        </button>
      </div>
    </div>
  );
}

function TodayStrip({ openTasks, available, setAvailable, onWhatsNext, completedCount, hideCompleted, setHideCompleted }) {
  const minutes = openTasks.reduce((s, t) => s + t.estimateMinutes, 0);
  const count = openTasks.length;
  return (
    <div style={{
      display: 'flex', alignItems: 'center', gap: 14, flexWrap: 'wrap',
      padding: '14px 18px',
      background: 'linear-gradient(135deg, var(--surface), var(--surface-2))',
      border: '1px solid var(--line)',
      borderRadius: 'var(--radius-md)',
      position: 'relative', overflow: 'hidden',
    }}>
      <div aria-hidden style={{
        position: 'absolute', top: -60, right: -60, width: 240, height: 240,
        background: 'radial-gradient(circle, var(--jewel-jade) 0%, transparent 70%)',
        opacity: 0.10, pointerEvents: 'none',
      }}/>
      {/* Summary group */}
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 7, marginRight: 'auto',
        position: 'relative', minWidth: 0, flex: '1 1 auto' }}>
        <span className="label">Today</span>
        <span className="num" style={{ fontSize: 14, color: 'var(--ink)', fontWeight: 600 }}>{count}</span>
        <span style={{ fontSize: 13, color: 'var(--ink-3)' }}>open</span>
        <span style={{ color: 'var(--ink-4)' }}>·</span>
        <span className="num" style={{ fontSize: 13, color: 'var(--ink-2)' }}>{fmtMin(minutes)}</span>
        {completedCount > 0 && (
          <React.Fragment>
            <span style={{ color: 'var(--ink-4)' }}>·</span>
            <button onClick={()=>setHideCompleted(v=>!v)}
              title={hideCompleted ? 'Show completed tasks' : 'Hide completed tasks'}
              style={{
                fontSize: 11, letterSpacing: '.08em', textTransform: 'uppercase',
                fontFamily: 'var(--font-mono)', fontWeight: 500,
                color: hideCompleted ? 'var(--ink-3)' : 'var(--ink-2)',
                padding: '2px 6px', borderRadius: 4, whiteSpace: 'nowrap',
              }}
              onMouseEnter={(e)=>e.currentTarget.style.background='var(--bg-alt)'}
              onMouseLeave={(e)=>e.currentTarget.style.background='transparent'}>
              {hideCompleted ? `Show ${completedCount} done` : `Hide ${completedCount} done`}
            </button>
          </React.Fragment>
        )}
      </div>
      {/* Action group — input + CTA coordinated, won't wrap apart */}
      <div style={{ display: 'flex', alignItems: 'stretch', position: 'relative', flexShrink: 0,
        borderRadius: 999, background: 'var(--bg)',
        border: '1px solid var(--line)',
        overflow: 'hidden', whiteSpace: 'nowrap',
      }}>
        <label style={{ display: 'inline-flex', alignItems: 'center', gap: 6, padding: '0 6px 0 14px' }}>
          <span className="label" style={{ fontSize: 9 }}>I have</span>
          <input value={available} type="number" min="0" step="15"
            onChange={(e)=>setAvailable(Number(e.target.value)||0)}
            className="num"
            aria-label="Available minutes"
            style={{ width: 44, border: 0, outline: 'none', background: 'transparent',
              fontSize: 15, fontWeight: 600, textAlign: 'right', color: 'var(--ink)' }}/>
          <span className="num" style={{ fontSize: 11, color: 'var(--ink-3)' }}>min</span>
        </label>
        <button onClick={onWhatsNext}
          style={{
            display: 'inline-flex', alignItems: 'center', gap: 7,
            padding: '8px 16px', fontSize: 13, fontWeight: 600,
            color: '#fff', whiteSpace: 'nowrap',
            background: 'linear-gradient(135deg, var(--jewel-jade), var(--jewel-coral))',
            boxShadow: 'inset 1px 0 0 rgba(0,0,0,.18), 0 0 24px -8px rgba(76,200,163,.55)',
            letterSpacing: '-.005em',
          }}>
          <ISparkles s={14}/>What&rsquo;s next?
        </button>
      </div>
    </div>
  );
}

function Dashboard({ data, expandedSubs, onToggleSub, onDrillCat, onDrillSub, onTaskAction, available, setAvailable, onWhatsNext, hideCompleted, setHideCompleted, compact, mobile }) {
  const tasksBySub = React.useMemo(() => {
    const m = {};
    data.tasks.forEach(t => { (m[t.subcategoryId] ||= []).push(t); });
    return m;
  }, [data.tasks]);
  const subsByCat = React.useMemo(() => {
    const m = {};
    data.subcategories.filter(s => !s.archivedAt).forEach(s => { (m[s.categoryId] ||= []).push(s); });
    return m;
  }, [data.subcategories]);
  const openTasks = data.tasks.filter(t => !t.completedAt);
  const completedCount = data.tasks.length - openTasks.length;

  return (
    <div className="screen">
      <TodayStrip openTasks={openTasks} available={available} setAvailable={setAvailable}
        onWhatsNext={onWhatsNext}
        completedCount={completedCount}
        hideCompleted={hideCompleted} setHideCompleted={setHideCompleted}/>

      {openTasks.length === 0 && completedCount > 0 && (
        <div style={{
          marginTop: 18, padding: '14px 16px',
          background: 'rgba(76,200,163,.08)',
          border: '1px solid rgba(76,200,163,.30)',
          borderRadius: 'var(--radius)',
          display: 'flex', alignItems: 'center', gap: 10,
        }}>
          <span style={{
            display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
            width: 28, height: 28, borderRadius: '50%',
            background: 'rgba(76,200,163,.18)', color: 'var(--jewel-jade)',
            flexShrink: 0,
          }}><ICheck s={16}/></span>
          <span style={{ flex: 1, fontSize: 13, color: 'var(--ink)' }}>
            <strong style={{ fontWeight: 600 }}>All clear for today.</strong>{' '}
            <span style={{ color: 'var(--ink-2)' }}>{completedCount} task{completedCount === 1 ? '' : 's'} done. Nothing else queued.</span>
          </span>
        </div>
      )}

      {data.tasks.length === 0 && (
        <div style={{
          marginTop: 40, padding: '48px 24px', textAlign: 'center',
          border: '1px dashed var(--line-strong)', borderRadius: 'var(--radius-md)',
        }}>
          <div style={{
            width: 44, height: 44, borderRadius: '50%',
            background: 'var(--accent-soft)', color: 'var(--accent)',
            display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
            marginBottom: 14,
          }}><IPlus s={20}/></div>
          <h3 className="display" style={{ margin: 0, fontSize: 18, fontWeight: 600, letterSpacing: '-.015em' }}>
            Nothing here yet.
          </h3>
          <p style={{ margin: '6px 0 16px', color: 'var(--ink-3)', fontSize: 13, lineHeight: 1.55 }}>
            Add a task to Work or Personal to get started.
            Tasks group into subcategories you define.
          </p>
          <Button variant="primary" icon={<IPlus s={14}/>}
            onClick={()=>onTaskAction({type:'add',subcategoryId:'s-atlas'})}>
            Add your first task
          </Button>
        </div>
      )}

      {data.tasks.length > 0 && (
      <div style={{
        display: 'grid', gap: mobile ? 24 : 'clamp(24px, 3vw, 40px)',
        gridTemplateColumns: mobile ? '1fr' : '1fr 1fr',
        marginTop: 32,
      }}>
        {data.categories.map(cat => (
          <CategoryColumn key={cat.id} category={cat}
            subcategories={subsByCat[cat.id] || []}
            tasksBySub={tasksBySub}
            expandedSet={expandedSubs}
            onToggleSub={onToggleSub}
            onDrillCat={() => onDrillCat(cat.id)}
            onDrillSub={onDrillSub}
            onAddSub={() => {}}
            onAddTask={(sid) => onTaskAction({ type: 'add', subcategoryId: sid })}
            onTaskAction={onTaskAction}
            compact={compact}
            hideCompleted={hideCompleted}
          />
        ))}
      </div>
      )}
    </div>
  );
}

Object.assign(window, { Dashboard, TaskRow, SubcatSection, CategoryColumn, TodayStrip });
