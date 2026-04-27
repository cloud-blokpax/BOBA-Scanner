/**
 * Image Harvest — dedicated runner for /api/cron/image-harvest.
 *
 * The 5-min price-harvest cron used to piggyback image capture onto every
 * eBay price call (~30 captures × 288 runs/day = ~8,640 sharp re-encodes
 * per day). That work was the dominant chunk of Vercel Hobby Fluid Active
 * CPU. This runner moves it onto an hourly schedule with a bounded batch
 * size, capturing for a small slice of the catalog per invocation and
 * letting the eventual full-catalog backfill take ~24 hours per pass
 * instead of ~7 hours of compounding CPU pressure every day.
 *
 * BoBA-only — Wonders does not currently harvest images (parallel ambiguity
 * means an eBay listing image is rarely a faithful match for a specific
 * parallel row in our catalog).
 */

import { isEbayConfigured, ebayFetch } from '$lib/server/ebay-auth';
import { getAdminClient } from '$lib/server/supabase-admin';
import { getRedis } from '$lib/server/redis';
import { buildEbaySearchQuery, filterRelevantListings } from '$lib/server/ebay-query';
import { captureCardImage } from '$lib/services/image-harvester';

const DEFAULT_MAX_BATCH = 20;
const FETCH_DELAY_MS = 2000;
// Hold roughly 8s back from the 60s Vercel limit for response serialization
// and any hash-cache writes captureCardImage kicks off.
const PROCESSING_BUDGET_MS = 52_000;

interface ImageCaptureCandidate {
	id: string;
	hero_name: string | null;
	name: string | null;
	card_number: string | null;
	athlete_name: string | null;
	parallel: string | null;
	weapon_type: string | null;
}

export interface ImageCaptureResult {
	captured: number;
	skipped: number;
	errored: number;
	considered: number;
}

export async function runImageCapture(opts?: {
	maxBatch?: number;
}): Promise<ImageCaptureResult> {
	const maxBatch = Math.max(1, opts?.maxBatch ?? DEFAULT_MAX_BATCH);
	const result: ImageCaptureResult = { captured: 0, skipped: 0, errored: 0, considered: 0 };

	if (!isEbayConfigured()) return result;

	const admin = getAdminClient();
	if (!admin) return result;

	// Candidates: BoBA cards with no image_url. Once the catalog is fully
	// populated, this query returns zero and the cron is a no-op. The
	// 30-day recapture path remains available via the price-harvest
	// piggyback when the kill-switch flag is flipped on.
	const { data: candidates, error: queryErr } = await admin
		.from('cards')
		.select('id, hero_name, name, card_number, athlete_name, parallel, weapon_type')
		.eq('game_id', 'boba')
		.is('image_url', null)
		.limit(maxBatch);

	if (queryErr || !candidates || candidates.length === 0) {
		if (queryErr) {
			console.warn('[image-harvest] candidate query failed:', queryErr.message);
		}
		return result;
	}

	result.considered = candidates.length;

	const redis = getRedis();
	const today = new Date().toISOString().slice(0, 10);
	const startTime = Date.now();

	for (let i = 0; i < candidates.length; i++) {
		if (Date.now() - startTime > PROCESSING_BUDGET_MS) break;

		const card = candidates[i] as ImageCaptureCandidate;

		try {
			// Symmetric with price-harvest: bump the daily eBay call counter
			// before issuing the request so /admin/Phase 2 quota gauges and the
			// 5000/day cap account for image-harvest traffic too.
			if (redis) {
				try {
					const key = `ebay-calls:${today}`;
					const count = await redis.incr(key);
					if (count === 1) await redis.expire(key, 86400);
				} catch (err) {
					console.debug(
						'[image-harvest] Redis counter increment failed:',
						err instanceof Error ? err.message : err
					);
				}
			}

			const query = buildEbaySearchQuery({
				hero_name: card.hero_name,
				name: card.name,
				card_number: card.card_number,
				athlete_name: card.athlete_name,
				parallel: card.parallel,
				weapon_type: card.weapon_type,
				game_id: 'boba'
			});

			const searchUrl = new URL(
				'https://api.ebay.com/buy/browse/v1/item_summary/search'
			);
			searchUrl.searchParams.set('q', query);
			searchUrl.searchParams.set('filter', 'buyingOptions:{FIXED_PRICE|AUCTION}');
			searchUrl.searchParams.set('limit', '50');

			const res = await ebayFetch(searchUrl.toString());
			if (!res.ok) {
				result.errored++;
				continue;
			}

			const data = await res.json();
			const rawItems: Array<{
				title?: string;
				image?: { imageUrl?: string };
				thumbnailImages?: Array<{ imageUrl?: string }>;
			}> = data.itemSummaries || [];

			const items = filterRelevantListings(rawItems, {
				hero_name: card.hero_name,
				name: card.name,
				card_number: card.card_number,
				athlete_name: card.athlete_name,
				parallel: card.parallel,
				weapon_type: card.weapon_type,
				game_id: 'boba'
			});

			if (items.length === 0) {
				result.skipped++;
				continue;
			}

			const status = await captureCardImage(card.id, items[0], 'boba');
			result[status]++;
		} catch (err) {
			console.warn(
				`[image-harvest] error for ${card.id}:`,
				err instanceof Error ? err.message : err
			);
			result.errored++;
		}

		if (i < candidates.length - 1) {
			await new Promise((r) => setTimeout(r, FETCH_DELAY_MS));
		}
	}

	return result;
}
