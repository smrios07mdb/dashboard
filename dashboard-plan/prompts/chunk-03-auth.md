# Chunk 3 — Auth + protected shell

**Goal:** Magic-link login, session persistence, route protection, account menu.
**Dependencies:** Chunks 1, 2.
**Effort:** ~3h.

> Reference `ARCHITECTURE.md` §5 (Auth). Use `design/Login.tsx` as the visual reference if it exists.

## What to build

### Supabase client

`src/lib/supabase.ts`:
- Export a configured Supabase client using `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY` from `import.meta.env`
- Configure with `persistSession: true`, `autoRefreshToken: true`, `detectSessionInUrl: true`
- Throw a clear error on import if env vars are missing in dev

### Session hook

`src/lib/auth.ts`:
- `useSession()` hook returning `{ session, user, loading }`
- Subscribes to `supabase.auth.onAuthStateChange` and updates state
- Initial load reads `supabase.auth.getSession()`

### Screens

**`src/screens/Login.tsx`** — email input, "Send magic link" button
- On click: `supabase.auth.signInWithOtp({ email, options: { emailRedirectTo: window.location.origin + import.meta.env.BASE_URL + 'auth/callback' } })`
- Shows "Check your email" success state with 30s resend cooldown (`setTimeout` + state)
- Surface errors via Toast
- Use `design/Login.tsx` styles if present, otherwise minimal centered layout

**`src/screens/AuthCallback.tsx`** — handles the redirect
- Calls `supabase.auth.exchangeCodeForSession(window.location.href)` if needed (Supabase JS handles this automatically via `detectSessionInUrl` in most cases; verify and add fallback)
- On success navigates to `/`
- On failure shows the error and a "Back to login" link

### Protected wrapper

`src/components/Protected.tsx`:
- Reads `useSession()`
- While loading: render skeleton
- No session: render `<Login />`
- Session present: render `props.children`

### Routing

Update `src/App.tsx` to use `react-router-dom` with `basename={import.meta.env.BASE_URL}`:
- `/` → `<Protected><Dashboard /></Protected>` (Dashboard is a placeholder stub: `<h1>Dashboard (signed in)</h1>` — chunk 6 will replace it)
- `/auth/callback` → `<AuthCallback />` (NOT wrapped in Protected)

### Account menu

`src/components/AccountMenu.tsx`:
- Renders in top-right of the protected layout
- shadcn DropdownMenu trigger shows the user's email truncated
- Menu item: "Sign out" → `supabase.auth.signOut()` then navigate to `/`

### Docs

`docs/auth.md`:
- One-paragraph note: iOS PWA sessions can be evicted after ~7 days of inactivity; re-login is expected behavior, not a bug.
- One-paragraph note on required Supabase redirect URLs (already configured in chunk 2; reiterate which URLs).

## Files to create/modify

```
src/lib/supabase.ts           (new)
src/lib/auth.ts               (new)
src/screens/Login.tsx         (new)
src/screens/AuthCallback.tsx  (new)
src/components/Protected.tsx  (new)
src/components/AccountMenu.tsx (new)
src/App.tsx                   (modify — add routing)
docs/auth.md                  (new)
```

## Acceptance criteria

- Enter email on Login screen → magic link arrives → clicking it returns to the app signed in
- Page reload keeps the session
- Sign out clears the session and routes back to Login
- AccountMenu shows the email and works on both desktop and mobile (hit target ≥44pt)
- Visiting `/dashboard/` while signed out shows Login; while signed in shows the Dashboard placeholder
- Visiting `/auth/callback` while signed out does NOT show Login (it processes the callback)

## Do NOT

- Touch any data tables (no repo functions yet — chunk 5)
- Enable PWA features (chunk 4)
- Build any UI beyond Login, AuthCallback, AccountMenu, and the stub Dashboard

## How to test

1. With `.env.local` filled in, run `npm run dev`
2. Visit `localhost:5173/dashboard/` → Login screen
3. Submit email → check inbox → click magic link → returns signed in
4. Reload → still signed in
5. Click account menu → Sign out → back to Login
6. Push to GH Pages; repeat the flow on the production URL (requires the prod URL to be in Supabase redirect list)
