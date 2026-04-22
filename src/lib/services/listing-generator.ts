import type { Card } from '$lib/types';
import { buildEbayListingTitle } from '$lib/utils/ebay-title';
import { PARALLEL_FULL_NAME, normalizeParallel } from '$lib/data/parallels';

export interface ListingTemplate {
	title: string;
	description: string;
	suggested_price: number | null;
	condition: string;
}

/**
 * Generate an eBay/Whatnot listing template.
 *
 * @param card - Card record (game-agnostic shape)
 * @param priceData - Optional price data for suggested_price
 * @param condition - Physical condition (Near Mint, etc.)
 * @param parallel - Human-readable parallel name (e.g. "Paper", "Classic Foil",
 *   "Battlefoil"). Mirrors cards.parallel and matches the DB. For Wonders this
 *   drives the title/description block. BoBA encodes parallel in card_number,
 *   so its title generator pulls from card.parallel directly.
 */
export function generateListingTemplate(
	card: Card,
	priceData?: { price_mid: number | null } | null,
	condition = 'Near Mint',
	parallel: string = 'Paper'
): ListingTemplate {
	const gameId = card.game_id || 'boba';
	const heroName = card.hero_name || card.name || 'Unknown';

	const title = buildEbayListingTitle({
		hero_name: card.hero_name,
		name: card.name,
		athlete_name: card.athlete_name,
		parallel: card.parallel ?? parallel,
		weapon_type: card.weapon_type,
		card_number: card.card_number,
		game_id: gameId,
		metadata: card.metadata ?? null,
	});

	const description = gameId === 'wonders'
		? buildWondersDescription(card, condition, parallel)
		: buildBobaDescription(card, condition, heroName);

	return {
		title,
		description,
		suggested_price: priceData?.price_mid ? Math.round(priceData.price_mid * 1.1 * 100) / 100 : null,
		condition
	};
}

export function buildBobaDescription(card: Card, condition: string, heroName: string): string {
	return [
		`${heroName} - Bo Jackson Battle Arena Trading Card`,
		'',
		`Card Number: ${card.card_number || 'N/A'}`,
		`Set: ${card.set_code || 'N/A'}`,
		card.athlete_name ? `Athlete: ${card.athlete_name}` : '',
		card.parallel ? `Parallel: ${card.parallel}` : '',
		card.weapon_type ? `Weapon Type: ${card.weapon_type}` : '',
		card.power ? `Power: ${card.power}` : '',
		card.rarity ? `Rarity: ${card.rarity.replace('_', ' ')}` : '',
		'',
		`Condition: ${condition}`,
		'',
		'Ships in a penny sleeve and top loader for protection.',
		'Combined shipping available on multiple cards.'
	].filter(Boolean).join('\n');
}

export function buildWondersDescription(card: Card, condition: string, parallel: string): string {
	const meta = (card.metadata ?? {}) as Record<string, unknown>;
	const setDisplay = (meta.set_name_display ?? meta.set_name ?? card.set_code ?? 'N/A') as string;
	// `parallel` may be a short code or already a human-readable name; normalize
	// to a short code first so we can look up the canonical display name.
	const parallelName = PARALLEL_FULL_NAME[normalizeParallel(parallel)] ?? parallel ?? 'Paper';
	const cardClass = typeof meta.card_class === 'string' ? meta.card_class : null;
	const rarityText = card.rarity ? String(card.rarity).replace('_', ' ') : null;

	return [
		`${card.name || 'Unknown'} - Wonders of The First Trading Card`,
		'',
		`Wonders of The First — ${setDisplay}`,
		`Parallel: ${parallelName}`,
		`Collector Number: ${card.card_number || 'N/A'}`,
		rarityText ? `Rarity: ${rarityText}` : '',
		cardClass ? `Class: ${cardClass}` : '',
		typeof meta.type_line === 'string' && meta.type_line ? `Type: ${meta.type_line}` : '',
		typeof meta.cost === 'number' || typeof meta.cost === 'string' ? `Cost: ${meta.cost}` : '',
		'',
		`Condition: ${condition}`,
		'',
		'Ships in a penny sleeve and top loader for protection.',
		'Combined shipping available on multiple cards.'
	].filter(Boolean).join('\n');
}
