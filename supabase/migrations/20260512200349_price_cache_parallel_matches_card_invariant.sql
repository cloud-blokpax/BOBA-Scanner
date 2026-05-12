
-- Bug A redux at the api/price layer: the /api/price/[cardId] endpoint
-- accepted a query param parallel and defaulted to literal 'Paper' when
-- omitted. The frontend price store passed no param for cards it thought
-- were Paper, including non-Paper hero cards like D-Harp RBF-95 (Red
-- Battlefoil). Result: a Paper row written under the RBF card_id, which
-- duplicates the same root cause as the original lowercase 'paper' bug:
-- something other than the canonical cards.parallel landing in price_cache.
--
-- Code-side fix: api/price now loads the card row first and derives parallel
-- from cards.parallel when the query param is missing.
--
-- DB-side fix: a trigger that rejects price_cache and price_history inserts
-- where parallel != cards.parallel for hero cards. This belt-and-braces
-- guards against future writers that bypass api/price.
-- (play_price_cache has no parallel column; play cards bypass this entirely.)

create or replace function public.enforce_price_cache_parallel_matches_card()
returns trigger
language plpgsql
as $$
declare
  catalog_parallel text;
begin
  -- Only check rows that reference a real cards row. UUID lookup; play cards
  -- use TEXT card_ids and are in play_price_cache (no parallel column there).
  select parallel into catalog_parallel from public.cards where id = new.card_id;
  if catalog_parallel is not null
     and new.parallel is not null
     and new.parallel != catalog_parallel then
    raise exception 'price write parallel (%) does not match cards.parallel (%) for card_id %; writer should derive parallel from the card row',
      new.parallel, catalog_parallel, new.card_id;
  end if;
  return new;
end;
$$;

drop trigger if exists price_cache_parallel_consistency on public.price_cache;
create trigger price_cache_parallel_consistency
  before insert or update of card_id, parallel on public.price_cache
  for each row
  execute function public.enforce_price_cache_parallel_matches_card();

drop trigger if exists price_history_parallel_consistency on public.price_history;
create trigger price_history_parallel_consistency
  before insert or update of card_id, parallel on public.price_history
  for each row
  execute function public.enforce_price_cache_parallel_matches_card();
