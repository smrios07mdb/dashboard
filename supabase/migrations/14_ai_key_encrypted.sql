-- Chunk 55 (ARCHITECTURE.md §10) — AI triage through the proxy.
-- `ai_api_key_encrypted` holds the user's Anthropic key, AES-GCM-encrypted by
-- the proxy with CALDAV_ENCRYPTION_KEY (same pattern as
-- `caldav_app_password_encrypted` / `outlook_ics_url_encrypted`). The app
-- never reads or writes it; it reads only `ai_status`.
-- `ai_status` mirrors `caldav_status`: 'unconfigured' | 'ok' | 'auth_failed',
-- written by the proxy only (POST/DELETE /api/ai/key, POST /api/ai/triage).
--
-- The legacy plaintext `ai_api_key` column is NOT dropped here: the proxy
-- lazily migrates it on the first triage (D5). The drop is the next chunk,
-- after the proxy stops selecting it.
--
-- No RLS / publication / replica-identity changes: settings is already
-- covered (migrations 03/05). Applied out-of-band to the dev project via raw
-- SQL (MCP `execute_sql`, migration-13 precedent). Idempotent — the inline
-- check constraint is created only together with its column.
alter table public.settings
  add column if not exists ai_api_key_encrypted bytea;

alter table public.settings
  add column if not exists ai_status text not null default 'unconfigured'
    check (ai_status in ('unconfigured','ok','auth_failed'));
