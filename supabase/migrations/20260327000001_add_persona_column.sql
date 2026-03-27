-- Add persona JSONB column to users table
-- Stores user persona weights for adaptive home screen ordering.
-- Default: collector persona at 0.5, all others at 0.
-- Referenced by: src/lib/stores/persona.svelte.ts, src/routes/+page.svelte

ALTER TABLE public.users
    ADD COLUMN IF NOT EXISTS persona JSONB DEFAULT '{"collector": 0.5, "deck_builder": 0, "seller": 0, "tournament": 0}'::jsonb;

COMMENT ON COLUMN public.users.persona IS 'Persona weights (0-1) for adaptive UI. Keys: collector, deck_builder, seller, tournament.';
