// Shared UI primitives. All use CSS vars from index.html.
// Style objects use unique names per file (primStyles, etc.) to avoid collisions.

const primStyles = {
  btnBase: {
    display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
    gap: 8, height: 36, padding: '0 14px', borderRadius: 'var(--radius)',
    border: '1px solid transparent', fontSize: 13, fontWeight: 500,
    lineHeight: 1, transition: 'background .14s, border-color .14s, color .14s',
    whiteSpace: 'nowrap', userSelect: 'none',
  },
};

const Button = ({ variant = 'ghost', size = 'md', icon, children, style, ...rest }) => {
  const v = {
    primary:  { background: 'var(--accent)', color: 'var(--bg)', borderColor: 'var(--accent)' },
    ghost:    { background: 'transparent', color: 'var(--ink)', borderColor: 'var(--line)' },
    plain:    { background: 'transparent', color: 'var(--ink-2)', borderColor: 'transparent' },
    danger:   { background: 'transparent', color: 'var(--destructive)', borderColor: 'var(--line)' },
    solid:    { background: 'var(--ink)', color: 'var(--bg)', borderColor: 'var(--ink)' },
  }[variant];
  const s = size === 'sm'
    ? { height: 30, padding: '0 10px', fontSize: 12 }
    : size === 'lg' ? { height: 42, padding: '0 18px', fontSize: 14 } : {};
  return (
    <button {...rest}
      onMouseDown={(e)=>e.currentTarget.style.transform='translateY(.5px)'}
      onMouseUp={(e)=>e.currentTarget.style.transform=''}
      onMouseLeave={(e)=>e.currentTarget.style.transform=''}
      style={{ ...primStyles.btnBase, ...v, ...s, ...style }}>
      {icon}
      {children}
    </button>
  );
};

const IconBtn = ({ children, label, tone = 'ghost', size = 28, style, ...rest }) => {
  const tones = {
    ghost: { color: 'var(--ink-3)' },
    danger: { color: 'var(--destructive)' },
    accent: { color: 'var(--accent)' },
    ink: { color: 'var(--ink-2)' },
  };
  return (
    <button aria-label={label} title={label} {...rest}
      onMouseEnter={(e)=>e.currentTarget.style.background='var(--bg-alt)'}
      onMouseLeave={(e)=>e.currentTarget.style.background='transparent'}
      style={{
        width: size, height: size, display: 'inline-flex', alignItems: 'center',
        justifyContent: 'center', borderRadius: 'var(--radius-sm)',
        ...tones[tone], ...style,
      }}>
      {children}
    </button>
  );
};

const Input = ({ leading, trailing, style, inputStyle, suffix, prefix, ...rest }) => (
  <div style={{
    display: 'flex', alignItems: 'center', height: 36,
    padding: '0 10px', gap: 6,
    border: '1px solid var(--line)', borderRadius: 'var(--radius)',
    background: 'var(--surface)', ...style,
  }}>
    {leading}
    {prefix && <span style={{ color: 'var(--ink-3)', fontSize: 13 }}>{prefix}</span>}
    <input {...rest} style={{
      flex: 1, minWidth: 0, border: 0, outline: 'none', background: 'transparent',
      fontSize: 13, color: 'var(--ink)', ...inputStyle,
    }}/>
    {suffix && <span style={{ color: 'var(--ink-3)', fontSize: 12 }}>{suffix}</span>}
    {trailing}
  </div>
);

// Custom checkbox — square, accent fill when checked.
const Check = ({ checked, onChange, size = 18, label, indeterminate, style }) => (
  <label style={{ display: 'inline-flex', alignItems: 'center', gap: 10, cursor: 'pointer', ...style }}>
    <span aria-hidden style={{
      width: size, height: size, borderRadius: 4,
      border: '1.4px solid ' + (checked ? 'var(--accent)' : 'var(--line-strong)'),
      background: checked ? 'var(--accent)' : 'transparent',
      display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
      transition: 'all .14s', flexShrink: 0,
    }}>
      {checked && !indeterminate && (
        <svg width={size-6} height={size-6} viewBox="0 0 24 24" fill="none" stroke="var(--bg)" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"><path d="M4 12l5 5L20 6"/></svg>
      )}
      {indeterminate && <span style={{width:'60%',height:2,background:'var(--bg)'}}/>}
    </span>
    <input type="checkbox" checked={!!checked} onChange={e=>onChange && onChange(e.target.checked)}
      style={{position:'absolute',opacity:0,pointerEvents:'none',width:0,height:0}}/>
    {label && <span>{label}</span>}
  </label>
);

// A pill-shaped count/badge.
const Pill = ({ children, tone = 'neutral', style }) => {
  const t = {
    neutral: { background: 'var(--bg-alt)', color: 'var(--ink-2)' },
    accent: { background: 'var(--accent-soft)', color: 'var(--accent-ink)' },
    work: { background: 'var(--work-soft)', color: 'var(--work)' },
    personal: { background: 'var(--personal-soft)', color: 'var(--personal)' },
    warn: { background: '#f5ead0', color: '#8a6a18' },
    danger: { background: 'var(--destructive-soft)', color: 'var(--destructive)' },
  }[tone];
  return (
    <span style={{
      display: 'inline-flex', alignItems: 'center', gap: 4,
      padding: '2px 8px', borderRadius: 999, fontSize: 11,
      fontWeight: 500, letterSpacing: '.01em', ...t, ...style
    }}>{children}</span>
  );
};

// Sync indicator.
const SyncBadge = ({ state, onClick }) => {
  const map = {
    synced:   { dot: 'var(--good)',     label: 'Synced',     sub: 'all changes saved' },
    syncing:  { dot: 'var(--warn)',     label: 'Syncing',    sub: 'draining outbox…' },
    offline:  { dot: 'var(--offline)',  label: 'Offline',    sub: 'changes queued locally' },
    sync_issues: { dot: 'var(--destructive)', label: 'Sync issues', sub: '3 rows in failed bucket' },
  };
  const it = map[state] || map.synced;
  return (
    <button onClick={onClick} title={it.sub}
      style={{
        display: 'inline-flex', alignItems: 'center', gap: 7,
        padding: '5px 10px 5px 8px', borderRadius: 999,
        border: '1px solid var(--line)', background: 'var(--surface)',
        fontSize: 12, color: 'var(--ink-2)',
      }}>
      <span style={{
        width: 7, height: 7, borderRadius: '50%', background: it.dot,
        boxShadow: state === 'syncing' ? '0 0 0 0 ' + it.dot : 'none',
        animation: state === 'syncing' ? 'pulse 1.4s infinite' : 'none'
      }}/>
      <span>{it.label}</span>
    </button>
  );
};

// Sheet (right-side, mobile-bottom).
const Sheet = ({ open, title, onClose, children, footer, width }) => {
  React.useEffect(() => {
    if (open) { document.body.classList.add('no-scroll'); }
    else { document.body.classList.remove('no-scroll'); }
    return () => document.body.classList.remove('no-scroll');
  }, [open]);
  React.useEffect(() => {
    if (!open) return;
    const h = (e) => { if (e.key === 'Escape') onClose && onClose(); };
    window.addEventListener('keydown', h);
    return () => window.removeEventListener('keydown', h);
  }, [open, onClose]);
  if (!open) return null;
  return (
    <React.Fragment>
      <div className="sheet-veil" onClick={onClose}/>
      <aside className="sheet" style={width ? { width } : undefined}>
        <header style={{
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          padding: '18px 22px', borderBottom: '1px solid var(--line)'
        }}>
          <h3 style={{ margin:0, fontSize: 15, fontWeight: 600, letterSpacing: '-.01em' }}>{title}</h3>
          <IconBtn label="Close" onClick={onClose}><IX/></IconBtn>
        </header>
        <div style={{ flex: 1, overflow: 'auto', padding: '20px 22px' }} className="lst">
          {children}
        </div>
        {footer && (
          <footer style={{ padding: '14px 22px', borderTop: '1px solid var(--line)', display: 'flex', gap: 10, justifyContent: 'flex-end' }}>
            {footer}
          </footer>
        )}
      </aside>
    </React.Fragment>
  );
};

// Dialog.
const Dialog = ({ open, title, onClose, children, actions }) => {
  React.useEffect(() => {
    if (!open) return;
    const h = (e) => { if (e.key === 'Escape') onClose && onClose(); };
    window.addEventListener('keydown', h);
    return () => window.removeEventListener('keydown', h);
  }, [open, onClose]);
  if (!open) return null;
  return (
    <div className="dlg-veil" onClick={(e)=>{ if (e.target === e.currentTarget) onClose && onClose(); }}>
      <div className="dlg" role="dialog">
        {title && <h3 style={{ margin: 0, marginBottom: 8, fontSize: 15, fontWeight: 600 }}>{title}</h3>}
        <div style={{ color: 'var(--ink-2)', fontSize: 13, lineHeight: 1.55 }}>{children}</div>
        {actions && <div style={{ marginTop: 18, display: 'flex', justifyContent: 'flex-end', gap: 8 }}>{actions}</div>}
      </div>
    </div>
  );
};

// Three-dot menu.
const Menu = ({ items, align = 'right' }) => {
  const [open, setOpen] = React.useState(false);
  const ref = React.useRef(null);
  React.useEffect(() => {
    const h = (e) => { if (ref.current && !ref.current.contains(e.target)) setOpen(false); };
    if (open) document.addEventListener('mousedown', h);
    return () => document.removeEventListener('mousedown', h);
  }, [open]);
  return (
    <div ref={ref} style={{ position: 'relative', display: 'inline-block' }}>
      <IconBtn label="More" onClick={() => setOpen(o => !o)}><IDots/></IconBtn>
      {open && (
        <div style={{
          position: 'absolute', top: 32, [align]: 0, zIndex: 30,
          minWidth: 180, background: 'var(--surface)', border: '1px solid var(--line)',
          borderRadius: 'var(--radius)', boxShadow: '0 12px 32px rgba(31,29,26,.10)',
          padding: 4, animation: 'fadein .12s forwards',
        }}>
          {items.map((it, i) => it === '-' ? (
            <hr key={i} className="hairline" style={{ margin: '4px 6px' }}/>
          ) : (
            <button key={i} onClick={() => { setOpen(false); it.onClick && it.onClick(); }}
              onMouseEnter={(e)=>e.currentTarget.style.background='var(--bg-alt)'}
              onMouseLeave={(e)=>e.currentTarget.style.background='transparent'}
              style={{
                width: '100%', textAlign: 'left', padding: '7px 10px',
                borderRadius: 4, fontSize: 13,
                color: it.tone === 'danger' ? 'var(--destructive)' : 'var(--ink)',
                display: 'flex', alignItems: 'center', gap: 8,
              }}>
              {it.icon}
              <span style={{ flex: 1 }}>{it.label}</span>
              {it.right && <span style={{ color: 'var(--ink-3)', fontSize: 11 }}>{it.right}</span>}
            </button>
          ))}
        </div>
      )}
    </div>
  );
};

// Tabs (top, used on tablet/desktop).
const TopTabs = ({ value, onChange, items }) => (
  <nav style={{ display: 'flex', gap: 2, borderBottom: '1px solid var(--line)' }}>
    {items.map(it => {
      const active = it.id === value;
      return (
        <button key={it.id} onClick={() => onChange(it.id)}
          style={{
            padding: '14px 16px', fontSize: 13, fontWeight: active ? 600 : 500,
            color: active ? 'var(--ink)' : 'var(--ink-3)',
            position: 'relative', display: 'inline-flex', alignItems: 'center', gap: 8,
          }}>
          {it.icon}{it.label}
          <span style={{
            position: 'absolute', left: 10, right: 10, bottom: -1, height: 2,
            background: active ? 'var(--ink)' : 'transparent', borderRadius: 2,
          }}/>
        </button>
      );
    })}
  </nav>
);

// Bottom nav for mobile.
const BottomTabs = ({ value, onChange, items }) => (
  <nav style={{
    position: 'fixed', left: 0, right: 0, bottom: 0, zIndex: 40,
    background: 'var(--surface)', borderTop: '1px solid var(--line)',
    display: 'grid', gridTemplateColumns: `repeat(${items.length}, 1fr)`,
    paddingBottom: 'env(safe-area-inset-bottom)',
    backdropFilter: 'blur(12px)',
  }}>
    {items.map(it => {
      const active = it.id === value;
      return (
        <button key={it.id} onClick={() => onChange(it.id)}
          style={{
            padding: '10px 6px 12px', display: 'flex', flexDirection: 'column',
            alignItems: 'center', gap: 4, fontSize: 10,
            color: active ? 'var(--ink)' : 'var(--ink-3)',
            fontWeight: active ? 600 : 500,
            position: 'relative',
          }}>
          {active && (
            <span style={{
              position: 'absolute', top: 0, left: '30%', right: '30%', height: 2,
              background: 'var(--jewel-jade)', borderRadius: '0 0 2px 2px',
              boxShadow: '0 0 12px var(--jewel-jade)',
            }}/>
          )}
          {it.icon}
          <span style={{ letterSpacing: '.02em' }}>{it.label}</span>
        </button>
      );
    })}
  </nav>
);

const Toast = ({ msg, onClose }) => {
  React.useEffect(() => {
    if (!msg) return;
    const t = setTimeout(onClose, 2400);
    return () => clearTimeout(t);
  }, [msg]);
  if (!msg) return null;
  return <div className="toast">{msg}</div>;
};

// Category color hint
const catColor = (catName) => catName === 'Work' ? 'var(--work)' : 'var(--personal)';
const catSoft  = (catName) => catName === 'Work' ? 'var(--work-soft)' : 'var(--personal-soft)';

// Format minutes → "1h 20m" / "45m"
const fmtMin = (m) => {
  if (!m) return '0m';
  const h = Math.floor(m / 60); const rem = m % 60;
  return h ? `${h}h${rem ? ' ' + rem + 'm' : ''}` : `${rem}m`;
};

Object.assign(window, {
  Button, IconBtn, Input, Check, Pill, SyncBadge,
  Sheet, Dialog, Menu, TopTabs, BottomTabs, Toast,
  catColor, catSoft, fmtMin
});

// Pulse animation for syncing dot.
const styleEl = document.createElement('style');
styleEl.textContent = `
  @keyframes pulse {
    0%   { box-shadow: 0 0 0 0 rgba(184,138,44,.45); }
    70%  { box-shadow: 0 0 0 6px rgba(184,138,44,0); }
    100% { box-shadow: 0 0 0 0 rgba(184,138,44,0); }
  }
`;
document.head.appendChild(styleEl);
