# Chunk 13 — Calendar integration + reconnect UX

**Goal:** Settings UI to enter and verify iCloud credentials. "Block time" flow on tasks. Busy strip on Dashboard. Reconnect banner on auth failure.
**Dependencies:** Chunk 12 (deployed proxy). Chunks 5, 6, 7, 9 in main repo.
**Effort:** ~5h.

> Reference `ARCHITECTURE.md` §7 (CalDAV) and §8 (slot proposal). `VITE_CALDAV_PROXY_URL` must be set.

## What to build

### Calendar API client

`src/lib/calendarApi.ts`:
- `testCredentials({ appleId, appPassword }): Promise<{ calendars: { url, name }[] }>`
- `saveCredentials({ appleId, appPassword, calendarUrl }): Promise<void>`
- `getBusy({ from, to }): Promise<{ start: string; end: string }[]>`
- `createEvent({ title, start, end, description? }): Promise<{ uid: string }>`
- All functions include the Supabase JWT in `Authorization: Bearer <token>` (fetch via `supabase.auth.getSession()`)
- All POST `JSON.stringify`, all parse JSON responses
- On `401 { error: 'auth_failed' }` from busy/events: throw a typed error the UI can catch to show "Reconnect"

### Settings — Calendar section

Replace the placeholder with the full UI:
- Status badge: 'Not configured' | 'Connected (last verified Xm ago)' | 'Reconnect needed'
  - 'last verified' computed from `localStorage` timestamp set after each successful `getBusy` or `testCredentials`
- Apple ID input
- App-specific password input (masked, with show toggle)
- "Test connection" button → calls `testCredentials` → on success, calendar picker dropdown populates from response
- Save button (enabled once both creds entered and a calendar selected) → calls `saveCredentials` → updates local `caldav_status` to 'ok'
- Help text: "Generate an app-specific password at appleid.apple.com → Sign-In and Security → App-Specific Passwords"
- "Disconnect" button: clears `caldav_apple_id`, `caldav_calendar_url`, `caldav_app_password_encrypted`, sets `caldav_status = 'unconfigured'` (via repo + a proxy endpoint if needed — for now, just clear via repo since proxy reads from same settings row)

### Busy strip

`src/components/BusyStrip.tsx`:
- Renders at the top of the Dashboard when `caldav_status === 'ok'`
- Fetches `getBusy({ from: startOfDay, to: endOfDay })` on mount, on window focus, and every 5 minutes
- Caches results in Dexie under key `busy:<dateKey>` with 5-minute TTL
- Displays as a horizontal compact strip: "Busy: 9–11, 14–15" — multiple ranges merged consecutively
- On loading: skeleton
- On `caldav_status === 'auth_failed'`: replace strip with a "Reconnect Apple Calendar" banner linking to Settings (yellow/amber tone, non-modal)
- On `caldav_status === 'unconfigured'`: render nothing (no nag)

### Slot proposal

`src/lib/slots.ts`:
- `proposeSlots({ estimateMinutes, busyRanges, timezone, now }): { start: string; end: string }[]`
- Algorithm per ARCHITECTURE §8:
  1. Working window 09:00–18:00 in `timezone`
  2. 15-minute granularity
  3. Start = `max(now + 15min, next working window start)`
  4. Iterate candidates of length `estimateMinutes`; reject overlaps with `busyRanges`
  5. Return first 3 within next 24h
- Pure function — fully unit-tested

`src/lib/slots.test.ts`:
- 3 slots found, all 3 returned
- 1 slot found, returns [slot] with "limited availability" flag
- 0 slots, returns []
- Slot starts at next 15-min boundary after now + 15min buffer
- Slot respects working window across day boundary (if asking late afternoon, next-day morning slots returned)

### "Block time" flow

`src/components/BlockTimeSheet.tsx`:
- Triggered by "Block time" button on each task row (add to TaskMenu three-dot in chunk 9)
- shadcn Sheet (right on desktop, bottom on mobile)
- On open: fetch busy ranges (or use cache), compute slots via `proposeSlots`
- Show 3 (or fewer) slot options as selectable cards: date + start–end time + duration
- If <3 slots: header note "Limited availability — only N slot(s) found"
- "Add to Apple Calendar" button creates event via `calendarApi.createEvent({ title: task.title, start, end, description: task.notes ?? undefined })`
- On success: toast "Event added to Apple Calendar"
- On `auth_failed`: redirect to Settings with a banner

### Reconnect UX

When any calendar API call returns `auth_failed`:
- Local `caldav_status` flips to `'auth_failed'` (via settings refetch from Supabase, since proxy already updated it)
- Busy strip swaps to Reconnect banner
- "Block time" flow shows a reconnect notice instead of slots
- Settings status badge reflects 'Reconnect needed'
- User clicks "Test connection" in Settings with new credentials → success flips status back to 'ok'; busy strip returns on next 5-min refresh

### Docs

`docs/calendar.md`:
- How CalDAV integration works (link to ARCHITECTURE §7)
- How to generate an app-specific password
- What happens when the password expires/is revoked

## Files to create/modify

```
src/lib/calendarApi.ts        (new)
src/lib/slots.ts              (new)
src/lib/slots.test.ts         (new)
src/components/BusyStrip.tsx  (new)
src/components/BlockTimeSheet.tsx (new)
src/components/ReconnectBanner.tsx (new)
src/components/TaskMenu.tsx   (modify — add "Block time")
src/screens/Settings.tsx      (modify — full Calendar section)
src/screens/Dashboard.tsx     (modify — mount BusyStrip)
docs/calendar.md              (new)
```

## Acceptance criteria

- Enter Apple ID + app-specific password → "Test connection" → calendar list appears
- Select a calendar → Save → status flips to Connected
- Dashboard shows busy strip with real iCloud busy ranges
- Click "Block time" on a task → see 3 valid slots → confirm → event appears in Calendar.app on iPhone within seconds
- Revoke the app-specific password at appleid.apple.com → next API call sets status to 'auth_failed' → busy strip swaps to Reconnect banner
- Generate new password, re-test in Settings → status returns to 'ok' → strip returns
- Slot proposal tests pass

## Do NOT

- Touch AI code
- Implement notifications (chunk 14)
- Build Insights (chunk 16)
- Add storage of decrypted creds anywhere in the client

## How to test

1. With proxy deployed and `VITE_CALDAV_PROXY_URL` set, run the app
2. Generate an app-specific password at appleid.apple.com
3. Enter it in Settings → Test → Save
4. Confirm Connected status
5. Click "Block time" on a task with 30-minute estimate → see slots → pick first → event appears in iPhone Calendar.app
6. Revoke the password at Apple → wait → next focus event fetches busy → status → 'auth_failed' → banner appears
7. Generate a new password → re-test in Settings → status → 'ok' → banner gone after next refresh
