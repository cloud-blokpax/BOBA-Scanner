-- Migration 24 — public.is_admin(uuid) helper function
--
-- Single source of truth for admin checks across the app. Used by:
--   1. SvelteKit server guards (requireAdmin in src/lib/server/auth/require-admin.ts)
--   2. Future RLS policies on admin-only tables
--
-- IMPORTANT: public.users.id != auth.users.id.
-- The link is public.users.auth_user_id = auth.users.id.
-- Always pass auth.uid() (or session.user.id from SvelteKit), never public.users.id.
--
-- This function was applied directly to prod via Supabase MCP before this file
-- was committed. The migration is recorded here so fresh Supabase branches and
-- the migrations folder converge to the same state when run in order.
--
-- Idempotent on re-run via CREATE OR REPLACE / REVOKE+GRANT.

create or replace function public.is_admin(p_auth_user_id uuid default auth.uid())
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(
    (select is_admin from public.users where auth_user_id = p_auth_user_id),
    false
  );
$$;

comment on function public.is_admin(uuid) is
  'Returns true if the given auth.users.id corresponds to a public.users row with is_admin=true. Defaults to auth.uid() when called with no args. SECURITY DEFINER so it works even inside RLS-restricted contexts.';

revoke all on function public.is_admin(uuid) from public;
grant execute on function public.is_admin(uuid) to authenticated, service_role;
