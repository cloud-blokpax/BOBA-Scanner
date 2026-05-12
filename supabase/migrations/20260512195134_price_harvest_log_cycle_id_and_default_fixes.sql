
-- Two related fixes on price_harvest_log:
--
-- 1. Add `cycle_id` for per-invocation observability. The existing `run_id`
--    field is overloaded: it serves as the *dedup key* (one card harvested
--    once per day) by being set to `today.slice(0,10)`, but this collapses
--    all of the day's ~288 QStash cycles into a single value, which makes
--    per-cycle latency and throughput metrics impossible to compute. We
--    keep `run_id` exactly as-is (still the dedup key) and add a separate
--    `cycle_id` column that holds the per-invocation UUID. Together:
--      - run_id     → "2026-05-12"           (one per day; dedup behavior)
--      - cycle_id   → "f3a8...e2b"           (one per QStash trigger)
--
--    cycle_id is nullable because old rows have no per-invocation identity.
--    A future migration may make it NOT NULL after the harvester has been
--    writing it for the retention window (9 days).
--
-- 2. Drop the column-default `'paper'` (lowercase) from `parallel`. This
--    was the source of the legacy lowercase 'paper' bug — any INSERT that
--    omitted parallel would silently get the wrong canonical case. Code
--    now always passes parallel explicitly. CHECK constraint already
--    blocks any new lowercase insert (from migration 20260512000000),
--    but removing the default closes the loophole at the schema level too.
--
-- Same fixes apply to price_cache and price_history defaults.

alter table public.price_harvest_log
  add column if not exists cycle_id text;

create index if not exists price_harvest_log_cycle_id_idx
  on public.price_harvest_log (cycle_id) where cycle_id is not null;

comment on column public.price_harvest_log.cycle_id is
  'Per-QStash-invocation UUID. Use for per-cycle latency/throughput metrics. Distinct from run_id, which is the per-day dedup key.';

-- Drop legacy lowercase defaults
alter table public.price_harvest_log alter column parallel drop default;
alter table public.price_cache alter column parallel drop default;
alter table public.price_history alter column parallel drop default;
alter table public.collections alter column parallel drop default;
alter table public.listing_templates alter column parallel drop default;
alter table public.scan_resolutions alter column parallel drop default;
