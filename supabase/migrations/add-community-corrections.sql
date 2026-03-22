-- Community Corrections table
-- Shares OCR misread→correct card number mappings across all users.
-- After 3 confirmations, a correction is treated as authoritative.

CREATE TABLE IF NOT EXISTS community_corrections (
    id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
    ocr_reading text NOT NULL,
    correct_card_number text NOT NULL,
    confirmation_count int DEFAULT 1,
    created_at timestamptz DEFAULT now(),
    updated_at timestamptz DEFAULT now(),
    UNIQUE (ocr_reading, correct_card_number)
);

-- RPC for atomic upsert with count increment
CREATE OR REPLACE FUNCTION submit_correction(
    p_ocr_reading text,
    p_correct_card_number text
) RETURNS void AS $$
INSERT INTO community_corrections (ocr_reading, correct_card_number, confirmation_count)
VALUES (p_ocr_reading, p_correct_card_number, 1)
ON CONFLICT (ocr_reading, correct_card_number) DO UPDATE SET
    confirmation_count = community_corrections.confirmation_count + 1,
    updated_at = now();
$$ LANGUAGE sql;

-- RPC for lookup (only returns corrections with 3+ confirmations)
CREATE OR REPLACE FUNCTION lookup_correction(
    p_ocr_reading text
) RETURNS TABLE (correct_card_number text, confirmation_count int) AS $$
SELECT correct_card_number, confirmation_count
FROM community_corrections
WHERE ocr_reading = p_ocr_reading
AND confirmation_count >= 3
ORDER BY confirmation_count DESC
LIMIT 1;
$$ LANGUAGE sql;

-- RLS: anyone can read (for lookup), authenticated can write
ALTER TABLE community_corrections ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Anyone can read corrections" ON community_corrections FOR SELECT USING (true);
CREATE POLICY "Authenticated users can insert" ON community_corrections FOR INSERT WITH CHECK (true);
