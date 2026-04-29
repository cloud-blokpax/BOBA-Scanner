import { error, json } from '@sveltejs/kit';
import { apiError } from '$lib/server/api-response';
import { getAdminClient } from '$lib/server/supabase-admin';
import { checkMutationRateLimit } from '$lib/server/rate-limit';
import { postOne, type PostOneInput } from '$lib/server/wtp/post-one';
import type { RequestHandler } from './$types';

export const config = { maxDuration: 60 };

export const POST: RequestHandler = async ({ request, locals }) => {
	const { user } = await locals.safeGetSession();
	if (!user) throw error(401, 'Authentication required');

	const rl = await checkMutationRateLimit(user.id);
	if (!rl.success) return apiError('Too many requests', 429);

	const admin = getAdminClient();
	if (!admin) return apiError('Service unavailable', 503);

	const body = (await request.json().catch(() => null)) as Partial<PostOneInput> | null;
	if (!body || typeof body !== 'object') return apiError('Invalid request body', 400);
	if (typeof body.scan_id !== 'string') return apiError('Missing scan_id', 400);
	if (typeof body.condition !== 'string') return apiError('Missing condition', 400);
	if (typeof body.price !== 'number') return apiError('Missing price', 400);
	if (typeof body.quantity !== 'number') return apiError('Missing quantity', 400);

	const input: PostOneInput = {
		scan_id: body.scan_id,
		condition: body.condition,
		price: body.price,
		quantity: body.quantity,
		accepting_offers: body.accepting_offers ?? true,
		open_to_trade: body.open_to_trade ?? false,
		shipping_mode: (body.shipping_mode as PostOneInput['shipping_mode']) ?? 'free',
		shipping_fee: body.shipping_fee ?? 0,
		description: body.description ?? null,
		image_urls: Array.isArray(body.image_urls) ? body.image_urls.filter((s): s is string => typeof s === 'string') : []
	};

	const result = await postOne(admin, user.id, input);
	if (!result.ok) {
		const status = result.error_code === 'scan_not_found' || result.error_code === 'card_not_found'
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
