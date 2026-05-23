// Mock data + state generator. Returns 3 different fixture sets keyed by state.

const ISO = (d) => new Date(d).toISOString();
const today = new Date(); today.setHours(9, 0, 0, 0);
const ago = (mins) => new Date(today.getTime() - mins * 60000).toISOString();
const ahead = (mins) => new Date(today.getTime() + mins * 60000).toISOString();
const dayKey = (offset = 0) => {
  const d = new Date(); d.setDate(d.getDate() + offset);
  return d.toISOString().slice(0, 10);
};

const CATEGORIES = [
  { id: 'c-work', name: 'Work' },
  { id: 'c-personal', name: 'Personal' },
];

// Subcategories per category — used across all data states.
const SUBCATS = [
  // Work
  { id: 's-atlas',    categoryId: 'c-work',     name: 'Project Atlas',  sortOrder: 0, archivedAt: null },
  { id: 's-reviews',  categoryId: 'c-work',     name: 'Reviews',        sortOrder: 1, archivedAt: null },
  { id: 's-admin',    categoryId: 'c-work',     name: 'Admin',          sortOrder: 2, archivedAt: null },
  { id: 's-1on1',     categoryId: 'c-work',     name: '1:1s',           sortOrder: 3, archivedAt: null },
  // Personal
  { id: 's-home',     categoryId: 'c-personal', name: 'Home',           sortOrder: 0, archivedAt: null },
  { id: 's-health',   categoryId: 'c-personal', name: 'Health',         sortOrder: 1, archivedAt: null },
  { id: 's-errands',  categoryId: 'c-personal', name: 'Errands',        sortOrder: 2, archivedAt: null },
  { id: 's-reading',  categoryId: 'c-personal', name: 'Reading',        sortOrder: 3, archivedAt: null },
];

// Three task pools.
const TASK_TEMPLATES = {
  's-atlas': [
    ['Wire up the migration script for tenant cutover', 90, 1, 1, false],
    ['Draft RFC for the new pricing surface', 60, 1, ago(30), true],
    ['Review Sam\u2019s PR on the export pipeline', 25, 2, null, false],
    ['Pair with Tom on the auth refactor', 45, null, ahead(180), true],
    ['Update Atlas roadmap doc with Q3 milestones', 30, null, null, false],
    ['Decide on the queue backend by Friday', 15, 1, ahead(2880), false],
  ],
  's-reviews': [
    ['H1 self-review: bullets and artifacts', 45, 1, ahead(1440), false],
    ['Read peer review for J.', 20, 2, null, false],
    ['Calibration prep notes', 30, null, null, false],
  ],
  's-admin': [
    ['Expense report \u2014 May', 15, null, null, false],
    ['Submit T&E for the offsite', 20, null, null, false],
    ['Annual security training', 35, 2, ahead(720), false],
    ['Approve timesheets', 5, null, null, false],
  ],
  's-1on1': [
    ['Prep agenda for K.', 10, null, null, false],
    ['Follow up with R. on growth case', 15, null, ahead(60), true],
  ],
  's-home': [
    ['Order new air filter', 5, null, null, false],
    ['Schedule dryer vent cleaning', 10, null, null, false],
    ['Paint touch-up in hallway', 60, null, null, false],
    ['Replace bathroom faucet washer', 25, 2, null, false],
  ],
  's-health': [
    ['Book dentist for the kids', 15, 1, null, false],
    ['Refill prescription', 5, null, ahead(1440), true],
    ['30 min walk', 30, null, ahead(360), false],
  ],
  's-errands': [
    ['Pick up dry cleaning', 10, null, null, false],
    ['Return Amazon package', 15, null, null, false],
    ['Buy birthday card for Mom', 10, 1, ahead(2880), false],
    ['Grocery run', 45, null, null, false],
  ],
  's-reading': [
    ['Finish chapter 7 of \u201cThinking in Systems\u201d', 25, null, null, false],
    ['Article: post-mortem on Cloudflare outage', 15, null, null, false],
  ],
};

// Generate tasks for each state. light=fewer; mid=most templates; heavy=duplicates with edge cases.
const buildTasks = (state) => {
  const out = [];
  let counter = 0;
  const subs = Object.keys(TASK_TEMPLATES);
  const slice = state === 'light' ? 1 : state === 'mid' ? null : null; // mid uses all, heavy adds more
  subs.forEach(sid => {
    const tmpl = TASK_TEMPLATES[sid];
    const taken = state === 'light' ? tmpl.slice(0, Math.ceil(tmpl.length / 2)) : tmpl;
    taken.forEach(([title, mins, prio, remind, notif]) => {
      counter++;
      out.push({
        id: `t-${counter}`, subcategoryId: sid,
        title, notes: null, estimateMinutes: mins,
        dueAt: null, remindAt: remind, notified: !!notif,
        priority: prio, completedAt: null,
        createdAt: ago(60 * 24 * (counter % 10 + 1)),
        updatedAt: ago(60 * counter),
      });
    });
    // heavy → add more
    if (state === 'heavy') {
      for (let i = 0; i < 4; i++) {
        counter++;
        out.push({
          id: `t-${counter}`, subcategoryId: sid,
          title: `Follow-up item ${i + 1} \u2014 a longer title that should wrap nicely across two lines of dense layout`,
          notes: null, estimateMinutes: [15, 20, 30, 45, 60, 90, 120][counter % 7],
          dueAt: null, remindAt: i === 0 ? ahead(120) : null, notified: i === 0,
          priority: i < 2 ? 1 : null, completedAt: null,
          createdAt: ago(200 + counter), updatedAt: ago(counter * 10),
        });
      }
    }
  });
  // mark a few completed (for completed totals/insights)
  out.slice(0, state === 'light' ? 1 : state === 'mid' ? 4 : 8).forEach((t, i) => {
    t.completedAt = ago((i + 1) * 30);
  });
  return out;
};

const ROUTINE_ITEMS = [
  // Morning
  { id: 'r-m-1', routine: 'morning', label: 'Make the bed',           sortOrder: 0, archivedAt: null, createdAt: ago(60*24*40) },
  { id: 'r-m-2', routine: 'morning', label: 'Drink a glass of water', sortOrder: 1, archivedAt: null, createdAt: ago(60*24*40) },
  { id: 'r-m-3', routine: 'morning', label: '10-min stretch',         sortOrder: 2, archivedAt: null, createdAt: ago(60*24*40) },
  { id: 'r-m-4', routine: 'morning', label: 'Journal 3 lines',        sortOrder: 3, archivedAt: null, createdAt: ago(60*24*40) },
  { id: 'r-m-5', routine: 'morning', label: 'Plan top 3 of the day',  sortOrder: 4, archivedAt: null, createdAt: ago(60*24*15) },
  // Night
  { id: 'r-n-1', routine: 'night',   label: 'Tidy the kitchen',       sortOrder: 0, archivedAt: null, createdAt: ago(60*24*40) },
  { id: 'r-n-2', routine: 'night',   label: 'Lay out clothes',        sortOrder: 1, archivedAt: null, createdAt: ago(60*24*40) },
  { id: 'r-n-3', routine: 'night',   label: 'Read 15 minutes',        sortOrder: 2, archivedAt: null, createdAt: ago(60*24*40) },
  { id: 'r-n-4', routine: 'night',   label: 'Phone in the kitchen',   sortOrder: 3, archivedAt: null, createdAt: ago(60*24*20) },
];

// 14 days of logs — pseudo-deterministic by item id char-sum.
const buildLogs = () => {
  const logs = [];
  ROUTINE_ITEMS.forEach((it, idx) => {
    for (let d = 0; d < 14; d++) {
      const k = dayKey(-d);
      // Pseudo-random completion: higher recency, lower for one item to break streaks
      const seed = (idx * 31 + d * 7) % 11;
      const done = d === 0 ? (idx % 2 === 0) : seed > 2;
      if (done) {
        logs.push({ id: `l-${it.id}-${k}`, routineItemId: it.id, dateKey: k, completed: true });
      }
    }
  });
  return logs;
};

const SETTINGS = {
  aiApiKey: null,
  caldavAppleId: 'me@icloud.com',
  caldavCalendarUrl: 'https://p123.caldav.icloud.com/12345/calendars/personal/',
  caldavStatus: 'ok',
  timezone: 'America/New_York',
};

const buildData = (state) => ({
  categories: CATEGORIES,
  subcategories: SUBCATS,
  tasks: buildTasks(state),
  routineItems: ROUTINE_ITEMS,
  routineLogs: buildLogs(),
  settings: SETTINGS,
  email: 'sam@hupo.app',
});

Object.assign(window, { buildData, dayKey });
