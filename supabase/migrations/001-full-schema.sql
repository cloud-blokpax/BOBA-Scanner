-- ============================================================================
-- BOBA Scanner — Canonical Database Schema
-- ============================================================================
-- Single-file, idempotent schema definition for the BOBA Scanner application.
-- Safe to re-run: uses IF NOT EXISTS, OR REPLACE, DROP...IF EXISTS throughout.
--
-- Run in the Supabase SQL Editor for fresh database setup.
-- ============================================================================


-- ============================================================================
-- EXTENSIONS
-- ============================================================================

CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "pg_trgm";


-- ============================================================================
-- TABLES (dependency order)
-- ============================================================================


-- ----------------------------------------------------------------------------
-- users
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.users (
    id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    auth_user_id    UUID UNIQUE REFERENCES auth.users(id) ON DELETE CASCADE,
    google_id       TEXT UNIQUE,
    email           TEXT NOT NULL,
    name            TEXT,
    picture         TEXT,
    discord_id      TEXT,
    card_limit      INT NOT NULL DEFAULT 500,
    api_calls_limit INT NOT NULL DEFAULT 50,
    api_calls_used  INT NOT NULL DEFAULT 0,
    cards_in_collection INT NOT NULL DEFAULT 0,
    is_admin        BOOLEAN NOT NULL DEFAULT FALSE,
    is_member       BOOLEAN NOT NULL DEFAULT FALSE,
    member_until    TIMESTAMPTZ,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_users_auth_user_id ON public.users(auth_user_id);
CREATE INDEX IF NOT EXISTS idx_users_email ON public.users(email);


-- ----------------------------------------------------------------------------
-- system_settings
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.system_settings (
    key   TEXT PRIMARY KEY,
    value TEXT NOT NULL
);

-- Seed data
INSERT INTO public.system_settings (key, value)
VALUES
    ('maintenance_mode', 'false'),
    ('max_daily_scans', '100'),
    ('app_version', '1.0.0')
ON CONFLICT (key) DO NOTHING;


-- ----------------------------------------------------------------------------
-- api_call_logs
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.api_call_logs (
    id            UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id       UUID,
    call_type     TEXT NOT NULL,
    error_message TEXT,
    success       BOOLEAN NOT NULL DEFAULT TRUE,
    created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_api_call_logs_user ON public.api_call_logs(user_id);
CREATE INDEX IF NOT EXISTS idx_api_call_logs_created ON public.api_call_logs(created_at);


-- ----------------------------------------------------------------------------
-- feature_flags
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.feature_flags (
    feature_key               TEXT PRIMARY KEY,
    display_name              TEXT NOT NULL,
    description               TEXT,
    enabled_globally          BOOLEAN NOT NULL DEFAULT FALSE,
    enabled_for_guest         BOOLEAN NOT NULL DEFAULT FALSE,
    enabled_for_authenticated BOOLEAN NOT NULL DEFAULT FALSE,
    enabled_for_member        BOOLEAN NOT NULL DEFAULT FALSE,
    enabled_for_admin         BOOLEAN NOT NULL DEFAULT TRUE,
    updated_at                TIMESTAMPTZ NOT NULL DEFAULT NOW()
);


-- ----------------------------------------------------------------------------
-- user_feature_overrides
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.user_feature_overrides (
    user_id     UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    feature_key TEXT NOT NULL REFERENCES public.feature_flags(feature_key) ON DELETE CASCADE,
    enabled     BOOLEAN NOT NULL DEFAULT TRUE,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (user_id, feature_key)
);


-- ----------------------------------------------------------------------------
-- themes
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.themes (
    id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    name        TEXT NOT NULL,
    description TEXT,
    config      JSONB NOT NULL DEFAULT '{}',
    is_public   BOOLEAN NOT NULL DEFAULT FALSE,
    created_by  UUID REFERENCES auth.users(id) ON DELETE SET NULL,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);


-- ----------------------------------------------------------------------------
-- tournaments
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.tournaments (
    id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    creator_id      UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    code            TEXT NOT NULL UNIQUE,
    name            TEXT NOT NULL,
    max_heroes      INT NOT NULL DEFAULT 60,
    max_plays       INT NOT NULL DEFAULT 30,
    max_bonus       INT NOT NULL DEFAULT 25,
    usage_count     INT NOT NULL DEFAULT 0,
    is_active       BOOLEAN NOT NULL DEFAULT TRUE,
    require_email   BOOLEAN NOT NULL DEFAULT FALSE,
    require_name    BOOLEAN NOT NULL DEFAULT FALSE,
    require_discord BOOLEAN NOT NULL DEFAULT FALSE,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_tournaments_code ON public.tournaments(code);
CREATE INDEX IF NOT EXISTS idx_tournaments_creator ON public.tournaments(creator_id);


-- ----------------------------------------------------------------------------
-- tournament_registrations
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.tournament_registrations (
    id            UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    tournament_id UUID NOT NULL REFERENCES public.tournaments(id) ON DELETE CASCADE,
    user_id       UUID REFERENCES auth.users(id) ON DELETE SET NULL,
    email         TEXT NOT NULL,
    name          TEXT,
    discord_id    TEXT,
    deck_csv      TEXT,
    created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_tournament_reg_tournament ON public.tournament_registrations(tournament_id);
CREATE INDEX IF NOT EXISTS idx_tournament_reg_user ON public.tournament_registrations(user_id);


-- ----------------------------------------------------------------------------
-- admin_templates
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.admin_templates (
    id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    name        TEXT NOT NULL,
    description TEXT,
    content     JSONB NOT NULL DEFAULT '{}',
    created_by  UUID REFERENCES auth.users(id) ON DELETE SET NULL,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);


-- ----------------------------------------------------------------------------
-- user_admin_template_assignments
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.user_admin_template_assignments (
    id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id     UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    template_id UUID NOT NULL REFERENCES public.admin_templates(id) ON DELETE CASCADE,
    assigned_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
    assigned_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (user_id, template_id)
);


-- ----------------------------------------------------------------------------
-- system_stats
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.system_stats (
    id         UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    stat_key   TEXT NOT NULL,
    stat_value JSONB NOT NULL DEFAULT '{}',
    recorded_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_system_stats_key ON public.system_stats(stat_key);


-- ----------------------------------------------------------------------------
-- admin_actions
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.admin_actions (
    id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    admin_id    UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    action_type TEXT NOT NULL,
    target_id   UUID,
    details     JSONB,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_admin_actions_admin ON public.admin_actions(admin_id);
CREATE INDEX IF NOT EXISTS idx_admin_actions_created ON public.admin_actions(created_at);


-- ----------------------------------------------------------------------------
-- cards
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.cards (
    id              TEXT PRIMARY KEY,
    card_id_legacy  TEXT,
    name            TEXT NOT NULL,
    hero_name       TEXT,
    athlete_name    TEXT,
    set_code        TEXT NOT NULL,
    card_number     TEXT,
    power           INT,
    rarity          TEXT,
    weapon_type     TEXT,
    battle_zone     TEXT,
    image_url       TEXT,
    year            INT,
    parallel        TEXT,
    search_vector   TSVECTOR,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_cards_set_code ON public.cards(set_code);
CREATE INDEX IF NOT EXISTS idx_cards_card_number ON public.cards(card_number);
CREATE INDEX IF NOT EXISTS idx_cards_name ON public.cards(name);
CREATE INDEX IF NOT EXISTS idx_cards_hero_name ON public.cards(hero_name);
CREATE INDEX IF NOT EXISTS idx_cards_search_vector ON public.cards USING GIN(search_vector);
CREATE INDEX IF NOT EXISTS idx_cards_updated_at ON public.cards(updated_at);


-- ----------------------------------------------------------------------------
-- collections (formerly collections_v2 — per-card rows, not JSONB)
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.collections (
    id        UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id   UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    card_id   TEXT NOT NULL REFERENCES public.cards(id) ON DELETE CASCADE,
    quantity  INT NOT NULL DEFAULT 1,
    condition TEXT NOT NULL DEFAULT 'near_mint',
    notes     TEXT,
    added_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_collections_user ON public.collections(user_id);
CREATE INDEX IF NOT EXISTS idx_collections_card ON public.collections(card_id);
CREATE UNIQUE INDEX IF NOT EXISTS idx_collections_user_card_condition
    ON public.collections(user_id, card_id, condition);


-- ----------------------------------------------------------------------------
-- scans
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.scans (
    id             UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id        UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    card_id        TEXT,
    image_path     TEXT,
    scan_method    TEXT NOT NULL DEFAULT 'claude',
    confidence     REAL,
    processing_ms  INT,
    created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_scans_user ON public.scans(user_id);
CREATE INDEX IF NOT EXISTS idx_scans_created ON public.scans(created_at);


-- ----------------------------------------------------------------------------
-- price_cache
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.price_cache (
    card_id        TEXT NOT NULL,
    source         TEXT NOT NULL DEFAULT 'ebay',
    price_low      NUMERIC(10,2),
    price_mid      NUMERIC(10,2),
    price_high     NUMERIC(10,2),
    listings_count INT,
    fetched_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (card_id, source)
);

CREATE INDEX IF NOT EXISTS idx_price_cache_fetched ON public.price_cache(fetched_at);


-- ----------------------------------------------------------------------------
-- hash_cache
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.hash_cache (
    phash       TEXT PRIMARY KEY,
    card_id     TEXT NOT NULL,
    confidence  REAL NOT NULL DEFAULT 0.9,
    scan_count  INT NOT NULL DEFAULT 1,
    last_seen   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    phash_256   TEXT
);

CREATE INDEX IF NOT EXISTS idx_hash_cache_card ON public.hash_cache(card_id);
CREATE INDEX IF NOT EXISTS idx_hash_cache_phash_256 ON public.hash_cache(phash_256);


-- ----------------------------------------------------------------------------
-- scan_metrics
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.scan_metrics (
    id             UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    scan_method    TEXT NOT NULL,
    processing_ms  INT NOT NULL,
    confidence     REAL,
    cache_hit      BOOLEAN NOT NULL DEFAULT FALSE,
    created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_scan_metrics_method ON public.scan_metrics(scan_method);
CREATE INDEX IF NOT EXISTS idx_scan_metrics_created ON public.scan_metrics(created_at);


-- ----------------------------------------------------------------------------
-- parallel_rarity_config
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.parallel_rarity_config (
    id            UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    parallel_name TEXT NOT NULL UNIQUE,
    rarity        TEXT NOT NULL DEFAULT 'common',
    sort_order    INT NOT NULL DEFAULT 0,
    updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_by    UUID REFERENCES auth.users(id) ON DELETE SET NULL
);


-- ----------------------------------------------------------------------------
-- price_history
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.price_history (
    id             UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    card_id        TEXT NOT NULL,
    source         TEXT NOT NULL DEFAULT 'ebay',
    price_low      NUMERIC(10,2),
    price_mid      NUMERIC(10,2),
    price_high     NUMERIC(10,2),
    listings_count INT,
    recorded_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_price_history_card ON public.price_history(card_id);
CREATE INDEX IF NOT EXISTS idx_price_history_recorded ON public.price_history(recorded_at);


-- ----------------------------------------------------------------------------
-- ebay_seller_tokens
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.ebay_seller_tokens (
    user_id                  UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
    access_token             TEXT NOT NULL,
    access_token_expires_at  TIMESTAMPTZ NOT NULL,
    refresh_token            TEXT NOT NULL,
    refresh_token_expires_at TIMESTAMPTZ NOT NULL,
    scopes                   TEXT,
    created_at               TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at               TIMESTAMPTZ NOT NULL DEFAULT NOW()
);


-- ----------------------------------------------------------------------------
-- listing_templates
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.listing_templates (
    id               UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id          UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    card_id          TEXT NOT NULL,
    title            TEXT NOT NULL,
    description      TEXT,
    price            NUMERIC(10,2) NOT NULL,
    condition        TEXT,
    sku              TEXT NOT NULL,
    status           TEXT NOT NULL DEFAULT 'draft',
    ebay_listing_id  TEXT,
    ebay_listing_url TEXT,
    error_message    TEXT,
    created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at       TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_listing_templates_user ON public.listing_templates(user_id);
CREATE INDEX IF NOT EXISTS idx_listing_templates_status ON public.listing_templates(status);


-- ----------------------------------------------------------------------------
-- app_config
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.app_config (
    key         TEXT PRIMARY KEY,
    value       JSONB NOT NULL DEFAULT '{}',
    description TEXT,
    updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);


-- ----------------------------------------------------------------------------
-- deck_shop_refresh_log
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.deck_shop_refresh_log (
    id         UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id    UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    card_count INT NOT NULL DEFAULT 0,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_deck_shop_refresh_user ON public.deck_shop_refresh_log(user_id);


-- ----------------------------------------------------------------------------
-- user_decks
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.user_decks (
    id                 UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id            UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    name               TEXT NOT NULL DEFAULT 'Untitled Deck',
    format_id          TEXT NOT NULL DEFAULT 'spec-playmaker',
    is_custom_format   BOOLEAN NOT NULL DEFAULT FALSE,
    notes              TEXT,
    hero_deck_min      INT NOT NULL DEFAULT 60,
    hero_deck_max      INT,
    play_deck_size     INT NOT NULL DEFAULT 30,
    bonus_plays_max    INT NOT NULL DEFAULT 25,
    hot_dog_deck_size  INT NOT NULL DEFAULT 10,
    dbs_cap            INT NOT NULL DEFAULT 1000,
    spec_power_cap     INT,
    combined_power_cap INT,
    hero_card_ids      TEXT[] NOT NULL DEFAULT '{}',
    play_entries       JSONB NOT NULL DEFAULT '[]',
    hot_dog_count      INT NOT NULL DEFAULT 0,
    is_shared          BOOLEAN NOT NULL DEFAULT FALSE,
    created_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    last_edited_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_user_decks_user ON public.user_decks(user_id);
CREATE INDEX IF NOT EXISTS idx_user_decks_shared ON public.user_decks(is_shared) WHERE is_shared = TRUE;


-- ----------------------------------------------------------------------------
-- shared_decks (read-only view of shared user_decks with view tracking)
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.shared_decks (
    id             UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id        UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    name           TEXT NOT NULL,
    format_id      TEXT NOT NULL,
    hero_card_ids  TEXT[] NOT NULL DEFAULT '{}',
    play_entries   JSONB NOT NULL DEFAULT '[]',
    view_count     INT NOT NULL DEFAULT 0,
    created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_shared_decks_user ON public.shared_decks(user_id);


-- ----------------------------------------------------------------------------
-- community_corrections
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.community_corrections (
    id                  UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    ocr_reading         TEXT NOT NULL,
    correct_card_number TEXT NOT NULL,
    confirmation_count  INT NOT NULL DEFAULT 1,
    created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (ocr_reading, correct_card_number)
);

CREATE INDEX IF NOT EXISTS idx_community_corrections_ocr ON public.community_corrections(ocr_reading);


-- ----------------------------------------------------------------------------
-- card_reference_images
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.card_reference_images (
    card_id        TEXT PRIMARY KEY,
    image_path     TEXT NOT NULL,
    phash          TEXT,
    phash_256      TEXT,
    confidence     REAL NOT NULL DEFAULT 0,
    contributed_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
    created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);


-- ----------------------------------------------------------------------------
-- user_badges
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.user_badges (
    id         UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id    UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    badge_key  TEXT NOT NULL,
    badge_name TEXT,
    description TEXT,
    icon       TEXT,
    awarded_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (user_id, badge_key)
);

CREATE INDEX IF NOT EXISTS idx_user_badges_user ON public.user_badges(user_id);


-- ============================================================================
-- FUNCTIONS & TRIGGERS
-- ============================================================================


-- ----------------------------------------------------------------------------
-- update_updated_at_column() — generic trigger function
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Trigger on cards
DROP TRIGGER IF EXISTS trigger_cards_updated_at ON public.cards;
CREATE TRIGGER trigger_cards_updated_at
    BEFORE UPDATE ON public.cards
    FOR EACH ROW
    EXECUTE FUNCTION public.update_updated_at_column();


-- ----------------------------------------------------------------------------
-- find_similar_hash(query_hash TEXT, max_distance INT)
-- Finds perceptual hashes within a given Hamming distance.
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.find_similar_hash(
    query_hash TEXT,
    max_distance INT DEFAULT 5
)
RETURNS TABLE (
    phash      TEXT,
    card_id    TEXT,
    confidence REAL,
    scan_count INT,
    distance   INT
) AS $$
BEGIN
    RETURN QUERY
    SELECT
        h.phash,
        h.card_id,
        h.confidence,
        h.scan_count,
        bit_count(('x' || h.phash)::BIT(64) # ('x' || query_hash)::BIT(64))::INT AS distance
    FROM public.hash_cache h
    WHERE bit_count(('x' || h.phash)::BIT(64) # ('x' || query_hash)::BIT(64))::INT <= max_distance
    ORDER BY distance ASC
    LIMIT 5;
END;
$$ LANGUAGE plpgsql STABLE;


-- ----------------------------------------------------------------------------
-- upsert_hash_cache(p_phash, p_card_id, p_confidence, p_phash_256)
-- Atomically inserts or updates a hash cache entry, incrementing scan_count.
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.upsert_hash_cache(
    p_phash      TEXT,
    p_card_id    TEXT,
    p_confidence REAL DEFAULT 0.9,
    p_phash_256  TEXT DEFAULT NULL
)
RETURNS VOID AS $$
BEGIN
    INSERT INTO public.hash_cache (phash, card_id, confidence, scan_count, last_seen, phash_256)
    VALUES (p_phash, p_card_id, p_confidence, 1, NOW(), p_phash_256)
    ON CONFLICT (phash) DO UPDATE SET
        card_id    = EXCLUDED.card_id,
        confidence = GREATEST(hash_cache.confidence, EXCLUDED.confidence),
        scan_count = hash_cache.scan_count + 1,
        last_seen  = NOW(),
        phash_256  = COALESCE(EXCLUDED.phash_256, hash_cache.phash_256);
END;
$$ LANGUAGE plpgsql;


-- ----------------------------------------------------------------------------
-- submit_correction(p_ocr_reading, p_correct_card_number)
-- Community OCR correction: inserts or increments confirmation_count.
-- SECURITY DEFINER so RLS doesn't block the upsert.
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.submit_correction(
    p_ocr_reading         TEXT,
    p_correct_card_number TEXT
)
RETURNS VOID AS $$
BEGIN
    INSERT INTO public.community_corrections (ocr_reading, correct_card_number, confirmation_count)
    VALUES (p_ocr_reading, p_correct_card_number, 1)
    ON CONFLICT (ocr_reading, correct_card_number) DO UPDATE SET
        confirmation_count = community_corrections.confirmation_count + 1,
        updated_at = NOW();
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;


-- ----------------------------------------------------------------------------
-- lookup_correction(p_ocr_reading)
-- Returns the most-confirmed correction for a given OCR reading (min 3).
-- SECURITY DEFINER so RLS doesn't block the lookup.
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.lookup_correction(
    p_ocr_reading TEXT
)
RETURNS TABLE (
    correct_card_number TEXT,
    confirmation_count  INT
) AS $$
BEGIN
    RETURN QUERY
    SELECT
        cc.correct_card_number,
        cc.confirmation_count
    FROM public.community_corrections cc
    WHERE cc.ocr_reading = p_ocr_reading
      AND cc.confirmation_count >= 3
    ORDER BY cc.confirmation_count DESC
    LIMIT 1;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER STABLE;


-- ----------------------------------------------------------------------------
-- increment_tournament_usage(tid UUID)
-- Atomically increments the usage_count on a tournament.
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.increment_tournament_usage(tid UUID)
RETURNS VOID AS $$
BEGIN
    UPDATE public.tournaments
    SET usage_count = usage_count + 1
    WHERE id = tid;
END;
$$ LANGUAGE plpgsql;


-- ----------------------------------------------------------------------------
-- award_badge_if_new(p_user_id, p_badge_key, p_badge_name, p_description, p_icon)
-- Inserts a badge if the user doesn't already have it. Returns TRUE if awarded.
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.award_badge_if_new(
    p_user_id    UUID,
    p_badge_key  TEXT,
    p_badge_name TEXT DEFAULT NULL,
    p_description TEXT DEFAULT NULL,
    p_icon       TEXT DEFAULT NULL
)
RETURNS BOOLEAN AS $$
DECLARE
    v_inserted BOOLEAN;
BEGIN
    INSERT INTO public.user_badges (user_id, badge_key, badge_name, description, icon)
    VALUES (p_user_id, p_badge_key, p_badge_name, p_description, p_icon)
    ON CONFLICT (user_id, badge_key) DO NOTHING;

    GET DIAGNOSTICS v_inserted = ROW_COUNT;
    RETURN v_inserted > 0;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;


-- ============================================================================
-- ROW LEVEL SECURITY
-- ============================================================================

-- Enable RLS on all tables
ALTER TABLE public.users ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.system_settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.api_call_logs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.feature_flags ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.user_feature_overrides ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.themes ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.tournaments ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.tournament_registrations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.admin_templates ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.user_admin_template_assignments ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.system_stats ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.admin_actions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.cards ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.collections ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.scans ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.price_cache ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.hash_cache ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.scan_metrics ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.parallel_rarity_config ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.price_history ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ebay_seller_tokens ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.listing_templates ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.app_config ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.deck_shop_refresh_log ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.user_decks ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.shared_decks ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.community_corrections ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.card_reference_images ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.user_badges ENABLE ROW LEVEL SECURITY;


-- ============================================================================
-- RLS POLICIES
-- ============================================================================

-- Helper: drop policy if exists (idempotent wrapper)
-- Postgres doesn't support IF NOT EXISTS for policies, so we drop first.


-- ----------------------------------------------------------------------------
-- users: SELECT own row + service_role ALL
-- ----------------------------------------------------------------------------
DROP POLICY IF EXISTS "users_select_own" ON public.users;
CREATE POLICY "users_select_own" ON public.users
    FOR SELECT TO authenticated
    USING (auth_user_id = (SELECT auth.uid()));

DROP POLICY IF EXISTS "users_service_all" ON public.users;
CREATE POLICY "users_service_all" ON public.users
    FOR ALL TO service_role
    USING (true) WITH CHECK (true);


-- ----------------------------------------------------------------------------
-- cards: SELECT for anon + authenticated, ALL for service_role
-- ----------------------------------------------------------------------------
DROP POLICY IF EXISTS "cards_select_anon" ON public.cards;
CREATE POLICY "cards_select_anon" ON public.cards
    FOR SELECT TO anon
    USING (true);

DROP POLICY IF EXISTS "cards_select_auth" ON public.cards;
CREATE POLICY "cards_select_auth" ON public.cards
    FOR SELECT TO authenticated
    USING (true);

DROP POLICY IF EXISTS "cards_service_all" ON public.cards;
CREATE POLICY "cards_service_all" ON public.cards
    FOR ALL TO service_role
    USING (true) WITH CHECK (true);


-- ----------------------------------------------------------------------------
-- collections: ALL for authenticated where auth.uid() = user_id
-- ----------------------------------------------------------------------------
DROP POLICY IF EXISTS "collections_auth_all" ON public.collections;
CREATE POLICY "collections_auth_all" ON public.collections
    FOR ALL TO authenticated
    USING (user_id = (SELECT auth.uid()))
    WITH CHECK (user_id = (SELECT auth.uid()));


-- ----------------------------------------------------------------------------
-- scans: ALL for authenticated where auth.uid() = user_id
-- ----------------------------------------------------------------------------
DROP POLICY IF EXISTS "scans_auth_all" ON public.scans;
CREATE POLICY "scans_auth_all" ON public.scans
    FOR ALL TO authenticated
    USING (user_id = (SELECT auth.uid()))
    WITH CHECK (user_id = (SELECT auth.uid()));


-- ----------------------------------------------------------------------------
-- price_cache: SELECT for anon+authenticated, ALL for service_role
-- ----------------------------------------------------------------------------
DROP POLICY IF EXISTS "price_cache_select_anon" ON public.price_cache;
CREATE POLICY "price_cache_select_anon" ON public.price_cache
    FOR SELECT TO anon
    USING (true);

DROP POLICY IF EXISTS "price_cache_select_auth" ON public.price_cache;
CREATE POLICY "price_cache_select_auth" ON public.price_cache
    FOR SELECT TO authenticated
    USING (true);

DROP POLICY IF EXISTS "price_cache_service_all" ON public.price_cache;
CREATE POLICY "price_cache_service_all" ON public.price_cache
    FOR ALL TO service_role
    USING (true) WITH CHECK (true);


-- ----------------------------------------------------------------------------
-- hash_cache: SELECT for anon+authenticated, ALL for service_role
-- ----------------------------------------------------------------------------
DROP POLICY IF EXISTS "hash_cache_select_anon" ON public.hash_cache;
CREATE POLICY "hash_cache_select_anon" ON public.hash_cache
    FOR SELECT TO anon
    USING (true);

DROP POLICY IF EXISTS "hash_cache_select_auth" ON public.hash_cache;
CREATE POLICY "hash_cache_select_auth" ON public.hash_cache
    FOR SELECT TO authenticated
    USING (true);

DROP POLICY IF EXISTS "hash_cache_service_all" ON public.hash_cache;
CREATE POLICY "hash_cache_service_all" ON public.hash_cache
    FOR ALL TO service_role
    USING (true) WITH CHECK (true);


-- ----------------------------------------------------------------------------
-- scan_metrics: INSERT for authenticated, ALL for service_role
-- ----------------------------------------------------------------------------
DROP POLICY IF EXISTS "scan_metrics_insert_auth" ON public.scan_metrics;
CREATE POLICY "scan_metrics_insert_auth" ON public.scan_metrics
    FOR INSERT TO authenticated
    WITH CHECK (true);

DROP POLICY IF EXISTS "scan_metrics_service_all" ON public.scan_metrics;
CREATE POLICY "scan_metrics_service_all" ON public.scan_metrics
    FOR ALL TO service_role
    USING (true) WITH CHECK (true);


-- ----------------------------------------------------------------------------
-- parallel_rarity_config: SELECT for all, ALL for authenticated+service_role
-- ----------------------------------------------------------------------------
DROP POLICY IF EXISTS "parallel_rarity_select_anon" ON public.parallel_rarity_config;
CREATE POLICY "parallel_rarity_select_anon" ON public.parallel_rarity_config
    FOR SELECT TO anon
    USING (true);

DROP POLICY IF EXISTS "parallel_rarity_select_auth" ON public.parallel_rarity_config;
CREATE POLICY "parallel_rarity_select_auth" ON public.parallel_rarity_config
    FOR SELECT TO authenticated
    USING (true);

DROP POLICY IF EXISTS "parallel_rarity_all_auth" ON public.parallel_rarity_config;
CREATE POLICY "parallel_rarity_all_auth" ON public.parallel_rarity_config
    FOR ALL TO authenticated
    USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "parallel_rarity_service_all" ON public.parallel_rarity_config;
CREATE POLICY "parallel_rarity_service_all" ON public.parallel_rarity_config
    FOR ALL TO service_role
    USING (true) WITH CHECK (true);


-- ----------------------------------------------------------------------------
-- price_history: SELECT for authenticated, ALL for service_role
-- ----------------------------------------------------------------------------
DROP POLICY IF EXISTS "price_history_select_auth" ON public.price_history;
CREATE POLICY "price_history_select_auth" ON public.price_history
    FOR SELECT TO authenticated
    USING (true);

DROP POLICY IF EXISTS "price_history_service_all" ON public.price_history;
CREATE POLICY "price_history_service_all" ON public.price_history
    FOR ALL TO service_role
    USING (true) WITH CHECK (true);


-- ----------------------------------------------------------------------------
-- ebay_seller_tokens: ALL USING (false) — deny all, service role only
-- ----------------------------------------------------------------------------
DROP POLICY IF EXISTS "ebay_seller_tokens_deny_all" ON public.ebay_seller_tokens;
CREATE POLICY "ebay_seller_tokens_deny_all" ON public.ebay_seller_tokens
    FOR ALL TO authenticated
    USING (false);

DROP POLICY IF EXISTS "ebay_seller_tokens_service_all" ON public.ebay_seller_tokens;
CREATE POLICY "ebay_seller_tokens_service_all" ON public.ebay_seller_tokens
    FOR ALL TO service_role
    USING (true) WITH CHECK (true);


-- ----------------------------------------------------------------------------
-- listing_templates: ALL for authenticated where auth.uid() = user_id
-- ----------------------------------------------------------------------------
DROP POLICY IF EXISTS "listing_templates_auth_all" ON public.listing_templates;
CREATE POLICY "listing_templates_auth_all" ON public.listing_templates
    FOR ALL TO authenticated
    USING (user_id = (SELECT auth.uid()))
    WITH CHECK (user_id = (SELECT auth.uid()));


-- ----------------------------------------------------------------------------
-- app_config: SELECT for all, ALL for service_role
-- ----------------------------------------------------------------------------
DROP POLICY IF EXISTS "app_config_select_anon" ON public.app_config;
CREATE POLICY "app_config_select_anon" ON public.app_config
    FOR SELECT TO anon
    USING (true);

DROP POLICY IF EXISTS "app_config_select_auth" ON public.app_config;
CREATE POLICY "app_config_select_auth" ON public.app_config
    FOR SELECT TO authenticated
    USING (true);

DROP POLICY IF EXISTS "app_config_service_all" ON public.app_config;
CREATE POLICY "app_config_service_all" ON public.app_config
    FOR ALL TO service_role
    USING (true) WITH CHECK (true);


-- ----------------------------------------------------------------------------
-- deck_shop_refresh_log: ALL for authenticated where auth.uid() = user_id
-- ----------------------------------------------------------------------------
DROP POLICY IF EXISTS "deck_shop_refresh_auth_all" ON public.deck_shop_refresh_log;
CREATE POLICY "deck_shop_refresh_auth_all" ON public.deck_shop_refresh_log
    FOR ALL TO authenticated
    USING (user_id = (SELECT auth.uid()))
    WITH CHECK (user_id = (SELECT auth.uid()));


-- ----------------------------------------------------------------------------
-- user_decks: per-operation for auth.uid() = user_id, shared decks readable
-- ----------------------------------------------------------------------------
DROP POLICY IF EXISTS "user_decks_select" ON public.user_decks;
CREATE POLICY "user_decks_select" ON public.user_decks
    FOR SELECT TO authenticated
    USING (
        user_id = (SELECT auth.uid())
        OR is_shared = TRUE
    );

DROP POLICY IF EXISTS "user_decks_insert" ON public.user_decks;
CREATE POLICY "user_decks_insert" ON public.user_decks
    FOR INSERT TO authenticated
    WITH CHECK (user_id = (SELECT auth.uid()));

DROP POLICY IF EXISTS "user_decks_update" ON public.user_decks;
CREATE POLICY "user_decks_update" ON public.user_decks
    FOR UPDATE TO authenticated
    USING (user_id = (SELECT auth.uid()))
    WITH CHECK (user_id = (SELECT auth.uid()));

DROP POLICY IF EXISTS "user_decks_delete" ON public.user_decks;
CREATE POLICY "user_decks_delete" ON public.user_decks
    FOR DELETE TO authenticated
    USING (user_id = (SELECT auth.uid()));

DROP POLICY IF EXISTS "user_decks_service_all" ON public.user_decks;
CREATE POLICY "user_decks_service_all" ON public.user_decks
    FOR ALL TO service_role
    USING (true) WITH CHECK (true);


-- ----------------------------------------------------------------------------
-- shared_decks: SELECT for all (public), ALL for service_role
-- ----------------------------------------------------------------------------
DROP POLICY IF EXISTS "shared_decks_select_anon" ON public.shared_decks;
CREATE POLICY "shared_decks_select_anon" ON public.shared_decks
    FOR SELECT TO anon
    USING (true);

DROP POLICY IF EXISTS "shared_decks_select_auth" ON public.shared_decks;
CREATE POLICY "shared_decks_select_auth" ON public.shared_decks
    FOR SELECT TO authenticated
    USING (true);

DROP POLICY IF EXISTS "shared_decks_service_all" ON public.shared_decks;
CREATE POLICY "shared_decks_service_all" ON public.shared_decks
    FOR ALL TO service_role
    USING (true) WITH CHECK (true);


-- ----------------------------------------------------------------------------
-- community_corrections: SELECT for all, INSERT for authenticated
-- ----------------------------------------------------------------------------
DROP POLICY IF EXISTS "corrections_select_anon" ON public.community_corrections;
CREATE POLICY "corrections_select_anon" ON public.community_corrections
    FOR SELECT TO anon
    USING (true);

DROP POLICY IF EXISTS "corrections_select_auth" ON public.community_corrections;
CREATE POLICY "corrections_select_auth" ON public.community_corrections
    FOR SELECT TO authenticated
    USING (true);

DROP POLICY IF EXISTS "corrections_insert_auth" ON public.community_corrections;
CREATE POLICY "corrections_insert_auth" ON public.community_corrections
    FOR INSERT TO authenticated
    WITH CHECK (true);


-- ----------------------------------------------------------------------------
-- card_reference_images: SELECT for all
-- ----------------------------------------------------------------------------
DROP POLICY IF EXISTS "ref_images_select_anon" ON public.card_reference_images;
CREATE POLICY "ref_images_select_anon" ON public.card_reference_images
    FOR SELECT TO anon
    USING (true);

DROP POLICY IF EXISTS "ref_images_select_auth" ON public.card_reference_images;
CREATE POLICY "ref_images_select_auth" ON public.card_reference_images
    FOR SELECT TO authenticated
    USING (true);

DROP POLICY IF EXISTS "ref_images_service_all" ON public.card_reference_images;
CREATE POLICY "ref_images_service_all" ON public.card_reference_images
    FOR ALL TO service_role
    USING (true) WITH CHECK (true);


-- ----------------------------------------------------------------------------
-- user_badges: SELECT+INSERT for authenticated (own), ALL for service_role
-- ----------------------------------------------------------------------------
DROP POLICY IF EXISTS "user_badges_select_auth" ON public.user_badges;
CREATE POLICY "user_badges_select_auth" ON public.user_badges
    FOR SELECT TO authenticated
    USING (user_id = (SELECT auth.uid()));

DROP POLICY IF EXISTS "user_badges_insert_auth" ON public.user_badges;
CREATE POLICY "user_badges_insert_auth" ON public.user_badges
    FOR INSERT TO authenticated
    WITH CHECK (user_id = (SELECT auth.uid()));

DROP POLICY IF EXISTS "user_badges_service_all" ON public.user_badges;
CREATE POLICY "user_badges_service_all" ON public.user_badges
    FOR ALL TO service_role
    USING (true) WITH CHECK (true);


-- ----------------------------------------------------------------------------
-- feature_flags: SELECT for authenticated, ALL for service_role
-- ----------------------------------------------------------------------------
DROP POLICY IF EXISTS "feature_flags_select_auth" ON public.feature_flags;
CREATE POLICY "feature_flags_select_auth" ON public.feature_flags
    FOR SELECT TO authenticated
    USING (true);

DROP POLICY IF EXISTS "feature_flags_service_all" ON public.feature_flags;
CREATE POLICY "feature_flags_service_all" ON public.feature_flags
    FOR ALL TO service_role
    USING (true) WITH CHECK (true);


-- ----------------------------------------------------------------------------
-- user_feature_overrides: SELECT own + service_role ALL
-- ----------------------------------------------------------------------------
DROP POLICY IF EXISTS "user_feature_overrides_select" ON public.user_feature_overrides;
CREATE POLICY "user_feature_overrides_select" ON public.user_feature_overrides
    FOR SELECT TO authenticated
    USING (user_id = (SELECT auth.uid()));

DROP POLICY IF EXISTS "user_feature_overrides_service_all" ON public.user_feature_overrides;
CREATE POLICY "user_feature_overrides_service_all" ON public.user_feature_overrides
    FOR ALL TO service_role
    USING (true) WITH CHECK (true);


-- ----------------------------------------------------------------------------
-- tournaments: SELECT for all, INSERT/UPDATE for authenticated, ALL service_role
-- ----------------------------------------------------------------------------
DROP POLICY IF EXISTS "tournaments_select_anon" ON public.tournaments;
CREATE POLICY "tournaments_select_anon" ON public.tournaments
    FOR SELECT TO anon
    USING (true);

DROP POLICY IF EXISTS "tournaments_select_auth" ON public.tournaments;
CREATE POLICY "tournaments_select_auth" ON public.tournaments
    FOR SELECT TO authenticated
    USING (true);

DROP POLICY IF EXISTS "tournaments_insert_auth" ON public.tournaments;
CREATE POLICY "tournaments_insert_auth" ON public.tournaments
    FOR INSERT TO authenticated
    WITH CHECK (true);

DROP POLICY IF EXISTS "tournaments_update_auth" ON public.tournaments;
CREATE POLICY "tournaments_update_auth" ON public.tournaments
    FOR UPDATE TO authenticated
    USING (true);

DROP POLICY IF EXISTS "tournaments_service_all" ON public.tournaments;
CREATE POLICY "tournaments_service_all" ON public.tournaments
    FOR ALL TO service_role
    USING (true) WITH CHECK (true);


-- ----------------------------------------------------------------------------
-- tournament_registrations: service_role only (app handles access)
-- ----------------------------------------------------------------------------
DROP POLICY IF EXISTS "tournament_reg_service_all" ON public.tournament_registrations;
CREATE POLICY "tournament_reg_service_all" ON public.tournament_registrations
    FOR ALL TO service_role
    USING (true) WITH CHECK (true);


-- ----------------------------------------------------------------------------
-- system_settings: service_role only
-- ----------------------------------------------------------------------------
DROP POLICY IF EXISTS "system_settings_service_all" ON public.system_settings;
CREATE POLICY "system_settings_service_all" ON public.system_settings
    FOR ALL TO service_role
    USING (true) WITH CHECK (true);


-- ----------------------------------------------------------------------------
-- api_call_logs: service_role only
-- ----------------------------------------------------------------------------
DROP POLICY IF EXISTS "api_call_logs_service_all" ON public.api_call_logs;
CREATE POLICY "api_call_logs_service_all" ON public.api_call_logs
    FOR ALL TO service_role
    USING (true) WITH CHECK (true);


-- ----------------------------------------------------------------------------
-- themes: service_role only (admin-managed)
-- ----------------------------------------------------------------------------
DROP POLICY IF EXISTS "themes_service_all" ON public.themes;
CREATE POLICY "themes_service_all" ON public.themes
    FOR ALL TO service_role
    USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "themes_select_auth" ON public.themes;
CREATE POLICY "themes_select_auth" ON public.themes
    FOR SELECT TO authenticated
    USING (true);


-- ----------------------------------------------------------------------------
-- admin_templates: service_role only
-- ----------------------------------------------------------------------------
DROP POLICY IF EXISTS "admin_templates_service_all" ON public.admin_templates;
CREATE POLICY "admin_templates_service_all" ON public.admin_templates
    FOR ALL TO service_role
    USING (true) WITH CHECK (true);


-- ----------------------------------------------------------------------------
-- user_admin_template_assignments: service_role only
-- ----------------------------------------------------------------------------
DROP POLICY IF EXISTS "admin_template_assign_service_all" ON public.user_admin_template_assignments;
CREATE POLICY "admin_template_assign_service_all" ON public.user_admin_template_assignments
    FOR ALL TO service_role
    USING (true) WITH CHECK (true);


-- ----------------------------------------------------------------------------
-- system_stats: service_role only
-- ----------------------------------------------------------------------------
DROP POLICY IF EXISTS "system_stats_service_all" ON public.system_stats;
CREATE POLICY "system_stats_service_all" ON public.system_stats
    FOR ALL TO service_role
    USING (true) WITH CHECK (true);


-- ----------------------------------------------------------------------------
-- admin_actions: service_role only
-- ----------------------------------------------------------------------------
DROP POLICY IF EXISTS "admin_actions_service_all" ON public.admin_actions;
CREATE POLICY "admin_actions_service_all" ON public.admin_actions
    FOR ALL TO service_role
    USING (true) WITH CHECK (true);


-- ============================================================================
-- END OF SCHEMA
-- ============================================================================
