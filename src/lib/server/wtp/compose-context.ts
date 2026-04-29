/**
 * Builds the compose-context payload that the WTP composer page
 * needs to render: scan + card + image URLs + suggested price.
 *
 * Wonders catalog metadata (orbital, type_line, card_class, etc.)
 * lives in cards.metadata JSONB — the wonders_cards_full view was
 * dropped in migration 32. This helper extracts the well-known
 * Wonders fields and keeps the rest accessible via metadata.
 */

import type { SupabaseClient } from '@supabase/supabase-js';

export interface WtpComposeCard {
	id: string;
	name: string;
	card_number: string | null;
	parallel: string;
	set_name: string | null;
	rarity: string | null;
	orbital: string | null;
	special_attribute: string | null;
	game_id: string;
	image_url: string | null;
}

export interface WtpComposeContext {
	scan: {
		id: string;
		capture_source: string | null;
	};
	card: WtpComposeCard;
	image_urls: string[];
	suggested_price: {
		value: number;
		source: string;
		sample_size: number | null;
	} | null;
}

export type ComposeContextError =
	| { kind: 'scan_not_found' }
	| { kind: 'scan_unresolved' }
	| { kind: 'card_not_found' }
	| { kind: 'wrong_game'; game_id: string };

export type ComposeContextResult =
	| { ok: true; context: WtpComposeContext }
	| { ok: false; error: ComposeContextError };

function readMetadataString(metadata: unknown, key: string): string | null {
	if (!metadata || typeof metadata !== 'object') return null;
	const v = (metadata as Record<string, unknown>)[key];
	return typeof v === 'string' && v.trim() ? v : null;
}

export async function buildComposeContext(
	admin: SupabaseClient,
	userId: string,
	scanId: string
): Promise<ComposeContextResult> {
	const { data: scan } = await admin
		.from('scans')
		.select('id, user_id, final_card_id, capture_source, photo_storage_path, photo_thumbnail_path')
		.eq('id', scanId)
		.eq('user_id', userId)
		.maybeSingle();

	if (!scan) return { ok: false, error: { kind: 'scan_not_found' } };
	if (!scan.final_card_id) return { ok: false, error: { kind: 'scan_unresolved' } };

	const { data: card } = await admin
		.from('cards')
		.select('id, name, card_number, parallel, set_code, rarity, image_url, game_id, metadata')
		.eq('id', scan.final_card_id)
		.maybeSingle();

	if (!card) return { ok: false, error: { kind: 'card_not_found' } };
	if (card.game_id !== 'wonders') {
		return { ok: false, error: { kind: 'wrong_game', game_id: card.game_id } };
	}

	const composeCard: WtpComposeCard = {
		id: card.id,
		name: card.name,
		card_number: card.card_number,
		parallel: card.parallel ?? 'Paper',
		set_name: readMetadataString(card.metadata, 'set_display_name') ?? card.set_code ?? null,
		rarity: card.rarity,
		orbital: readMetadataString(card.metadata, 'orbital'),
		special_attribute: readMetadataString(card.metadata, 'special_attribute'),
		game_id: card.game_id,
		image_url: card.image_url
	};

	const imageUrls: string[] = [];
	const supabaseUrl = process.env.PUBLIC_SUPABASE_URL ?? '';
	if (scan.photo_storage_path && supabaseUrl) {
		imageUrls.push(`${supabaseUrl}/storage/v1/object/public/scan-images/${scan.photo_storage_path}`);
	}
	if (composeCard.image_url) imageUrls.push(composeCard.image_url);

	const { data: priceRows } = await admin
		.from('price_cache')
		.select('source, buy_now_mid, listings_count, parallel')
		.eq('card_id', card.id)
		.eq('parallel', composeCard.parallel)
		.in('source', ['wtp-active', 'wtp-sold', 'ebay-browse']);

	const preferred =
		priceRows?.find((r) => r.source === 'wtp-active') ??
		priceRows?.find((r) => r.source === 'wtp-sold') ??
		priceRows?.[0] ??
		null;

	const suggested = preferred && preferred.buy_now_mid != null
		? {
				value: Number(preferred.buy_now_mid),
				source: preferred.source as string,
				sample_size: preferred.listings_count as number | null
			}
		: null;

	return {
		ok: true,
		context: {
			scan: { id: scan.id, capture_source: scan.capture_source },
			card: composeCard,
			image_urls: imageUrls,
			suggested_price: suggested
		}
	};
}
