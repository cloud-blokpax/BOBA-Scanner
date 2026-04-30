-- 041_security_seed_temp_private.sql
--
-- Flip the `seed-temp` storage bucket from public to private. The bucket
-- holds transient seeding payloads from server-side scripts; nothing in
-- app code reads it via getPublicUrl, and the only writes happen via
-- service-role clients (which bypass RLS). No app changes are required.
--
-- Closing public:true means anonymous users can no longer fetch arbitrary
-- objects by URL even if they guess a path.

UPDATE storage.buckets SET public = false WHERE id = 'seed-temp';
