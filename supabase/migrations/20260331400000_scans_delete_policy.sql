-- Allow authenticated users to delete their own scans
CREATE POLICY "scans_delete_own" ON public.scans
    FOR DELETE USING (auth.uid() = user_id);
