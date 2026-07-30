# Claude Code Prompt — Build the Week Planner

> Paste everything below the line into Claude Code from the root of the Hupomnemata app
> repo, with this `design_handoff_week_planner/` folder copied in. Works the same pasted
> into Claude chat with this folder attached. The app shell, task model, and Daylight
> design system already exist — this adds the planner surfaces and extends priority.

---

You are adding the **Week Planner** — the centerpiece feature — to the existing Hupomnemata
app (React + TypeScript + Tailwind + shadcn/ui). Tasks get scheduled into time slots against
read-only busy overlays from two external calendars (Apple iCloud CalDAV + an Outlook
published-ICS feed), with a P1/P2/P3 priority system. A working prototype of the exact
visuals and behavior lives in `design_handoff_week_planner/prototype/` (React-via-Babel —
**port to our idioms, don't copy verbatim**).

## Read first
1. `design_handoff_week_planner/README.md` — authoritative spec (tokens, screens, states).
2. `design_handoff_week_planner/DESIGN_NOTES.md` — exact geometry + busy-overlay rationale.
3. `prototype/planner/planner-primitives.jsx` — mock data shape, block components, and the
   pure functions. Open `prototype/Week Planner.html` in a browser to see everything live
   (Tweaks panel toggles states).

## Build it in four parts

### 1. Model + pure functions (unit-test these)
- Extend `Task.priority` to `1 | 2 | 3` (existing data: `1` stays P1, everything else P3).
- New: `ScheduledBlock { taskId, start, end, done }` and
  `BusySpan { source: 'icloud' | 'outlook', start, end, title }`.
- Port exactly from `planner-primitives.jsx`: `findOpenSlots`, `nextOpenSlot`, `autoFill`,
  `computeCapacity`, `computeDayFree`, `overlapBusy`, `sortTray`, `blockPos`.
  All snapping is 15 minutes; working window 09:00–18:00 weekdays.

### 2. Week Planner routes
- `/planner` (desktop ≥1024): 300px unscheduled tray + 7-day grid (half-width weekends),
  collapsible 08:00–19:00 window. Drag via `@dnd-kit` (tray→grid, move, resize); detect
  no-hover devices and disable dnd. Busy overlays sit behind task blocks; overlaps are
  advisory (destructive preview + toast), never blocked.
- Mobile (<640): day-chip strip + single-day timeline + bottom Unscheduled section; tap →
  bottom "Schedule" sheet with 3 proposed slots + custom time (reuse the app's Sheet).
- Ship: Fill-my-week proposals (accent bar, Place all / Clear), carryover for past-undone
  blocks (hollow + "move to next open slot"), done-toggle on blocks, busy-block popover,
  per-day free figures, stale-feed treatment (header chip + dimmed cached Outlook blocks).

### 3. Priority on the task list
- Compact chip after the title on every open task row (P1 destructive / P2 warn-mix /
  P3 neutral); keep the existing 3px destructive left edge for P1; hide chip when completed.
- Chip tap or row ⋯ → 3-option picker (Urgent / Soon / Whenever). Sort control
  (Priority / Due / Estimate) on list headers and the tray — one shared segmented component.

### 4. Settings → Calendars
- Restyle the Apple row status pill; add the Outlook row: ICS URL input → verify → feed
  name + `Last refreshed 12m ago`, amber unreachable state with cached-time copy and retry.
  Backend: poll the ICS feed every 15 min through our proxy; mark stale on failure with
  the last-success timestamp.

## Non-negotiables
- Reuse existing primitives (`Pill`, `Check`, `Menu`, `Sheet`, `Button`, icons, `.label`,
  `.num`, `catColor`, `fmtMin`). Don't fork them.
- Tokens only. The two busy-source tints in the README are the only new color values;
  P2 derives from `--warn` via color-mix. Light theme only. No exclamation marks in copy.
- Busy spans are read-only context: never editable, never look like task cards.
- 24-hour clock throughout the planner. Minimum 44px touch targets on mobile.
- Don't touch Dashboard, Routines, or Insights beyond the task-row priority chip.
