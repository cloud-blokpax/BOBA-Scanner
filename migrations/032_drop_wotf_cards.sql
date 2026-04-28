-- Migration 32 — Drop unused wotf_cards / wonders_cards_full
--
-- Discovery (Phase 0.3 in the implementation doc) confirmed wotf_cards
-- and wonders_cards_full have no consumers in application code:
--   $ grep -rn "wotf_cards\|wonders_cards_full" src/ scripts/
--   (no results)
-- Orbital costs, dragon points, card_class, type_line, rules text, and
-- every other Wonders-specific field is read from cards.metadata JSONB
-- throughout the app. The 1:1 join key (id) was also broken by migration
-- 30's 5x expansion, since cards now has 5 rows per Wonders identity
-- and wotf_cards has only 1.
--
-- DROP IF EXISTS makes this a no-op if the discovery check found neither
-- object. Safe to apply unconditionally on a fresh branch.
--
-- If a future migration introduces an SQL function or view that
-- references wonders_cards_full, surface it before dropping:
--   SELECT proname FROM pg_proc WHERE prosrc ILIKE '%wonders_cards_full%';
-- Zero results → safe. Non-zero → update those references first.

DROP VIEW  IF EXISTS public.wonders_cards_full CASCADE;
DROP TABLE IF EXISTS public.wotf_cards         CASCADE;
