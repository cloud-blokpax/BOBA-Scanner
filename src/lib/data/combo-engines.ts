/**
 * BoBA Combo Engine Registry
 *
 * Curated multi-card synergy definitions. Each engine describes cards
 * that produce multiplicative value when combined — the whole is
 * significantly greater than the sum of the parts.
 *
 * Cards are identified by name (unique across the entire database).
 * The detection system matches against the player's current playbook
 * and reports complete, partial, and missing combos.
 */

export interface ComboEngine {
	/** Unique identifier */
	id: string;
	/** Display name */
	name: string;
	/** One-line tagline for the UI */
	tagline: string;
	/** Full strategic description (shown when expanded) */
	description: string;
	/** The chain explanation — how the cards interact */
	chain: string;
	/** Cards that define the combo — all required for full effect */
	coreCards: string[];
	/** Cards that enhance the combo but aren't required */
	enhancerCards: string[];
	/** Cards that "feed" the engine (e.g., dice plays for the Dice Engine) */
	feedCategory: string | null;
	/** Total DBS cost of core cards */
	coreDBS: number;
	/** Total HD cost of core cards */
	coreHD: number;
	/** Weapon requirement — null means weapon-agnostic */
	weaponRequirement: string | null;
	/** Risk level */
	risk: 'low' | 'medium' | 'high';
	/** Projected power swing per game when fully assembled */
	projectedImpact: string;
	/** Rarity tier of core cards (affects accessibility) */
	rarityNote: string;
}

export const COMBO_ENGINES: ComboEngine[] = [
	{
		id: 'dice_engine',
		name: 'The Dice Engine',
		tagline: 'Your opponent is punished for playing cards',
		description:
			'Three persistent effects that chain off dice rolls. When Leave It To Chance forces your opponent to roll dice for every play they attempt, each roll triggers Deep In The Playbook (you draw a free play) and Pay The Price (opponent hero -5). The opponent is punished just for trying to play the game.',
		chain: 'Play Leave It To Chance → opponent must roll dice to use ANY play → each roll triggers Deep In The Playbook (you draw a play) AND Pay The Price (opponent -5). If opponent uses 3 plays in a battle: you draw 3 plays AND their hero takes -15. Your own dice plays also trigger both effects.',
		coreCards: ['Deep In The Playbook', 'Pay The Price', 'Leave It To Chance'],
		enhancerCards: [
			'Dice Duel',
			'Luck Of The Draw',
			'Crystal Ball',
			'Lucky 7',
			'Roller Dogs'
		],
		feedCategory: 'dice_roll',
		coreDBS: 73,
		coreHD: 7,
		weaponRequirement: null,
		risk: 'medium',
		projectedImpact:
			'-15 to -25 opponent power per battle + 2-3 extra play draws per battle once assembled',
		rarityNote:
			'All 3 core cards are Alpha SSPs (PL-9, PL-17, PL-18). Premium collection required.'
	},
	{
		id: 'weapon_alchemy',
		name: 'Weapon Alchemy',
		tagline: 'Rewrite the weapon rules mid-game',
		description:
			"Convert ALL heroes in the game to one weapon type, then stack that weapon's buffs and anti-weapon plays. Your opponent's weapon-specific plays become dead cards. Advanced variant: convert everything to Steel, then use Molten Steel to change YOUR heroes to Fire for weapon-type advantage.",
		chain: "Play Only Steel (DBS 11) → all heroes become Steel → play Steel Boost → YOUR Steel heroes get permanent +10 → opponent's Fire/Ice plays are now dead → anti-Steel plays like Rusted Edge (+15) and Stain-Less-Steel (-15) fire EVERY battle.",
		coreCards: ['Only Steel', 'Steel Boost'],
		enhancerCards: [
			'Rusted Edge',
			'Stain-Less-Steel',
			'Steel Cage',
			'Steel Defense',
			'Molten Steel',
			'Frost-Hardened'
		],
		feedCategory: null,
		coreDBS: 27,
		coreHD: 5,
		weaponRequirement: null,
		risk: 'low',
		projectedImpact:
			"+10 permanent to all your heroes, opponent weapon-specific plays neutralized, anti-Steel plays guaranteed every battle",
		rarityNote:
			'Only Steel is Alpha Uncommon (PL-54), Steel Boost is Alpha SP (PL-22). Moderate accessibility.'
	},
	{
		id: 'starvation_lock',
		name: 'The Starvation Lock',
		tagline: 'Drain your opponent dry — then punish them for it',
		description:
			"Shut off hot dog recovery for both players, strip the opponent's remaining HD, then convert their inevitable 0 HD state into automatic battle losses. You survive by running free plays; they didn't plan for it.",
		chain: "Play Bun Shortage → no one recovers HD rest of game → play Drought → opponent loses 2 more HD → opponent runs out by Battle 5-6 → Ultimatum Dog means 0 HD = automatic loss. You run free plays so you don't need HD either.",
		coreCards: ['Bun Shortage', 'Ultimatum Dog'],
		enhancerCards: [
			'Drought',
			'Dog Gone Inflation',
			'Grilled Bandit',
			'Hungry Demands',
			'Hot Dog Thief',
			'Incendiary Dog'
		],
		feedCategory: 'free_plays',
		coreDBS: 33,
		coreHD: 8,
		weaponRequirement: null,
		risk: 'high',
		projectedImpact:
			'Opponent unable to play cards or substitute by Battle 5-6. Auto-win Battles 6-7 via Ultimatum Dog.',
		rarityNote:
			'Bun Shortage is Griffey Rare (PL-38[G]). Ultimatum Dog is Update BPL (DBS 3). Accessible combo.'
	},
	{
		id: 'unlimited_subs',
		name: 'The Unlimited Subs Engine',
		tagline: 'You adapt freely — your opponent is stuck',
		description:
			"Make all your substitutions free while locking the opponent out of substituting entirely. You always have the optimal hero in each zone; they're stuck with bad draws. Substitution Boost gives +5 for every sub, compounding over the game.",
		chain: "Play Unlimited Subs → your subs are free rest of game → play No More Subs → opponent can't sub rest of game → play Substitution Boost → every sub gives your hero +5 permanent. Over Battles 4-7: save 8 HD on subs, gain +20 from Substitution Boost.",
		coreCards: ['Unlimited Subs', 'Substitution Boost', 'No More Subs'],
		enhancerCards: ['Late Game Lockdown', 'Bench Lock', 'Bench Blocker'],
		feedCategory: null,
		coreDBS: 59,
		coreHD: 8,
		weaponRequirement: null,
		risk: 'medium',
		projectedImpact:
			'Save 8 HD on subs over 4 battles, gain +20 cumulative power, opponent locked into random draws',
		rarityNote:
			"All 3 core cards are Alpha (PL-19, PL-68, PL-15). Mixed rarity — Unlimited Subs is SP, others are Rare/SP."
	},
	{
		id: 'recovery_snowball',
		name: 'The Recovery Snowball',
		tagline: 'Every hot dog recovery is amplified',
		description:
			"Bonus Recovery makes every future recovery give +1 extra HD. Stack recovery plays and each one is amplified. Over a 7-battle game, this generates 3-4 extra HD — enough for 1-2 additional play activations. This is a fuel system, not a win condition. It makes every other strategy more sustainable.",
		chain: "Play Bonus Recovery (free, Battle 1) → all future recoveries give +1 extra → Victory Dinner (recover 3, now recover 4) → Synergy Snacks (recover 2, now recover 3) → 3-4 extra HD over the game.",
		coreCards: ['Bonus Recovery'],
		enhancerCards: [
			'Victory Dinner',
			"It's Gonna Cost Ya",
			'Synergy Snacks',
			'Dog Gone Flip',
			'Feast Or Famine',
			'Make Up Meal',
			'Instant Refund',
			"The Heroes Favorite Hot Dogs"
		],
		feedCategory: 'hd_recovery',
		coreDBS: 8,
		coreHD: 0,
		weaponRequirement: null,
		risk: 'low',
		projectedImpact: '+3-4 extra HD over a full game, enabling 1-2 additional play activations',
		rarityNote:
			'Bonus Recovery is Alpha BPL-3. BPLs are generally less scarce than SSP standard plays.'
	},
	{
		id: 'coin_flip_control',
		name: 'Coin Flip Control',
		tagline: 'Death by a thousand flips',
		description:
			'Loan Sharked makes every coin flip in the game deal -5 to the opponent. Stack 8-10 cheap coin flip plays and every activation does its normal effect PLUS -5. Even failed flips (tails) still damage the opponent. No losing outcome.',
		chain: 'Play Loan Sharked → every coin flip gives opponent -5 → stack Steel Smash, Firework, Ice Blast, Even Money, etc. → each flip does +20 on heads AND -5 regardless of outcome → cumulative -40 to -60 opponent power over 7 battles.',
		coreCards: ['Loan Sharked'],
		enhancerCards: [
			'Even Money',
			'Double Down',
			'Jump Ball',
			'Steel Smash',
			'Firework',
			'Ice Blast',
			'Hex Flipper',
			'Flip & Glow',
			'Lucky Gum',
			'Heads I Win, Tails You Lose',
			'Frozen Flip',
			'Flaming Flip',
			'Stainless Flip'
		],
		feedCategory: 'coin_flip',
		coreDBS: 10,
		coreHD: 2,
		weaponRequirement: null,
		risk: 'low',
		projectedImpact:
			'Projected -5 per flip × 7-12 flips per game = -35 to -60 cumulative opponent power',
		rarityNote:
			'Loan Sharked is Alpha Uncommon (PL-69). Most flipper plays are Update Commons/Uncommons. Very accessible.'
	},
	{
		id: 'noble_sacrifice_stack',
		name: 'Noble Sacrifice Stack',
		tagline: 'Invest early, dominate forever',
		description:
			'Stack 3-4 permanent buff/debuff effects in Battles 1-3, then coast on +40 net power swing per battle for the rest of the game. High HD cost upfront (10 total) requires recovery plays or accepting a weak early game.',
		chain: 'Noble Sacrifice (+10 all your heroes, this hero becomes 0) + Member Bounce (+10 all your heroes) + The 12th Man (-10 all opponent heroes) + Weapon Boost (+10 to your weapon heroes) = net +40 swing per battle for rest of game.',
		coreCards: ['Noble Sacrifice', 'Member Bounce', 'The 12th Man'],
		enhancerCards: [
			'Steel Boost',
			'Fire Boost',
			'Ice Boost',
			'Scorching Pressure',
			'Cold Pressure',
			'Steel Pressure'
		],
		feedCategory: 'persistent_buff',
		coreDBS: 35,
		coreHD: 8,
		weaponRequirement: null,
		risk: 'high',
		projectedImpact:
			'+30 to all your heroes, -10 to all opponent heroes = +40 net swing every remaining battle',
		rarityNote:
			'Noble Sacrifice is Alpha SP (PL-30). Member Bounce and 12th Man are Alpha BPLs. Moderate accessibility.'
	},
	{
		id: 'lose_to_win',
		name: 'The Comeback Engine',
		tagline: 'Lose 3, win 4 — with overwhelming force',
		description:
			'Deliberately sacrifice Battles 1-3 by placing weak heroes. Stockpile hot dogs and draws. Then explode in Battles 4-7 with massive comeback bonuses. Turn the Tide gives +60 for losing the first 3 — the largest single-card power swing in the entire database for just 1 DBS.',
		chain: 'Lose Battles 1-3 (place weak heroes, save HD) → Battle 4: Turn the Tide (+60) + Saving Bullets (+30) + To Fight Another Day (+20) + Comeback Time (+15) = +125 from plays. Pick Your Poison drains opponent, Competitive Disadvantage gives them -30. You must win 4 straight.',
		coreCards: ['Turn the Tide'],
		enhancerCards: [
			'To Fight Another Day',
			'Comeback Time',
			'Saving Bullets',
			'Make Up Meal',
			'Pick Your Poison',
			'Competitive Disadvantage',
			'Consolation Combo'
		],
		feedCategory: 'comeback',
		coreDBS: 1,
		coreHD: 4,
		weaponRequirement: null,
		risk: 'high',
		projectedImpact:
			'+125 power swing in Battle 4 after losing first 3. Must win 4 of remaining 4 battles.',
		rarityNote:
			'Turn the Tide is Update BPL-21 (DBS 1). Extremely accessible. Most supporting cards are commons/uncommons.'
	},
	{
		id: 'substitution_cleanse',
		name: 'The Substitution Cleanse',
		tagline: 'Erase every debuff your opponent applies',
		description:
			'Rule 3.2: cards lose all applied effects when they move between zones. If your hero gets -20 from an opponent play, substitute them out — the debuff is erased. With Unlimited Subs (free substitutions), you can systematically cleanse every negative effect at zero HD cost.',
		chain: 'Opponent plays debuff on your hero (-20) → you substitute that hero out (free via Unlimited Subs) → debuff is erased (Rule 3.2) → new hero enters clean → opponent wasted their play and HD. Repeat every battle.',
		coreCards: ['Unlimited Subs'],
		enhancerCards: ['Substitution Boost', 'No More Subs', 'Late Game Lockdown'],
		feedCategory: null,
		coreDBS: 19,
		coreHD: 4,
		weaponRequirement: null,
		risk: 'low',
		projectedImpact:
			'Neutralizes all opponent debuffs post-activation. +5 per sub from Substitution Boost. Opponent debuff plays become dead cards.',
		rarityNote: 'Unlimited Subs is Alpha SP (PL-19). Accessible.'
	},
	{
		id: 'ongoing_kill_switch',
		name: 'The Ongoing Kill Switch',
		tagline: 'Kill their persistent effects retroactively',
		description:
			"Rule 5.1.7: if a play with an ongoing effect leaves play or is returned to hand, its ongoing effects are immediately nullified. Cards that bounce opponent plays to hand don't just deny activation — they retroactively kill any persistent buffs or restrictions that play created.",
		chain: "Opponent plays persistent buff (+10 all heroes rest of game) → you play a bounce/nullify effect → their play returns to hand → Rule 5.1.7 triggers → the +10 buff is immediately nullified. Their HD is wasted, their buff is gone, and the play is back in their hand (they could replay it, but they'd need to spend HD again).",
		coreCards: [],
		enhancerCards: [],
		feedCategory: 'nullify',
		coreDBS: 0,
		coreHD: 0,
		weaponRequirement: null,
		risk: 'medium',
		projectedImpact:
			"Each nullification erases the opponent's HD investment + removes their persistent advantage.",
		rarityNote:
			'TBD — requires identifying bounce/nullify plays in the database.'
	}
];

/** Find a combo engine by ID */
export function getComboEngine(id: string): ComboEngine | undefined {
	return COMBO_ENGINES.find((e) => e.id === id);
}
