
-- Materialized for fast access. Refresh after each harvest cycle.
create materialized view public.canonical_listing_attributions as
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
listing_top AS (
  select
    ebay_item_id,
    max(score) as global_top_score
  from scored
  group by ebay_item_id
),
listing_canonical_card AS (
  select distinct
    s.ebay_item_id,
    s.card_id as canonical_card_id
  from scored s
  join listing_top lt on lt.ebay_item_id = s.ebay_item_id and s.score = lt.global_top_score
),
listing_canonical_unique AS (
  select
    ebay_item_id,
    count(*) as distinct_top_cards,
    (array_agg(canonical_card_id))[1] as canonical_card_id
  from listing_canonical_card
  group by ebay_item_id
)
select
  s.observation_id,
  s.observed_at,
  s.run_id,
  s.card_id,
  s.game_id,
  s.parallel,
  s.ebay_item_id,
  s.title,
  s.price_value,
  s.price_currency,
  s.condition_label,
  s.score,
  lt.global_top_score as top_score,
  lcu.distinct_top_cards as tied_at_top,
  (lcu.distinct_top_cards = 1 and s.card_id = lcu.canonical_card_id) as is_canonical
from scored s
join listing_top lt on lt.ebay_item_id = s.ebay_item_id
join listing_canonical_unique lcu on lcu.ebay_item_id = s.ebay_item_id;

create unique index canonical_listing_attributions_observation_id_idx
  on public.canonical_listing_attributions (observation_id);
create index canonical_listing_attributions_card_canonical_idx
  on public.canonical_listing_attributions (card_id, is_canonical) where is_canonical = true;
create index canonical_listing_attributions_item_id_idx
  on public.canonical_listing_attributions (ebay_item_id);

comment on materialized view public.canonical_listing_attributions is
  'Bug D dedup: each ebay_item_id attributed to single best-matching card (top score, no ties). Filter on is_canonical=true. Refresh after harvest cycles via REFRESH MATERIALIZED VIEW CONCURRENTLY public.canonical_listing_attributions.';
