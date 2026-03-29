-- submit_reference_image(p_card_id, p_image_path, p_confidence, p_user_id, p_user_name, p_blur_variance)
-- Atomically checks if the submitted image beats the current reference image
-- for that card. If it wins (higher confidence), the user becomes the new champion.
-- Returns whether the submission was accepted and metadata about the previous holder.

CREATE OR REPLACE FUNCTION public.submit_reference_image(
    p_card_id        TEXT,
    p_image_path     TEXT,
    p_confidence     REAL,
    p_user_id        UUID,
    p_user_name      TEXT,
    p_blur_variance  REAL DEFAULT NULL
)
RETURNS JSONB AS $$
DECLARE
    v_existing       RECORD;
    v_accepted       BOOLEAN := FALSE;
    v_is_new_card    BOOLEAN := FALSE;
    v_previous_holder TEXT := NULL;
    v_old_confidence REAL := NULL;
BEGIN
    -- Lock the row for this card to prevent race conditions
    SELECT * INTO v_existing
    FROM public.card_reference_images
    WHERE card_id = p_card_id
    FOR UPDATE;

    IF NOT FOUND THEN
        -- No existing reference image — this is the first submission
        INSERT INTO public.card_reference_images (card_id, image_path, confidence, contributed_by, created_at, updated_at)
        VALUES (p_card_id, p_image_path, p_confidence, p_user_id, NOW(), NOW());

        v_accepted := TRUE;
        v_is_new_card := TRUE;
    ELSIF p_confidence > v_existing.confidence THEN
        -- New submission beats the current champion
        v_old_confidence := v_existing.confidence;

        -- Look up previous holder's display name
        SELECT COALESCE(u.name, split_part(u.email, '@', 1), 'Anonymous')
        INTO v_previous_holder
        FROM public.users u
        WHERE u.auth_user_id = v_existing.contributed_by;

        UPDATE public.card_reference_images
        SET image_path     = p_image_path,
            confidence     = p_confidence,
            contributed_by = p_user_id,
            updated_at     = NOW()
        WHERE card_id = p_card_id;

        v_accepted := TRUE;
    END IF;

    RETURN jsonb_build_object(
        'accepted', v_accepted,
        'is_new_card', v_is_new_card,
        'previous_holder', v_previous_holder,
        'old_confidence', v_old_confidence
    );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
