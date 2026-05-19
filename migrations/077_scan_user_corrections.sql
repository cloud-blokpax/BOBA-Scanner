-- Phase 8 — User-supplied scan corrections capture.
-- Backs the tap-to-teach UX: corner taps when detection fails, draggable
-- quad refinement on low-confidence results, card-id overrides, and
-- explicit abandon events. Labeled data here can later train detector
-- improvements (or be replayed offline to grade new detector versions).

CREATE TABLE IF NOT EXISTS scan_user_corrections (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    -- NULLABLE because corner_tap_4 corrections fire BEFORE any scan row
    -- exists (detector failed pre-capture, user supplies corners directly).
    -- card_id_override / abandon / quad_adjust corrections always have a
    -- scan row to reference.
    scan_id uuid REFERENCES scans(id) ON DELETE CASCADE,
    user_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
    correction_type text NOT NULL CHECK (correction_type IN (
        'corner_tap_4', 'quad_adjust', 'card_id_override', 'abandon'
    )),
    -- 4-element JSON array of {x,y} in source-pixel coords; NULL when
    -- correction_type doesn't involve geometry (card_id_override / abandon).
    original_corners jsonb,
    corrected_corners jsonb,
    -- Pre/post card refs; NULL when correction_type is geometry-only.
    original_card_id uuid REFERENCES cards(id) ON DELETE SET NULL,
    corrected_card_id uuid REFERENCES cards(id) ON DELETE SET NULL,
    -- Time in ms from result-render to user-completed-correction. Lets us
    -- compare UX friction across correction types.
    correction_latency_ms int,
    created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS scan_user_corrections_scan_id_idx
    ON scan_user_corrections(scan_id);
CREATE INDEX IF NOT EXISTS scan_user_corrections_correction_type_idx
    ON scan_user_corrections(correction_type);
CREATE INDEX IF NOT EXISTS scan_user_corrections_created_at_idx
    ON scan_user_corrections(created_at DESC);

-- Grants — authenticated users own their corrections; service_role for
-- admin/analysis reads. Forward-compatible with the May/Oct 2026 grant
-- defaults removal.
GRANT SELECT ON scan_user_corrections TO anon;
GRANT SELECT, INSERT ON scan_user_corrections TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON scan_user_corrections TO service_role;

ALTER TABLE scan_user_corrections ENABLE ROW LEVEL SECURITY;

CREATE POLICY "users read own corrections"
    ON scan_user_corrections FOR SELECT TO authenticated
    USING (auth.uid() = user_id);

CREATE POLICY "users insert own corrections"
    ON scan_user_corrections FOR INSERT TO authenticated
    WITH CHECK (auth.uid() = user_id);
