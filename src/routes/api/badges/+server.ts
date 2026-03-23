/**
 * POST /api/badges — Award a badge to the authenticated user
 *
 * Accepts a badge_key and awards it if the user doesn't already have it.
 * Only awards badges from the predefined list (no arbitrary badge creation).
 */

import { json, error } from '@sveltejs/kit';
import { checkCollectionRateLimit } from '$lib/server/rate-limit';
import type { RequestHandler } from './$types';

/** All valid badges and their metadata */
const BADGE_DEFINITIONS: Record<string, { name: string; description: string; icon: string }> = {
	shutterbug: {
		name: 'Shutterbug',
		description: 'Captured the top reference image for a card',
		icon: '📸'
	},
	sharp_eye: {
		name: 'Sharp Eye',
		description: 'Hold 10 top reference images',
		icon: '👁️'
	},
	card_photographer: {
		name: 'Card Photographer',
		description: 'Hold 50 top reference images',
		icon: '📷'
	},
	lens_master: {
		name: 'Lens Master',
		description: 'Hold 100 top reference images',
		icon: '🔍'
	},
	the_archivist: {
		name: 'The Archivist',
		description: 'Hold 500 top reference images — legendary contributor',
		icon: '🏛️'
	},
	speed_demon: {
		name: 'Speed Demon',
		description: 'Scored 50+ points in a speed challenge round',
		icon: '⚡'
	},
	collector: {
		name: 'Collector',
		description: 'Added 100 cards to your collection',
		icon: '🃏'
	},
	deck_architect: {
		name: 'Deck Architect',
		description: 'Built a tournament-legal deck',
		icon: '🏗️'
	}
};

export const POST: RequestHandler = async ({ request, locals, getClientAddress }) => {
	const { user } = await locals.safeGetSession();
	if (!user) throw error(401, 'Sign in to earn badges');
	if (!locals.supabase) throw error(503, 'Service unavailable');

	// Rate limit badge requests
	const rateLimit = await checkCollectionRateLimit(user.id);
	if (!rateLimit.success) {
		return json({ error: 'Too many requests' }, { status: 429 });
	}

	const body = await request.json();
	const badgeKey = body.badge_key as string;

	if (!badgeKey || !BADGE_DEFINITIONS[badgeKey]) {
		throw error(400, 'Invalid badge key');
	}

	const badge = BADGE_DEFINITIONS[badgeKey];

	// RPC not in generated types — use untyped client
	// eslint-disable-next-line @typescript-eslint/no-explicit-any
	const { data: awarded } = await (locals.supabase as any)
		.rpc('award_badge_if_new', {
			p_user_id: user.id,
			p_badge_key: badgeKey,
			p_badge_name: badge.name,
			p_description: badge.description,
			p_icon: badge.icon
		});

	return json({ awarded: awarded === true, badge_key: badgeKey, badge_name: badge.name });
};
