/**
 * POST /api/whatnot/export — Bulk Whatnot CSV export
 *
 * Accepts an array of card IDs, fetches full card data + prices + collection info,
 * returns a Whatnot-formatted CSV file.
 */

import { json, error } from '@sveltejs/kit';
import { generateWhatnotCSV, type WhatnotExportCard, type WhatnotExportOptions } from '$lib/services/whatnot-export';
import { checkMutationRateLimit } from '$lib/server/rate-limit';
import type { RequestHandler } from './$types';

// Fetches up to 500 cards + prices + collection + images = multi-query chain
export const config = { maxDuration: 60 };

export const POST: RequestHandler = async ({ request, locals }) => {
	const { user } = await locals.safeGetSession();
	if (!user) throw error(401, 'Sign in to export');

	const rateLimit = await checkMutationRateLimit(user.id);
	if (!rateLimit.success) {
		return json({ error: 'Too many export requests' }, { status: 429 });
	}

	if (!locals.supabase) throw error(503, 'Database not available');

	// Pro gate — Whatnot export is a premium feature
	const { data: profile, error: profileErr } = await locals.supabase
		.from('users')
		.select('is_pro, is_admin')
		.eq('auth_user_id', user.id)
		.single();
	if (profileErr) {
		console.error('[whatnot/export] Profile lookup failed:', profileErr.message);
		throw error(500, 'Failed to verify account status');
	}
	if (!profile?.is_pro && !profile?.is_admin) {
		throw error(403, 'Whatnot export is a Pro feature. Upgrade to export your cards.');
	}

	const body = await request.json();
	const { cardIds, options } = body as {
		cardIds: string[];
		options?: WhatnotExportOptions;
	};

	if (!Array.isArray(cardIds) || !cardIds.length) {
		throw error(400, 'No card IDs provided');
	}

	if (cardIds.length > 500) {
		throw error(400, 'Maximum 500 cards per export');
	}

	const supabase = locals.supabase;

	// Fetch cards
	const { data: cards, error: cardsErr } = await supabase
		.from('cards')
		.select('id, hero_name, name, athlete_name, card_number, set_code, parallel, weapon_type, power, rarity')
		.in('id', cardIds);

	if (cardsErr) {
		console.error('[whatnot/export] Cards query failed:', cardsErr);
		throw error(500, 'Failed to fetch cards');
	}

	if (!cards?.length) {
		throw error(404, 'No cards found');
	}

	// Fetch prices
	const { data: prices } = await supabase
		.from('price_cache')
		.select('card_id, price_mid')
		.in('card_id', cardIds);

	const priceMap = new Map(
		(prices || []).map((p: { card_id: string; price_mid: number | null }) => [p.card_id, p.price_mid])
	);

	// Fetch collection data (quantity, condition)
	const { data: collection } = await supabase
		.from('collections')
		.select('card_id, quantity, condition')
		.eq('user_id', user.id)
		.in('card_id', cardIds);

	const collectionMap = new Map(
		(collection || []).map((c: { card_id: string; quantity: number; condition: string }) => [c.card_id, c])
	);

	// Fetch reference images for public URLs
	const { data: refImages } = await supabase
		.from('card_reference_images')
		.select('card_id, image_path')
		.in('card_id', cardIds);

	const imageMap = new Map<string, string>();
	for (const ref of refImages || []) {
		if (ref.card_id && ref.image_path && !imageMap.has(ref.card_id)) {
			const { data } = supabase.storage
				.from('card-images')
				.getPublicUrl(ref.image_path);
			if (data?.publicUrl) {
				imageMap.set(ref.card_id, data.publicUrl);
			}
		}
	}

	// Assemble export data
	const exportCards: WhatnotExportCard[] = cards.map((card: {
		id: string;
		hero_name: string | null;
		name: string | null;
		athlete_name: string | null;
		card_number: string | null;
		set_code: string | null;
		parallel: string | null;
		weapon_type: string | null;
		power: number | null;
		rarity: string | null;
	}) => {
		const col = collectionMap.get(card.id);
		return {
			...card,
			price_mid: priceMap.get(card.id) || null,
			quantity: col?.quantity || 1,
			condition: col?.condition || 'near_mint',
			image_url: imageMap.get(card.id) || null
		};
	});

	const csv = generateWhatnotCSV(exportCards, {
		...options,
		isPro: profile?.is_pro || profile?.is_admin || false
	});

	return new Response(csv, {
		status: 200,
		headers: {
			'Content-Type': 'text/csv; charset=utf-8',
			'Content-Disposition': `attachment; filename="whatnot-export-${new Date().toISOString().split('T')[0]}.csv"`
		}
	});
};
