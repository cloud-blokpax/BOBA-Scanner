-- ═══════════════════════════════════════════════════════════
-- User Decks: personal deck storage with full metadata
-- ═══════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS user_decks (
    id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
    user_id uuid NOT NULL REFERENCES auth.users(id),
    name text NOT NULL DEFAULT 'My Deck',
    format_id text NOT NULL DEFAULT 'spec_playmaker',
    is_custom_format boolean DEFAULT false,
    notes text,  -- Multi-line free text notes displayed with the deck

    -- Build requirements (populated from format defaults, editable by user)
    hero_deck_min int NOT NULL DEFAULT 60,
    hero_deck_max int DEFAULT NULL,  -- NULL = no maximum
    play_deck_size int NOT NULL DEFAULT 30,
    bonus_plays_max int DEFAULT 25,
    hot_dog_deck_size int DEFAULT 10,
    dbs_cap int DEFAULT 1000,
    spec_power_cap int DEFAULT NULL,  -- NULL = no individual card power cap
    combined_power_cap int DEFAULT NULL,

    -- Deck contents (stored as JSONB arrays)
    hero_card_ids text[] DEFAULT '{}',
    play_entries jsonb DEFAULT '[]'::jsonb,
    -- play_entries shape: [{ "cardNumber": "PL-1", "setCode": "A", "name": "Front Run", "dbs": 16 }, ...]
    hot_dog_count int DEFAULT 10,

    -- Metadata
    is_shared boolean DEFAULT false,  -- Whether this deck appears in community decks
    created_at timestamptz DEFAULT now(),
    updated_at timestamptz DEFAULT now(),
    last_edited_at timestamptz DEFAULT now()
);

CREATE INDEX idx_user_decks_user ON user_decks (user_id, updated_at DESC);

-- RLS: users can only see and modify their own decks
ALTER TABLE user_decks ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users read own decks"
    ON user_decks FOR SELECT
    USING (auth.uid() = user_id);

CREATE POLICY "Users insert own decks"
    ON user_decks FOR INSERT
    WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users update own decks"
    ON user_decks FOR UPDATE
    USING (auth.uid() = user_id);

CREATE POLICY "Users delete own decks"
    ON user_decks FOR DELETE
    USING (auth.uid() = user_id);

-- Shared decks are also readable by anyone (for the community page)
CREATE POLICY "Anyone reads shared decks"
    ON user_decks FOR SELECT
    USING (is_shared = true);
