-- Migration: add_hero_set_status_table
--
-- Models the per-(hero, set) status tier in BoBA: Featured, Highlighted, Non-Featured.
--
-- Why per-set: a hero's status is set-specific. Burner is Non-Featured in Alpha
-- Edition + Alpha Blast, Featured in Griffey Edition. PB Buckets is Highlighted
-- in Griffey Edition but may not exist in other sets.
--
-- Featured     = derivable. (hero, set) has at least one Inspired Ink printing.
-- Highlighted  = manual tag. Hero gets broad chase-parallel coverage in a set
--                (Alpha/Logofoil/Slime/Headlines etc.) without Inspired Ink.
-- Non-Featured = neither.
--
-- The `source` column distinguishes machine-derived rows from human-tagged rows
-- so the derivation pass doesn't clobber manual edits when new sets ship.

create table if not exists hero_set_status (
  game_id text not null default 'boba',
  hero_name text not null,
  set_code text not null,
  status text not null check (status in ('Featured', 'Highlighted', 'Non-Featured')),
  source text not null check (source in ('derived', 'manual')) default 'derived',
  notes text,
  updated_at timestamptz not null default now(),
  primary key (game_id, hero_name, set_code)
);

create index if not exists idx_hero_set_status_status
  on hero_set_status (game_id, status);

-- RLS: public read. Admin writes bypass RLS via service role (getAdminClient).
alter table hero_set_status enable row level security;

create policy "hero_set_status_public_read"
  on hero_set_status for select
  using (true);

-- ===========================================================================
-- Backfill Pass 1 — every (hero, set) starts as Non-Featured / derived
-- ===========================================================================

insert into hero_set_status (game_id, hero_name, set_code, status, source)
select distinct game_id, hero_name, set_code, 'Non-Featured', 'derived'
from cards
where game_id = 'boba'
  and hero_name is not null
  and set_code is not null
on conflict (game_id, hero_name, set_code) do nothing;

-- ===========================================================================
-- Backfill Pass 2 — upgrade to Featured where Inspired Ink exists in that set
-- ===========================================================================

update hero_set_status hss
set status = 'Featured', updated_at = now()
where source = 'derived'
  and exists (
    select 1 from cards c
    where c.game_id = hss.game_id
      and c.hero_name = hss.hero_name
      and c.set_code = hss.set_code
      and c.parallel ilike '%Inspired Ink%'
  );

-- ===========================================================================
-- Backfill Pass 3 — manual Highlighted seeds (confirmed examples)
-- ===========================================================================

insert into hero_set_status (game_id, hero_name, set_code, status, source, notes)
values
  ('boba', 'Maverick',   'Griffey Edition', 'Highlighted', 'manual',
   'Stub seed: 150 cards / 29 parallels, no Inspired Ink. Confirmed.'),
  ('boba', 'PB Buckets', 'Griffey Edition', 'Highlighted', 'manual',
   'Stub seed: 150 cards / 29 parallels, no Inspired Ink. Confirmed.'),
  ('boba', 'Leducky',    'Alpha Edition',   'Highlighted', 'manual',
   'Stub seed: cross-set Highlighted, no Inspired Ink. Confirmed.'),
  ('boba', 'Leducky',    'Alpha Blast',     'Highlighted', 'manual',
   'Stub seed: cross-set Highlighted, no Inspired Ink. Confirmed.')
on conflict (game_id, hero_name, set_code) do update
  set status     = excluded.status,
      source     = excluded.source,
      notes      = excluded.notes,
      updated_at = now();
