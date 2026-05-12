
-- A read-only view that exposes the gap between price_cache's current values
-- and what the canonical attribution computation would produce. Use this for:
--   1. Monitoring contamination magnitude per card
--   2. Eventually replacing price_cache values (when downstream is ready)
--   3. Admin debugging the worst-affected cards
create or replace view public.price_cache_with_canonical as
with canonical_agg as (
  select
    card_id,
    game_id,
    parallel,
    count(*) filter (where is_canonical) as canonical_listings,
    count(distinct ebay_item_id) filter (where is_canonical) as canonical_unique_listings,
    -- price stats from canonical only (parsing price_value as numeric)
    min(price_value) filter (where is_canonical and price_value > 0) as canonical_price_low,
    percentile_cont(0.5) within group (order by price_value)
      filter (where is_canonical and price_value > 0) as canonical_price_mid,
    max(price_value) filter (where is_canonical and price_value > 0) as canonical_price_high
  from canonical_listing_attributions
  group by card_id, game_id, parallel
)
select
  pc.card_id,
  pc.parallel,
  pc.game_id,
  pc.listings_count as current_listings_count,
  coalesce(ca.canonical_unique_listings, 0) as canonical_listings_count,
  pc.listings_count - coalesce(ca.canonical_unique_listings, 0) as listings_inflation,
  pc.price_mid as current_price_mid,
  ca.canonical_price_mid,
  case
    when pc.price_mid is not null and ca.canonical_price_mid is not null
      then round(((pc.price_mid - ca.canonical_price_mid) / ca.canonical_price_mid * 100)::numeric, 1)
    else null
  end as price_drift_pct,
  ca.canonical_price_low,
  ca.canonical_price_high,
  pc.fetched_at
from public.price_cache pc
left join canonical_agg ca on ca.card_id = pc.card_id and ca.parallel = pc.parallel
where pc.source = 'ebay';

comment on view public.price_cache_with_canonical is
  'Bug D diagnostic: compares price_cache row-by-row against the canonical attribution. listings_inflation > 0 means the cache counts more listings than truly belong to that card. price_drift_pct shows the gap between cache mid and what canonical would compute.';
