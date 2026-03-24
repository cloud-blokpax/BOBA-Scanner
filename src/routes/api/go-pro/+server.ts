import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';

const TIERS: Record<string, { amount: number; label: string }> = {
	legendary: { amount: 25, label: 'Unbelievable and worth every penny' },
	epic:      { amount: 15, label: 'Must have for this price' },
	standard:  { amount: 5,  label: 'This app is ok — I will give' },
	custom:    { amount: 0,  label: 'I must ponder the value' }
};

export const POST: RequestHandler = async ({ request, locals }) => {
	const { user } = await locals.safeGetSession();
	if (!user) throw error(401, 'Sign in to Go Pro');
	if (!locals.supabase) throw error(503, 'Service unavailable');

	const body = await request.json();
	const tierKey = body.tier_key as string;
	const paymentMethod = body.payment_method as string;

	if (!tierKey || !(tierKey in TIERS)) throw error(400, 'Invalid tier');
	if (!paymentMethod || !['venmo', 'paypal'].includes(paymentMethod)) throw error(400, 'Invalid payment method');

	const tier = TIERS[tierKey];

	const { data, error: rpcError } = await locals.supabase.rpc('activate_pro', {
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
};
