
-- After the Wonders 5x parallel expansion, each (card, parallel) tuple has its
-- own row in cards. The collection's parallel column MUST match the card_id's
-- parallel — otherwise the harvester is asked to fetch eBay prices for one
-- parallel against a different parallel's catalog row, which silently fails.
-- The 6 inconsistent rows just fixed were thrashing the harvester for 9+ days.
-- A trigger enforces the invariant on INSERT/UPDATE.
CREATE OR REPLACE FUNCTION public.enforce_collection_parallel_matches_card()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
DECLARE
  catalog_parallel text;
BEGIN
  SELECT parallel INTO catalog_parallel FROM public.cards WHERE id = NEW.card_id;
  IF catalog_parallel IS NOT NULL
     AND NEW.parallel IS NOT NULL
     AND NEW.parallel != catalog_parallel THEN
    RAISE EXCEPTION 'collection.parallel (%) does not match cards.parallel (%) for card_id %; the collection row should reference the parallel-specific card row',
      NEW.parallel, catalog_parallel, NEW.card_id;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS collection_parallel_consistency ON public.collections;
CREATE TRIGGER collection_parallel_consistency
  BEFORE INSERT OR UPDATE OF card_id, parallel ON public.collections
  FOR EACH ROW
  EXECUTE FUNCTION public.enforce_collection_parallel_matches_card();
