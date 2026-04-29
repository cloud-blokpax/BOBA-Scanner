-- 034_client_errors_table.sql
--
-- Low-level client-side error capture, including inferred crashes via
-- heartbeat staleness. Catches the failure class that window.onerror /
-- unhandledrejection (and the existing app_events pipeline) miss —
-- iOS Safari OOM kills, service-worker reloads, and other process-level
-- terminations that fire below the JS layer.
--
-- This table is intentionally separate from app_events. Diagnostic events
-- (`app_events`) are server- and client-emitted at the SDK boundary and
-- get fingerprinted/deduped. `client_errors` is a lower-level surface
-- focused on the crash itself plus a heartbeat trail of which scan flow
-- step the user was in when the page died.
--
-- Convention matches scans table: user_id is unconstrained uuid (no FK).
--
-- Applied directly to prod via Supabase MCP on 2026-04-28
-- (version 20260428220700, name client_errors_table). Recorded here so
-- fresh Supabase branches and the migrations folder converge to the
-- same state when run in order.

create table if not exists public.client_errors (
  id uuid primary key default gen_random_uuid(),
  user_id uuid,
  session_id text not null,
  created_at timestamptz not null default now(),

  -- error: window 'error' event
  -- unhandledrejection: window 'unhandledrejection' event
  -- inferred_crash: stale flow heartbeat detected on next page load
  -- manual_breadcrumb: explicit flowBreadcrumb() call (rare; usually attached to others)
  error_type text not null check (
    error_type in ('error', 'unhandledrejection', 'inferred_crash', 'manual_breadcrumb')
  ),

  -- Flow context. NULL for errors fired outside an active flow.
  flow text,
  step text,

  -- Standard error payload.
  message text,
  stack text,
  source text,
  line int,
  col int,

  -- Age (ms) of the last heartbeat at the moment the inferred crash was
  -- detected. NULL for non-inferred error_types.
  heartbeat_age_ms int,

  -- Environment snapshot at time of capture.
  user_agent text,
  url text,
  viewport jsonb,
  memory_mb numeric,
  device_memory_gb numeric,
  connection_type text,

  -- Ring buffer of recent flow steps, captured at error time.
  breadcrumbs jsonb,

  -- Triage state.
  resolved boolean not null default false,
  notes text
);

create index if not exists client_errors_created_at_idx
  on public.client_errors (created_at desc);
create index if not exists client_errors_user_id_idx
  on public.client_errors (user_id);
create index if not exists client_errors_flow_idx
  on public.client_errors (flow) where flow is not null;
create index if not exists client_errors_unresolved_idx
  on public.client_errors (created_at desc) where resolved = false;
create index if not exists client_errors_session_id_idx
  on public.client_errors (session_id);
create index if not exists client_errors_error_type_idx
  on public.client_errors (error_type);

alter table public.client_errors enable row level security;

drop policy if exists "anyone can insert client errors" on public.client_errors;
create policy "anyone can insert client errors"
  on public.client_errors for insert
  to anon, authenticated
  with check (true);

drop policy if exists "admin can read all client errors" on public.client_errors;
create policy "admin can read all client errors"
  on public.client_errors for select
  to authenticated
  using (public.is_admin());

drop policy if exists "admin can update client errors" on public.client_errors;
create policy "admin can update client errors"
  on public.client_errors for update
  to authenticated
  using (public.is_admin())
  with check (public.is_admin());

comment on table public.client_errors is
  'Low-level client-side error capture including OOM-kill inferred crashes via heartbeat staleness. user_id is unconstrained uuid matching scans table convention.';
