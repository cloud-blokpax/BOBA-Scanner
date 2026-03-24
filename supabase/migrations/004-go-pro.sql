-- ============================================================================
-- Go Pro — Rename membership columns + donations table + activate_pro RPC
-- ============================================================================

-- Rename is_member → is_pro, member_until → pro_until
ALTER TABLE public.users RENAME COLUMN is_member TO is_pro;
ALTER TABLE public.users RENAME COLUMN member_until TO pro_until;

-- Rename feature flag column
ALTER TABLE public.feature_flags RENAME COLUMN enabled_for_member TO enabled_for_pro;

-- ── Donations table ─────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.donations (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id         UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    tier_key        TEXT NOT NULL,
    tier_amount     NUMERIC(10,2) NOT NULL,
    payment_method  TEXT NOT NULL,
    time_added      BOOLEAN NOT NULL DEFAULT FALSE,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_donations_user ON public.donations(user_id);
CREATE INDEX IF NOT EXISTS idx_donations_created ON public.donations(created_at);

ALTER TABLE public.donations ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "donations_select_own" ON public.donations;
CREATE POLICY "donations_select_own" ON public.donations
    FOR SELECT TO authenticated
    USING (user_id = (SELECT auth.uid()));

DROP POLICY IF EXISTS "donations_service_all" ON public.donations;
CREATE POLICY "donations_service_all" ON public.donations
    FOR ALL TO service_role
    USING (true) WITH CHECK (true);

-- ── activate_pro RPC ────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.activate_pro(
    p_user_id        UUID,
    p_tier_key       TEXT,
    p_tier_amount    NUMERIC,
    p_payment_method TEXT
)
RETURNS JSONB AS $$
DECLARE
    v_last_donation_at TIMESTAMPTZ;
    v_current_pro_until TIMESTAMPTZ;
    v_new_pro_until TIMESTAMPTZ;
    v_time_added BOOLEAN := FALSE;
    v_max_pro_until TIMESTAMPTZ := NOW() + INTERVAL '60 days';
BEGIN
    -- Check when the user last donated (for 7-day cooldown)
    SELECT MAX(created_at) INTO v_last_donation_at
    FROM public.donations
    WHERE user_id = p_user_id AND time_added = TRUE;

    -- Get current pro_until
    SELECT pro_until INTO v_current_pro_until
    FROM public.users
    WHERE auth_user_id = p_user_id;

    -- Determine if this donation should add time
    -- Only add time if: no previous time-extending donation, OR last one was 7+ days ago
    IF v_last_donation_at IS NULL OR (NOW() - v_last_donation_at) >= INTERVAL '7 days' THEN
        -- Calculate new pro_until: 30 days added to the later of NOW or current expiry
        v_new_pro_until := GREATEST(NOW(), COALESCE(v_current_pro_until, NOW())) + INTERVAL '30 days';

        -- Cap at 60 days from now
        IF v_new_pro_until > v_max_pro_until THEN
            v_new_pro_until := v_max_pro_until;
        END IF;

        -- Update the user
        UPDATE public.users
        SET is_pro = TRUE,
            pro_until = v_new_pro_until
        WHERE auth_user_id = p_user_id;

        v_time_added := TRUE;
    ELSE
        -- Cooldown active — don't add time, just use current values
        v_new_pro_until := v_current_pro_until;
    END IF;

    -- Always record the donation intent (even if no time was added)
    INSERT INTO public.donations (user_id, tier_key, tier_amount, payment_method, time_added)
    VALUES (p_user_id, p_tier_key, p_tier_amount, p_payment_method, v_time_added);

    RETURN jsonb_build_object(
        'pro_until', v_new_pro_until,
        'time_added', v_time_added,
        'cooldown_active', NOT v_time_added AND v_last_donation_at IS NOT NULL
    );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
