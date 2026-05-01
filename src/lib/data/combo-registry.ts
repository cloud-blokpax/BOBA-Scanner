/**
 * BoBA Combo Registry — v2 schema.
 *
 * Replaces `combo-engines.ts`. Backwards-compatible: the legacy `ComboEngine`
 * type and `COMBO_ENGINES` array are still exported for consumers that haven't
 * migrated yet (currently `playbook-engine.ts` and `ComboStatusCard.svelte`).
 *
 * New v2 fields (set on `Combo`, projected to `ComboEngine` for the legacy view):
 *   - `tier` — design-philosophy quality tier (S / A / B / C)
 *   - `combos` of `ingredients` with `substitutes` — functional reprints by name
 *   - `ruleCitations` — rules sections this combo depends on (admin-linked)
 *   - `ambiguity` — flagged when a combo's interpretation depends on a rule
 *     reading the dev team hasn't confirmed
 *   - `archetypes` — which playbook-archetype IDs this combo belongs to
 *   - `counters` — what stops this combo
 *
 * IDs are stable. Migrations preserve old IDs. New entries use the C-NN naming
 * from the rules-grounded analysis where applicable.
 */

// ── Type definitions ─────────────────────────────────────────

export type ComboTier = 'S' | 'A' | 'B' | 'C';
export type ComboRisk = 'low' | 'medium' | 'high';

/**
 * A single ingredient in a combo. The `name` is the canonical card name
 * (matched against PlayCard.name). `substitutes` are alternative cards that
 * fulfill the same role — these power the redundancy / consistency math.
 */
export interface ComboIngredient {
	/** Canonical card name (matched against PlayCard.name) */
	name: string;
	/**
	 * Alternative card names that fulfill the same role. Empty array means
	 * the ingredient is a strict 1-of (no functional reprint).
	 */
	substitutes: string[];
	/** Optional human-readable role label */
	role?: string;
	/**
	 * How useful is this card OUTSIDE the combo? "high" = generically good,
	 * worth running anyway; "dead" = useless without combo.
	 */
	standaloneUtility: 'high' | 'medium' | 'low' | 'dead';
}

/**
 * Reference to a specific rule section the combo depends on.
 * Format: { section: '§3.2', exploitId: 'EX-002' (optional, links to admin tab) }
 */
export interface RuleCitation {
	/** Rules section, e.g. "§3.2" or "§5.1.7" */
	section: string;
	/** One-sentence summary of the rule's role in the combo */
	relevance: string;
	/**
	 * Optional cross-reference to the rule-exploits.ts admin entry.
	 * If the dev team patches the rule, the combo can be flagged stale.
	 */
	exploitId?: string;
}

/**
 * Set when a combo's interpretation depends on a rule reading the dev team
 * hasn't confirmed. The UI surfaces this as a warning so users know the
 * combo's effectiveness is uncertain.
 */
export interface ComboAmbiguity {
	/** Plain-language description of what's ambiguous */
	question: string;
	/** The two (or more) plausible readings */
	readings: { label: string; consequence: string }[];
	/** Which exploit ID in rule-exploits.ts tracks this */
	exploitId?: string;
}

/**
 * Full v2 combo entry.
 */
export interface Combo {
	/** Stable unique ID */
	id: string;
	/** Display name */
	name: string;
	/** One-line tagline */
	tagline: string;
	/** Full strategic description (used by UI for expanded view) */
	description: string;
	/** Step-by-step chain explanation */
	chain: string;
	/**
	 * Ingredients in execution order. Least-replaceable ingredient first
	 * (per Commander Spellbook convention).
	 */
	ingredients: ComboIngredient[];
	/**
	 * Cards that AMPLIFY the combo (don't define it). Distinct from substitutes.
	 * Each enhancer is a card name; tradition says a name is enough — substitutes
	 * for enhancers aren't tracked.
	 */
	enhancerCards: string[];
	/**
	 * Category tag for "feed" cards — generic Plays that fuel the combo.
	 * Examples: "coin_flip", "dice_roll", "weapon_steel". null = no feed.
	 */
	feedCategory: string | null;
	/** Design-philosophy tier. S = game-warping, C = synergy/value only. */
	tier: ComboTier;
	/** Total DBS cost summing all ingredients' DBS */
	coreDBS: number;
	/** Total HD cost summing all ingredients' HD */
	coreHD: number;
	/** Weapon requirement (null = weapon-agnostic) */
	weaponRequirement: string | null;
	/** Risk level */
	risk: ComboRisk;
	/** Plain-English projected impact */
	projectedImpact: string;
	/** Notes on rarity / accessibility */
	rarityNote: string;
	/** Rules sections this combo depends on (cross-references admin Rule Exploits) */
	ruleCitations: RuleCitation[];
	/** Flagged when interpretation is uncertain — UI shows a warning */
	ambiguity: ComboAmbiguity | null;
	/**
	 * Playbook archetype IDs this combo lives inside. Lets the Architect
	 * surface "Cleanse Wall users typically also use this combo" type hints.
	 */
	archetypes: string[];
	/** What beats this combo, in plain language */
	counters: string[];
	/** Sets that introduce ingredients (lets us flag stale combos when sets rotate) */
	setsIntroduced: string[];
}

// ── Backwards-compatibility legacy type ──────────────────────
//
// The legacy ComboEngine shape is kept so existing consumers (playbook-engine.ts,
// ComboStatusCard.svelte) work without modification. New consumers should
// import `Combo` directly.

export interface ComboEngine {
	id: string;
	name: string;
	tagline: string;
	description: string;
	chain: string;
	coreCards: string[];
	enhancerCards: string[];
	feedCategory: string | null;
	coreDBS: number;
	coreHD: number;
	weaponRequirement: string | null;
	risk: ComboRisk;
	projectedImpact: string;
	rarityNote: string;
}

/**
 * Project a v2 Combo down to the legacy ComboEngine shape.
 * Used to maintain backwards compatibility.
 */
function comboToEngine(c: Combo): ComboEngine {
	return {
		id: c.id,
		name: c.name,
		tagline: c.tagline,
		description: c.description,
		chain: c.chain,
		coreCards: c.ingredients.map((i) => i.name),
		enhancerCards: c.enhancerCards,
		feedCategory: c.feedCategory,
		coreDBS: c.coreDBS,
		coreHD: c.coreHD,
		weaponRequirement: c.weaponRequirement,
		risk: c.risk,
		projectedImpact: c.projectedImpact,
		rarityNote: c.rarityNote
	};
}

// ── Combo data ───────────────────────────────────────────────

export const COMBOS: Combo[] = [
	// ── ID 1: dice_engine — migrated from combo-engines.ts ──
	{
		id: 'dice_engine',
		name: 'The Dice Engine',
		tagline: 'Your opponent is punished for playing cards',
		description:
			'Three persistent effects that chain off dice rolls. When Leave It To Chance forces your opponent to roll dice for every play they attempt, each roll triggers Deep In The Playbook (you draw a free play) and Pay The Price (opponent hero -5). The opponent is punished just for trying to play the game.',
		chain:
			'Play Leave It To Chance → opponent must roll dice to use ANY play → each roll triggers Deep In The Playbook (you draw a play) AND Pay The Price (opponent -5). If opponent uses 3 plays in a battle: you draw 3 plays AND their hero takes -15.',
		ingredients: [
			{ name: 'Leave It To Chance', substitutes: [], role: 'Forced-roll trigger', standaloneUtility: 'medium' },
			{ name: 'Deep In The Playbook', substitutes: [], role: 'Card-draw payoff', standaloneUtility: 'medium' },
			{ name: 'Pay The Price', substitutes: [], role: 'Damage payoff', standaloneUtility: 'medium' }
		],
		enhancerCards: ['Dice Duel', 'Luck Of The Draw', 'Crystal Ball', 'Lucky 7', 'Roller Dogs'],
		feedCategory: 'dice_roll',
		tier: 'A',
		coreDBS: 113,
		coreHD: 7,
		weaponRequirement: null,
		risk: 'medium',
		projectedImpact: '-15 to -25 opponent power per battle + 2-3 extra play draws per battle once assembled',
		rarityNote: 'All 3 core cards are Alpha SSPs (PL-9, PL-17, PL-18). Premium collection required.',
		ruleCitations: [
			{ section: '§5.1.3', relevance: 'Persistent effects from all three Plays remain active until ended.', exploitId: 'EX-020' },
			{ section: '§5.1.7', relevance: "Returning any of the three core Plays to hand nullifies that piece's ongoing effect — do NOT combo with Reload.", exploitId: 'EX-003' }
		],
		ambiguity: null,
		archetypes: ['twin_engine_aggro', 'dice_aggro'],
		counters: [
			'Pulling The Plug — wipes all three persistent effects at once',
			'The Perfect Offense — cancels Plays opponent used this Battle',
			'A deck with no dice or coin Plays of its own — minimal trigger surface'
		],
		setsIntroduced: ['A']
	},

	// ── ID 2: weapon_alchemy — migrated ──
	{
		id: 'weapon_alchemy',
		name: 'Weapon Alchemy',
		tagline: 'Rewrite the weapon rules mid-game',
		description:
			"Convert ALL heroes in the game to one weapon type, then stack that weapon's buffs and anti-weapon plays. Your opponent's weapon-specific plays become dead cards.",
		chain:
			"Play Only Steel (DBS 11) → all heroes become Steel → play Steel Boost → YOUR Steel heroes get permanent +10 → opponent's Fire/Ice plays are now dead → anti-Steel plays like Rusted Edge (+15) and Stain-Less-Steel (-15) fire EVERY battle.",
		ingredients: [
			{ name: 'Only Steel', substitutes: [], role: 'Weapon converter', standaloneUtility: 'medium' },
			{ name: 'Steel Boost', substitutes: ['Fire Boost', 'Ice Boost'], role: 'Tribal buff', standaloneUtility: 'high' }
		],
		enhancerCards: ['Rusted Edge', 'Stain-Less-Steel', 'Steel Cage', 'Steel Defense', 'Molten Steel', 'Frost-Hardened'],
		feedCategory: null,
		tier: 'A',
		coreDBS: 21,
		coreHD: 5,
		weaponRequirement: 'steel',
		risk: 'low',
		projectedImpact: "+10 permanent to all your heroes, opponent weapon-specific plays neutralized, anti-Steel plays guaranteed every battle",
		rarityNote: 'Only Steel is Alpha Uncommon (PL-54), Steel Boost is Alpha SP (PL-22). Moderate accessibility.',
		ruleCitations: [
			{ section: '§3.2', relevance: 'Weapon-type changes from Only Steel may be lost on zone change. Confirm whether weapon-type modifications survive substitution.', exploitId: 'EX-002' }
		],
		ambiguity: {
			question: "Does 'Only Steel' permanently change Heroes' weapon types, or does §3.2 cleanse the weapon-type change when a Hero is substituted?",
			readings: [
				{ label: 'Permanent change (combo works)', consequence: 'Steel Boost stacks +10 on all heroes including those substituted in later — combo dominates.' },
				{ label: '§3.2 cleanses weapon change (combo weaker)', consequence: 'Only the original 7 + 4 Bench heroes are converted. Substituted-in heroes retain original weapon.' }
			],
			exploitId: 'EX-002'
		},
		archetypes: ['mono_steel_fortress'],
		counters: ['Pulling The Plug — wipes the weapon conversion', "Opponent's own Only [other weapon] — they convert back"],
		setsIntroduced: ['A']
	},

	// ── ID 3: starvation_lock — migrated ──
	{
		id: 'starvation_lock',
		name: 'The Starvation Lock',
		tagline: 'Drain your opponent dry — then punish them for it',
		description: "Bun Shortage's persistent Hot Dog tax forces opponent to discard a Hot Dog every Battle. Ultimatum Dog wins automatically when opponent has 0 HDs.",
		chain: 'Play Bun Shortage (Battle 1-2) → opponent discards 1 HD per Battle → after 5 Battles, opponent at 5 HDs → play Ultimatum Dog when they\'re close to 0 → if they hit 0 HD, you auto-win the Battle.',
		ingredients: [
			{ name: 'Bun Shortage', substitutes: [], role: 'HD drain', standaloneUtility: 'medium' },
			{ name: 'Ultimatum Dog', substitutes: [], role: 'Win condition', standaloneUtility: 'low' }
		],
		enhancerCards: ['Hot Dog Dominance', 'Pay It For Me', 'Forced Substitution', 'Hero Tax'],
		feedCategory: null,
		tier: 'B',
		coreDBS: 33,
		coreHD: 3,
		weaponRequirement: null,
		risk: 'high',
		projectedImpact: 'Opponent reduced to 0-2 HDs by Battle 5; auto-win Battle 5+ if Ultimatum Dog drawn.',
		rarityNote: 'Bun Shortage is Alpha SSP, hard to find. Ultimatum Dog is Alpha Uncommon.',
		ruleCitations: [
			{ section: '§2.1.4', relevance: 'Hot Dog economy is fixed at 10 per game. Forced discards genuinely deplete the resource pool.' },
			{ section: '§5.1.3', relevance: "Bun Shortage's effect persists for the rest of the game (ongoing)." }
		],
		ambiguity: null,
		archetypes: ['hot_dog_denial'],
		counters: ['Bonus Recovery — opponent recovers HDs faster than the drain', 'Pulling The Plug — wipes the persistent drain', 'Back From The Dumps — emergency HD recovery'],
		setsIntroduced: ['A']
	},

	// ── ID 4: unlimited_subs_engine — migrated with ambiguity flag ──
	{
		id: 'unlimited_subs_engine',
		name: 'The Unlimited Subs Engine',
		tagline: 'Free substitutions every Battle, with permanent buffs',
		description: 'Unlimited Subs makes every substitution free for the rest of the game. Substitution Boost adds +5 to every substituted-in Hero. No More Subs locks the opponent OUT of substitutions while you sub freely.',
		chain: 'Battle 1-2: play Substitution Boost. Battle 2-3: play Unlimited Subs. From Battle 3 onward: substitute every Battle for free, each substituted Hero gets +5. Optionally play No More Subs to lock opponent.',
		ingredients: [
			{ name: 'Unlimited Subs', substitutes: [], role: 'Free-sub enabler', standaloneUtility: 'medium' },
			{ name: 'Substitution Boost', substitutes: ['Pinch Hitter'], role: 'Per-sub buff', standaloneUtility: 'medium' },
			{ name: 'No More Subs', substitutes: ['Late Game Lockdown', 'Bench Lock', 'Bench Blocker'], role: 'Opponent lockout', standaloneUtility: 'high' }
		],
		enhancerCards: ['10 For A Sub', 'Hot Dog Dominance', 'Pay It For Me'],
		feedCategory: null,
		tier: 'A',
		coreDBS: 64,
		coreHD: 8,
		weaponRequirement: null,
		risk: 'medium',
		projectedImpact: 'Free subs every Battle + +5 per sub + opponent locked out = ~+30 to +40 net Power swing per game.',
		rarityNote: 'Unlimited Subs and Substitution Boost are Alpha cards; No More Subs is widely available.',
		ruleCitations: [
			{ section: '§4.2.2', relevance: 'Each Coach may substitute only once per Battle. Unlimited Subs removes the HD cost but NOT the once-per-Battle limit.' },
			{ section: '§3.2', relevance: "Power modifications are lost when a Hero moves zones. Substitution Boost's +5 reading depends on whether it's a Hero modification or an ongoing rule.", exploitId: 'EX-002' }
		],
		ambiguity: {
			question: "Does Substitution Boost's +5 persist on a Hero across subsequent zone changes?",
			readings: [
				{ label: "Reading 1 (pessimistic): +5 is per-Hero-instance", consequence: '+5 lasts only while the Hero is in the Battle Zone. Subbing the Hero out clears the +5.' },
				{ label: "Reading 2 (optimistic): +5 is a stamp", consequence: '+5 stamps the Hero permanently across all zone changes.' }
			],
			exploitId: 'EX-002'
		},
		archetypes: ['cleanse_wall', 'substitution_tempo'],
		counters: ['No More Subs (mirror) — locks you out of your own engine', 'Forced Substitution — drains your HD even with free subs', 'Pulling The Plug — wipes the persistent free-sub effect'],
		setsIntroduced: ['A']
	},

	// ── ID 5: recovery_snowball — migrated, substitutes added ──
	{
		id: 'recovery_snowball',
		name: 'The Recovery Snowball',
		tagline: 'Hot Dog economy beyond the 10-card cap',
		description: 'BoBA limits you to 10 Hot Dogs per game. Recovery Plays let you spend HDs and get them back, but Bonus Recovery amplifies all subsequent recovery.',
		chain: 'Battle 1-2: play Bonus Recovery (8 DBS, 0 HD). For the rest of the game, every recovery Play returns +1 extra HD.',
		ingredients: [
			{ name: 'Bonus Recovery', substitutes: [], role: 'Recovery amplifier', standaloneUtility: 'low' }
		],
		enhancerCards: ['Victory Dinner', "It's Gonna Cost Ya", 'Late Game Push', 'Cloudy With A Chance Of Hot Dogs', 'Add Firepower', 'Back From The Dumps', 'Momentum Meal', 'Synergy Snacks', 'Sacrifice it All to Win', 'Robin Who'],
		feedCategory: 'hd_recovery',
		tier: 'A',
		coreDBS: 8,
		coreHD: 0,
		weaponRequirement: null,
		risk: 'low',
		projectedImpact: 'Effective HD pool 1.5x to 2x your opponent across a 7-Battle game.',
		rarityNote: 'Bonus Recovery is widely available. Easy to assemble.',
		ruleCitations: [
			{ section: '§2.1.4', relevance: "Hot Dog Deck is fixed at 10. Recovery Plays are the only way to exceed the resource cap." },
			{ section: '§5.1.3', relevance: "Bonus Recovery's amplifier is an ongoing effect (rest of game)." }
		],
		ambiguity: null,
		archetypes: ['marathon_free_play', 'hot_dog_denial', 'permanent_stack', 'cleanse_wall'],
		counters: ['Pulling The Plug — wipes Bonus Recovery', 'Bun Shortage — drains HDs faster than recovery returns them'],
		setsIntroduced: ['A']
	},

	// ── ID 6: coin_flip_control — migrated, full substitute list ──
	{
		id: 'coin_flip_control',
		name: 'Coin Flip Control',
		tagline: 'Death by a thousand flips',
		description: "Loan Sharked's persistent on-flip damage to opponent. Combine with high-volume coin-flip Plays (45 in catalog) and every flip becomes -5 opponent Power.",
		chain: "Battle 1-2: play Loan Sharked. From that point, every coin flip you make deals -5 to their Hero. Stack 8+ flip Plays for guaranteed engine activation.",
		ingredients: [
			{ name: 'Loan Sharked', substitutes: [], role: 'On-flip damage trigger', standaloneUtility: 'medium' }
		],
		enhancerCards: ['Heads I Win, Tails You Lose', 'Steel Flipper', '3rd Time Charm', 'Add Firepower', 'Flip Ya For 2 Plays', 'Win The Toss', 'Flaming Flip', 'Frozen Flip', 'Stainless Flip', 'Super Lucky', 'Coin Toss Tap'],
		feedCategory: 'coin_flip',
		tier: 'A',
		coreDBS: 10,
		coreHD: 1,
		weaponRequirement: null,
		risk: 'medium',
		projectedImpact: '-25 to -40 cumulative opponent Power across a 7-Battle game with 8+ flip Plays.',
		rarityNote: 'Loan Sharked is Alpha SP. Flip Plays are widely available.',
		ruleCitations: [
			{ section: '§5.1.3', relevance: "Loan Sharked's on-flip trigger is an ongoing effect." },
			{ section: '§5.1.6', relevance: 'Loan Sharked cannot be stacked with itself (uniqueness rule).' }
		],
		ambiguity: null,
		archetypes: ['twin_engine_aggro', 'coin_aggro'],
		counters: ['Pulling The Plug — wipes Loan Sharked', 'A deck with no coin Plays — engine has zero triggers'],
		setsIntroduced: ['A']
	},

	// ── ID 7: noble_sacrifice_stack — migrated ──
	{
		id: 'noble_sacrifice_stack',
		name: 'Noble Sacrifice Stack',
		tagline: 'Permanent buffs that compound across battles',
		description: 'Three persistent buffs that affect ALL your Heroes (or all opponent Heroes) for the rest of the game.',
		chain: "Battle 1: Noble Sacrifice (+10 to all your Heroes). Battle 2: Member Bounce (+10 to all your Heroes). Battle 3: The 12th Man (-10 to all opponent Heroes). Net swing: +30 per Battle for the rest of the game.",
		ingredients: [
			{ name: 'Noble Sacrifice', substitutes: [], role: 'Self-buff (+10 all)', standaloneUtility: 'medium' },
			{ name: 'Member Bounce', substitutes: [], role: 'Self-buff (+10 all)', standaloneUtility: 'medium' },
			{ name: 'The 12th Man', substitutes: [], role: 'Opponent debuff (-10 all)', standaloneUtility: 'medium' }
		],
		enhancerCards: ['Bonus Recovery', 'Steel Boost', 'Fire Boost', 'Ice Boost'],
		feedCategory: null,
		tier: 'A',
		coreDBS: 35,
		coreHD: 8,
		weaponRequirement: null,
		risk: 'high',
		projectedImpact: '+30 net Power swing per Battle from Battle 4 onward, all Heroes affected.',
		rarityNote: 'All three cards are Alpha SP-tier.',
		ruleCitations: [
			{ section: '§5.1.3', relevance: 'All three Plays are persistent (rest of game).' },
			{ section: '§3.2', relevance: 'The +10 / -10 effects are applied to all Heroes — when Heroes substitute, the buffs/debuffs may be lost.', exploitId: 'EX-002' }
		],
		ambiguity: {
			question: "Are 'all your Heroes get +10' effects per-Hero modifications (lost on zone change) or rule-level effects?",
			readings: [
				{ label: "Per-Hero modification", consequence: 'Subbed-out Heroes lose the +10. Subbed-in Heroes don\'t have it.' },
				{ label: "Rule-level (recommended reading for design intent)", consequence: '+10 applies to whatever Hero is currently in the zone. Substitution irrelevant.' }
			],
			exploitId: 'EX-002'
		},
		archetypes: ['permanent_stack'],
		counters: ['Pulling The Plug — wipes all three at once', 'Emergency Shutdown — wipes if opponent has ≤2 HDs', 'The Perfect Offense — single-Battle cancel'],
		setsIntroduced: ['A']
	},

	// ── ID 8: comeback_engine — migrated ──
	{
		id: 'comeback_engine',
		name: 'The Comeback Engine',
		tagline: 'Lose-to-win value engine',
		description: "Turn the Tide gives massive Power when you've lost the previous Battle. Pair with deliberate early-Battle losses to set up devastating Battle 3-7 swings.",
		chain: "Lose Battle 1 deliberately. Battle 2: Turn the Tide → your Hero gets +30. Repeat the pattern.",
		ingredients: [
			{ name: 'Turn the Tide', substitutes: ['To Fight Another Day'], role: 'Lose-to-win trigger', standaloneUtility: 'high' }
		],
		enhancerCards: ['Late Game Push', 'Fairweather Fan', 'Late-Game Magic', 'Big Win Energy'],
		feedCategory: 'comeback',
		tier: 'B',
		coreDBS: 1,
		coreHD: 1,
		weaponRequirement: null,
		risk: 'low',
		projectedImpact: '+20 to +30 swing on Battles where you intentionally lost the previous one.',
		rarityNote: 'Turn the Tide is widely available.',
		ruleCitations: [
			{ section: '§4.3.2', relevance: 'Honors goes to the winner of the previous Battle. Deliberately losing concedes Honors — strategic tradeoff.' }
		],
		ambiguity: null,
		archetypes: ['late_game_bomb'],
		counters: ["Aggro decks that win 4 Battles before Comeback fires", "Mirror — opponent also runs comeback engines"],
		setsIntroduced: ['A']
	},

	// ── ID 9: substitution_cleanse — migrated ──
	{
		id: 'substitution_cleanse',
		name: 'The Substitution Cleanse',
		tagline: 'Free debuff erasure via §3.2',
		description: 'Per §3.2, cards lose all effects on zone change. Combined with Unlimited Subs (free substitution), every opposing debuff applied to your Hero is erased by substituting that Hero out.',
		chain: 'Opponent applies Stain-Less-Steel (-15) to your Steel Hero. You substitute that Hero out (free, via Unlimited Subs). The -15 effect is gone (per §3.2). The substituted-in Hero is fresh.',
		ingredients: [
			{ name: 'Unlimited Subs', substitutes: [], role: 'Free-sub enabler', standaloneUtility: 'medium' }
		],
		enhancerCards: ['Substitution Boost', 'Pinch Hitter', '10 For A Sub', 'Hot Dog Dominance'],
		feedCategory: null,
		tier: 'B',
		coreDBS: 22,
		coreHD: 4,
		weaponRequirement: null,
		risk: 'low',
		projectedImpact: 'Every opposing -Power debuff is erased for free, neutering control archetypes.',
		rarityNote: 'Unlimited Subs is Alpha SP.',
		ruleCitations: [
			{ section: '§3.2', relevance: 'Heroes lose all applied effects on zone change — this is the literal rule that powers the cleanse.', exploitId: 'EX-002' }
		],
		ambiguity: null,
		archetypes: ['cleanse_wall'],
		counters: ['No More Subs — locks you out of substitutions', 'EX-021 future "persistent debuff" Plays — if printed, would beat the cleanse'],
		setsIntroduced: ['A']
	},

	// ── ID 10: ongoing_kill_switch — corrected (was empty in old registry) ──
	{
		id: 'ongoing_kill_switch',
		name: 'The Cancel Sweep',
		tagline: 'Wipe an entire Battle of opponent investment',
		description: "The Perfect Offense (DBS 1, 6 HD) cancels every Play your opponent used this Battle. After they've stacked +30 to +50 of buffs, you wipe it all in a single Play.",
		chain: 'Opponent runs their Plays first (Honors). Their Hero is now +30 to +50. You run The Perfect Offense — cancels every Play they used this Battle. Their Hero reverts to base. You win on raw Power.',
		ingredients: [
			{ name: 'The Perfect Offense', substitutes: [], role: 'Battle-wide cancel', standaloneUtility: 'low' }
		],
		enhancerCards: ['Pulling The Plug', 'Emergency Shutdown'],
		feedCategory: null,
		tier: 'S',
		coreDBS: 1,
		coreHD: 6,
		weaponRequirement: null,
		risk: 'medium',
		projectedImpact: '+30 to +50 swing on the Battle you target.',
		rarityNote: 'The Perfect Offense is Alpha SSP — premium card.',
		ruleCitations: [
			{ section: '§5.1.4', relevance: "Already-resolved INSTANTANEOUS effects (e.g., HD recovery) cannot be reversed by The Perfect Offense — only ongoing-state effects revert." },
			{ section: '§5.1.7', relevance: 'Ongoing effects from cancelled Plays are nullified per §5.1.7.' }
		],
		ambiguity: null,
		archetypes: ['nullify_wall'],
		counters: ['Holding Plays back — opponent runs nothing for the Battle', 'Spreading buffs across many Battles instead of concentrating'],
		setsIntroduced: ['A']
	},

	// ── ID 11: free_play_engine — was in archetypes but treated as combo here ──
	{
		id: 'free_play_engine',
		name: 'Free Play Engine',
		tagline: 'Skip a Battle, get +20 free',
		description: "Free Booster (DBS 24, 3 HD: '+20. If you didn't run any Plays last Battle, this Play costs 0. This Play can't be used in Battle 1.') is a deferred-tempo engine.",
		chain: 'Battle 1: don\'t run any Plays. Battle 2: run Free Booster for 0 HD → +20 to your Hero. Repeat.',
		ingredients: [
			{ name: 'Free Booster', substitutes: [], role: 'Conditional free buff', standaloneUtility: 'high' }
		],
		enhancerCards: ['Late Game Push', 'No Huddle', 'Save It For Later'],
		feedCategory: null,
		tier: 'B',
		coreDBS: 24,
		coreHD: 0,
		weaponRequirement: null,
		risk: 'low',
		projectedImpact: 'Per chain: 0 HD investment for +20 Power. Possible 3-4 chains per game.',
		rarityNote: 'Free Booster is widely available.',
		ruleCitations: [
			{ section: '§4.3.2', relevance: 'Each Coach has only one opportunity per Battle to run Plays — skipping is allowed.' }
		],
		ambiguity: null,
		archetypes: ['marathon_free_play', 'late_game_bomb'],
		counters: ['Plays that force you to run a Play (none currently exist; design slot)', 'Aggro decks that win 4 Battles before Free Booster fires'],
		setsIntroduced: ['A']
	},

	// ── NEW: C-01 Honors Lockstep ──
	{
		id: 'honors_lockstep',
		name: 'Honors Lockstep',
		tagline: 'The Splinter Twin of BoBA',
		description: "Make It, Take It (DBS 14, 1 HD) is the cheapest single-card win condition in the format. Win Battle 1, get +5 next Battle from Make It Take It, win Battle 2, +5 more, win Battle 3... Honors persists across wins per §4.3.2; the +5 stacks across Battles per §5.1.3.",
		chain: 'Battle 1: run Make It, Take It. Win Battle 1. Battle 2: your Hero gets +5 (from Make It). Win Battle 2 (Honors-priority advantage). Battle 3: +5 from Make It (recurring). Win Battle 3. Repeat. By Battle 5, the snowball is unbreakable.',
		ingredients: [
			{ name: 'Make It, Take It', substitutes: ['Make It, Take It - htd'], role: 'Win-condition snowball', standaloneUtility: 'high' }
		],
		enhancerCards: ['Big Win Energy', 'Money Line', 'Save It For Later'],
		feedCategory: null,
		tier: 'S',
		coreDBS: 14,
		coreHD: 1,
		weaponRequirement: null,
		risk: 'low',
		projectedImpact: 'Win Battle 1 → snowball delivers +5 / +10 / +15 / +20 / +25 across Battles 2-6.',
		rarityNote: 'Make It, Take It is Alpha SP. The HTD variant is 0 HD — even cheaper, very strong in HTD-ON formats.',
		ruleCitations: [
			{ section: '§4.3.2', relevance: 'Honors transfers via Battle wins. After winning a Battle, you get to run Plays first in the next.', exploitId: 'EX-013' },
			{ section: '§5.1.2', relevance: "Honors player runs all Plays first — combined with Make It Take It's +5, the buffer is decisive." },
			{ section: '§5.1.3', relevance: "Make It, Take It's effect persists for the rest of the game." }
		],
		ambiguity: null,
		archetypes: ['power_curve_aggro'],
		counters: ['Win Battle 1 yourself — the snowball never starts', 'Pulling The Plug — wipes the persistent +5', 'Force a tie in Battle 1 — Honors stays neutral'],
		setsIntroduced: ['A']
	},

	// ── NEW: C-04 Sudden Death Sculptor ──
	{
		id: 'sudden_death_sculptor',
		name: 'Sudden Death Sculptor',
		tagline: 'Win the tied games',
		description: 'When Sudden Death (§4.4.3) triggers, the top of your Hero Deck wins. Sculpt that top with Locker Room Evacuation (discard 4 unwanted) + Big Time Recruit (shuffle losers back).',
		chain: 'Mid-game: Locker Room Evacuation reveals top 5, you keep 1, discard 4. Later: Big Time Recruit reveals top 3, you keep 1, shuffle others back. By Battle 7+ tie, your Hero Deck top is sculpted for victory.',
		ingredients: [
			{ name: 'Locker Room Evacuation', substitutes: [], role: 'Top-deck pruner', standaloneUtility: 'medium' },
			{ name: 'Big Time Recruit', substitutes: ['Cheap Trick', 'Cheap Addition'], role: 'Top-deck shuffler', standaloneUtility: 'medium' }
		],
		enhancerCards: ['Recycle', 'Refill And Reload', 'Quick Draw'],
		feedCategory: null,
		tier: 'B',
		coreDBS: 44,
		coreHD: 2,
		weaponRequirement: null,
		risk: 'low',
		projectedImpact: 'In Sudden-Death-eligible games (~10-20% of competitive games), you nearly guarantee the win.',
		rarityNote: 'Both core cards are Alpha SP.',
		ruleCitations: [
			{ section: '§4.4.3', relevance: 'Sudden Death uses the top of the Hero Deck. Sculpting the top wins the tiebreaker.', exploitId: 'EX-012' },
			{ section: '§4.3.2', relevance: 'Super weapons win Battle 7 ties (Super Tie Breaker).' }
		],
		ambiguity: null,
		archetypes: ['late_game_bomb'],
		counters: ['Aggro decks that close the game before Sudden Death', 'No current Plays target opponent Hero Deck — uncountered'],
		setsIntroduced: ['A']
	},

	// ── NEW: C-05 Free Court Press ──
	{
		id: 'free_court_press',
		name: 'Free Court Press',
		tagline: '0 HD lockout — opponent cannot Play',
		description: 'The HTD Plays Flame Wall, Icy Shield, and Steel Defense (each DBS 110, 0 HD) lock the opponent out of running ANY Plays for the Battle. For zero resource investment, you eliminate their entire Play window.',
		chain: 'Reveal Hero with matching weapon (Fire/Ice/Steel). Run Flame Wall - htd (or Icy / Steel) for 0 HD. Per §5.1.2, opponent cannot interrupt — their Play window opens AFTER yours, and the lockout takes effect immediately.',
		ingredients: [
			{ name: 'Flame Wall - htd', substitutes: ['Icy Shield - htd', 'Steel Defense - htd', 'Flame Wall', 'Icy Shield', 'Steel Defense', 'Full Court Press'], role: 'Battle lockout', standaloneUtility: 'high' }
		],
		enhancerCards: ['Late Game Lockdown', 'Prevent D'],
		feedCategory: null,
		tier: 'S',
		coreDBS: 110,
		coreHD: 0,
		weaponRequirement: null,
		risk: 'low',
		projectedImpact: 'Eliminate one full Battle of opponent Play investment for 0 HD.',
		rarityNote: 'HTD versions cost 0 HD — confirm with dev team whether this is intended (see EX-024).',
		ruleCitations: [
			{ section: '§5.1.2', relevance: 'Honors player runs all Plays first — opponent cannot interrupt the lockout once played.', exploitId: 'EX-004' },
			{ section: '§4.3.2', relevance: 'Each Coach has only one Play window per Battle — locking it eliminates it entirely.' }
		],
		ambiguity: {
			question: 'What is the HTD card economy? Are these really 0 HD with no hidden constraints?',
			readings: [
				{ label: 'HTD is "free cost" by design', consequence: 'Free Court Press is the cheapest game-warping combo in the format.' },
				{ label: 'HTD has hidden constraints', consequence: 'Combo may be weaker than the catalog suggests.' }
			],
			exploitId: 'EX-024'
		},
		archetypes: ['mono_steel_fortress', 'mono_fire_rush', 'mono_ice_cold_lock'],
		counters: ['Run a Play before the opponent plays Free Court Press (only possible if you have Honors)', 'Pulling The Plug at end of Battle to remove any lingering effects'],
		setsIntroduced: ['A', 'HTD']
	},

	// ── NEW: C-07 Lockout Cascade ──
	{
		id: 'lockout_cascade',
		name: 'Lockout Cascade',
		tagline: 'Battle 7 substitution lock',
		description: "Bench Lock (DBS 2!) and Late Game Lockdown (DBS 7) are dirt-cheap Plays that remove opponent's substitution optionality in critical Battles.",
		chain: 'Battle 6: play Bench Lock → opponent cannot substitute next Battle (Battle 7). Battle 7: redundantly play Late Game Lockdown → confirmation of the lock. Opponent fights Battle 7 with the original face-down Hero.',
		ingredients: [
			{ name: 'Bench Lock', substitutes: ['Bench Blocker'], role: 'Per-battle sub denial', standaloneUtility: 'high' },
			{ name: 'Late Game Lockdown', substitutes: ['Late Game Lockdown - htd', 'Prevent D'], role: 'Battle 7 sub denial', standaloneUtility: 'medium' }
		],
		enhancerCards: ['No More Subs', 'Frozen Lineup', 'Torched', 'Steel Cage', 'Sticky Strength'],
		feedCategory: 'sub_denial',
		tier: 'B',
		coreDBS: 9,
		coreHD: 3,
		weaponRequirement: null,
		risk: 'low',
		projectedImpact: 'Battle 7 substitution locked → opponent fights with the original face-down Hero.',
		rarityNote: 'Both cards are widely available.',
		ruleCitations: [
			{ section: '§4.2.2', relevance: 'Substitution rules — locking it removes a key strategic lever.' }
		],
		ambiguity: null,
		archetypes: ['cleanse_wall', 'late_game_bomb', 'substitution_lock'],
		counters: ["Pulling The Plug — wipes the Bench Lock's effect on Battle 7", "Emergency Shutdown — wipes if opponent has ≤2 HDs"],
		setsIntroduced: ['A']
	},

	// ── NEW: C-09 Discard Cycle ──
	{
		id: 'discard_cycle',
		name: 'The Discard Cycle',
		tagline: 'Filter your hand to the right answers',
		description: 'BoBA decks have almost no hand-filtering tools. Tear a Page + Trade-Up + Burn That Play form the only meaningful filter package.',
		chain: 'When you draw a play that doesn\'t fit your strategy: Tear a Page (discard, draw replacement, free) or Trade-Up (discard, draw 2). Burn That Play converts a discarded Play into +10 Power.',
		ingredients: [
			{ name: 'Tear a Page', substitutes: [], role: 'Cheap filter', standaloneUtility: 'high' },
			{ name: 'Trade-Up', substitutes: [], role: 'Heavier filter', standaloneUtility: 'high' },
			{ name: 'Burn That Play', substitutes: [], role: 'Discard payoff', standaloneUtility: 'medium' }
		],
		enhancerCards: ['4 New Plays Baby!', 'Play Booster', 'Refill And Reload'],
		feedCategory: null,
		tier: 'B',
		coreDBS: 71,
		coreHD: 2,
		weaponRequirement: null,
		risk: 'low',
		projectedImpact: 'Hand quality improves over time — combo decks find their pieces faster.',
		rarityNote: 'All three cards are Alpha standard rarity.',
		ruleCitations: [
			{ section: '§5.2.3', relevance: 'Discard-as-cost is a clear instruction; these Plays exemplify it.' }
		],
		ambiguity: null,
		archetypes: ['twin_engine_aggro', 'permanent_stack', 'cleanse_wall'],
		counters: ['Opponent runs Overwhelm or Momentum Breaker (forces additional discards)', "You don't need filter — strong opening hand wins regardless"],
		setsIntroduced: ['A']
	},

	// ── NEW: C-11 Tribal Streak ──
	{
		id: 'tribal_streak',
		name: 'Tribal Streak',
		tagline: 'Mono-weapon scaling payoff',
		description: 'In a mono-weapon deck, three scaling Plays compound. Battle 6 single Hero: +95 Power.',
		chain: 'Build a 60-Hero mono-weapon deck. Battles 1-2 set up the streak. Battle 3: 3 Weapon Streak fires → +25. Battle 6: 5 Weapon Streak fires → +40. Throughout: Weapon Lineage scales with subbed-out Heroes in Discard.',
		ingredients: [
			{ name: '3 Weapon Streak', substitutes: [], role: 'Mid-game scaling', standaloneUtility: 'medium' },
			{ name: '5 Weapon Streak', substitutes: [], role: 'Late-game scaling', standaloneUtility: 'medium' },
			{ name: 'Weapon Lineage', substitutes: ['Synergy Snacks', 'Weapon-Sync'], role: 'Discard-to-Power scaling', standaloneUtility: 'medium' }
		],
		enhancerCards: ['Steel Boost', 'Fire Boost', 'Ice Boost', 'Weapon Tangle'],
		feedCategory: null,
		tier: 'A',
		coreDBS: 31,
		coreHD: 6,
		weaponRequirement: null,
		risk: 'low',
		projectedImpact: 'Battle 6 with all three: +95 Power on a single Hero in a mono-weapon deck.',
		rarityNote: 'All three cards are widely available.',
		ruleCitations: [
			{ section: '§4.1.1', relevance: 'Hero deck rules limit 6 per power — mono-weapon density is the enabler.' }
		],
		ambiguity: null,
		archetypes: ['mono_steel_fortress', 'mono_fire_rush', 'mono_ice_cold_lock', 'mono_brawl', 'mono_glow'],
		counters: ["Anti-tribal Plays (Stain-Less-Steel, Fire Extinguisher, Ice Pick)", "Aggro that wins early before the streak triggers fire"],
		setsIntroduced: ['A']
	},

	// ── NEW: C-12 Forced March ──
	{
		id: 'forced_march',
		name: 'Forced March',
		tagline: 'Drain opponent HDs into bankruptcy',
		description: 'Forced Substitution (DBS 24, 3 HD: forces opponent to pay 2 HD and substitute) + Hero Tax (DBS 46, 4 HD: opponent pays 1 HD per Hero in hand) gut the opponent\'s HD economy.',
		chain: "Battle 2: Forced Substitution → opponent loses 2 HD + must sub. Battle 3: Hero Tax → opponent pays N HD (where N is Bench size, typically 4). Combined drain: ~6 HD removed in 2 Battles.",
		ingredients: [
			{ name: 'Forced Substitution', substitutes: ['Forced Substitution - htd'], role: 'HD drain via forced sub', standaloneUtility: 'medium' },
			{ name: 'Hero Tax', substitutes: [], role: 'HD drain via Bench tax', standaloneUtility: 'medium' }
		],
		enhancerCards: ['Bun Shortage', 'Pay It For Me', 'Dog Gone Inflation'],
		feedCategory: null,
		tier: 'B',
		coreDBS: 70,
		coreHD: 7,
		weaponRequirement: null,
		risk: 'medium',
		projectedImpact: 'Opponent loses ~6 HD across 2 Battles. Combined with their normal spending, they hit 0-2 HD by Battle 5.',
		rarityNote: 'Forced Substitution is Alpha SP, Hero Tax is Alpha SSP.',
		ruleCitations: [
			{ section: '§2.1.4', relevance: 'HD economy fixed at 10. Forced drains compound rapidly.' },
			{ section: '§5.2.2', relevance: 'Costs must be paid even if effects do not resolve.' }
		],
		ambiguity: null,
		archetypes: ['hot_dog_denial', 'substitution_lock'],
		counters: ['Bonus Recovery — opponent recovers HDs to compensate', 'Back From The Dumps — emergency HD recovery for both players (mutual)'],
		setsIntroduced: ['A']
	}
];

// ── Backwards-compatible exports ─────────────────────────────

/**
 * Legacy export — projected from COMBOS for consumers that haven't migrated
 * to the v2 shape yet.
 */
export const COMBO_ENGINES: ComboEngine[] = COMBOS.map(comboToEngine);

export function getComboEngine(id: string): ComboEngine | undefined {
	return COMBO_ENGINES.find((e) => e.id === id);
}

// ── New v2 helpers ───────────────────────────────────────────

export function getCombo(id: string): Combo | undefined {
	return COMBOS.find((c) => c.id === id);
}

/**
 * Helper for the Architect: given a list of selected play names, find every
 * substitute that fulfills a missing combo ingredient.
 */
export function findSubstitutesFor(
	combo: Combo,
	availablePlayNames: Set<string>
): { ingredient: ComboIngredient; substitutesAvailable: string[] }[] {
	return combo.ingredients
		.filter((ing) => !availablePlayNames.has(ing.name))
		.map((ing) => ({
			ingredient: ing,
			substitutesAvailable: ing.substitutes.filter((s) => availablePlayNames.has(s))
		}))
		.filter((x) => x.substitutesAvailable.length > 0);
}

/**
 * Helper: count effective copies of a combo's ingredients in a given universe.
 * Used by the consistency math.
 */
export function effectiveIngredientCount(
	combo: Combo,
	availablePlayNames: Set<string>
): number {
	let count = 0;
	for (const ing of combo.ingredients) {
		if (availablePlayNames.has(ing.name)) count++;
		count += ing.substitutes.filter((s) => availablePlayNames.has(s)).length;
	}
	return count;
}
