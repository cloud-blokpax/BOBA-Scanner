/**
 * POST /api/deck/validate
 *
 * Server-side deck validation endpoint.
 * Keeps tournament-formats, boba-parallels, and boba-dbs-scores
 * out of the client bundle by running validation on the server.
 *
 * Accepts card IDs and looks up actual card data server-side
 * to prevent clients from submitting falsified card attributes.
 */
import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { validateDeck, type DeckValidationResult } from '$lib/services/deck-validator';
import { checkCollectionRateLimit } from '$lib/server/rate-limit';
import type { Card } from '$lib/types';

export const POST: RequestHandler = async ({ request, locals, getClientAddress }) => {
	// Rate limit validation requests
	const { user } = await locals.safeGetSession();
	const rateLimitKey = user?.id ?? getClientAddress();
	const rateLimit = await checkCollectionRateLimit(rateLimitKey);
	if (!rateLimit.success) {
		return json({ error: 'Too many requests' }, { status: 429 });
	}

	try {
		const body = await request.json();
		const { heroCardIds, formatId, playCardIds = [], hotDogCount = 0 } = body as {
			heroCardIds: string[];
			formatId: string;
			playCardIds?: string[];
			hotDogCount?: number;
		};

		if (!Array.isArray(heroCardIds) || typeof formatId !== 'string') {
			return json(
				{ error: 'Invalid request: heroCardIds (array) and formatId (string) required' },
				{ status: 400 }
			);
		}

		// Cap array sizes to prevent abuse
		if (heroCardIds.length > 100 || playCardIds.length > 100) {
			return json({ error: 'Too many cards in request' }, { status: 400 });
		}

		// Look up actual card data server-side — never trust client-supplied card objects
		const allIds = [...new Set([...heroCardIds, ...playCardIds])];

		if (!locals.supabase) {
			return json({ error: 'Database not available' }, { status: 503 });
		}

		// Batch fetch in chunks of 100 (Supabase .in() limit)
		const allCards: Card[] = [];
		for (let i = 0; i < allIds.length; i += 100) {
			const chunk = allIds.slice(i, i + 100);
			const { data, error: dbError } = await locals.supabase
				.from('cards')
				.select('*')
				.in('id', chunk);
			if (dbError) {
				return json({ error: 'Failed to fetch card data' }, { status: 500 });
			}
			if (data) allCards.push(...(data as Card[]));
		}

		const cardMap = new Map(allCards.map(c => [c.id, c]));
		const heroCards = heroCardIds.map(id => cardMap.get(id)).filter(Boolean) as Card[];
		const playCards = playCardIds.map(id => cardMap.get(id)).filter(Boolean) as Card[];

		// Generate placeholder hot dog cards (they don't have individual card data)
		const hotDogCards: Card[] = [];

		const result: DeckValidationResult = validateDeck(heroCards, formatId, playCards, hotDogCards);
		return json(result);
	} catch (err) {
		console.error('[api/deck/validate] Validation failed:', err);
		return json(
			{ error: 'Validation failed' },
			{ status: 500 }
		);
	}
};
