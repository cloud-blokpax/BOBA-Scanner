-- ============================================================================
-- CHECK Constraints — Database-level data invariants
-- ============================================================================
-- These constraints are the deepest safety net. They cannot be bypassed by
-- any application code, including service role access. They ensure that even
-- if a bug makes it past all validation layers, the database rejects the
-- invalid data rather than silently storing it.
-- ============================================================================


-- ── users ────────────────────────────────────────────────────
-- Email must be non-empty and contain @
ALTER TABLE public.users
    ADD CONSTRAINT chk_users_email_format
    CHECK (email ~* '^[^@\s]+@[^@\s]+\.[^@\s]+$');

-- Card limit must be positive
ALTER TABLE public.users
    ADD CONSTRAINT chk_users_card_limit_positive
    CHECK (card_limit > 0);

-- API call counters must be non-negative
ALTER TABLE public.users
    ADD CONSTRAINT chk_users_api_calls_nonneg
    CHECK (api_calls_used >= 0 AND api_calls_limit >= 0);

-- Collection count must be non-negative
ALTER TABLE public.users
    ADD CONSTRAINT chk_users_collection_count_nonneg
    CHECK (cards_in_collection >= 0);


-- ── collections ──────────────────────────────────────────────
-- Quantity must be at least 1 (delete the row instead of setting 0)
ALTER TABLE public.collections
    ADD CONSTRAINT chk_collections_quantity_positive
    CHECK (quantity >= 1);

-- Condition must be a known value
ALTER TABLE public.collections
    ADD CONSTRAINT chk_collections_condition_valid
    CHECK (condition IN ('mint', 'near_mint', 'excellent', 'good', 'fair', 'poor'));


-- ── cards ────────────────────────────────────────────────────
-- Power must be in the valid BoBA range (NULL is allowed for Play/Hot Dog cards)
ALTER TABLE public.cards
    ADD CONSTRAINT chk_cards_power_range
    CHECK (power IS NULL OR (power >= 0 AND power <= 300));

-- Set code must be non-empty
ALTER TABLE public.cards
    ADD CONSTRAINT chk_cards_set_code_nonempty
    CHECK (set_code <> '');

-- Name must be non-empty
ALTER TABLE public.cards
    ADD CONSTRAINT chk_cards_name_nonempty
    CHECK (name <> '');


-- ── hash_cache ───────────────────────────────────────────────
-- Confidence must be 0–1 range
ALTER TABLE public.hash_cache
    ADD CONSTRAINT chk_hash_cache_confidence_range
    CHECK (confidence >= 0.0 AND confidence <= 1.0);

-- Scan count must be positive
ALTER TABLE public.hash_cache
    ADD CONSTRAINT chk_hash_cache_scan_count_positive
    CHECK (scan_count >= 1);

-- Hash must be non-empty
ALTER TABLE public.hash_cache
    ADD CONSTRAINT chk_hash_cache_phash_nonempty
    CHECK (phash <> '');

-- Card ID must be non-empty
ALTER TABLE public.hash_cache
    ADD CONSTRAINT chk_hash_cache_card_id_nonempty
    CHECK (card_id <> '');


-- ── price_cache ──────────────────────────────────────────────
-- Prices must be non-negative when present
ALTER TABLE public.price_cache
    ADD CONSTRAINT chk_price_cache_prices_nonneg
    CHECK (
        (price_low IS NULL OR price_low >= 0) AND
        (price_mid IS NULL OR price_mid >= 0) AND
        (price_high IS NULL OR price_high >= 0)
    );

-- Low <= mid <= high when all present
ALTER TABLE public.price_cache
    ADD CONSTRAINT chk_price_cache_price_ordering
    CHECK (
        price_low IS NULL OR price_mid IS NULL OR price_high IS NULL
        OR (price_low <= price_mid AND price_mid <= price_high)
    );

-- Listings count must be non-negative
ALTER TABLE public.price_cache
    ADD CONSTRAINT chk_price_cache_listings_nonneg
    CHECK (listings_count IS NULL OR listings_count >= 0);


-- ── price_history ────────────────────────────────────────────
ALTER TABLE public.price_history
    ADD CONSTRAINT chk_price_history_prices_nonneg
    CHECK (
        (price_low IS NULL OR price_low >= 0) AND
        (price_mid IS NULL OR price_mid >= 0) AND
        (price_high IS NULL OR price_high >= 0)
    );


-- ── scans ────────────────────────────────────────────────────
-- Confidence must be 0–1
ALTER TABLE public.scans
    ADD CONSTRAINT chk_scans_confidence_range
    CHECK (confidence IS NULL OR (confidence >= 0.0 AND confidence <= 1.0));

-- Processing time must be non-negative
ALTER TABLE public.scans
    ADD CONSTRAINT chk_scans_processing_nonneg
    CHECK (processing_ms IS NULL OR processing_ms >= 0);

-- Scan method must be known
ALTER TABLE public.scans
    ADD CONSTRAINT chk_scans_method_valid
    CHECK (scan_method IN ('hash_cache', 'tesseract', 'claude', 'manual'));


-- ── tournaments ──────────────────────────────────────────────
-- Deck size limits must be positive
ALTER TABLE public.tournaments
    ADD CONSTRAINT chk_tournaments_sizes_positive
    CHECK (max_heroes > 0 AND max_plays > 0 AND max_bonus >= 0);

-- Usage count must be non-negative
ALTER TABLE public.tournaments
    ADD CONSTRAINT chk_tournaments_usage_nonneg
    CHECK (usage_count >= 0);


-- ── listing_templates ────────────────────────────────────────
-- Price must be positive
ALTER TABLE public.listing_templates
    ADD CONSTRAINT chk_listing_price_positive
    CHECK (price > 0);

-- Status must be known
ALTER TABLE public.listing_templates
    ADD CONSTRAINT chk_listing_status_valid
    CHECK (status IN ('draft', 'pending', 'published', 'error'));


-- ── card_reference_images ────────────────────────────────────
-- Confidence must be 0–1
ALTER TABLE public.card_reference_images
    ADD CONSTRAINT chk_ref_image_confidence_range
    CHECK (confidence >= 0.0 AND confidence <= 1.0);


-- ── community_corrections ────────────────────────────────────
-- Confirmation count must be positive
ALTER TABLE public.community_corrections
    ADD CONSTRAINT chk_corrections_count_positive
    CHECK (confirmation_count >= 1);


-- ── user_decks ───────────────────────────────────────────────
-- Deck size limits must be positive
ALTER TABLE public.user_decks
    ADD CONSTRAINT chk_user_decks_sizes_positive
    CHECK (hero_deck_min > 0 AND play_deck_size > 0 AND hot_dog_deck_size >= 0);

-- DBS cap must be non-negative
ALTER TABLE public.user_decks
    ADD CONSTRAINT chk_user_decks_dbs_nonneg
    CHECK (dbs_cap >= 0);

-- Hot dog count must be non-negative
ALTER TABLE public.user_decks
    ADD CONSTRAINT chk_user_decks_hotdog_nonneg
    CHECK (hot_dog_count >= 0);


-- ── deck_shop_refresh_log ────────────────────────────────────
-- Card count must be 1–10
ALTER TABLE public.deck_shop_refresh_log
    ADD CONSTRAINT chk_deck_refresh_card_count
    CHECK (card_count >= 1 AND card_count <= 10);


-- ============================================================================
-- Missing Foreign Keys
-- ============================================================================

-- price_cache.card_id → cards.id
ALTER TABLE public.price_cache
    ADD CONSTRAINT fk_price_cache_card
    FOREIGN KEY (card_id) REFERENCES public.cards(id) ON DELETE CASCADE;

-- price_history.card_id → cards.id
ALTER TABLE public.price_history
    ADD CONSTRAINT fk_price_history_card
    FOREIGN KEY (card_id) REFERENCES public.cards(id) ON DELETE CASCADE;

-- listing_templates.card_id → cards.id
ALTER TABLE public.listing_templates
    ADD CONSTRAINT fk_listing_templates_card
    FOREIGN KEY (card_id) REFERENCES public.cards(id) ON DELETE CASCADE;


-- ============================================================================
-- Immutable admin/member columns — prevent privilege escalation
-- ============================================================================
-- Even if RLS policies or application code allow a user to update their own
-- row, these triggers prevent is_admin and is_pro from being changed
-- except by a service_role connection.
-- ============================================================================

CREATE OR REPLACE FUNCTION public.protect_privilege_columns()
RETURNS TRIGGER AS $$
BEGIN
    -- Allow changes if the session is service_role (admin operations)
    IF current_setting('request.jwt.claim.role', true) = 'service_role' THEN
        RETURN NEW;
    END IF;

    -- Prevent non-service-role from changing privilege columns
    IF NEW.is_admin IS DISTINCT FROM OLD.is_admin THEN
        RAISE EXCEPTION 'Cannot modify is_admin — admin changes require service role access';
    END IF;

    IF NEW.is_pro IS DISTINCT FROM OLD.is_pro THEN
        RAISE EXCEPTION 'Cannot modify is_pro — Pro changes require service role access';
    END IF;

    IF NEW.pro_until IS DISTINCT FROM OLD.pro_until THEN
        RAISE EXCEPTION 'Cannot modify pro_until — Pro changes require service role access';
    END IF;

    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trigger_protect_privileges ON public.users;
CREATE TRIGGER trigger_protect_privileges
    BEFORE UPDATE ON public.users
    FOR EACH ROW
    EXECUTE FUNCTION public.protect_privilege_columns();


-- ============================================================================
-- Retention cleanup function — call via pg_cron or manual schedule
-- ============================================================================
-- Removes old rows from high-volume tables to prevent unbounded growth.
-- Schedule via Supabase pg_cron: SELECT cron.schedule('cleanup-old-records',
-- '0 3 * * *', 'SELECT * FROM cleanup_old_records()');
-- ============================================================================

CREATE OR REPLACE FUNCTION public.cleanup_old_records()
RETURNS TABLE (
    table_name TEXT,
    rows_deleted BIGINT
) AS $$
DECLARE
    v_deleted BIGINT;
BEGIN
    -- Scan metrics: keep 90 days
    DELETE FROM public.scan_metrics WHERE created_at < NOW() - INTERVAL '90 days';
    GET DIAGNOSTICS v_deleted = ROW_COUNT;
    table_name := 'scan_metrics'; rows_deleted := v_deleted;
    RETURN NEXT;

    -- API call logs: keep 90 days
    DELETE FROM public.api_call_logs WHERE created_at < NOW() - INTERVAL '90 days';
    GET DIAGNOSTICS v_deleted = ROW_COUNT;
    table_name := 'api_call_logs'; rows_deleted := v_deleted;
    RETURN NEXT;

    -- Price history: keep 1 year
    DELETE FROM public.price_history WHERE recorded_at < NOW() - INTERVAL '365 days';
    GET DIAGNOSTICS v_deleted = ROW_COUNT;
    table_name := 'price_history'; rows_deleted := v_deleted;
    RETURN NEXT;

    -- Deck shop refresh log: keep 90 days
    DELETE FROM public.deck_shop_refresh_log WHERE created_at < NOW() - INTERVAL '90 days';
    GET DIAGNOSTICS v_deleted = ROW_COUNT;
    table_name := 'deck_shop_refresh_log'; rows_deleted := v_deleted;
    RETURN NEXT;

    -- Admin actions: keep 1 year
    DELETE FROM public.admin_actions WHERE created_at < NOW() - INTERVAL '365 days';
    GET DIAGNOSTICS v_deleted = ROW_COUNT;
    table_name := 'admin_actions'; rows_deleted := v_deleted;
    RETURN NEXT;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
