import { json, error } from '@sveltejs/kit';
import { parseJsonBody } from '$lib/server/validate';
import { checkMutationRateLimit } from '$lib/server/rate-limit';
import { requireAdmin } from '$lib/server/admin-guard';
import { getAdminClient } from '$lib/server/supabase-admin';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = async ({ locals, url }) => {
	await requireAdmin(locals);

	const admin = getAdminClient();
	if (!admin) throw error(503, 'Database not available');

	const boxType = url.searchParams.get('box_type');

	// pack_configurations is not yet in the generated Supabase types
	// eslint-disable-next-line @typescript-eslint/no-explicit-any
	let query = (admin as any)
		.from('pack_configurations')
		.select('*')
		.eq('is_active', true);

	if (boxType) {
		query = query.eq('box_type', boxType).limit(1).maybeSingle();
	} else {
		query = query.order('box_type');
	}

	const { data, error: dbErr } = await query;

	if (dbErr) {
		console.error('[admin/pack-config] GET DB error:', dbErr.message);
		throw error(500, 'Database operation failed');
	}

	return json(data || (boxType ? null : []));
};

export const PUT: RequestHandler = async ({ request, locals }) => {
	await requireAdmin(locals);
	const { user } = await locals.safeGetSession();
	if (!user) throw error(401, 'Unauthorized');

	const admin = getAdminClient();
	if (!admin) throw error(503, 'Database not available');

	const rateLimit = await checkMutationRateLimit(user.id);
	if (!rateLimit.success) {
		return json({ error: 'Too many requests' }, { status: 429, headers: { 'X-RateLimit-Limit': String(rateLimit.limit), 'X-RateLimit-Remaining': String(rateLimit.remaining), 'X-RateLimit-Reset': String(rateLimit.reset) } });
	}

	const body = await parseJsonBody(request);
	const { id, box_type, set_code, display_name, slots, packs_per_box } = body as Record<string, unknown>;

	// Validate slot weights
	if (!Array.isArray(slots)) throw error(400, 'slots must be an array');

	for (const slot of slots) {
		const weightSum = slot.outcomes.reduce(
			(sum: number, o: { weight: number }) => sum + o.weight,
			0
		);
		if (Math.abs(weightSum - 100) > 0.01) {
			throw error(
				400,
				`Slot ${slot.slotNumber} weights sum to ${weightSum.toFixed(1)}, must be 100`
			);
		}
	}

	const record = {
		box_type,
		set_code: set_code || 'alpha',
		display_name: display_name || box_type,
		slots,
		packs_per_box: packs_per_box || 10,
		is_active: true,
		updated_at: new Date().toISOString(),
		updated_by: user.id
	};

	// eslint-disable-next-line @typescript-eslint/no-explicit-any
	const supabase = admin as any;
	let result;
	if (id) {
		const { data, error: dbErr } = await supabase
			.from('pack_configurations')
			.update(record)
			.eq('id', id)
			.select()
			.single();

		if (dbErr) {
			console.error('[admin/pack-config] PUT update DB error:', dbErr.message);
			throw error(500, 'Database operation failed');
		}
		result = data;
	} else {
		const { data, error: dbErr } = await supabase
			.from('pack_configurations')
			.insert(record)
			.select()
			.single();

		if (dbErr) {
			console.error('[admin/pack-config] PUT insert DB error:', dbErr.message);
			throw error(500, 'Database operation failed');
		}
		result = data;
	}

	return json(result);
};
