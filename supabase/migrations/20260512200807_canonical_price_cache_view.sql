
-- Bug D follow-up: shadow price cache computed only from canonical attributions.
--
-- This is the stepping stone to eventually rewriting price_cache. Side-by-side
-- comparison via price_cache_with_canonical (already shipped) tells the story
-- per-row; this view exposes the shadow values as a price_cache-shaped result
-- set the app could read from once the team is ready to flip.
--
-- Stats computed:
--   - listings_count    = distinct ebay_item_ids canonically attributed to card
--   - price_low/mid/hi  = min/median/max of price_value for those listings
--   - buy_now_*         = same for listings with buying_options containing 'FIXED_PRICE'
--   - confidence_score  = sqrt(listings_count) bounded to 1.0, simple shape
--   - source = 'ebay-canonical' to distinguish from harvester-written rows
--   - fetched_at        = max observed_at across canonical observations
--
-- The view is materialized for the same reason as canonical_listing_attributions:
-- the scoring CTE inside it is expensive (window functions over many rows).
-- Refresh policy is daily via the same refresh_canonical_listing_attributions()
-- chain (which now also refreshes this).

create materialized view if not exists public.canonical_price_cache as
with canonical_obs as (
  select
    card_id,
    game_id,
    parallel,
    ebay_item_id,
    price_value,
    condition_label,
    observed_at,
    -- We don't have buying_options in the materialized view's projection.
    -- Pull it back from the source observation table so buy-now stats work.
    (select buying_options from public.ebay_listing_observations obs
       where obs.id = cla.observation_id) as buying_options
  from public.canonical_listing_attributions cla
  where is_canonical = true
    and price_value is not null
    and price_value > 0
),
-- One row per (card, listing) — collapse re-observations of the same listing
-- to the most recent price for that listing. (Listing prices can drop over
-- time; we want the current value.)
deduped as (
  select distinct on (card_id, ebay_item_id)
    card_id,
    game_id,
    parallel,
    ebay_item_id,
    price_value,
    condition_label,
    buying_options,
    observed_at
  from canonical_obs
  order by card_id, ebay_item_id, observed_at desc
),
aggregated as (
  select
    card_id,
    game_id,
    parallel,
    count(*) as listings_count,
    min(price_value) as price_low,
    percentile_cont(0.5) within group (order by price_value) as price_mid,
    max(price_value) as price_high,
    avg(price_value) as price_mean,
    -- Buy-now bucket: listings where the listing supports fixed-price purchase.
    count(*) filter (
      where buying_options is not null
        and 'FIXED_PRICE' = any(buying_options)
    ) as buy_now_count,
    min(price_value) filter (
      where buying_options is not null
        and 'FIXED_PRICE' = any(buying_options)
    ) as buy_now_low,
    percentile_cont(0.5) within group (order by price_value) filter (
      where buying_options is not null
        and 'FIXED_PRICE' = any(buying_options)
    ) as buy_now_mid,
    max(observed_at) as fetched_at
  from deduped
  group by card_id, game_id, parallel
)
select
  card_id,
  'ebay-canonical'::text as source,
  parallel,
  game_id,
  price_low,
  price_mid,
  price_high,
  price_mean,
  listings_count,
  buy_now_low,
  buy_now_mid,
  buy_now_count,
  -- Conservative confidence: sqrt(listings_count)/sqrt(20) capped at 1.0.
  -- listings_count=1 → 0.22, 4 → 0.45, 9 → 0.67, 20+ → 1.0
  least(sqrt(listings_count::numeric) / sqrt(20.0), 1.0) as confidence_score,
  -- A row is "cold start" if it has fewer than 2 canonical listings.
  (listings_count < 2) as confidence_cold_start,
  fetched_at
from aggregated;

create unique index canonical_price_cache_pk_idx
  on public.canonical_price_cache (card_id, source, parallel);
create index canonical_price_cache_game_id_idx
  on public.canonical_price_cache (game_id);
create index canonical_price_cache_fetched_at_idx
  on public.canonical_price_cache (fetched_at);

comment on materialized view public.canonical_price_cache is
  'Shadow price_cache computed from canonical_listing_attributions WHERE is_canonical. Use price_cache_with_canonical to compare row-by-row. Refresh via refresh_canonical_price_cache().';

-- Refresh function — couples this materialized view to the canonical one.
create or replace function public.refresh_canonical_price_cache()
returns void
language plpgsql
security definer
set search_path to 'public'
as $$
begin
  refresh materialized view concurrently public.canonical_price_cache;
end;
$$;

grant execute on function public.refresh_canonical_price_cache to service_role;
