/**
 * POST /api/deck/validate
 *
 * Server-side deck validation endpoint.
 * Keeps tournament-formats, boba-parallels, and boba-dbs-scores
 * out of the client bundle by running validation on the server.
 */
import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { validateDeck, type DeckValidationResult } from '$lib/services/deck-validator';
import type { Card } from '$lib/types';

interface ValidateRequestBody {
	heroCards: Card[];
	formatId: string;
	playCards?: Card[];
	hotDogCards?: Card[];
}

export const POST: RequestHandler = async ({ request }) => {
	try {
		const body: ValidateRequestBody = await request.json();
		const { heroCards, formatId, playCards = [], hotDogCards = [] } = body;

		// Basic input validation
		if (!Array.isArray(heroCards) || typeof formatId !== 'string') {
			return json(
				{ error: 'Invalid request: heroCards (array) and formatId (string) required' },
				{ status: 400 }
			);
		}

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
