
-- Document the BoBA catalog convention that one card_number can host two
-- different (name, athlete) tributes within the same parallel and set.
-- Examples: RJA-N (Mr. October Reggie Jackson + JAW-JAW Ron Jaworski),
-- RPU-6 PROMO (Halo Malik Nabers + Exterminaber Angel Reese).
--
-- This is by-design — the uniqueness key
-- (game_id, set_code, card_number, name, parallel) correctly admits these.
-- A future drift check that flags duplicate card_numbers as "wrong" would
-- be a regression.

comment on constraint cards_game_set_card_name_parallel_unique on public.cards is
  'BoBA cards are uniquely identified by (game_id, set_code, card_number, name, parallel). The `name` component is essential because some card_numbers host two different (name, athlete) tributes — e.g. RJA-1 through RJA-12 are jointly assigned to "Mr. October" (Reggie Jackson) and "JAW-JAW" (Ron Jaworski). RPU-6 PROMO is shared by Halo/Angel Reese and Exterminaber/Malik Nabers. Treat these as separate cards, not duplicates.';
