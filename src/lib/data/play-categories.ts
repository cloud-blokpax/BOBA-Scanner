/**
 * Play Card Strategic Categories
 *
 * Each category defines a strategic function that plays can serve.
 * The Playbook Architect uses these to classify a player's collection,
 * calculate draw consistency per category, and recommend plays.
 *
 * A single play can belong to multiple categories (e.g., a play that
 * gives +20 AND draws a card belongs to both 'power_boost' and 'draw_play').
 */

export interface PlayCategory {
	id: string;
	name: string;
	description: string;
	/** Regex patterns to match against ability text (case-insensitive) */
	patterns: RegExp[];
	/** Whether this category is essential for deck function (affects scoring) */
	isEssential: boolean;
	/** Recommended minimum cards of this category in a 30-card deck */
	recommendedMin: number;
	/** Recommended maximum (beyond this, diminishing returns) */
	recommendedMax: number;
}

export const PLAY_CATEGORIES: PlayCategory[] = [
	{
		id: 'power_boost',
		name: 'Power Boost',
		description: "Directly increases your hero's power in the active battle",
		patterns: [/your hero gets \+\d+/i, /hero gets \+\d+/i, /gets \+\d+ power/i],
		isEssential: true,
		recommendedMin: 8,
		recommendedMax: 15
	},
	{
		id: 'opponent_debuff',
		name: 'Opponent Debuff',
		description: "Reduces the opponent's hero power or restricts their options",
		patterns: [/opponent.*(?:gets|loses?) -\d+/i, /their hero.*-\d+/i, /opponent.*hero.*-\d+/i],
		isEssential: false,
		recommendedMin: 3,
		recommendedMax: 8
	},
	{
		id: 'draw_play',
		name: 'Draw Plays',
		description: 'Draws additional plays from your playbook — the combo enablers',
		patterns: [/draw (?:a|\d+) play/i, /draw play/i],
		isEssential: true,
		recommendedMin: 4,
		recommendedMax: 10
	},
	{
		id: 'hd_recovery',
		name: 'Hot Dog Recovery',
		description: 'Recovers hot dogs from your discard pile to extend your resource budget',
		patterns: [/recover.*hot dog/i],
		isEssential: true,
		recommendedMin: 3,
		recommendedMax: 7
	},
	{
		id: 'hd_attack',
		name: 'Hot Dog Attack',
		description: "Drains the opponent's hot dog supply or inflates their play costs",
		patterns: [
			/opponent.*(?:lose|discard).*hot dog/i,
			/opponent.*pay.*hot dog/i,
			/cost.*extra.*hot dog/i
		],
		isEssential: false,
		recommendedMin: 0,
		recommendedMax: 5
	},
	{
		id: 'sub_denial',
		name: 'Substitution Denial',
		description: 'Prevents the opponent from substituting heroes',
		patterns: [/can'?t substitute/i, /can ?not substitute/i],
		isEssential: false,
		recommendedMin: 0,
		recommendedMax: 3
	},
	{
		id: 'play_denial',
		name: 'Play Denial',
		description: 'Prevents the opponent from using plays in a battle',
		patterns: [/can'?t run.*play/i, /can'?t use.*play/i, /opponent.*no play/i],
		isEssential: false,
		recommendedMin: 0,
		recommendedMax: 2
	},
	{
		id: 'persistent',
		name: 'Persistent Effect',
		description:
			'Creates a lasting effect for the rest of the game — high value but usually high cost',
		patterns: [/rest of the game/i, /for the rest/i],
		isEssential: false,
		recommendedMin: 2,
		recommendedMax: 6
	},
	{
		id: 'coin_flip',
		name: 'Coin Flip',
		description: 'Uses coin flips for effects — pairs with Loan Sharked for guaranteed value',
		patterns: [/flip.*coin/i, /coin.*flip/i],
		isEssential: false,
		recommendedMin: 0,
		recommendedMax: 12
	},
	{
		id: 'dice_roll',
		name: 'Dice Roll',
		description:
			'Uses dice rolls for effects — pairs with Deep In The Playbook and Pay The Price',
		patterns: [/roll.*dice/i, /dice.*roll/i, /roll a die/i],
		isEssential: false,
		recommendedMin: 0,
		recommendedMax: 10
	},
	{
		id: 'comeback',
		name: 'Comeback',
		description:
			'Benefits from losing battles — the foundation of the Lose-to-Win archetype',
		patterns: [/if you los[et]/i, /lost the previous/i, /lost.*battle/i, /for every battle.*lost/i],
		isEssential: false,
		recommendedMin: 0,
		recommendedMax: 6
	},
	{
		id: 'scaling',
		name: 'Scaling',
		description:
			'Gets stronger as the game progresses — power grows with discard pile, battle count, etc.',
		patterns: [/for every/i, /for each/i, /\+\d+ for/i],
		isEssential: false,
		recommendedMin: 2,
		recommendedMax: 6
	},
	{
		id: 'weapon_steel',
		name: 'Steel Weapon',
		description: 'Requires or benefits from Steel weapon heroes',
		patterns: [/(?:your hero|heroes).*(?:has|have|with).*steel.*weapon/i, /steel weapon/i],
		isEssential: false,
		recommendedMin: 0,
		recommendedMax: 13
	},
	{
		id: 'weapon_fire',
		name: 'Fire Weapon',
		description: 'Requires or benefits from Fire weapon heroes',
		patterns: [/(?:your hero|heroes).*(?:has|have|with).*fire.*weapon/i, /fire weapon/i],
		isEssential: false,
		recommendedMin: 0,
		recommendedMax: 11
	},
	{
		id: 'weapon_ice',
		name: 'Ice Weapon',
		description: 'Requires or benefits from Ice weapon heroes',
		patterns: [/(?:your hero|heroes).*(?:has|have|with).*ice.*weapon/i, /ice weapon/i],
		isEssential: false,
		recommendedMin: 0,
		recommendedMax: 10
	},
	{
		id: 'free_play',
		name: 'Free Play (0 HD)',
		description:
			'Costs 0 hot dogs to activate — the backbone of resource-light strategies',
		patterns: [], // Detected by hot_dog_cost === 0, not ability text
		isEssential: false,
		recommendedMin: 4,
		recommendedMax: 18
	}
];

/** Get a category by ID */
export function getCategory(id: string): PlayCategory | undefined {
	return PLAY_CATEGORIES.find((c) => c.id === id);
}

/**
 * Categorize a play card by matching its ability text against category patterns.
 * Returns an array of category IDs that the play belongs to.
 */
export function categorizePlay(play: { ability: string; hot_dog_cost: number }): string[] {
	const categories: string[] = [];

	for (const cat of PLAY_CATEGORIES) {
		if (cat.id === 'free_play') {
			if (play.hot_dog_cost === 0) categories.push(cat.id);
			continue;
		}
		for (const pattern of cat.patterns) {
			if (pattern.test(play.ability)) {
				categories.push(cat.id);
				break;
			}
		}
	}

	return categories;
}
