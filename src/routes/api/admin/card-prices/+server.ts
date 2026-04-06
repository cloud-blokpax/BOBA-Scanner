/**
 * GET /api/admin/card-prices — Paginated card price browser for admin
 *
 * Returns cards joined with price_cache and scan counts.
 * Supports search, sorting, filtering, and pagination.
 *
 * Query params:
 *   page (default 1), limit (default 50, max 100)
 *   search — filters by card name/number
 *   sort — "name" | "price" | "fetched" | "scans" (default "name")
 *   order — "asc" | "desc" (default "asc")
 *   filter — "all" | "priced" | "searched" | "unsearched" (default "all")
 */

import { json, error } from '@sveltejs/kit';
import { requireAdmin } from '$lib/server/admin-guard';
import { getAdminClient } from '$lib/server/supabase-admin';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = async ({ locals, url }) => {
	await requireAdmin(locals);

	const admin = getAdminClient();
	if (!admin) throw error(503, 'Database not available');

	const page = Math.max(1, parseInt(url.searchParams.get('page') || '1', 10));
	const limit = Math.min(100, Math.max(1, parseInt(url.searchParams.get('limit') || '50', 10)));
	const search = url.searchParams.get('search')?.trim() || '';
	const sort = url.searchParams.get('sort') || 'name';
	const order = url.searchParams.get('order') === 'desc' ? 'desc' : 'asc';
	const filter = url.searchParams.get('filter') || 'all';
	const offset = (page - 1) * limit;

	// Build query for cards with their latest price info
	// We use the RPC approach to get scan counts efficiently
	const { data: rows, error: queryError } = await admin.rpc('get_card_price_details', {
		p_search: search || null,
		p_filter: filter,
		p_sort: sort,
		p_order: order,
		p_limit: limit,
		p_offset: offset
	});

	if (queryError) {
		// RPC not deployed yet — fall back to direct queries
		console.warn('[card-prices] RPC not available, using fallback:', queryError.message);
		return await fallbackQuery(admin, { search, filter, sort, order, limit, offset });
	}

	// Get total count for pagination
	const { data: countData } = await admin.rpc('get_card_price_details_count', {
		p_search: search || null,
		p_filter: filter
	});

	const rawCount = countData as unknown as Array<{ total: number }> | number | null;
	const total = (Array.isArray(rawCount) ? rawCount[0]?.total : rawCount) ?? rows?.length ?? 0;

	return json({
		cards: rows || [],
		pagination: {
			page,
			limit,
			total,
			totalPages: Math.ceil(total / limit)
		}
	});
};

/** Fallback when the RPC function isn't deployed yet */
async function fallbackQuery(
	admin: NonNullable<ReturnType<typeof getAdminClient>>,
	opts: { search: string; filter: string; sort: string; order: string; limit: number; offset: number }
) {
	// Supabase/PostgREST caps responses at 1,000 rows regardless of .range(),
	// so we must paginate in chunks of 1,000 to fetch all data.
	const CHUNK = 1000;

	// Step 1: Get cards (with search filter) — paginated in 1k chunks
	type RawCard = {
		id: string;
		name: string;
		hero_name: string | null;
		card_number: string | null;
		power: number | null;
		weapon_type: string | null;
		parallel: string | null;
		set_code: string | null;
	};
	const allCards: RawCard[] = [];
	let cardOffset = 0;
	let cardsDone = false;
	while (!cardsDone) {
		let cardsQuery = admin.from('cards')
			.select('id, name, hero_name, card_number, power, weapon_type, parallel, set_code');

		if (opts.search) {
			cardsQuery = cardsQuery.or(
				`name.ilike.%${opts.search}%,card_number.ilike.%${opts.search}%,hero_name.ilike.%${opts.search}%`
			);
		}

		cardsQuery = cardsQuery.order('name', { ascending: true });

		const { data: cardRows, error: cardsError } = await cardsQuery.range(cardOffset, cardOffset + CHUNK - 1);
		if (cardsError) {
			console.error('[card-prices] Cards query failed:', cardsError.message);
			return json({ cards: [], pagination: { page: 1, limit: opts.limit, total: 0, totalPages: 0 } });
		}
		if (!cardRows || cardRows.length === 0) {
			cardsDone = true;
		} else {
			allCards.push(...cardRows);
			cardOffset += CHUNK;
			if (cardRows.length < CHUNK) cardsDone = true;
		}
	}

	if (allCards.length === 0) {
		return json({ cards: [], pagination: { page: 1, limit: opts.limit, total: 0, totalPages: 0 } });
	}

	// Step 2: Get all price_cache entries — paginated in 1k chunks
	const priceMap = new Map<string, {
		price_low: number | null;
		price_mid: number | null;
		price_high: number | null;
		listings_count: number | null;
		confidence_score: number | null;
		fetched_at: string | null;
	}>();

	let priceOffset = 0;
	let priceDone = false;
	while (!priceDone) {
		const { data: priceRows } = await admin.from('price_cache')
			.select('card_id, price_low, price_mid, price_high, listings_count, confidence_score, fetched_at')
			.eq('source', 'ebay')
			.range(priceOffset, priceOffset + CHUNK - 1);

		if (!priceRows || priceRows.length === 0) {
			priceDone = true;
		} else {
			for (const row of priceRows) {
				priceMap.set(row.card_id, {
					price_low: row.price_low,
					price_mid: row.price_mid,
					price_high: row.price_high,
					listings_count: row.listings_count,
					confidence_score: row.confidence_score,
					fetched_at: row.fetched_at
				});
			}
			priceOffset += CHUNK;
			if (priceRows.length < CHUNK) priceDone = true;
		}
	}

	// Step 3: Get scan counts per card — paginated in 1k chunks
	const scanCountMap = new Map<string, number>();
	let scanOffset = 0;
	let scanDone = false;
	while (!scanDone) {
		const { data: harvestRows } = await admin.from('price_harvest_log')
			.select('card_id')
			.range(scanOffset, scanOffset + CHUNK - 1);

		if (!harvestRows || harvestRows.length === 0) {
			scanDone = true;
		} else {
			for (const row of harvestRows) {
				scanCountMap.set(row.card_id, (scanCountMap.get(row.card_id) || 0) + 1);
			}
			scanOffset += CHUNK;
			if (harvestRows.length < CHUNK) scanDone = true;
		}
	}

	// Step 4: Join and build result
	type CardRow = {
		id: string;
		name: string;
		hero_name: string | null;
		card_number: string | null;
		power: number | null;
		weapon_type: string | null;
		parallel: string | null;
		set_code: string | null;
		price_low: number | null;
		price_mid: number | null;
		price_high: number | null;
		listings_count: number | null;
		confidence_score: number | null;
		fetched_at: string | null;
		scan_count: number;
	};

	let joined: CardRow[] = allCards.map(card => {
		const price = priceMap.get(card.id);
		return {
			id: card.id,
			name: card.name,
			hero_name: card.hero_name,
			card_number: card.card_number,
			power: card.power,
			weapon_type: card.weapon_type,
			parallel: card.parallel,
			set_code: card.set_code,
			price_low: price?.price_low ?? null,
			price_mid: price?.price_mid ?? null,
			price_high: price?.price_high ?? null,
			listings_count: price?.listings_count ?? null,
			confidence_score: price?.confidence_score ?? null,
			fetched_at: price?.fetched_at ?? null,
			scan_count: scanCountMap.get(card.id) || 0
		};
	});

	// Step 5: Apply filter
	if (opts.filter === 'priced') {
		joined = joined.filter(c => c.price_mid != null);
	} else if (opts.filter === 'searched') {
		joined = joined.filter(c => c.fetched_at != null && c.price_mid == null);
	} else if (opts.filter === 'unsearched') {
		joined = joined.filter(c => c.fetched_at == null);
	}

	// Step 6: Sort
	const dir = opts.order === 'desc' ? -1 : 1;
	joined.sort((a, b) => {
		switch (opts.sort) {
			case 'price':
				return ((a.price_mid ?? -1) - (b.price_mid ?? -1)) * dir;
			case 'fetched':
				if (!a.fetched_at && !b.fetched_at) return 0;
				if (!a.fetched_at) return 1;
				if (!b.fetched_at) return -1;
				return (new Date(a.fetched_at).getTime() - new Date(b.fetched_at).getTime()) * dir;
			case 'scans':
				return (a.scan_count - b.scan_count) * dir;
			default: // name
				return (a.name || '').localeCompare(b.name || '') * dir;
		}
	});

	const total = joined.length;
	const paged = joined.slice(opts.offset, opts.offset + opts.limit);

	return json({
		cards: paged,
		pagination: {
			page: Math.floor(opts.offset / opts.limit) + 1,
			limit: opts.limit,
			total,
			totalPages: Math.ceil(total / opts.limit)
		}
	});
}
