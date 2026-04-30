-- 044_security_privatize_scan_images_bucket.sql
--
-- Privatize the `scan-images` Supabase Storage bucket.
--
-- Background: the Pass-2 audit confirmed two `references/*.jpg` files are
-- publicly fetchable via /storage/v1/object/public/scan-images/<path> on
-- top of ~60 user-scoped scan photos at `{auth_uid}/{file_uuid}.jpg`.
-- Retake/listing uploads were also writing public URLs into
-- `collections.scan_image_url` and `listing_templates.scan_image_url`,
-- meaning any url-leak (analytics, referrer, copy-paste) leaked the image.
-- The privacy page already claims scans aren't permanently stored.
--
-- App side (this PR):
--   - `src/lib/services/scan-image-url.ts` exposes `signScanImageUrl()`
--     and `extractScanImagePath()`. Every consumer that previously read
--     `getPublicUrl('scan-images', path)` now mints a short-lived signed
--     URL on render (1h owner display, 24h Whatnot CSV).
--   - Upload paths (`uploadScanImage`, `uploadScanImageForListing`,
--     `/api/ebay/listing`, `/api/ebay/create-draft`) now persist the
--     storage PATH in `scan_image_url` columns rather than a public URL.
--     Legacy URL-shaped values keep working through extractScanImagePath.
--   - Server-side `compose-context.ts` and `post-from-listing.ts`
--     mint signed URLs with the service-role admin client before passing
--     to the WTP composer / WTP listing API.
--
-- This migration:
--   1. Flips `storage.buckets.public` from true to false on `scan-images`.
--      Direct /object/public URLs stop resolving immediately.
--   2. Replaces the broad `scan_images_select_authenticated` policy
--      (which let any signed-in user list any folder's metadata) with
--      owner-scoped SELECT + DELETE policies plus an admin override.
--      `scan_images_insert_own` from migration 021 already enforces
--      the owner-folder write check; left in place.
--   3. Cleans up four diagnostic test artifacts left in the bucket from
--      Phase 2 storage debugging.
--
-- Rollout: deploy the app code first, THEN apply this migration. Old
-- code paths that still call getPublicUrl() will start receiving 400s
-- once the bucket is private; the new code paths sign and work.

-- ── 1. Privatize the bucket ─────────────────────────────────────
UPDATE storage.buckets SET public = false WHERE id = 'scan-images';

-- ── 2. Owner-scoped RLS on storage.objects for scan-images ──────

-- Drop the broad authenticated-can-select-everything policy. The post-INSERT
-- SELECT the SDK does as part of .upload() returns metadata for the row the
-- caller just wrote, which the new owner-scoped SELECT covers. Reference
-- images (`references/<cardId>.jpg`) are written from server-side service
-- role and read via signed URLs minted by service role, so they don't need
-- a per-role SELECT policy at all.
DROP POLICY IF EXISTS "scan_images_select_authenticated" ON storage.objects;

DROP POLICY IF EXISTS "scan_images_select_owner" ON storage.objects;
CREATE POLICY "scan_images_select_owner"
ON storage.objects FOR SELECT TO authenticated
USING (
  bucket_id = 'scan-images'
  AND (storage.foldername(name))[1] = (auth.uid())::text
);

DROP POLICY IF EXISTS "scan_images_delete_owner" ON storage.objects;
CREATE POLICY "scan_images_delete_owner"
ON storage.objects FOR DELETE TO authenticated
USING (
  bucket_id = 'scan-images'
  AND (storage.foldername(name))[1] = (auth.uid())::text
);

-- Admin override — admin tooling that needs to inspect any user's images
-- (grading review, abuse triage) joins on public.users by auth_user_id.
DROP POLICY IF EXISTS "scan_images_admin_all" ON storage.objects;
CREATE POLICY "scan_images_admin_all"
ON storage.objects FOR ALL TO authenticated
USING (
  bucket_id = 'scan-images'
  AND EXISTS (
    SELECT 1 FROM public.users
    WHERE auth_user_id = auth.uid() AND is_admin = true
  )
)
WITH CHECK (
  bucket_id = 'scan-images'
  AND EXISTS (
    SELECT 1 FROM public.users
    WHERE auth_user_id = auth.uid() AND is_admin = true
  )
);

-- ── 3. Clean up Phase-2 diagnostic artifacts ────────────────────
-- These four files were written by storage-RLS investigations and have no
-- production data attached. Deleting them tightens the audit-pass cleanup
-- list flagged by the external auditor.
DELETE FROM storage.objects
WHERE bucket_id = 'scan-images'
  AND (
    name LIKE '%__diag.jpg'
    OR name LIKE '%__no_role_test.jpg'
    OR name LIKE '%__post_simplification_test.jpg'
    OR name LIKE '%__svc_role_test.jpg'
  );
