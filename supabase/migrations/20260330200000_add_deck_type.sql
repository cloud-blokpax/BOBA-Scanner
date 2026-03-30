-- Add deck_type column to tournaments table
-- 'constructed' = traditional deck building (select existing, build new, CSV import)
-- 'sealed' = scan/lookup cards from a sealed product opening
ALTER TABLE public.tournaments
    ADD COLUMN IF NOT EXISTS deck_type TEXT NOT NULL DEFAULT 'constructed'
        CHECK (deck_type IN ('constructed', 'sealed'));
