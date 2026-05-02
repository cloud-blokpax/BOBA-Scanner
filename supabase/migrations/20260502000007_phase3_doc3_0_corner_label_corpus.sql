-- Phase 3 Doc 3.0 — Corner-label corpus for the self-trained detector.
-- Applied via Supabase MCP on 2026-05-02 prior to repo commit.

CREATE TABLE IF NOT EXISTS public.detector_training_labels (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  ebay_item_id text NOT NULL,
  card_id uuid NOT NULL REFERENCES public.cards(id) ON DELETE CASCADE,
  source_url text NOT NULL,
  source_size text NOT NULL CHECK (source_size IN ('s-l225','s-l500','s-l1600')),
  image_w integer NOT NULL,
  image_h integer NOT NULL,
  corners_px jsonb,
  label_state text NOT NULL DEFAULT 'auto_pending' CHECK (label_state IN (
    'auto_pending', 'auto_labelled', 'auto_failed',
    'human_confirmed', 'human_corrected', 'rejected'
  )),
  auto_detection_layer text,
  auto_aspect_ratio real,
  auto_quality_score real,
  split text CHECK (split IS NULL OR split IN ('train', 'val', 'test')),
  reviewed_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  reviewed_at timestamptz,
  reject_reason text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (ebay_item_id, source_size)
);

CREATE INDEX IF NOT EXISTS idx_detector_training_labels_state
  ON public.detector_training_labels (label_state);
CREATE INDEX IF NOT EXISTS idx_detector_training_labels_split
  ON public.detector_training_labels (split) WHERE split IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_detector_training_labels_card
  ON public.detector_training_labels (card_id);
CREATE INDEX IF NOT EXISTS idx_detector_training_labels_quality_review
  ON public.detector_training_labels (auto_quality_score)
  WHERE label_state = 'auto_labelled';

COMMENT ON TABLE public.detector_training_labels IS
  'Phase 3 Doc 3.0. Per-eBay-image corner labels for the self-trained detector. Bootstrapped by running the production classical detector against ebay_card_images; rows where the classical detector succeeded enter as auto_labelled (cheap labels, ~45-72% of corpus per the eBay bench), the rest enter as auto_failed and queue for human review via the active-learning UI. The split column gates inclusion in the train/val/test sets.';

INSERT INTO public.feature_flags
  (feature_key, display_name, description, icon,
   enabled_globally, enabled_for_guest, enabled_for_authenticated,
   enabled_for_pro, enabled_for_admin)
VALUES
  ('phase3_label_review_ui_v1',
   'Phase 3: Detector Label Review UI',
   'Admin-only UI for reviewing and correcting auto-generated corner labels on the eBay corpus. Drives the active-learning loop that feeds the self-trained detector. Doc 3.0.',
   '🏷️', false, false, false, false, true)
ON CONFLICT (feature_key) DO UPDATE SET
  display_name = EXCLUDED.display_name,
  description = EXCLUDED.description,
  icon = EXCLUDED.icon,
  enabled_for_admin = EXCLUDED.enabled_for_admin;
