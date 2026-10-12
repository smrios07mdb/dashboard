// Notebook mock data + pure helpers. D1 fields only: id, title, body, pinned, createdAt, updatedAt,
// attachment ({kind:'task'|'subcategory', id} | null), plus a prototype-only `detachedFrom` memo for D3.
const NB_NOW = new Date('2026-10-12T14:20:00');
const ago = (min) => new Date(NB_NOW.getTime() - min * 60000).toISOString();

const NB_CATEGORIES = [{ id: 'c-work', name: 'Work' }, { id: 'c-personal', name: 'Personal' }];
const NB_SUBS = [
  { id: 's-atlas', categoryId: 'c-work', name: 'Atlas launch', hue: 'var(--jewel-sapphire)' },
  { id: 's-hiring', categoryId: 'c-work', name: 'Hiring', hue: 'var(--jewel-teal)' },
  { id: 's-home', categoryId: 'c-personal', name: 'Home', hue: 'var(--jewel-gold)' },
  { id: 's-health', categoryId: 'c-personal', name: 'Health', hue: 'var(--jewel-rose)' },
];
const NB_TASKS = [
  { id: 't-pricing', subcategoryId: 's-atlas', title: 'Ship the pricing page', estimateMinutes: 90, priority: 1 },
  { id: 't-changelog', subcategoryId: 's-atlas', title: 'Write the launch changelog', estimateMinutes: 45, priority: 2 },
  { id: 't-qa', subcategoryId: 's-atlas', title: 'QA pass on onboarding', estimateMinutes: 60, priority: null },
  { id: 't-screen', subcategoryId: 's-hiring', title: 'Screen the two design candidates', estimateMinutes: 40, priority: 2 },
  { id: 't-offer', subcategoryId: 's-hiring', title: 'Draft offer letter template', estimateMinutes: 30, priority: null, completedAt: ago(60 * 30) },
  { id: 't-boiler', subcategoryId: 's-home', title: 'Book boiler service', estimateMinutes: 10, priority: null },
  { id: 't-lease', subcategoryId: 's-home', title: 'Read the lease renewal', estimateMinutes: 25, priority: 1 },
  { id: 't-physio', subcategoryId: 's-health', title: 'Physio exercises', estimateMinutes: 20, priority: null },
];

const NB_LONG_BODY = `Three tiers, annual default, monthly behind a toggle. The free tier stays but loses API access.

## Open questions
- Do we show the enterprise tier or gate it behind "Talk to us"?
- Annual discount: 16% or round to two months free? Finance prefers the latter.
- Whether the comparison table collapses on phone or scrolls sideways.

## Copy notes
Lead with outcomes, not features. The old page listed 31 bullet points and nobody read them. Keep each tier to four lines and one sentence of who it's for.

Reference: [Stripe's pricing](https://stripe.com/pricing) handles the toggle well. Avoid the Linear-style "contact sales" dead end.

## Numbers from the last review
- Conversion from pricing to checkout: 3.1%
- Median time on page: 48s
- Top exit: the FAQ accordion

## Next
- Rough the phone layout before Thursday
- Ask legal about the "no hidden fees" claim
- Final numbers from finance by the 15th

Also remember that the launch changelog links here, so the anchor names can't change after the 20th.`;

const NB_NOTES = [
  { id: 'n1', title: 'Pricing page — decisions so far', body: NB_LONG_BODY, pinned: true, createdAt: ago(60 * 24 * 9), updatedAt: ago(42), attachment: { kind: 'task', id: 't-pricing' } },
  { id: 'n2', title: 'Launch week checklist', body: `Owner per surface, one line each.\n\n- Marketing site: Priya\n- Docs: Tom\n- Status page: me\n- Support macros: Lena, draft by Monday\n\nWe said no feature flags flipping after 10:00 on the day. Keep it.`, pinned: true, createdAt: ago(60 * 24 * 4), updatedAt: ago(60 * 3), attachment: { kind: 'subcategory', id: 's-atlas' } },
  { id: 'n3', title: '', body: `Things I keep forgetting about the car: tyre pressure is 2.4 front, 2.2 rear. Service light resets by holding the trip button on ignition.`, pinned: false, createdAt: ago(60 * 24 * 30), updatedAt: ago(60 * 5), attachment: null },
  { id: 'n4', title: 'Interview rubric', body: `# What we are actually testing\n\n- Can they explain a decision they reversed, and why\n- Do they ask about the user before the stack\n- Portfolio: one project in depth beats six in passing\n\nScore 1–4, no 2.5s. Disagreements go to a second call, not an average.`, pinned: false, createdAt: ago(60 * 24 * 12), updatedAt: ago(60 * 26), attachment: { kind: 'subcategory', id: 's-hiring' } },
  { id: 'n5', title: 'Boiler', body: `Model is a Vaillant ecoTEC 832. Last serviced March. Engineer said the pressure drop is a slow leak at the filling loop, not the vessel.\n\nPlumber: Daniel, 07700 900123. Prefers texts.`, pinned: false, createdAt: ago(60 * 24 * 20), updatedAt: ago(60 * 24 * 2), attachment: { kind: 'task', id: 't-boiler' } },
  { id: 'n6', title: 'Q3 retro notes', body: `What the team said, unedited:\n\n- Too many half-finished projects. Pick fewer.\n- Planning meetings run long because nobody prepares.\n- The on-call rota is fine now.\n\nOne change for Q4: a written proposal before any new project gets a kickoff.`, pinned: false, createdAt: ago(60 * 24 * 40), updatedAt: ago(60 * 24 * 3), attachment: null, detachedFrom: { name: 'Q3 planning', category: 'Work', deletedAt: ago(60 * 24 * 3) } },
  { id: 'n7', title: 'Physio routine', body: `Morning: calf raises ×15, two sets. Evening: the band work, slow on the way down.\n\nShe wants me back in six weeks, sooner if the ankle swells after running.`, pinned: false, createdAt: ago(60 * 24 * 15), updatedAt: ago(60 * 24 * 6), attachment: { kind: 'task', id: 't-physio' } },
  { id: 'n8', title: 'Books people recommended', body: `- The Design of Everyday Things (again)\n- Thinking in Systems\n- A Pattern Language, just the first third\n- Something by Le Guin, Tom didn't say which`, pinned: false, createdAt: ago(60 * 24 * 60), updatedAt: ago(60 * 24 * 11), attachment: null },
  { id: 'n9', title: '', body: `Lease renewal arrives in November. Rent review clause is on page 4; notice period is two months, not one.`, pinned: false, createdAt: ago(60 * 24 * 8), updatedAt: ago(60 * 24 * 8), attachment: { kind: 'task', id: 't-lease' } },
  { id: 'n10', title: 'Pricing — call with finance', body: `Annual discount settled: two months free, shown as a percentage on the page.\n\n- Enterprise stays behind Talk to us\n- They want the numbers by the 15th, not the 20th`, pinned: false, createdAt: ago(60 * 24 * 1), updatedAt: ago(60 * 7), attachment: { kind: 'task', id: 't-pricing' } },
  { id: 'n11', title: 'Offer letter — what legal changed', body: `Non-compete clause removed for the UK contract. Probation stays at three months.`, pinned: false, createdAt: ago(60 * 24 * 14), updatedAt: ago(60 * 24 * 13), attachment: { kind: 'task', id: 't-offer' } },
];

// ---- lookups ----
const nbSub = (id) => NB_SUBS.find(s => s.id === id);
const nbTask = (id) => NB_TASKS.find(t => t.id === id);
const nbCatOf = (sub) => NB_CATEGORIES.find(c => c.id === sub.categoryId);
// Resolve an attachment to { catName, subName, taskTitle?, sub }.
const nbResolve = (att) => {
  if (!att) return null;
  if (att.kind === 'task') { const t = nbTask(att.id); if (!t) return null; const s = nbSub(t.subcategoryId); return { catName: nbCatOf(s).name, subName: s.name, taskTitle: t.title, sub: s, task: t }; }
  const s = nbSub(att.id); if (!s) return null; return { catName: nbCatOf(s).name, subName: s.name, sub: s };
};
const nbNotesFor = (notes, kind, id) => notes.filter(n => n.attachment && n.attachment.kind === kind && n.attachment.id === id);
const nbTaskNotes = (notes, taskId) => notes.filter(n => n.attachment && n.attachment.kind === 'task' && n.attachment.id === taskId).sort((a, b) => new Date(b.updatedAt) - new Date(a.updatedAt));
const nbTaskNote = (notes, taskId) => nbTaskNotes(notes, taskId)[0] || null;
// Hide-completed preference: a note attached to a completed task is "on a completed task".
const nbOnCompleted = (n) => !!(n.attachment && n.attachment.kind === 'task' && nbTask(n.attachment.id) && nbTask(n.attachment.id).completedAt);

// ---- text helpers ----
const nbStrip = (md) => md.replace(/^#+\s*/gm, '').replace(/^-\s+/gm, '').replace(/\[([^\]]+)\]\([^)]+\)/g, '$1');
const nbFirstLine = (n) => n.title || (nbStrip(n.body).split('\n').find(l => l.trim()) || 'Untitled');
const nbExcerpt = (n) => { const lines = nbStrip(n.body).split('\n').filter(l => l.trim()); if (!n.title) lines.shift(); return lines.join(' · '); };
const nbRel = (iso) => {
  const d = (NB_NOW - new Date(iso)) / 60000;
  if (d < 1) return 'now'; if (d < 60) return Math.round(d) + 'm'; if (d < 60 * 24) return Math.round(d / 60) + 'h';
  if (d < 60 * 48) return 'Yesterday'; const dt = new Date(iso); return dt.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
};
const nbDate = (iso) => new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });

// Highlight `q` inside plain text → array of strings / <mark>.
const nbMark = (text, q) => {
  if (!q) return text;
  const i = text.toLowerCase().indexOf(q.toLowerCase()); if (i < 0) return text;
  return [text.slice(0, i), <mark key="m" style={{ background: 'var(--accent-soft)', color: 'var(--accent-ink)', borderRadius: 2, padding: '0 1px' }}>{text.slice(i, i + q.length)}</mark>, text.slice(i + q.length)];
};
// For search rows: the body line containing the match, trimmed around it.
const nbMatchLine = (n, q) => {
  const lines = nbStrip(n.body).split('\n').filter(l => l.trim());
  const hit = lines.find(l => l.toLowerCase().includes(q.toLowerCase())); if (!hit) return null;
  const i = hit.toLowerCase().indexOf(q.toLowerCase()); const start = Math.max(0, i - 40);
  return (start > 0 ? '…' : '') + hit.slice(start);
};

// D4 renderer: paragraphs, # / ## headings, - lists, [text](url) + bare links. No checkboxes, no images.
const nbInline = (s, q) => {
  const parts = []; const re = /\[([^\]]+)\]\((https?:\/\/[^)]+)\)|(https?:\/\/[^\s)]+)/g; let last = 0, m;
  while ((m = re.exec(s))) {
    if (m.index > last) parts.push(nbMark(s.slice(last, m.index), q));
    const href = m[2] || m[3]; parts.push(<a key={m.index} href={href} target="_blank" rel="noreferrer">{m[1] || m[3]}</a>); last = re.lastIndex;
  }
  if (last < s.length) parts.push(nbMark(s.slice(last), q));
  return parts;
};
const NbMarkdown = ({ body, q, style }) => {
  const blocks = []; const lines = body.split('\n'); let i = 0;
  while (i < lines.length) {
    const l = lines[i];
    if (!l.trim()) { i++; continue; }
    if (/^##\s/.test(l)) { blocks.push(<h3 key={i} style={{ margin: '18px 0 6px', fontSize: 15, fontWeight: 600, letterSpacing: '-.01em', color: 'var(--ink)' }}>{nbInline(l.replace(/^##\s*/, ''), q)}</h3>); i++; continue; }
    if (/^#\s/.test(l)) { blocks.push(<h2 key={i} className="title" style={{ margin: '20px 0 8px', fontSize: 22 }}>{nbInline(l.replace(/^#\s*/, ''), q)}</h2>); i++; continue; }
    if (/^-\s/.test(l)) { const items = []; while (i < lines.length && /^-\s/.test(lines[i])) { items.push(<li key={i} style={{ margin: '3px 0' }}>{nbInline(lines[i].replace(/^-\s*/, ''), q)}</li>); i++; } blocks.push(<ul key={'u' + i} style={{ margin: '6px 0 10px', paddingLeft: 22 }}>{items}</ul>); continue; }
    const para = []; while (i < lines.length && lines[i].trim() && !/^(#|-\s)/.test(lines[i])) { para.push(lines[i]); i++; }
    blocks.push(<p key={'p' + i} style={{ margin: '0 0 12px' }}>{nbInline(para.join(' '), q)}</p>);
  }
  return <div style={{ fontSize: 15, lineHeight: 1.6, color: 'var(--ink)', ...style }}>{blocks}</div>;
};

// Extra glyphs in the app's 1.6px stroke style.
const INote = (p) => <Icon {...p}><path d="M7 3h7l5 5v13H7z M14 3v5h5 M10 13h6M10 17h6"/></Icon>;
const IPin = (p) => <Icon {...p}><path d="M9 4h6l-1 6 3 3v2H7v-2l3-3-1-6zM12 15v6"/></Icon>;
const IPinOn = (p) => <Icon {...p}><path d="M9 4h6l-1 6 3 3v2H7v-2l3-3-1-6z" fill="currentColor"/><path d="M12 15v6"/></Icon>;
const IBook = (p) => <Icon {...p}><path d="M4 5a2 2 0 0 1 2-2h13v16H6a2 2 0 0 0-2 2V5zM4 19a2 2 0 0 1 2-2h13"/></Icon>;
const IUnlink = (p) => <Icon {...p}><path d="M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1.5 1.5M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 1 0 5.7 5.7l1.5-1.5M4 4l16 16"/></Icon>;

// Attachment chip: category dot + name. tone 'solid' (normal) | 'hollow' (detached, D3).
const AttachChip = ({ res, detached, onClick, style, size = 'md' }) => {
  const name = detached ? detached.name : (res.taskTitle || res.subName);
  const cat = detached ? detached.category : res.catName;
  const Tag = onClick ? 'button' : 'span';
  return (
    <Tag onClick={onClick} title={detached ? `Detached from ${name}` : `${cat} · ${res.subName}${res.taskTitle ? ' · ' + res.taskTitle : ''}`}
      style={{ display: 'inline-flex', alignItems: 'center', gap: 6, maxWidth: '100%', padding: size === 'sm' ? '1px 7px 1px 6px' : '3px 9px 3px 7px', borderRadius: 999,
        border: '1px solid ' + (detached ? 'transparent' : 'var(--line)'), outline: detached ? '1px dashed var(--line-strong)' : 'none', outlineOffset: -1,
        background: detached ? 'transparent' : 'var(--surface)', color: detached ? 'var(--ink-3)' : 'var(--ink-2)', fontSize: size === 'sm' ? 11 : 12, fontWeight: 500, minHeight: onClick ? 28 : undefined, cursor: onClick ? 'pointer' : 'default', ...style }}>
      <span style={{ width: 7, height: 7, borderRadius: '50%', flexShrink: 0, background: detached ? 'var(--ink-4)' : catColor(cat) }}/>
      <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', minWidth: 0, textDecoration: detached ? 'line-through' : 'none', textDecorationColor: 'var(--ink-4)' }}>{name}</span>
      {!detached && res.taskTitle && size !== 'sm' && <span className="label" style={{ fontSize: 8.5, letterSpacing: '.12em' }}>task</span>}
    </Tag>
  );
};

// Sync state: reuses the SyncBadge dot vocabulary (good / warn / offline) at caption scale.
const SaveState = ({ state, compact }) => {
  const map = { saved: { dot: 'var(--good)', label: 'Saved', short: 'Saved' }, syncing: { dot: 'var(--warn)', label: 'Syncing', short: 'Syncing', pulse: true }, offline: { dot: 'var(--offline)', label: 'Offline · saved on this device', short: 'Offline' }, queued: { dot: 'var(--offline)', label: 'Offline · 1 change queued', short: 'Queued' } };
  const it = map[state] || map.saved;
  return (
    <span title={it.label} style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 11.5, color: 'var(--ink-3)', whiteSpace: 'nowrap', flexShrink: 0 }}>
      <span style={{ width: 7, height: 7, borderRadius: '50%', background: it.dot, animation: it.pulse ? 'pulse 1.4s infinite' : 'none' }}/>{compact ? it.short : it.label}
    </span>
  );
};

Object.assign(window, { NB_NOW, NB_CATEGORIES, NB_SUBS, NB_TASKS, NB_NOTES, nbSub, nbTask, nbCatOf, nbResolve, nbNotesFor, nbTaskNote, nbTaskNotes, nbOnCompleted, nbStrip, nbFirstLine, nbExcerpt, nbRel, nbDate, nbMark, nbMatchLine, NbMarkdown, INote, IPin, IPinOn, IBook, IUnlink, AttachChip, SaveState });
