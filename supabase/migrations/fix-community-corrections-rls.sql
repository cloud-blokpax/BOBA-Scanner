-- Fix submit_correction: add SECURITY DEFINER so the ON CONFLICT UPDATE branch works
CREATE OR REPLACE FUNCTION submit_correction(
    p_ocr_reading text,
    p_correct_card_number text
) RETURNS void AS $$
INSERT INTO community_corrections (ocr_reading, correct_card_number, confirmation_count)
VALUES (p_ocr_reading, p_correct_card_number, 1)
ON CONFLICT (ocr_reading, correct_card_number) DO UPDATE SET
    confirmation_count = community_corrections.confirmation_count + 1,
    updated_at = now();
$$ LANGUAGE sql SECURITY DEFINER;

-- Fix lookup_correction: add SECURITY DEFINER for consistency
CREATE OR REPLACE FUNCTION lookup_correction(
    p_ocr_reading text
) RETURNS TABLE (correct_card_number text, confirmation_count int) AS $$
SELECT correct_card_number, confirmation_count
FROM community_corrections
WHERE ocr_reading = p_ocr_reading
AND confirmation_count >= 3
ORDER BY confirmation_count DESC
LIMIT 1;
$$ LANGUAGE sql SECURITY DEFINER;

-- Tighten the INSERT policy to actually require authentication
-- (the existing policy says "Authenticated" but uses WITH CHECK (true) which allows anon)
DROP POLICY IF EXISTS "Authenticated users can insert" ON community_corrections;
CREATE POLICY "Authenticated users can insert"
    ON community_corrections FOR INSERT
    WITH CHECK (auth.uid() IS NOT NULL);
