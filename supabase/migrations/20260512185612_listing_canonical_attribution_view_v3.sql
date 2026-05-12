
-- Partition by (ebay_item_id, run_id) instead of (ebay_item_id, observed_at).
-- Different cards' harvests of the same listing happen at different timestamps
-- but share the same run_id (the QStash trigger day). Using run_id correctly
-- groups all harvests of one listing within one harvest day.
create view public.canonical_listing_attributions as
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
    max(score) over (partition by ebay_item_id, run_id) as top_score
  from scored s
),
with_ties as (
  select
    r.*,
    sum(case when score = top_score then 1 else 0 end)
      over (partition by ebay_item_id, run_id) as tied_at_top
  from ranked r
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
  tied_at_top,
  (score = top_score and tied_at_top = 1) as is_canonical
from with_ties;

comment on view public.canonical_listing_attributions is
  'Bug D dedup: each ebay_item_id within a run_id attributed to the single best-matching card (top discriminator score, no ties). Filter on is_canonical=true.';
