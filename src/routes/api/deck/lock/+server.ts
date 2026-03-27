/**
 * POST /api/deck/lock — Lock a deck for tournament play
 *
 * Validates the deck against the specified format, creates an immutable
 * snapshot in the deck_snapshots table, and returns a short verification code.
 *
 * Body: { deck_id: string, format_id: string }
 * Returns: { code: string, verify_url: string, is_valid: boolean, violations: Violation[], stats: DeckStats }
 */

import { json, error } from '@sveltejs/kit';
import { requireAuth, requireSupabase, parseJsonBody, requireString } from '$lib/server/validate';
import { checkHeavyMutationRateLimit } from '$lib/server/rate-limit';
import { getAdminClient } from '$lib/server/supabase-admin';
import type { RequestHandler } from './$types';
import type { Card } from '$lib/types';

function generateCode(length = 8): string {
	const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789';
	const bytes = crypto.getRandomValues(new Uint8Array(length));
	return Array.from(bytes, b => chars[b % chars.length]).join('');
}

interface DeckCard {
	card_id: string;
	zone: string;
	card: Card;
}

export const POST: RequestHandler = async ({ request, locals }) => {
	const user = await requireAuth(locals);
	const supabase = requireSupabase(locals);

	const rateLimit = await checkHeavyMutationRateLimit(user.id);
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
	const deckId = requireString(body.deck_id, 'deck_id');
	const formatId = requireString(body.format_id, 'format_id');

	// Fetch the deck and its cards — cast to unknown first to avoid
	// Supabase typed client issues with joined queries
	const { data: rawDeck, error: deckErr } = await supabase
		.from('decks')
		.select('*, cards:deck_cards(card_id, zone, card:cards(*))')
		.eq('id', deckId)
		.eq('user_id', user.id)
		.single();

	if (deckErr || !rawDeck) throw error(404, 'Deck not found');

	const deck = rawDeck as unknown as {
		id: string;
		name: string;
		cards: DeckCard[];
	};

	// Run validation
	const { validateDeck } = await import('$lib/services/deck-validator');

	const deckCards = deck.cards || [];

	const heroCards = deckCards
		.filter((c) => c.zone === 'hero' || !c.zone)
		.map((c) => c.card);

	const playCards = deckCards
		.filter((c) => c.zone === 'play')
		.map((c) => c.card);

	const hotDogCards = deckCards
		.filter((c) => c.zone === 'hotdog')
		.map((c) => c.card);

	const validation = validateDeck(heroCards, formatId, playCards, hotDogCards);

	// Generate a unique verification code
	const code = generateCode(8);
	const origin = new URL(request.url).origin;
	const verifyUrl = `${origin}/deck/verify/${code}`;

	// Store the immutable snapshot — use admin client to bypass RLS
	// The table may not be in the generated types yet, so use .from() with
	// a type assertion to work around the typed client restriction.
	const adminClient = getAdminClient() || supabase;

	const snapshotData = {
		code,
		user_id: user.id,
		deck_id: deckId,
		deck_name: deck.name || 'Unnamed Deck',
		format_id: formatId,
		format_name: validation.formatName,
		is_valid: validation.isValid,
		violations: validation.violations,
		stats: validation.stats,
		hero_cards: heroCards.map((c) => ({
			card_number: c.card_number,
			hero_name: c.hero_name,
			power: c.power,
			weapon_type: c.weapon_type,
			parallel: c.parallel
		})),
		play_cards: playCards.map((c) => ({
			card_number: c.card_number,
			name: c.name
		})),
		player_name: user.email?.split('@')[0] || 'Player',
		locked_at: new Date().toISOString()
	};

	// eslint-disable-next-line @typescript-eslint/no-explicit-any
	const { error: snapErr } = await (adminClient as any).from('deck_snapshots').insert(snapshotData);

	if (snapErr) {
		console.error('[deck/lock] Snapshot insert failed:', snapErr);
		throw error(500, 'Failed to lock deck');
	}

	return json({
		code,
		verify_url: verifyUrl,
		is_valid: validation.isValid,
		violations: validation.violations,
		stats: validation.stats
	});
	} catch (err) {
		if (err && typeof err === 'object' && 'status' in err) throw err;
		console.error('[deck/lock] Unexpected error:', err);
		throw error(500, 'Internal server error');
	}
};
