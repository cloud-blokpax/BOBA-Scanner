import type { Card } from '$lib/types';
import { buildEbayListingTitle } from '$lib/utils/ebay-title';

export interface ListingTemplate {
	title: string;
	description: string;
	suggested_price: number | null;
	condition: string;
}

export function generateListingTemplate(
	card: Card,
	priceData?: { price_mid: number | null } | null,
	condition = 'Near Mint'
): ListingTemplate {
	const heroName = card.hero_name || card.name || 'Unknown';

	const title = buildEbayListingTitle({
		hero_name: card.hero_name,
		name: card.name,
		athlete_name: card.athlete_name,
		parallel: card.parallel,
		weapon_type: card.weapon_type,
		card_number: card.card_number
	});

	const descLines = [
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

	return {
		title,
		description: descLines,
		suggested_price: priceData?.price_mid ? Math.round(priceData.price_mid * 1.1 * 100) / 100 : null,
		condition
	};
}
