import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { getAdminClient } from '$lib/server/supabase-admin';
import { apiError, rateLimited, serviceUnavailable } from '$lib/server/api-response';
import { checkMutationRateLimit } from '$lib/server/rate-limit';

export const PATCH: RequestHandler = async ({ request, locals }) => {
	const { session, user } = await locals.safeGetSession();
	if (!session || !user) {
		return apiError('Authentication required', 401, { code: 'UNAUTHORIZED' });
	}

	const rateLimit = await checkMutationRateLimit(user.id);
	if (!rateLimit.success) {
		return rateLimited(rateLimit);
	}

	const admin = getAdminClient();
	if (!admin) {
		return serviceUnavailable('Database');
	}

	let body: { name?: string; discord_id?: string };
	try {
		body = await request.json();
	} catch {
		return apiError('Invalid request body', 400, { code: 'INVALID_BODY' });
	}

	const updates: Record<string, string | null> = {};
	if ('name' in body) {
		updates.name = typeof body.name === 'string' ? body.name.trim() || null : null;
	}
	if ('discord_id' in body) {
		updates.discord_id = typeof body.discord_id === 'string' ? body.discord_id.trim() || null : null;
	}

	if (Object.keys(updates).length === 0) {
		return apiError('No fields to update', 400, { code: 'NO_FIELDS' });
	}

	const { data, error } = await admin
		.from('users')
		.update(updates)
		.eq('auth_user_id', user.id)
		.select('name, discord_id')
		.single();

	if (error) {
		console.error('[api/profile] Update failed:', error.message);
		return apiError('Failed to save profile', 500);
	}

	if (!data) {
		// Row doesn't exist yet — create it
		const { data: inserted, error: insertErr } = await admin
			.from('users')
			.insert({
				auth_user_id: user.id,
				email: user.email || '',
				...updates
			})
			.select('name, discord_id')
			.single();

		if (insertErr) {
			console.error('[api/profile] Insert failed:', insertErr.message);
			return apiError('Failed to create profile', 500);
		}

		return json(inserted);
	}

	return json(data);
};
