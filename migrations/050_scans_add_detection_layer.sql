-- Doc 1.2 — Detection Robustness. Adds the `detection_layer` column to
-- public.scans so production telemetry surfaces which classical-CV layer
-- (multi-scale Canny vs adaptive thresholding) succeeded at corner
-- detection. Useful for tuning thresholds and deciding whether the
-- adaptive fallback is earning its keep.

ALTER TABLE public.scans
  ADD COLUMN IF NOT EXISTS detection_layer text;

COMMENT ON COLUMN public.scans.detection_layer IS
  'Doc 1.2 — which classical-CV layer succeeded at corner detection. ''canny_75_200'' | ''canny_40_120'' | ''canny_20_80'' | ''adaptive''. NULL on centered_fallback.';
