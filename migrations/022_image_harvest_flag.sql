-- Migration 22 — Image harvest kill-switch flag
--
-- Vercel Hobby Fluid Active CPU was being burned by the image-capture
-- piggyback inside /api/cron/price-harvest (sharp re-encode + Supabase
-- Storage upload, ~30 captures × 288 runs/day = ~8,640 image jobs/day on
-- the same trigger as price work). This flag gates the inline image
-- capture so price work continues on the 5-min cadence while image work
-- moves to a dedicated hourly endpoint.
--
-- Default OFF: when this row is absent OR enabled_globally = false, the
-- price-harvest cron skips captureCardImage entirely. The dedicated
-- /api/cron/image-harvest endpoint runs the work on its own QStash
-- schedule. The flag exists so the inline path can be re-enabled later
-- if the dedicated endpoint is ever retired.
--
-- Idempotent on re-run via ON CONFLICT DO NOTHING.

INSERT INTO public.feature_flags (
	feature_key,
	display_name,
	description,
	icon,
	enabled_globally,
	enabled_for_guest,
	enabled_for_authenticated,
	enabled_for_pro,
	enabled_for_admin
)
VALUES (
	'image_harvest_in_price_cron_v1',
	'Image Harvest in Price Cron',
	'When OFF (default), image capture is skipped inside /api/cron/price-harvest. Use /api/cron/image-harvest on its own hourly schedule instead. Introduced to pull Fluid Active CPU back under the Vercel Hobby cap.',
	'🖼️',
	false,
	false,
	false,
	false,
	false
)
ON CONFLICT (feature_key) DO NOTHING;

-- Verification — should return one row with enabled_globally = false
SELECT feature_key, enabled_globally
FROM public.feature_flags
WHERE feature_key = 'image_harvest_in_price_cron_v1';
