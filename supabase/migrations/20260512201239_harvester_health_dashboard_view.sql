
-- Read-only views that surface harvester health metrics for admin observability.
-- No code change needed to use these — Jimmy can query them directly via MCP
-- or wire them into the admin dashboard.

-- harvester_daily_summary: one row per (day, game_id) with throughput and
-- thrash detection. The duplicate ratio (harvests / unique_cards) was the
-- canary that surfaced Bug A: a value of 42 meant the same 7 cards were
-- being re-fetched 288 times/day. Healthy is 1.0; >2.0 deserves investigation.
create or replace view public.harvester_daily_summary as
select
  date(processed_at) as day,
  game_id,
  count(*) as harvests,
  count(distinct card_id) as unique_cards,
  count(distinct parallel) as parallels_touched,
  -- Duplicate ratio: 1.0 = healthy, >1.5 = warning, >5 = pathology
  round(count(*)::numeric / nullif(count(distinct card_id), 0), 2) as duplicate_ratio,
  count(*) filter (where listings_count > 0) as got_listings,
  count(*) filter (where zero_results) as zero_results,
  count(*) filter (where not success) as errors,
  round(avg(duration_ms)::numeric, 0) as avg_ms,
  round(percentile_cont(0.95) within group (order by duration_ms)::numeric, 0) as p95_ms,
  min(processed_at) as first_at,
  max(processed_at) as last_at
from public.price_harvest_log
where processed_at >= now() - interval '14 days'
group by date(processed_at), game_id
order by day desc, game_id;

comment on view public.harvester_daily_summary is
  'Per-day throughput and thrash detection for the harvester. Drift signal: duplicate_ratio > 2.0 means cards are being re-fetched within a day (bug A territory). Window: last 14 days.';

-- harvester_parallel_health: per-parallel hit rates. Used to spot Bug B
-- patterns (e.g. Alpha Blast variants showing 0% hit rate across 731 attempts).
create or replace view public.harvester_parallel_health as
select
  game_id,
  parallel,
  count(*) as attempts_7d,
  count(*) filter (where listings_count > 0) as hits_7d,
  count(*) filter (where zero_results) as zeros_7d,
  round(100.0 * count(*) filter (where listings_count > 0) / nullif(count(*), 0), 1) as hit_rate_pct,
  round(avg(listings_count) filter (where listings_count > 0)::numeric, 1) as avg_listings_when_hit,
  count(distinct card_id) as unique_cards_attempted,
  max(processed_at) as last_attempt
from public.price_harvest_log
where processed_at >= now() - interval '7 days'
group by game_id, parallel
order by game_id, attempts_7d desc;

comment on view public.harvester_parallel_health is
  'Per-parallel hit rate over the last 7 days. Drift signal: hit_rate_pct = 0 with attempts_7d > 50 indicates the search query format may be broken for that parallel (Bug B territory). Window: 7 days.';

-- price_cache_quality: cards where price_cache disagrees significantly with
-- canonical attribution. Use to triage Bug D fallout and prioritize cleanup.
create or replace view public.price_cache_quality_alerts as
select
  c.name, c.card_number, c.parallel, c.game_id,
  pcwc.current_listings_count,
  pcwc.canonical_listings_count,
  pcwc.listings_inflation,
  pcwc.current_price_mid,
  pcwc.canonical_price_mid,
  pcwc.price_drift_pct,
  case
    when pcwc.canonical_listings_count = 0 and pcwc.current_listings_count > 0 then 'all_contamination'
    when abs(pcwc.price_drift_pct) >= 50 then 'severe_drift'
    when pcwc.listings_inflation >= 10 then 'severe_inflation'
    when abs(pcwc.price_drift_pct) >= 20 then 'moderate_drift'
    when pcwc.listings_inflation >= 5 then 'moderate_inflation'
    else 'minor'
  end as alert_level
from public.price_cache_with_canonical pcwc
join public.cards c on c.id = pcwc.card_id and c.parallel = pcwc.parallel
where pcwc.current_listings_count > 0
  and (
    pcwc.canonical_listings_count = 0
    or abs(coalesce(pcwc.price_drift_pct, 0)) >= 20
    or pcwc.listings_inflation >= 5
  );

comment on view public.price_cache_quality_alerts is
  'Cards where current price_cache differs significantly from canonical attribution. alert_level=all_contamination means EVERY listing currently counted is cross-card contamination (worst). Use to prioritize price_cache rewrite candidates.';
