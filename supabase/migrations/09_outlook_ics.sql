-- Chunk 35 (ARCHITECTURE.md §4, §7) — Outlook ICS feed columns on settings.
--
-- The read-only Outlook busy overlay (planner series) stores its state in
-- five settings columns: the AES-GCM-encrypted published-ICS URL (written
-- and read only by the CalDAV proxy, never by the client — same posture as
-- caldav_app_password_encrypted), the human-readable feed name, a status
-- ('unreachable' means the feed stopped responding and cached data is being
-- served — stale, not lost), the proxy's cached busy JSON, and the cache
-- timestamp.
--
-- Applied out-of-band: chunk 34 (proxy repo) already ran this DDL against
-- the dev project via raw SQL (chunk-14/33 precedent — `db push` remains
-- blocked by divergent remote migration tracking). This file is the formal
-- record for fresh-database reproducibility; `if not exists` makes it a
-- no-op against the dev project.

alter table public.settings
  add column if not exists outlook_ics_url_encrypted bytea,
  add column if not exists outlook_feed_name text,
  add column if not exists outlook_status text not null default 'unconfigured'
    check (outlook_status in ('unconfigured', 'ok', 'unreachable')),
  add column if not exists outlook_cached_busy jsonb,
  add column if not exists outlook_fetched_at timestamptz;
