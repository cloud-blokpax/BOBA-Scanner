
-- Bug D resolution: post-aggregation deduplication via canonical attribution.
-- See migration 20260512000004 for full design notes.
create or replace view public.canonical_listing_attributions as
with scored as (
  select
    obs.id as observation_id,
    obs.observed_at,
    obs.run_id,
    obs.card_id,
    obs.game_id,
    obs.parallel,
    obs.ebay_item_id,
    obs.title,
    obs.price_value,
    obs.price_currency,
    obs.condition_label,
    obs.accepted_by_filter,
    (case
       when c.card_number is not null
            and lower(obs.title) ~
                ('(^|[^a-z0-9])'
                 || regexp_replace(lower(c.card_number), '[-\s/]', '[- ]?', 'g')
                 || '($|[^a-z0-9])')
       then 100 else 0 end
     + case
         when c.parallel is not null
              and lower(c.parallel) not in ('paper', 'base')
              and lower(obs.title) like '%' || lower(c.parallel) || '%'
         then 10 else 0 end
     + case
         when c.weapon_type is not null
              and lower(obs.title) ~ ('\m' || lower(c.weapon_type) || '\M')
         then 5 else 0 end
     + case
         when c.name is not null
              and lower(obs.title) like '%' || lower(c.name) || '%'
         then 1 else 0 end
    ) as score
  from public.ebay_listing_observations obs
  join public.cards c on c.id = obs.card_id
  where obs.accepted_by_filter = true
),
ranked as (
  select
    s.*,
    max(score) over (partition by ebay_item_id, observed_at) as top_score,
    count(*) over (partition by ebay_item_id, observed_at, score) as cards_at_this_score
  from scored s
)
select
  observation_id,
  observed_at,
  run_id,
  card_id,
  game_id,
  parallel,
  ebay_item_id,
  title,
  price_value,
  price_currency,
  condition_label,
  score,
  top_score,
  -- A row is canonical iff it has the unique top score for this listing.
  (score = top_score and cards_at_this_score = 1) as is_canonical
from ranked;

comment on view public.canonical_listing_attributions is
  'Bug D post-aggregation dedup: each ebay_item_id attributed to the single best-matching card based on title discriminators (card_number, parallel, weapon, name). Filter on is_canonical=true for the deduplicated set.';
