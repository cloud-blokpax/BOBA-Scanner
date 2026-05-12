
-- Function wrapper so the daily-maintenance route can refresh the canonical
-- view without needing direct REFRESH MATERIALIZED VIEW privileges on the
-- service-role client. SECURITY DEFINER runs as the function owner.
create or replace function public.refresh_canonical_listing_attributions()
returns void
language plpgsql
security definer
set search_path to 'public'
as $$
begin
  refresh materialized view concurrently public.canonical_listing_attributions;
end;
$$;

comment on function public.refresh_canonical_listing_attributions is
  'Refresh the Bug D canonical attribution view. Called from daily-maintenance cron.';

-- Allow service_role and authenticated roles to call. Anon should NOT have it.
grant execute on function public.refresh_canonical_listing_attributions to service_role;
