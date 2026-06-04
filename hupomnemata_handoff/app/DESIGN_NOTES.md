# Hupomnemata — Design Notes

Handoff for engineering. This document is the bridge between the prototype and the
production React + TypeScript + Tailwind + shadcn/ui build.

> Pin one thing only: the **visual system**. Everything else (routing, dnd, state, data
> sync) is yours to implement against `ARCHITECTURE.md`.

---

## 1. Design System

### Fonts

| Use | Family | Weights | Notes |
|---|---|---|---|
| UI text | **Inter** | 400/500/600/700 | All body, all headers |
| Numeric / labels | **IBM Plex Mono** | 500 | Estimates, durations, "01"/"02" kickers, uppercase tracked labels |
| Optional display pairing | Instrument Serif | 400 italic | Only used if the user picks "+ serif" pairing tweak. Not load-bearing. |

The `.label` utility — Plex Mono, 10px, weight 500, tracking .16em, uppercase, `--ink-3` —
does heavy structural work. Treat as a primitive.

### Color tokens

All vars live at the top of `index.html`. Names below should map 1:1 to Tailwind
CSS-variable theme tokens.

**Surfaces (Obsidian, default)**
```
--bg          #0a0b0e
--bg-alt      #11131a
--surface     #14171f
--surface-2   #1a1e28
--line        rgba(255,255,255,.055)
--line-strong rgba(255,255,255,.10)
```

**Ink (text scale)**
```
--ink   #ecedf2   /* body */
--ink-2 #a8abb4   /* secondary */
--ink-3 #7a7d87   /* hint, brightened to clear WCAG AA on bg */
--ink-4 #36383f   /* placeholder, disabled */
```

**Category accents — load-bearing, do not swap**
```
--work     #4cc8a3  (jade)
--personal #ff7d6b  (coral)
```

These two colors are the product's identity. The chart palette, category column accent
bars, and priority-edge cues all derive from them. Don't theme them away.

**Jewel palette for Insights chart bars** (`--jewel-*` vars):
sapphire, amethyst, coral, citron, jade, rose, teal, gold — used in `pickPalette()`.
Work side rolls through jade/teal greens; Personal side rolls through coral/rose/gold.

**Accent (focal color, swappable via Tweaks)**
The `--accent` token is the only color the user is allowed to rotate. Options:
`ice` (default), `ember`, `emerald`, `pearl`.

### Radii & spacing

```
--radius-sm 3px    /* tags, edge accents */
--radius    5px    /* inputs, buttons */
--radius-md 8px    /* cards, sheets */
--radius-lg 12px   /* not currently used */
```

Comfortable density: `--row-h: 36px`, `--row-pad: 9px 12px`.
Compact: `--row-h: 30px`, `--row-pad: 5px 10px`.

---

## 2. Interaction Patterns

### Hide-completed-by-default
`Settings → Account → Completed tasks: Hide` is a real persisted preference.
Default `true`. Each subcategory header reveals a `+N COMPLETED` button when collapsed
done-tasks exist. Per-section state overrides global default per session, but does
not persist.

### Priority indicator
Priority 1 tasks get a **3px coral left edge** on the row, with `paddingLeft` reduced
to keep alignment. Not a dot. Only shown when task is not completed.

### Drill-down
- Single chevron tap → drill (mobile primary)
- Double-click on header → drill (desktop accelerator)
- The category column header is fully clickable; chevron is a hint
- Routes: `/category/:id`, `/category/:id/subcategory/:id` — use react-router

### Drag-and-drop (NOT in prototype)
The prototype mocks moves via three-dot menu only. In production:
- `@dnd-kit/core` on Dashboard and Category drill-down (desktop only)
- Detect via `window.matchMedia('(hover: none)').matches`
- Subcategory drill-down keeps the bulk-select pattern instead

### Bulk actions
Subcategory drill-down's bulk toolbar takes a `bulk` action with `{ action, ids, subcategoryId }`.
In the prototype, Mark complete + Delete actually mutate state. Move shows a toast
("picker coming") — production needs a cascading category → subcategory picker.

### Reminder picker
Four quick presets + a custom `<input type="datetime-local">`. The datetime-local input
needs `colorScheme: 'dark'` for the dark theme to look right.

### AI triage ("What's next?")
Lives in a Sheet from the Today strip. Posts to Anthropic's API with the user's key
(see `ARCHITECTURE.md §10`). Response shape: `{ recommendations: [{ task_id, reason }], note }`.
Each recommendation renders with the category color as a 3px left edge.

### Block-time
Three proposed slots within next 24h, 09:00–18:00 window (from `settings.timezone`).
Slots come from the CalDAV proxy busy ranges (see ARCHITECTURE §8). Selected slot
becomes a VEVENT.

---

## 3. Empty States

| Screen | Empty trigger | Treatment |
|---|---|---|
| Dashboard | `tasks.length === 0` | Dashed-border centered card with `+` icon, primary CTA |
| Dashboard | `openTasks.length === 0 && completedCount > 0` | Jade "All clear" banner above (still shows columns) |
| Subcategory section | `visibleTasks.length === 0 && completedCount > 0` | "All N done." text |
| Subcategory section | `tasks.length === 0` | "No tasks here." text |
| Insights chart | `totalMinutes === 0` | Centered card "No time logged yet" |

---

## 4. Connectivity States

### Sync indicator (top-right header)
Four states:
- `synced` — jade dot
- `syncing` — amber dot with pulse animation
- `offline` — gray dot
- `sync_issues` — coral dot

Clicking it cycles in the prototype; in production it shows a popover with last sync time
+ "Force resync" button.

### CalDAV disconnected banner
When `settings.caldav_status === 'auth_failed'`, show `<CaldavBanner>` above main content
on every tab except Settings. Coral-tinted border + Info icon + "Reconnect" CTA that
deep-links to Settings → Calendar.

The prototype's Settings page has a "Simulate fail" / "Restore" dashed-border button next
to the status pill — remove this in production; the state is driven by the proxy
returning 401 from iCloud.

### Notification gating
Web Push requires:
1. iOS 16.4+
2. PWA installed to Home Screen (`display-mode: standalone`)
3. Permission granted

If not installed, the Notifications row shows an info card explaining the install step
first. After install, the "Enable notifications" button activates. Detect with
`window.matchMedia('(display-mode: standalone)').matches`.

---

## 5. Responsive Breakpoints

The prototype targets these specifically:

| Width | Layout |
|---|---|
| ≥ 640px | Two-column dashboard, top tabs in header |
| < 640px | Single column, bottom-nav tabs, install banner visible on iOS |
| Tablet 744px (iPad mini portrait) | Two-column with `clamp(24px, 3vw, 40px)` gap |
| Desktop 1440px (27" portrait) | Shell max-width 1280px; centered |

The `mobile` boolean in the prototype combines `tweak.device === 'mobile'` OR
`window.innerWidth < 640`. In production, drop the tweak — just use the viewport.

Dashboard column gap uses `clamp(24px, 3vw, 40px)` — let it breathe on large screens,
tighten on small.

---

## 6. Component Inventory

What's in the prototype vs. what to use in production:

| Prototype primitive | shadcn/ui equivalent |
|---|---|
| `<Button variant="primary\|ghost\|danger\|solid">` | `<Button>` with variants |
| `<Input>` | `<Input>` |
| `<Check>` | `<Checkbox>` |
| `<Sheet>` (right slide, bottom on mobile) | `<Sheet>` |
| `<Dialog>` | `<Dialog>` |
| `<Menu>` (three-dot dropdown) | `<DropdownMenu>` |
| `<Pill>` (small status chip) | Use `<Badge>` with variants |
| `<SyncBadge>` | Custom — combines dot + pulse + label |
| `<TopTabs>` / `<BottomTabs>` | `<Tabs>` / custom bottom-nav |

The "What's next?" CTA is a coordinated two-segment pill (numeric input + gradient
button in one rounded container). Build as a custom composite — shadcn doesn't have
this shape natively.

---

## 7. Animations

- `@keyframes fadein` — opacity:0.001 → 1 — used on screen transitions and overlays
- Avoid keyframes that start at `opacity:0` exactly — iOS Safari sometimes pauses these
  during initial paint and they never tick. We use 0.001 as a guard.
- `transition: background .12s` on hover surfaces — keep this gentle
- `animation: pulse 1.4s infinite` on the syncing dot

---

## 8. What's NOT in the prototype

You'll need to add these in production:

- [ ] react-router routes — currently state-based
- [ ] Real drag-and-drop with @dnd-kit
- [ ] Service worker + Web Push subscription
- [ ] Supabase client + Dexie cache + outbox
- [ ] Anthropic API call (prototype synthesizes the response after 900ms)
- [ ] CalDAV proxy integration
- [ ] Real recharts (prototype's SVG chart is nicer but you may want recharts'
      accessibility + tooltip baggage anyway)
- [ ] Focus trapping in Sheet and Dialog (Esc-to-close is wired)
- [ ] Streak calculation against `routine_logs` (prototype derives client-side)
- [ ] PWA manifest, service worker, install prompt
- [ ] Calendar status auto-update via proxy 401 handling

---

## 9. What I'd push back on

If product asks for these — push back:
- More accent colors. Jade + coral does real differentiation work. More would dilute.
- Empty-state illustrations. The dashed-border + icon pattern is editorial.
  Illustrations would feel young.
- Onboarding tour. The product is small enough to discover.
- Gamification copy on streaks. "Start today" is intentional — no exclamation marks,
  no "Way to go!". Keep the dignified tone.

---

*This prototype is a visual reference. The names of components, the shape of state, and
the exact CSS values are right. The implementation choices in `ARCHITECTURE.md` win
over the prototype's mock approximations.*
