import type { Card } from '$lib/types';

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
	const cardNum = card.card_number || '';
	const setCode = card.set_code || '';
	const rarity = card.rarity ? card.rarity.replace('_', ' ') : '';
	const parallel = card.parallel || '';

	// Build title: eBay max 80 chars, front-load with searchable terms
	let title = `Bo Jackson Battle Arena ${heroName}`;
	if (cardNum) title += ` #${cardNum}`;
	if (parallel) title += ` ${parallel}`;
	if (rarity && !title.toLowerCase().includes(rarity.toLowerCase())) title += ` ${rarity}`;
	if (setCode && title.length + setCode.length + 3 < 80) title += ` - ${setCode}`;
	title = title.substring(0, 80);

	const descLines = [
		`${heroName} - Bo Jackson Battle Arena Trading Card`,
		'',
		`Card Number: ${cardNum || 'N/A'}`,
		`Set: ${setCode || 'N/A'}`,
		`Rarity: ${rarity || 'N/A'}`,
		parallel ? `Parallel: ${parallel}` : '',
		card.weapon_type ? `Weapon Type: ${card.weapon_type}` : '',
		card.power ? `Power: ${card.power}` : '',
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
