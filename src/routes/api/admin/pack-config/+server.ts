import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = async ({ locals }) => {
	const { user } = await locals.safeGetSession();
	if (!user) throw error(401, 'Unauthorized');

	const client = locals.supabase;
	if (!client) throw error(500, 'Database not configured');

	// pack_configurations is not yet in the generated Supabase types
	// eslint-disable-next-line @typescript-eslint/no-explicit-any
	const { data, error: dbErr } = await (client as any)
		.from('pack_configurations')
		.select('*')
		.eq('is_active', true)
		.order('box_type');

	if (dbErr) throw error(500, dbErr.message);

	return json(data || []);
};

export const PUT: RequestHandler = async ({ request, locals }) => {
	const { user } = await locals.safeGetSession();
	if (!user) throw error(401, 'Unauthorized');

	const client = locals.supabase;
	if (!client) throw error(500, 'Database not configured');

	const { data: userData } = await client
		.from('users')
		.select('is_admin')
		.eq('auth_user_id', user.id)
		.single();

	if (!userData?.is_admin) throw error(403, 'Admin access required');

	const body = await request.json();
	const { id, box_type, set_code, display_name, slots, packs_per_box } = body;

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
	const supabase = client as any;
	let result;
	if (id) {
		const { data, error: dbErr } = await supabase
			.from('pack_configurations')
			.update(record)
			.eq('id', id)
			.select()
			.single();

		if (dbErr) throw error(500, dbErr.message);
		result = data;
	} else {
		const { data, error: dbErr } = await supabase
			.from('pack_configurations')
			.insert(record)
			.select()
			.single();

		if (dbErr) throw error(500, dbErr.message);
		result = data;
	}

	return json(result);
};
