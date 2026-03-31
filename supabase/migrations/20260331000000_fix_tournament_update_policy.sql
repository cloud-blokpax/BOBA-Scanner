-- Fix tournament UPDATE RLS policy: creator_id references public.users(id),
-- not auth.users(id), so comparing creator_id = auth.uid() never matches.
-- Use a proper join through public.users to map auth_user_id → users.id.

DROP POLICY IF EXISTS "tournaments_update_organizer" ON public.tournaments;

CREATE POLICY "tournaments_update_owner_or_admin"
    ON public.tournaments FOR UPDATE
    USING (
        EXISTS (
            SELECT 1 FROM public.users
            WHERE users.id = tournaments.creator_id
              AND users.auth_user_id = auth.uid()
        )
        OR EXISTS (
            SELECT 1 FROM public.users
            WHERE users.auth_user_id = auth.uid()
              AND users.is_admin = true
        )
    );
