-- ============================================================
-- Price Harvest Log — per-card results from nightly eBay harvester
-- ============================================================
-- Every card processed by the harvester gets one row per run.
-- Captures all pricing metadata, previous price for delta tracking,
-- search query for debugging, and priority bucket for analytics.

CREATE TABLE IF NOT EXISTS public.price_harvest_log (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),

    -- ── Harvest run context ─────────────────────────────
    run_id              TEXT NOT NULL,           -- Groups all cards from one nightly chain (YYYY-MM-DD)
    chain_depth         INTEGER NOT NULL,        -- Which chain link processed this card
    priority            INTEGER NOT NULL,        -- 1=unpriced collected, 2=stale collected, 3=unpriced any, 4=stale any

    -- ── Card identity ───────────────────────────────────
    card_id             TEXT NOT NULL,
    hero_name           TEXT,
    card_name           TEXT,
    card_number         TEXT,

    -- ── Search context ──────────────────────────────────
    search_query        TEXT NOT NULL,           -- Exact eBay query string used
    ebay_results_raw    INTEGER NOT NULL DEFAULT 0,  -- Total itemSummaries returned by eBay
    auction_count       INTEGER NOT NULL DEFAULT 0,  -- Listings with AUCTION buying option
    fixed_price_count   INTEGER NOT NULL DEFAULT 0,  -- Listings with FIXED_PRICE buying option

    -- ── All listings stats (auction + fixed) ────────────
    price_low           NUMERIC(10,2),
    price_mid           NUMERIC(10,2),           -- Median (primary metric)
    price_high          NUMERIC(10,2),
    price_mean          NUMERIC(10,2),
    listings_count      INTEGER NOT NULL DEFAULT 0,  -- Listings with valid price > 0
    filtered_count      INTEGER NOT NULL DEFAULT 0,  -- Listings surviving IQR outlier filter
    confidence_score    NUMERIC(4,2) DEFAULT 0,      -- 0.00–1.00

    -- ── Buy-now only stats ──────────────────────────────
    buy_now_low         NUMERIC(10,2),
    buy_now_mid         NUMERIC(10,2),
    buy_now_high        NUMERIC(10,2),
    buy_now_mean        NUMERIC(10,2),
    buy_now_count       INTEGER NOT NULL DEFAULT 0,
    buy_now_filtered    INTEGER NOT NULL DEFAULT 0,
    buy_now_confidence  NUMERIC(4,2) DEFAULT 0,

    -- ── Delta tracking (vs previous price_cache entry) ──
    previous_mid        NUMERIC(10,2),           -- Previous median price (null if first time)
    price_changed       BOOLEAN NOT NULL DEFAULT FALSE,
    price_delta         NUMERIC(10,2),           -- New mid - previous mid (null if first time)
    price_delta_pct     NUMERIC(8,2),            -- Percentage change (null if first time or prev was 0)
    is_new_price        BOOLEAN NOT NULL DEFAULT FALSE,  -- True if no previous price existed

    -- ── Result status ───────────────────────────────────
    success             BOOLEAN NOT NULL DEFAULT FALSE,
    zero_results        BOOLEAN NOT NULL DEFAULT FALSE,  -- eBay returned 0 listings
    error_message       TEXT,                            -- If success=false, why

    -- ── Timing ──────────────────────────────────────────
    duration_ms         INTEGER,                 -- How long this card's eBay call took
    processed_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Indexes for common admin queries
CREATE INDEX IF NOT EXISTS idx_harvest_log_run ON public.price_harvest_log(run_id);
CREATE INDEX IF NOT EXISTS idx_harvest_log_card ON public.price_harvest_log(card_id);
CREATE INDEX IF NOT EXISTS idx_harvest_log_processed ON public.price_harvest_log(processed_at DESC);
CREATE INDEX IF NOT EXISTS idx_harvest_log_changed ON public.price_harvest_log(price_changed, processed_at DESC);
CREATE INDEX IF NOT EXISTS idx_harvest_log_zero ON public.price_harvest_log(zero_results, processed_at DESC);

-- RLS: no client access — server uses service_role
ALTER TABLE public.price_harvest_log ENABLE ROW LEVEL SECURITY;

-- Auto-purge old logs (keep 90 days). Run manually or via pg_cron:
-- DELETE FROM public.price_harvest_log WHERE processed_at < NOW() - INTERVAL '90 days';
