-- 040_security_tournaments_lookup_lockdown.sql
--
-- Lock down `public.tournaments` SELECT and add a code-gated lookup RPC.
--
-- Background: the prior policies were `USING (true)` (admin policy that
-- forgot to qualify by role) and `USING (is_active = true)` (which was
-- intended to expose the code-as-gate model but actually let any anon
-- caller list every active tournament — including codes and creator
-- UUIDs). The "code is the gate" access model was therefore broken.
--
-- New model:
--   * Owners can read their own tournaments.
--   * Participants (anyone with a tournament_results row tied to their
--     user) can read tournaments they participated in.
--   * Admins can read all tournaments.
--   * Anonymous + authenticated callers go through `lookup_tournament_by_code`
--     to fetch a single tournament when they have its code. The RPC
--     returns a whitelisted column set — creator_id is NOT exposed.
--
-- App-side, every existing code-based read either uses the public
-- /api/tournament/[code] endpoint (now backed by the RPC) or runs as
-- the service-role admin client, so the RLS lockdown is non-breaking
-- after the matching code change ships.

-- ── 1. Replace broken broad-SELECT policies ───────────────────────────
DROP POLICY IF EXISTS admin_read_all_tournaments ON public.tournaments;
DROP POLICY IF EXISTS read_active_tournaments ON public.tournaments;

DROP POLICY IF EXISTS tournaments_select_owner ON public.tournaments;
CREATE POLICY tournaments_select_owner ON public.tournaments
  FOR SELECT TO authenticated
  USING (
    creator_id IN (
      SELECT id FROM public.users WHERE auth_user_id = auth.uid()
    )
  );

DROP POLICY IF EXISTS tournaments_select_participant ON public.tournaments;
CREATE POLICY tournaments_select_participant ON public.tournaments
  FOR SELECT TO authenticated
  USING (
    id IN (
      SELECT tournament_id FROM public.tournament_results
      WHERE player_user_id IN (
        SELECT id FROM public.users WHERE auth_user_id = auth.uid()
      )
    )
  );

DROP POLICY IF EXISTS tournaments_select_admin ON public.tournaments;
CREATE POLICY tournaments_select_admin ON public.tournaments
  FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.users
      WHERE auth_user_id = auth.uid()
        AND is_admin = true
    )
  );

-- ── 2. Code-gated lookup RPC (anon + authenticated) ───────────────────
-- Returns a whitelisted column set for a single active tournament when
-- the caller supplies the correct code. creator_id is intentionally not
-- in the return — the code IS the only thing a non-owner needs to enter
-- a tournament; everything else they get is what /api/tournament/[code]
-- already returned before the lockdown.
CREATE OR REPLACE FUNCTION public.lookup_tournament_by_code(p_code text)
RETURNS TABLE (
  id uuid,
  name text,
  code text,
  format_id text,
  deck_type text,
  max_heroes int,
  max_plays int,
  max_bonus int,
  event_date date,
  venue text,
  registration_closed boolean,
  submission_deadline timestamptz,
  deadline_mode text,
  is_active boolean,
  description text,
  entry_fee text,
  prize_pool text,
  max_players int,
  require_email boolean,
  require_name boolean,
  require_discord boolean
)
LANGUAGE sql
SECURITY DEFINER
SET search_path = public, pg_catalog
STABLE
AS $$
  SELECT t.id,
         t.name,
         t.code,
         t.format_id,
         t.deck_type,
         t.max_heroes,
         t.max_plays,
         t.max_bonus,
         t.event_date,
         t.venue,
         t.registration_closed,
         t.submission_deadline,
         t.deadline_mode,
         t.is_active,
         t.description,
         t.entry_fee,
         t.prize_pool,
         t.max_players,
         t.require_email,
         t.require_name,
         t.require_discord
  FROM public.tournaments t
  WHERE upper(t.code) = upper(p_code)
    AND t.is_active = true
  LIMIT 1;
$$;

REVOKE ALL ON FUNCTION public.lookup_tournament_by_code(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.lookup_tournament_by_code(text) TO anon, authenticated;
