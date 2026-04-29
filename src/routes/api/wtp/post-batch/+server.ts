import { error, json } from '@sveltejs/kit';
import { apiError } from '$lib/server/api-response';
import { getAdminClient } from '$lib/server/supabase-admin';
import { checkHeavyMutationRateLimit } from '$lib/server/rate-limit';
import { postOne, type PostOneInput, type PostOneResult } from '$lib/server/wtp/post-one';
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

	// Pro gate. Free users get the single-card flow; binder bulk is Pro.
	const isPro =
		(user.app_metadata as Record<string, unknown> | null | undefined)?.is_pro === true ||
		(user.user_metadata as Record<string, unknown> | null | undefined)?.is_pro === true;
	if (!isPro) return apiError('Pro subscription required for bulk posting', 402, { code: 'pro_required' });

	const admin = getAdminClient();
	if (!admin) return apiError('Service unavailable', 503);

	const body = (await request.json().catch(() => null)) as { items?: Partial<PostOneInput>[] } | null;
	if (!body || !Array.isArray(body.items)) return apiError('Missing items array', 400);
	if (body.items.length === 0) return apiError('Empty items array', 400);
	if (body.items.length > MAX_BATCH_SIZE) {
		return apiError(`Batch size exceeds maximum (${MAX_BATCH_SIZE})`, 400, { code: 'batch_too_large' });
	}

	const results: PostOneResult[] = [];
	for (let i = 0; i < body.items.length; i++) {
		const raw = body.items[i];
		if (
			!raw ||
			typeof raw.scan_id !== 'string' ||
			typeof raw.condition !== 'string' ||
			typeof raw.price !== 'number' ||
			typeof raw.quantity !== 'number'
		) {
			results.push({
				ok: false,
				error: 'Invalid item shape',
				error_code: 'invalid_item',
				scan_id: typeof raw?.scan_id === 'string' ? raw.scan_id : ''
			});
			continue;
		}
		const input: PostOneInput = {
			scan_id: raw.scan_id,
			condition: raw.condition,
			price: raw.price,
			quantity: raw.quantity,
			accepting_offers: raw.accepting_offers ?? true,
			open_to_trade: raw.open_to_trade ?? false,
			shipping_mode: (raw.shipping_mode as PostOneInput['shipping_mode']) ?? 'free',
			shipping_fee: raw.shipping_fee ?? 0,
			description: raw.description ?? null,
			image_urls: Array.isArray(raw.image_urls) ? raw.image_urls.filter((s): s is string => typeof s === 'string') : []
		};

		const result = await postOne(admin, user.id, input);
		results.push(result);
		if (i < body.items.length - 1) await delay(PER_ITEM_DELAY_MS);
	}

	const succeeded = results.filter((r) => r.ok).length;
	const failed = results.length - succeeded;

	return json({ ok: true, succeeded, failed, results });
};
