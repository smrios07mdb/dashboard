# Design Brief for Claude Design Mode

> Copy everything between the lines below into a fresh Claude conversation in **Design mode**. Do not edit.

---

Design the UI for a single-user personal productivity dashboard delivered as an installable PWA that runs on iPhone, iPad, and Mac.

Output as React + TypeScript components using Tailwind and shadcn/ui (Button, Input, Dialog, Checkbox, DropdownMenu, Tabs, Card, Sheet, Tooltip, Toast, Skeleton). Components accept all data via props and emit changes via callbacks — **no backend calls inside components**. Components hold UI state only (open dialogs, drag targets) — never cached data.

## Data interfaces (use these exact types in `types.ts`)

```ts
export type Category = {
  id: string;
  name: 'Work' | 'Personal';
};

export type Subcategory = {
  id: string;
  categoryId: string;
  name: string;
  sortOrder: number;
  archivedAt: string | null;
};

export type Task = {
  id: string;
  subcategoryId: string;
  title: string;
  notes: string | null;
  estimateMinutes: number;
  dueAt: string | null;
  remindAt: string | null;
  notified: boolean;
  priority: number | null;
  completedAt: string | null;
  createdAt: string;
  updatedAt: string;
};

export type RoutineItem = {
  id: string;
  routine: 'morning' | 'night';
  label: string;
  sortOrder: number;
  archivedAt: string | null;
  createdAt: string;
};

export type RoutineLog = {
  id: string;
  routineItemId: string;
  dateKey: string; // YYYY-MM-DD
  completed: boolean;
};

export type Settings = {
  aiApiKey: string | null;
  caldavAppleId: string | null;
  caldavCalendarUrl: string | null;
  caldavStatus: 'unconfigured' | 'ok' | 'auth_failed';
  timezone: string;
};

export type SyncState = 'synced' | 'syncing' | 'offline' | 'sync_issues';
```

## Screens

### 0. Login
- Email input, "Send magic link" button
- "Check your email" success state with 30s resend cooldown
- Minimal, centered, brand-quiet

### 1. Unified Dashboard (landing)
- Two top-level columns: **Work** and **Personal**
- Each column header shows the category name, total task count, total estimated minutes, and a chevron (›) to drill down
- Below each column header: collapsible subcategory sections, each showing its name, task count, summed minutes, and its own chevron
- Within each subcategory: list of tasks with title, minutes, optional bell icon (reminder set), trash icon, and three-dot menu
- Header strip at top: "Today: N tasks, M minutes" + available-time input (numeric, minutes) + "What's next?" button (opens AI triage sheet)
- Top-right: sync indicator badge (colored dot + text: Synced / Syncing / Offline / Sync issues) and account menu (email + Sign out)
- Tabs at top: Dashboard | Routines | Insights | Settings
- iOS install banner: when on iOS Safari and not in standalone mode, show a dismissible bar "Install to Home Screen for notifications and full-screen use" with platform-specific instructions

### 2. Category Drill-Down (`/category/:id`)
- Reached by chevron-tap or double-click on a category header
- Breadcrumb: All › Work
- All non-archived subcategories of that category expanded with their tasks, inline editable
- "Add subcategory" button at the bottom

### 3. Subcategory Drill-Down (`/subcategory/:id`)
- Reached by chevron-tap or double-click on a subcategory header
- Breadcrumb: All › Work › Project A
- Full task list with bulk-select checkboxes, sortable
- Bulk action toolbar (appears when ≥1 selected): "Move to..." picker, Delete with confirm
- "Add task" button

### 4. Routines Tab
- Two panels: **Morning Routine** and **Night Routine**
  - Side-by-side ≥768px width, stacked below
- Each panel header: routine name, current streak badge (e.g. "🔥 5 days" — use a neutral icon, no emoji), "Edit list" toggle
- Default mode (check-off): list of today's items as Checkbox + label
- Edit mode: same list with drag handles (@dnd-kit), inline rename, X to remove, "+ Add item" at bottom
- Below the list: 14-day dot grid (filled = all items completed that day, empty = not, faded = day before any items existed)

### 5. Insights Tab
- Filter bar at top: range buttons (7 / 30 / 90 days), category toggles (All / Work / Personal)
- Stacked bar chart (recharts): estimated minutes per day, segmented by subcategory
  - Colors derived from category: Work uses green shades, Personal uses warm neutral shades
  - If >8 subcategories in range, group all but top 7 (by total minutes) into "Other" with a single neutral color; tooltip shows full breakdown
- Below: summary table — subcategory, total tasks completed, total minutes, % of total

### 6. Settings Tab
- **Account**: email displayed, Sign out button
- **Calendar**:
  - Status badge: Not configured / Connected (last verified Xm ago) / Reconnect needed
  - Apple ID input
  - App-specific password input (masked, with "show" toggle)
  - "Test connection" button
  - On success: calendar picker dropdown populated from the response
  - Save button (enabled once a calendar is picked)
  - Help text linking to appleid.apple.com for app-specific password creation
- **AI**: Anthropic API key input (masked)
- **Notifications**: "Enable notifications" button (shows current permission state); status indicator
- **Data**:
  - Export all data (JSON download)
  - Import data (file picker → mode selector: Replace all / Merge → typed confirmation if Replace)
  - Wipe local cache (clears Dexie only, typed confirmation)
- **Developer** (only rendered when `import.meta.env.DEV`): "Load sample data" button
- **About**: build version, link to source repo

## Interaction patterns

| Action | Desktop | Mobile (touch) |
|---|---|---|
| Drill into category/subcategory | Double-click header OR click chevron | Tap chevron |
| Move task between subcategories | Drag-and-drop (Dashboard or Category view) OR three-dot menu → "Move to..." | Three-dot menu → "Move to..." cascading picker |
| Edit task title | Single click → inline input | Tap → inline input |
| Edit task minutes | Click duration → inline numeric input | Tap → numeric input |
| Set reminder | Click bell → time picker popover | Tap bell → time picker sheet |
| Delete task | Trash icon → confirm dialog | Trash icon → confirm dialog |
| Delete subcategory with tasks | Confirm dialog asks "Move N tasks to..." (dropdown) OR "Delete tasks too" | Same |
| Merge subcategories | Subcategory menu → "Merge into..." picker → confirm | Same |
| Toggle routine item today | Tap checkbox | Tap checkbox |
| Reorder routine items | Drag handle in edit mode | Drag handle in edit mode |
| AI triage | "What's next?" → Sheet with available-time input → 1–3 ranked tasks with reasoning | Same |
| Block calendar time | "Block time" button on task → Sheet with 3 proposed slots → confirm → toast | Same |
| Sync indicator | Click to see last sync time + force resync | Tap |

Detect touch via `window.matchMedia('(hover: none)').matches` and conditionally attach drag handlers.

## Visual tone

- Editorial, calm, dense-but-readable. Linear meets a paper notebook.
- Background `#faf8f3` (warm off-white)
- Text `#1f1d1a` (charcoal)
- Primary accent `#3a5a40` (deep green)
- Destructive `#a85a3c` (muted red)
- Subtle 1px borders, no heavy shadows
- Inter for UI; uppercase labels at 10px with tracking 0.18em
- Generous whitespace between sections
- No emoji in production copy; no gamification language ("Great job!", etc.)

## Responsive

- <640px: single column, bottom-nav tabs (instead of top tabs)
- 640–1024px: two-column dashboard, top tabs
- ≥1024px: optional sidebar nav variant
- All interactive elements ≥44pt hit target on touch

## A11y

- Every interactive element keyboard-reachable
- Visible focus ring (2px solid, accent color)
- `aria-label` where text isn't visible
- All dialogs trap focus
- Color contrast ≥4.5:1 on text

## Output

- One component per screen in separate files under `src/screens/`
- Shared `src/types.ts` with the interfaces above
- Reusable primitives in `src/components/ui/`
- Top-level `App.tsx` wiring routes
- `mock-data.ts` so every screen renders standalone for review
- A `responsive-demo.tsx` page that lets the reviewer toggle between iPhone, iPad, and desktop viewports
- All interactive elements wired to callback props (`onTaskEdit`, `onTaskMove`, `onSubcategoryDelete`, `onRoutineItemToggle`, etc.) — no internal data state, only UI state

Do not implement Supabase, Dexie, CalDAV, or AI calls. Components are presentation-only; the build chunks will wire them to real data.

---

(End of design brief — everything above the line is what gets pasted into Claude Design.)
