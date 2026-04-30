-- 039_security_drop_broad_bucket_listing_and_anon_rpcs.sql
--
-- Two reductions in the public attack surface, both flagged by the
-- April 30 advisor pass:
--
-- 1. The "everyone-can-list-the-bucket" SELECT policies on the three
--    image buckets (scan-images, card-images, wotf-card-images) were
--    enumeration-only — they let an anon caller read object metadata via
--    storage.from(bucket).list(). Direct fetches by URL still work
--    because the buckets are public; deleting the listing policies just
--    closes the enumeration sidechannel.
--
--    Note: SDK-side .upload() reads its own metadata via the per-bucket
--    "select_authenticated" policies added in migration 021, which
--    remain in place. Public-URL reads remain in place. Only the
--    enumerate-everything policies are dropped.
--
-- 2. Ten SECURITY DEFINER RPCs are revoked from `anon`. They have no
--    anonymous use case — every consumer is authenticated app code or
--    a service-role cron. Closing the anon EXECUTE bit prevents an
--    anon-key holder from calling them with crafted inputs.
--
-- Applied directly to prod via Supabase MCP on 2026-04-30 under the name
-- `security_drop_broad_bucket_listing_policies_and_anon_rpcs`. Recorded
-- here so fresh branches converge.

-- Part 1: drop the broad SELECT-everything policies on storage.objects
-- for the three image buckets. Per-bucket SDK-upload SELECT policies
-- (from migration 021) remain.
DROP POLICY IF EXISTS "scan_images_public_list" ON storage.objects;
DROP POLICY IF EXISTS "card_images_public_list" ON storage.objects;
DROP POLICY IF EXISTS "wotf_card_images_public_list" ON storage.objects;
DROP POLICY IF EXISTS "Public Access" ON storage.objects;

-- Part 2: revoke EXECUTE-from-anon on RPCs that have no anon use case.
DO $$
DECLARE
  fn record;
BEGIN
  FOR fn IN
    SELECT n.nspname, p.proname, pg_get_function_identity_arguments(p.oid) AS args
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public'
      AND p.proname IN (
        'increment_persona',
        'increment_tournament_usage',
        'increment_shared_deck_views',
        'get_weekly_listing_count',
        'find_similar_hash',
        'find_similar_phash_256',
        'match_card_embedding',
        'submit_correction',
        'submit_reference_image',
        'award_badge_if_new'
      )
  LOOP
    EXECUTE format(
      'REVOKE EXECUTE ON FUNCTION %I.%I(%s) FROM anon',
      fn.nspname, fn.proname, fn.args
    );
  END LOOP;
END $$;
