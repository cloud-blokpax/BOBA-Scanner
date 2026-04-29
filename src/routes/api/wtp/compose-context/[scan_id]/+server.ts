import { error, json } from '@sveltejs/kit';
import { apiError } from '$lib/server/api-response';
import { getAdminClient } from '$lib/server/supabase-admin';
import { buildComposeContext } from '$lib/server/wtp/compose-context';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = async ({ params, locals }) => {
	const { user } = await locals.safeGetSession();
	if (!user) throw error(401, 'Authentication required');

	const admin = getAdminClient();
	if (!admin) return apiError('Service unavailable', 503);

	const result = await buildComposeContext(admin, user.id, params.scan_id);
	if (!result.ok) {
		switch (result.error.kind) {
			case 'scan_not_found':
				return apiError('Scan not found', 404, { code: 'scan_not_found' });
			case 'scan_unresolved':
				return apiError('Scan did not resolve to a card', 400, { code: 'scan_unresolved' });
			case 'card_not_found':
				return apiError('Card not found', 404, { code: 'card_not_found' });
			case 'wrong_game':
				return apiError('Card is not a Wonders card', 400, {
					code: 'wrong_game',
					details: { game_id: result.error.game_id }
				});
		}
	}

	return json(result.context);
};
