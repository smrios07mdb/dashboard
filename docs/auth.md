# Auth notes

See `ARCHITECTURE.md` §5 for the canonical auth model.

## iOS PWA session eviction

iOS evicts WebKit storage (including the Supabase session in `localStorage`)
for installed PWAs after **roughly 7 days of inactivity**. When that happens
the next launch will show the Login screen even though the user never signed
out. This is expected behavior, not a bug. The product surface for it is the
unchanged Login flow — re-login is fast (magic link) and Dexie cache still
has the user's data ready to display once the session restores.

## Supabase redirect URLs (already configured in chunk 2)

The Supabase project's allowed redirect URLs use wildcards so any path under
`/dashboard/` (including `/dashboard/auth/callback`) is accepted:

- `http://localhost:5173/dashboard/**`
- `https://smrios07mdb.github.io/dashboard/**`

The Login screen passes the callback URL via the magic link's `emailRedirectTo`
option:

```ts
window.location.origin + import.meta.env.BASE_URL + 'auth/callback'
// → http://localhost:5173/dashboard/auth/callback (dev)
// → https://smrios07mdb.github.io/dashboard/auth/callback (prod)
```

If you ever deploy to a new origin (preview environment, custom domain), add
a matching wildcard to the Supabase project's URL allowlist before pointing
traffic at it. Magic links sent for one origin won't redirect cleanly to
another.

## Routing: BrowserRouter vs createBrowserRouter

We use `BrowserRouter` (declarative `<Routes>` / `<Route>`) from
react-router-dom v7, with `basename={import.meta.env.BASE_URL}` so the same
route table works under `/dashboard/` on GH Pages and under `/dashboard/` in
dev.

Both `BrowserRouter` and `createBrowserRouter` are v7-idiomatic; the data
router (`createBrowserRouter`) adds loaders/actions that load route data
before the route renders. We do not load data at the route level — auth is
checked inside `<Protected>`, and per-screen data (chunks 5+) lives in the
data repo behind hooks. The declarative form keeps the surface minimal until
a chunk has a reason to need the data router.

## Session flow

1. `src/lib/supabase.ts` constructs the client with
   `persistSession: true`, `autoRefreshToken: true`,
   `detectSessionInUrl: true`, and `flowType: 'pkce'`. The PKCE flow puts a
   short-lived `?code=` on the callback URL instead of the access token, so
   tokens never appear in browser history or the Referer header.
2. The Login screen calls `supabase.auth.signInWithOtp({ email, options })`.
3. Supabase emails the user a link to `/dashboard/auth/callback?code=...`.
4. When the browser loads that URL, `detectSessionInUrl` exchanges the code
   for a session automatically. `AuthCallback` waits for the session via
   `useSession()` and then navigates to `/`.
5. If the auto-exchange hasn't completed after ~1.5s, `AuthCallback` falls
   back to a manual `supabase.auth.exchangeCodeForSession(href)`.
6. `<Protected>` reads `useSession()` and renders Login, a Skeleton, or the
   wrapped children depending on `{ session, loading }`.
7. `<AccountMenu>` calls `supabase.auth.signOut()` then `navigate('/')`; the
   session subscription clears state on `SIGNED_OUT` and Protected swaps in
   Login.

## Fonts

Inter (400/500/600/700) and IBM Plex Mono (500) are bundled via
`@fontsource/*` packages and imported in `src/main.tsx`. This avoids the
render-blocking Google Fonts CSS request, gives the service worker (chunk 4)
something to cache for offline use, and pins exact font versions across
deploys. Add new weights by importing them in `src/main.tsx` — Vite tree-
shakes anything not imported.
