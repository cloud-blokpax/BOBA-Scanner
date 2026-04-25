-- Migration 021: Restore complete storage RLS broken by April 15 cleanup.
--
-- Bug #2 root cause: Phase 8 of the April 15 RLS cleanup
-- (remove_broad_bucket_policies_phase8) dropped SELECT policies on
-- storage.objects under the assumption that public buckets serve via direct
-- URL only. But the Supabase JS SDK's .upload() does a post-INSERT SELECT
-- to compute the returned public URL — without that policy, every
-- authenticated client upload across every bucket failed with the
-- misleading "new row violates row-level security policy" message.
--
-- Result: zero authenticated user uploads succeeded between April 15 and
-- April 25 (10 days) across scan-images, card-images, wotf-card-images.
-- Service-role uploads (price harvester) kept working because BYPASSRLS=true.
--
-- This migration is idempotent: it drops policies if they exist and
-- recreates them, so it can run safely against prod (where the MCP
-- migrations of the same name already landed) or against a fresh branch.

-- 1. SELECT policy on storage.buckets (was missing — clients couldn't see buckets)
DROP POLICY IF EXISTS "buckets_read_all" ON storage.buckets;
CREATE POLICY "buckets_read_all"
ON storage.buckets FOR SELECT
TO authenticated, anon
USING (true);

-- 2. SELECT policies on storage.objects per bucket
--    (the Supabase JS SDK reads back uploaded objects to return their public URL)
DROP POLICY IF EXISTS "scan_images_select_authenticated" ON storage.objects;
CREATE POLICY "scan_images_select_authenticated"
ON storage.objects FOR SELECT TO authenticated
USING (bucket_id = 'scan-images');

DROP POLICY IF EXISTS "card_images_select_authenticated" ON storage.objects;
CREATE POLICY "card_images_select_authenticated"
ON storage.objects FOR SELECT TO authenticated
USING (bucket_id = 'card-images');

DROP POLICY IF EXISTS "wotf_card_images_select_authenticated" ON storage.objects;
CREATE POLICY "wotf_card_images_select_authenticated"
ON storage.objects FOR SELECT TO authenticated
USING (bucket_id = 'wotf-card-images');

-- 3. Cleaned-up INSERT policies (replace fragmented legacy ones with explicit role+path checks)
DROP POLICY IF EXISTS "Allow uploads" ON storage.objects;
DROP POLICY IF EXISTS "scan_images_insert_own" ON storage.objects;
CREATE POLICY "scan_images_insert_own"
ON storage.objects FOR INSERT TO authenticated
WITH CHECK (
  bucket_id = 'scan-images'
  AND (storage.foldername(name))[1] = (auth.uid())::text
);

DROP POLICY IF EXISTS "card_images_insert_authenticated" ON storage.objects;
CREATE POLICY "card_images_insert_authenticated"
ON storage.objects FOR INSERT TO authenticated
WITH CHECK (bucket_id = 'card-images');

-- 4. scan-images bucket: remove mime/size restrictions
--    Validation now happens in app code via uploadScanPhoto's resize step,
--    where we have visibility into failures via app_events telemetry.
UPDATE storage.buckets
SET file_size_limit = NULL,
    allowed_mime_types = NULL
WHERE id = 'scan-images';
