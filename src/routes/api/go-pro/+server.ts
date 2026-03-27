import { json, error } from '@sveltejs/kit';
import { requireAuth, requireSupabase, parseJsonBody, requireString } from '$lib/server/validate';
import { checkMutationRateLimit } from '$lib/server/rate-limit';
import type { RequestHandler } from './$types';

const TIERS: Record<string, { amount: number; label: string }> = {
	legendary: { amount: 25, label: 'Unbelievable and worth every penny' },
	epic:      { amount: 15, label: 'Must have for this price' },
	standard:  { amount: 5,  label: 'This app is ok — I will give' },
	custom:    { amount: 0,  label: 'I must ponder the value' }
};

export const POST: RequestHandler = async ({ request, locals }) => {
	const user = await requireAuth(locals);
	const supabase = requireSupabase(locals);

	const rateLimit = await checkMutationRateLimit(user.id);
	if (!rateLimit.success) {
		return json({ error: 'Too many requests' }, {
			status: 429,
			headers: {
				'X-RateLimit-Limit': String(rateLimit.limit),
				'X-RateLimit-Remaining': String(rateLimit.remaining),
				'X-RateLimit-Reset': String(rateLimit.reset)
			}
		});
	}

	try {
		const body = await parseJsonBody(request);
		const tierKey = requireString(body.tier_key, 'tier_key', 20);
		const paymentMethod = requireString(body.payment_method, 'payment_method', 20);

		if (!(tierKey in TIERS)) throw error(400, 'Invalid tier');
		if (!['venmo', 'paypal'].includes(paymentMethod)) throw error(400, 'Invalid payment method');

		const tier = TIERS[tierKey];

		const { data, error: rpcError } = await supabase.rpc('activate_pro', {
			p_user_id: user.id,
			p_tier_key: tierKey,
			p_tier_amount: tier.amount,
			p_payment_method: paymentMethod
		});

		if (rpcError) {
			console.error('[api/go-pro] activate_pro failed:', rpcError);
			throw error(500, 'Failed to activate Pro');
		}

		return json({
			success: true,
			...data
		});
	} catch (err) {
		if (err && typeof err === 'object' && 'status' in err) throw err;
		console.error('[api/go-pro] Unexpected error:', err);
		throw error(500, 'Internal server error');
	}
};
