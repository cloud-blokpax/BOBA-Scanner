
-- Prevent the same user from creating duplicate collection rows for the same
-- (card, parallel, condition) tuple. Currently no duplicates exist but no
-- constraint enforces it, so future scan-to-collection workflows could create
-- silent duplicates that inflate quantity counts in the UI.
ALTER TABLE collections
  ADD CONSTRAINT collections_unique_user_card_parallel_condition
  UNIQUE (user_id, card_id, parallel, condition);
