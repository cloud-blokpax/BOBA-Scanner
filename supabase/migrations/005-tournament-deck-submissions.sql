-- ============================================================
-- BOBA Scanner Tournament Deck Submission System
-- Migration 005
-- ============================================================

-- ── 1. Organizer role on users table ─────────────────────────
ALTER TABLE public.users
    ADD COLUMN IF NOT EXISTS is_organizer BOOLEAN NOT NULL DEFAULT FALSE;

-- ── 2. Enhanced tournaments table ────────────────────────────
ALTER TABLE public.tournaments
    ADD COLUMN IF NOT EXISTS format_id TEXT,
    ADD COLUMN IF NOT EXISTS description TEXT,
    ADD COLUMN IF NOT EXISTS venue TEXT,
    ADD COLUMN IF NOT EXISTS event_date DATE,
    ADD COLUMN IF NOT EXISTS entry_fee TEXT,
    ADD COLUMN IF NOT EXISTS prize_pool TEXT,
    ADD COLUMN IF NOT EXISTS max_players INTEGER,
    ADD COLUMN IF NOT EXISTS submission_deadline TIMESTAMPTZ,
    ADD COLUMN IF NOT EXISTS registration_closed BOOLEAN NOT NULL DEFAULT FALSE,
    ADD COLUMN IF NOT EXISTS deadline_mode TEXT NOT NULL DEFAULT 'manual'
        CHECK (deadline_mode IN ('manual', 'datetime', 'both')),
    ADD COLUMN IF NOT EXISTS results_entered BOOLEAN NOT NULL DEFAULT FALSE,
    ADD COLUMN IF NOT EXISTS results_entered_at TIMESTAMPTZ,
    ADD COLUMN IF NOT EXISTS results_entered_by UUID REFERENCES auth.users(id);

-- ── 3. Deck submissions table ────────────────────────────────
CREATE TABLE IF NOT EXISTS public.deck_submissions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

    tournament_id UUID NOT NULL REFERENCES public.tournaments(id) ON DELETE CASCADE,
    user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,

    player_name TEXT NOT NULL,
    player_email TEXT NOT NULL,
    player_discord TEXT,

    hero_cards JSONB NOT NULL DEFAULT '[]'::jsonb,
    play_entries JSONB NOT NULL DEFAULT '[]'::jsonb,
    hot_dog_count INTEGER NOT NULL DEFAULT 0,
    foil_hot_dog_count INTEGER NOT NULL DEFAULT 0,

    format_id TEXT NOT NULL,
    format_name TEXT NOT NULL,
    is_valid BOOLEAN NOT NULL DEFAULT FALSE,
    validation_violations JSONB DEFAULT '[]'::jsonb,
    validation_warnings JSONB DEFAULT '[]'::jsonb,
    validation_stats JSONB DEFAULT '{}'::jsonb,

    dbs_total INTEGER,
    hero_count INTEGER NOT NULL DEFAULT 0,
    total_power INTEGER NOT NULL DEFAULT 0,
    avg_power NUMERIC(5,1),

    source_deck_id UUID REFERENCES public.user_decks(id) ON DELETE SET NULL,

    status TEXT NOT NULL DEFAULT 'submitted'
        CHECK (status IN ('submitted', 'locked', 'withdrawn')),
    submitted_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    last_updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    locked_at TIMESTAMPTZ,

    verification_code TEXT UNIQUE,

    UNIQUE(tournament_id, user_id)
);

CREATE INDEX IF NOT EXISTS idx_deck_sub_tournament ON public.deck_submissions(tournament_id);
CREATE INDEX IF NOT EXISTS idx_deck_sub_user ON public.deck_submissions(user_id);
CREATE INDEX IF NOT EXISTS idx_deck_sub_verification ON public.deck_submissions(verification_code);
CREATE INDEX IF NOT EXISTS idx_deck_sub_format ON public.deck_submissions(format_id);

-- ── 4. Tournament results table ──────────────────────────────
CREATE TABLE IF NOT EXISTS public.tournament_results (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tournament_id UUID NOT NULL REFERENCES public.tournaments(id) ON DELETE CASCADE,

    submission_id UUID REFERENCES public.deck_submissions(id) ON DELETE SET NULL,

    player_name TEXT NOT NULL,
    player_user_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,

    final_standing INTEGER NOT NULL,
    placement_label TEXT,

    match_wins INTEGER,
    match_losses INTEGER,
    match_draws INTEGER,

    entered_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    entered_by UUID NOT NULL REFERENCES auth.users(id),

    UNIQUE(tournament_id, final_standing)
);

CREATE INDEX IF NOT EXISTS idx_results_tournament ON public.tournament_results(tournament_id);
CREATE INDEX IF NOT EXISTS idx_results_submission ON public.tournament_results(submission_id);

-- ── 5. RLS Policies ──────────────────────────────────────────

ALTER TABLE public.deck_submissions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.tournament_results ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own submissions"
    ON public.deck_submissions FOR SELECT
    USING (auth.uid() = user_id);

CREATE POLICY "Organizers can view tournament submissions"
    ON public.deck_submissions FOR SELECT
    USING (
        EXISTS (
            SELECT 1 FROM public.tournaments t
            WHERE t.id = deck_submissions.tournament_id
            AND t.creator_id = auth.uid()
        )
    );

CREATE POLICY "Admins can view all submissions"
    ON public.deck_submissions FOR SELECT
    USING (
        EXISTS (
            SELECT 1 FROM public.users
            WHERE users.auth_user_id = auth.uid()
            AND (users.is_admin = true OR users.is_organizer = true)
        )
    );

CREATE POLICY "Users can insert own submissions"
    ON public.deck_submissions FOR INSERT
    WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update own submissions"
    ON public.deck_submissions FOR UPDATE
    USING (auth.uid() = user_id);

CREATE POLICY "Anyone can view results"
    ON public.tournament_results FOR SELECT
    USING (true);

CREATE POLICY "Organizers can insert results"
    ON public.tournament_results FOR INSERT
    WITH CHECK (
        EXISTS (
            SELECT 1 FROM public.users
            WHERE users.auth_user_id = auth.uid()
            AND (users.is_admin = true OR users.is_organizer = true)
        )
    );

CREATE POLICY "Organizers can update results"
    ON public.tournament_results FOR UPDATE
    USING (
        EXISTS (
            SELECT 1 FROM public.users
            WHERE users.auth_user_id = auth.uid()
            AND (users.is_admin = true OR users.is_organizer = true)
        )
    );

CREATE POLICY "Service role full access on deck_submissions"
    ON public.deck_submissions FOR ALL
    USING (auth.role() = 'service_role');

CREATE POLICY "Service role full access on tournament_results"
    ON public.tournament_results FOR ALL
    USING (auth.role() = 'service_role');

-- ── 6. Update tournaments RLS for organizer role ──────────────
DROP POLICY IF EXISTS "tournaments_insert_auth" ON public.tournaments;
CREATE POLICY "tournaments_insert_organizer"
    ON public.tournaments FOR INSERT
    WITH CHECK (
        EXISTS (
            SELECT 1 FROM public.users
            WHERE users.auth_user_id = auth.uid()
            AND (users.is_admin = true OR users.is_organizer = true)
        )
    );

DROP POLICY IF EXISTS "tournaments_update_auth" ON public.tournaments;
CREATE POLICY "tournaments_update_organizer"
    ON public.tournaments FOR UPDATE
    USING (
        creator_id = auth.uid()
        OR EXISTS (
            SELECT 1 FROM public.users
            WHERE users.auth_user_id = auth.uid()
            AND users.is_admin = true
        )
    );

-- ── 7. QR verification: public read for the verification page ──
CREATE POLICY "Anyone can verify by code"
    ON public.deck_submissions FOR SELECT
    USING (verification_code IS NOT NULL);
