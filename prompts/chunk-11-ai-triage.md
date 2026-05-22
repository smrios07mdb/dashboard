# Chunk 11 — AI triage

**Goal:** "What's next?" button calls Anthropic API client-side and returns 1–3 ranked tasks with reasoning.
**Dependencies:** Chunks 5, 6, 7.
**Effort:** ~4h.

> Reference `ARCHITECTURE.md` §10 (AI triage, security tradeoff).

## What to build

### Settings UI

Add an "AI" section to `src/screens/Settings.tsx`:
- Anthropic API key input (masked, with show toggle)
- Reads from `settings.aiApiKey` via repo
- Save button → `repo.settings.update({ aiApiKey })`
- Help text: "Your key is stored in your Supabase data, accessible only by you (RLS). Calls are made directly from your browser. See docs/security.md."

### AI client

`src/lib/ai.ts`:
- `triage({ tasks, availableMinutes, timezone }): Promise<TriageResult>` where `TriageResult = { recommendations: { taskId: string; reason: string }[]; note?: string }`
- Reads the API key from settings; throws a typed error if missing
- POSTs to `https://api.anthropic.com/v1/messages` with:
  ```
  headers:
    x-api-key: <key>
    anthropic-version: 2023-06-01
    anthropic-dangerous-direct-browser-access: true
    content-type: application/json
  body:
    model: claude-sonnet-4-5
    max_tokens: 800
    system: <triage prompt>
    messages: [{ role: 'user', content: <task list JSON + available minutes> }]
  ```
- System prompt (verbatim):
  > You are a triage assistant for a personal productivity dashboard. Given a list of the user's incomplete tasks and their available time, recommend 1–3 tasks to do next. Consider deadlines, time fit, priority, and category balance. Respond with valid JSON only: `{ "recommendations": [{ "task_id": "...", "reason": "<one sentence>" }], "note": "<optional brief note>" }`. Do not include any text outside the JSON.
- User message: JSON containing `tasks` (id, title, subcategory_name, category_name, estimate_minutes, due_at, priority) and `available_minutes`
- Parses the response; on JSON parse failure, returns the raw text in a typed error for the UI to display

### Triage sheet

`src/components/WhatsNextSheet.tsx`:
- Triggered by "What's next?" button on the Dashboard header
- shadcn Sheet (slides in from the right on desktop, bottom on mobile)
- Inputs:
  - Available minutes (prefilled from the Dashboard header input; editable)
  - "Get recommendations" button
- Loading state with skeleton
- Results: 1–3 task cards, each showing title, subcategory + category, estimate, due (if any), and the one-sentence reason
- Each result card has a "Start" button that navigates to the subcategory view and scrolls to / highlights the task
- Error states:
  - Missing API key → CTA "Add your API key in Settings"
  - Network error → "Couldn't reach the AI. Try again."
  - Malformed JSON → "AI response was malformed. Try again." with a "Show raw response" expander
  - 401 from Anthropic → "API key rejected. Update it in Settings."

### Header wiring

The "What's next?" button on the Dashboard (built but disabled in chunk 6) is now enabled and opens the sheet.

### Docs

`docs/security.md`:
- Document the client-side AI key tradeoff: visible in network traffic on the user's device
- Acceptable for single-user personal use
- Future hardening path: route AI calls through the CalDAV proxy with the key as a server env var

## Files to create/modify

```
src/screens/Settings.tsx           (modify — add AI section)
src/lib/ai.ts                      (new)
src/components/WhatsNextSheet.tsx  (new)
src/screens/Dashboard.tsx          (modify — enable "What's next?" button)
docs/security.md                   (new)
```

## Acceptance criteria

- Without an API key: clicking "What's next?" shows the missing-key CTA
- With a valid key + 10 seeded tasks + 30 minute window: returns 1–3 task recommendations with reasoning
- Invalid key: shows 401 error message
- Malformed AI response: graceful error, raw response inspectable
- Result "Start" button navigates correctly
- Mobile: Sheet slides from the bottom; usable with thumbs

## Do NOT

- Stream responses (out of scope)
- Store AI responses in DB (ephemeral only)
- Touch calendar or notifications
- Try to "fix" the security tradeoff in this chunk — document it and move on

## How to test

1. Add API key in Settings → save
2. Dashboard → enter 30 → click "What's next?" → see 1–3 results
3. Vary available minutes to 5, 60, 120 → results change appropriately
4. Remove key → click "What's next?" → see missing-key CTA
5. Enter invalid key → see 401 message
6. Use browser DevTools to verify the call goes to `api.anthropic.com` directly
