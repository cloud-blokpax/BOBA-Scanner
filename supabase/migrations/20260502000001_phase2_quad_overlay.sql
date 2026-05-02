-- Phase 2 Doc 2.2 — AR Live-Quad Overlay
-- Applied via Supabase MCP on 2026-05-02 prior to repo commit.

INSERT INTO public.feature_flags
  (feature_key, display_name, description, icon,
   enabled_globally, enabled_for_guest, enabled_for_authenticated,
   enabled_for_pro, enabled_for_admin)
VALUES
  ('phase2_quad_overlay_v1',
   'Phase 2: AR Live-Quad Overlay',
   'Renders the detected card quadrilateral as an SVG overlay during live capture. Outline follows the card in real-time with smoothed corner positions, coloured by alignment state (yellow=detected, green=ready). Doc 2.2.',
   '🟩', false, false, false, false, true)
ON CONFLICT (feature_key) DO UPDATE SET
  display_name = EXCLUDED.display_name,
  description = EXCLUDED.description,
  icon = EXCLUDED.icon,
  enabled_for_admin = EXCLUDED.enabled_for_admin;
