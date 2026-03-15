/**
 * BoBA Weapon Type Hierarchy
 *
 * Weapons determine card rarity, power tier, and tie-breaking in gameplay.
 * Ordered from most rare/powerful to least rare/powerful.
 * The rarer the weapon, the higher the card's power value and collector value.
 */

export interface WeaponType {
	/** Weapon name as it appears on cards */
	name: string;
	/** Short lowercase key for DB/code usage */
	key: string;
	/** Rarity tier (maps to the app's existing rarity system) */
	rarity: 'legendary' | 'ultra_rare' | 'rare' | 'uncommon' | 'common';
	/** Hierarchy rank: 1 = most rare/powerful, 8 = least */
	rank: number;
	/** Whether this weapon wins all ties against lower-ranked weapons */
	tieBreaker: boolean;
	/** Visual color on card (for scan identification and UI display) */
	color: string;
	/** Visual icon description (helps AI scan prompt identify weapon type) */
	iconDescription: string;
	/** Whether this weapon type is eligible as an "Apex card" (165+ power) in Madness format */
	isApexEligible: boolean;
}

export const WEAPON_HIERARCHY: WeaponType[] = [
	{
		name: 'Super',
		key: 'super',
		rarity: 'legendary',
		rank: 1,
		tieBreaker: true,
		color: '#FFD700',
		iconDescription: 'Gold-on-black finish, 1/1 superfoil treatment',
		isApexEligible: true
	},
	{
		name: 'Gum',
		key: 'gum',
		rarity: 'legendary',
		rank: 2,
		tieBreaker: false,
		color: '#FF69B4',
		iconDescription: 'Pink bubble/bubblegum themed, secret rare',
		isApexEligible: true
	},
	{
		name: 'Hex',
		key: 'hex',
		rarity: 'ultra_rare',
		rank: 3,
		tieBreaker: false,
		color: '#8B5CF6',
		iconDescription: 'Purple skull/dark magic icon, Inspired Ink autograph serialized to /10',
		isApexEligible: true
	},
	{
		name: 'Glow',
		key: 'glow',
		rarity: 'ultra_rare',
		rank: 4,
		tieBreaker: false,
		color: '#FBBF24',
		iconDescription: 'Yellow/green radioactive glow icon',
		isApexEligible: true
	},
	{
		name: 'Fire',
		key: 'fire',
		rarity: 'rare',
		rank: 5,
		tieBreaker: false,
		color: '#EF4444',
		iconDescription: 'Red flame icon',
		isApexEligible: true
	},
	{
		name: 'Ice',
		key: 'ice',
		rarity: 'rare',
		rank: 6,
		tieBreaker: false,
		color: '#3B82F6',
		iconDescription: 'Blue crystal/snowflake icon',
		isApexEligible: true
	},
	{
		name: 'Steel',
		key: 'steel',
		rarity: 'common',
		rank: 7,
		tieBreaker: false,
		color: '#9CA3AF',
		iconDescription: 'Gray shield icon, most common weapon type',
		isApexEligible: false
	},
	{
		name: 'Brawl',
		key: 'brawl',
		rarity: 'common',
		rank: 8,
		tieBreaker: false,
		color: '#F97316',
		iconDescription: 'Orange fist icon, introduced in 2026 Edition for close-quarters combat',
		isApexEligible: false
	}
];

/** Get a weapon by key (case-insensitive) */
export function getWeapon(key: string): WeaponType | undefined {
	return WEAPON_HIERARCHY.find(w => w.key === key.toLowerCase() || w.name.toLowerCase() === key.toLowerCase());
}

/** Get weapon rank (lower = rarer). Returns Infinity for unknown weapons. */
export function getWeaponRank(key: string): number {
	return getWeapon(key)?.rank ?? Infinity;
}

/** Check if weapon1 beats weapon2 in a tie (only Super beats everything) */
export function winsOnTie(weapon1: string, weapon2: string): boolean {
	const w1 = getWeapon(weapon1);
	const w2 = getWeapon(weapon2);
	if (!w1 || !w2) return false;
	if (w1.tieBreaker && !w2.tieBreaker) return true;
	return false;
}

/** Check if a card's power qualifies as "Apex" (165+, used in Madness format) */
export function isApexPower(power: number): boolean {
	return power >= 165;
}

/** Get all weapon type keys as a string array (for validation) */
export function getAllWeaponKeys(): string[] {
	return WEAPON_HIERARCHY.map(w => w.key);
}
