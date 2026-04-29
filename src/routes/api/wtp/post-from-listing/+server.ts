/**
 * POST /api/wtp/post-from-listing — post an existing listing_templates row
 * to WTP. Sibling endpoint to /api/wtp/post (which is keyed on scan_id).
 *
 * Idempotent on (user_id, source_listing_id) via the partial unique index
 * in migration 034. Re-submits short-circuit and return the prior URL.
 */

import { error, json } from '@sveltejs/kit';
import { apiError } from '$lib/server/api-response';
import { getAdminClient } from '$lib/server/supabase-admin';
import { checkMutationRateLimit } from '$lib/server/rate-limit';
import {
	postOneFromListing,
	type PostFromListingInput
} from '$lib/server/wtp/post-from-listing';
import type { RequestHandler } from './$types';

export const config = { maxDuration: 60 };

export const POST: RequestHandler = async ({ request, locals }) => {
	const { user } = await locals.safeGetSession();
	if (!user) throw error(401, 'Authentication required');

	const rl = await checkMutationRateLimit(user.id);
	if (!rl.success) return apiError('Too many requests', 429);

	const admin = getAdminClient();
	if (!admin) return apiError('Service unavailable', 503);

	const body = (await request.json().catch(() => null)) as Partial<PostFromListingInput> | null;
	if (!body || typeof body !== 'object') return apiError('Invalid request body', 400);
	if (typeof body.source_listing_id !== 'string') return apiError('Missing source_listing_id', 400);

	const input: PostFromListingInput = {
		source_listing_id: body.source_listing_id,
		condition: body.condition,
		price: body.price,
		quantity: body.quantity,
		accepting_offers: body.accepting_offers,
		open_to_trade: body.open_to_trade,
		shipping_mode: body.shipping_mode,
		shipping_fee: body.shipping_fee,
		description: body.description ?? undefined,
		image_urls: Array.isArray(body.image_urls)
			? body.image_urls.filter((s): s is string => typeof s === 'string')
			: undefined
	};

	const result = await postOneFromListing(admin, user.id, input);
	if (!result.ok) {
		const status =
			result.error_code === 'listing_not_found' ||
			result.error_code === 'card_not_found' ||
			result.error_code === 'listing_unresolved'
				? 404
				: result.error_code === 'wrong_game' || result.error_code === 'invalid_payload'
					? 400
					: 500;
		return apiError(result.error, status, {
			code: result.error_code,
			details: { posting_id: result.posting_id }
		});
	}

	return json(result);
};
