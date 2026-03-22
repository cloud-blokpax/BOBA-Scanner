-- Enable RLS on ebay_seller_tokens (stores sensitive OAuth credentials)
ALTER TABLE IF EXISTS ebay_seller_tokens ENABLE ROW LEVEL SECURITY;

-- Only the service role can read/write seller tokens.
-- The server-side ebay-seller-auth.ts uses getServiceClient() which
-- bypasses RLS, so no user-facing policies are needed.
-- This ensures the anon key cannot access any rows.

-- Drop existing policies if any (idempotent)
DROP POLICY IF EXISTS "No public access to seller tokens" ON ebay_seller_tokens;

-- Create a deny-all policy for anon/authenticated roles
-- (service_role bypasses RLS automatically)
CREATE POLICY "No public access to seller tokens"
  ON ebay_seller_tokens
  FOR ALL
  USING (false);

-- Also verify RLS on listing_templates
ALTER TABLE IF EXISTS listing_templates ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can only see their own listings" ON listing_templates;

CREATE POLICY "Users can only see their own listings"
  ON listing_templates
  FOR ALL
  USING (auth.uid() = user_id);
