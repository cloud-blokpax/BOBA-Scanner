-- Migration 33 — Per-game (card_number, parallel) uniqueness on cards
--
-- Until now, "uniqueness" of a Wonders card row was enforced only by
-- convention: every catalog row had parallel='Paper' so (game_id,
-- card_number) was de-facto unique. BoBA already encoded parallel into
-- card_number prefixes, so (game_id, card_number) was structurally
-- unique there too.
--
-- After migration 30, Wonders has up to 5 rows per card_number, one per
-- physical parallel printing. The real unique key is now
-- (game_id, card_number, parallel). Make it explicit so:
--   - The catalog import script (scripts/import-wonders-set.ts) can rely
--     on ON CONFLICT (game_id, card_number, parallel) DO NOTHING for
--     idempotent reapplication.
--   - Accidental duplicate inserts from admin tooling fail loudly
--     instead of silently double-row-ing the catalog.
--   - The recognition pipeline's catalog-mirror lookup
--     (game_id, card_number, parallel) → card_id can be assumed unique
--     by consumers without disambiguation logic.
--
-- Run AFTER migration 30. Running before would fail because Paper rows
-- for cards that someone already manually added a CF/FF/OCM/SF row for
-- would conflict during constraint creation.

ALTER TABLE public.cards
  ADD CONSTRAINT cards_game_card_parallel_unique
  UNIQUE (game_id, card_number, parallel);

COMMENT ON CONSTRAINT cards_game_card_parallel_unique ON public.cards IS
  'Every (game_id, card_number, parallel) tuple identifies a unique '
  'physical printing. Wonders cards have up to 5 printings per '
  'card_number (Paper, Classic Foil, Formless Foil, Orbital Color '
  'Match, Stonefoil); BoBA encodes parallel in the card_number prefix '
  'so its rows are also covered.';
