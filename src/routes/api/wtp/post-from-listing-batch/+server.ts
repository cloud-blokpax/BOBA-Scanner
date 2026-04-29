/**
 * POST /api/wtp/post-from-listing-batch — Pro-gated bulk version of
 * /api/wtp/post-from-listing. Mirrors the scan-driven /api/wtp/post-batch
 * shape so UI can collect per-item results identically.
 */

import { error, json } from '@sveltejs/kit';
import { apiError } from '$lib/server/api-response';
import { getAdminClient } from '$lib/server/supabase-admin';
import { checkHeavyMutationRateLimit } from '$lib/server/rate-limit';
import {
	postOneFromListing,
	type PostFromListingInput,
	type PostFromListingResult
} from '$lib/server/wtp/post-from-listing';
import type { RequestHandler } from './$types';

export const config = { maxDuration: 60 };

const MAX_BATCH_SIZE = 15;
const PER_ITEM_DELAY_MS = 3000;

function delay(ms: number): Promise<void> {
	return new Promise((resolve) => setTimeout(resolve, ms));
}

export const POST: RequestHandler = async ({ request, locals }) => {
	const { user } = await locals.safeGetSession();
	if (!user) throw error(401, 'Authentication required');

	const rl = await checkHeavyMutationRateLimit(user.id);
	if (!rl.success) return apiError('Too many requests', 429);

	const isPro =
		(user.app_metadata as Record<string, unknown> | null | undefined)?.is_pro === true ||
		(user.user_metadata as Record<string, unknown> | null | undefined)?.is_pro === true;
	if (!isPro) {
		return apiError('Pro subscription required for bulk posting', 402, { code: 'pro_required' });
	}

	const admin = getAdminClient();
	if (!admin) return apiError('Service unavailable', 503);

	const body = (await request.json().catch(() => null)) as
		| { items?: Partial<PostFromListingInput>[] }
		| null;
	if (!body || !Array.isArray(body.items)) return apiError('Missing items array', 400);
	if (body.items.length === 0) return apiError('Empty items array', 400);
	if (body.items.length > MAX_BATCH_SIZE) {
		return apiError(`Batch size exceeds maximum (${MAX_BATCH_SIZE})`, 400, {
			code: 'batch_too_large'
		});
	}

	const results: PostFromListingResult[] = [];
	for (let i = 0; i < body.items.length; i++) {
		const raw = body.items[i];
		if (!raw || typeof raw.source_listing_id !== 'string') {
			results.push({
				ok: false,
				error: 'Invalid item shape',
				error_code: 'invalid_item',
				source_listing_id: typeof raw?.source_listing_id === 'string' ? raw.source_listing_id : ''
			});
			continue;
		}
		const input: PostFromListingInput = {
			source_listing_id: raw.source_listing_id,
			condition: raw.condition,
			price: raw.price,
			quantity: raw.quantity,
			accepting_offers: raw.accepting_offers,
			open_to_trade: raw.open_to_trade,
			shipping_mode: raw.shipping_mode,
			shipping_fee: raw.shipping_fee,
			description: raw.description ?? undefined,
			image_urls: Array.isArray(raw.image_urls)
				? raw.image_urls.filter((s): s is string => typeof s === 'string')
				: undefined
		};

		const result = await postOneFromListing(admin, user.id, input);
		results.push(result);
		if (i < body.items.length - 1) await delay(PER_ITEM_DELAY_MS);
	}

	const succeeded = results.filter((r) => r.ok).length;
	const failed = results.length - succeeded;

	return json({ ok: true, succeeded, failed, results });
};
