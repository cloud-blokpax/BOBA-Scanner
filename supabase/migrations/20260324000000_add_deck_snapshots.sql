-- Deck snapshots for tournament QR verification
-- Stores an immutable copy of a deck at lock time so organizers can verify

CREATE TABLE IF NOT EXISTS deck_snapshots (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    code TEXT NOT NULL UNIQUE,
    user_id UUID NOT NULL REFERENCES auth.users(id),
    deck_id UUID NOT NULL,
    deck_name TEXT NOT NULL,
    format_id TEXT NOT NULL,
    format_name TEXT NOT NULL,
    is_valid BOOLEAN NOT NULL DEFAULT false,
    violations JSONB DEFAULT '[]'::jsonb,
    stats JSONB DEFAULT '{}'::jsonb,
    hero_cards JSONB NOT NULL DEFAULT '[]'::jsonb,
    play_cards JSONB DEFAULT '[]'::jsonb,
    player_name TEXT NOT NULL,
    locked_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    created_at TIMESTAMPTZ DEFAULT now()
);

-- Index for fast code lookups (hot path — organizer scans QR)
CREATE UNIQUE INDEX IF NOT EXISTS idx_deck_snapshots_code ON deck_snapshots(code);

-- RLS: anyone can READ snapshots (organizers don't have accounts),
-- only the owner can INSERT.
ALTER TABLE deck_snapshots ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Anyone can view deck snapshots"
    ON deck_snapshots FOR SELECT
    USING (true);

CREATE POLICY "Users can create their own snapshots"
    ON deck_snapshots FOR INSERT
    WITH CHECK (auth.uid() = user_id);
