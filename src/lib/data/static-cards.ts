/**
 * Static card database loader.
 *
 * Imports the bundled card-database.json (bobaleagues format),
 * maps fields to the app's Card type, and filters invalid records.
 * This guarantees the card index is available even without Supabase.
 */

import rawCards from './card-database.json';
import { getAthleteForHero } from './boba-heroes';
import type { Card } from '$lib/types';

interface RawCard {
	'Card ID': number;
	Name: string | null;
	Year: number | null;
	Set: string | null;
	'Card Number': string | number | null;
	Parallel: string | null;
	Weapon: string | null;
	Power: number | null;
}

/**
 * Map a raw bobaleagues record to the app's Card type.
 * Field mapping:
 *   "Card ID"     → id (converted to string)
 *   "Name"        → name, hero_name (BOBA hero names are the card name)
 *   "Year"        → (not in Card type, but useful — ignored here)
 *   "Set"         → set_code
 *   "Card Number" → card_number (converted to string)
 *   "Parallel"    → rarity (approximate mapping)
 *   "Weapon"      → weapon_type
 *   "Power"       → power
 */
function mapCard(raw: RawCard): Card {
	const heroName = raw.Name || 'Unknown';
	return {
		id: String(raw['Card ID']),
		name: heroName,
		hero_name: heroName,
		athlete_name: getAthleteForHero(heroName) || null,
		set_code: raw.Set || 'Unknown',
		card_number: raw['Card Number'] != null ? String(raw['Card Number']) : null,
		power: raw.Power || null,
		rarity: mapParallelToRarity(raw.Parallel),
		weapon_type: raw.Weapon || null,
		battle_zone: null,
		image_url: null,
		created_at: new Date().toISOString()
	};
}

/**
 * Best-effort mapping from bobaleagues "Parallel" to the app's rarity enum.
 * Paper = common, standard Battlefoil = uncommon, named foils = rare,
 * Superfoil/Inspired Ink = ultra_rare, Promo = legendary.
 */
function mapParallelToRarity(parallel: string | null): Card['rarity'] {
	if (!parallel) return 'common';
	const p = parallel.toLowerCase();
	if (p === 'paper' || p === 'play' || p === 'bonus play') return 'common';
	if (p === 'battlefoil') return 'uncommon';
	if (p.includes('superfoil') || p.includes('inspired ink')) return 'ultra_rare';
	if (p.includes('battlefoil')) return 'rare'; // named battlefoils (Blue, Green, Rad, etc.)
	return 'common';
}

/**
 * The full static card database, pre-mapped and filtered.
 * Junk records (Card ID 0 and 777777777) are excluded.
 */
export const STATIC_CARDS: Card[] = (rawCards as unknown as RawCard[])
	.filter((r) => r['Card ID'] > 0 && r['Card ID'] < 777777777 && r.Name != null)
	.map(mapCard);
