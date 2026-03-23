/**
 * BoBA Deck Balancing Score (DBS) Lookup
 *
 * Every Play and Bonus Play card has a DBS point value.
 * The total DBS across all Plays must stay at or below 1,000 for sanctioned events.
 *
 * DBS ranges: Low (0-20), Medium (21-40), High (41-60), Very High (61+)
 *
 * Keyed by composite "set_code:card_number" since the same card number
 * exists across releases with different DBS values.
 */

export interface PlayCardData {
	id: string;
	card_number: string;
	name: string;
	release: string;
	type: string;
	number: number;
	hot_dog_cost: number | null;
	dbs: number;
}

/** DBS score for a specific Play card, keyed by "set_code:card_number" */
const DBS_SCORES: Record<string, number> = {
	// ── Alpha Edition (A) ──
	'Alpha Edition:PL-1': 16, // Front Run
	'Alpha Edition:PL-2': 34, // Victory Dinner
	'Alpha Edition:PL-3': 24, // Get What You Pay For
	'Alpha Edition:PL-4': 37, // It's Gonna Cost Ya
	'Alpha Edition:PL-5': 24, // Deadline Deal
	'Alpha Edition:PL-6': 16, // Late Game Push
	'Alpha Edition:PL-7': 39, // Back From The Dumps
	'Alpha Edition:PL-8': 45, // Reload
	'Alpha Edition:PL-9': 35, // Leave It To Chance
	'Alpha Edition:PL-10': 52, // 4 New Plays Baby!
	'Alpha Edition:PL-11': 17, // Burn That Play
	'Alpha Edition:PL-12': 22, // Cloudy With A Chance Of Hot Dogs
	'Alpha Edition:PL-13': 80, // Play Booster
	'Alpha Edition:PL-14': 67, // You're Not Alone
	'Alpha Edition:PL-15': 18, // No More Subs
	'Alpha Edition:PL-16': 30, // Locker Room Evacuation
	'Alpha Edition:PL-17': 20, // Deep In The Playbook
	'Alpha Edition:PL-18': 18, // Pay The Price
	'Alpha Edition:PL-19': 22, // Unlimited Subs
	'Alpha Edition:PL-20': 11, // Leave It To Fate
	'Alpha Edition:PL-21': 10, // Ice Boost
	'Alpha Edition:PL-22': 16, // Steel Boost
	'Alpha Edition:PL-23': 10, // Fire Boost
	'Alpha Edition:PL-24': 6, // Fire Roll
	'Alpha Edition:PL-25': 6, // Ice Roll
	'Alpha Edition:PL-26': 7, // Bigger Steel Roll
	'Alpha Edition:PL-27': 21, // By Any Means Necessary
	'Alpha Edition:PL-28': 8, // Pick On Someone Your Own Size
	'Alpha Edition:PL-29': 25, // Dogpile
	'Alpha Edition:PL-30': 25, // Noble Sacrifice
	'Alpha Edition:PL-31': 17, // Buff Up 15
	'Alpha Edition:PL-32': 17, // Opp Loses 15
	'Alpha Edition:PL-33': 22, // Lose 1 To Win 2 (Hopefully)
	'Alpha Edition:PL-34': 5, // Luck Of The Draw
	'Alpha Edition:PL-35': 20, // Discarded Heroes
	'Alpha Edition:PL-36': 9, // Make It, Take It
	'Alpha Edition:PL-37': 10, // Heads I Win, Tails You Lose
	'Alpha Edition:PL-38': 10, // Fairweather Fan
	'Alpha Edition:PL-39': 50, // Flash Sale
	'Alpha Edition:PL-40': 2, // Ha! Gotcha
	'Alpha Edition:PL-41': 35, // Pay It For Me
	'Alpha Edition:PL-42': 25, // Only Upside
	'Alpha Edition:PL-43': 7, // Recycle For 5
	'Alpha Edition:PL-44': 12, // Steel Flipper
	'Alpha Edition:PL-45': 21, // 2 Get 10
	'Alpha Edition:PL-46': 21, // 10/10 Unfair
	'Alpha Edition:PL-47': 5, // I Get Some, You Get Some.
	'Alpha Edition:PL-48': 31, // I Get 1. You Lose 1.
	'Alpha Edition:PL-49': 26, // 3rd Time Charm
	'Alpha Edition:PL-50': 16, // Baby Phoenix
	'Alpha Edition:PL-51': 19, // Steel Resolve
	'Alpha Edition:PL-52': 8, // Only Fire
	'Alpha Edition:PL-53': 8, // Only Ice
	'Alpha Edition:PL-54': 11, // Only Steel
	'Alpha Edition:PL-55': 94, // Flame Wall
	'Alpha Edition:PL-56': 94, // Icy Shield
	'Alpha Edition:PL-57': 95, // Steel Defense
	'Alpha Edition:PL-58': 4, // Indestructible
	'Alpha Edition:PL-59': 110, // Full Court Press
	'Alpha Edition:PL-60': 12, // Curveball
	'Alpha Edition:PL-61': 39, // Add Firepower
	'Alpha Edition:PL-62': 12, // Going Back to Back
	'Alpha Edition:PL-63': 13, // Flip Ya For 2 Plays
	'Alpha Edition:PL-64': 17, // Easy Choice
	'Alpha Edition:PL-65': 90, // Dog Gone Inflation
	'Alpha Edition:PL-66': 43, // Tough Call
	'Alpha Edition:PL-67': 21, // Don't Call It A Comeback
	'Alpha Edition:PL-68': 17, // Late-Game Magic
	'Alpha Edition:PL-69': 10, // Loan Sharked
	'Alpha Edition:PL-70': 19, // Pulling The Plug
	'Alpha Edition:PL-71': 10, // Rally Cap
	'Alpha Edition:PL-72': 16, // Rob Peter Pay Paul
	'Alpha Edition:PL-73': 12, // Shooters Shoot
	'Alpha Edition:PL-74': 33, // The Champion's Lasso
	'Alpha Edition:PL-75': 12, // To Fight Another Day
	'Alpha Edition:PL-76': 34, // Win The Toss
	'Alpha Edition:PL-77': 7, // Gavel of Justice
	'Alpha Edition:PL-78': 23, // No Huddle
	'Alpha Edition:PL-79': 7, // 1-4-1 Hero
	'Alpha Edition:PL-80': 34, // 1-4-1 Play
	'Alpha Edition:PL-81': 32, // Adding Depth
	'Alpha Edition:PL-82': 5, // Crystal Ball
	'Alpha Edition:PL-83': 4, // Double or Nothin'
	'Alpha Edition:PL-84': 12, // Heads-Up!
	'Alpha Edition:PL-85': 5, // Jump Ball
	'Alpha Edition:PL-86': 7, // Late Game Lockdown
	'Alpha Edition:PL-87': 5, // Lucky 7
	'Alpha Edition:PL-88': 18, // Lucky Bounce
	'Alpha Edition:PL-89': 18, // Robin Who
	'Alpha Edition:PL-90': 19, // Pinch Hitter
	'Alpha Edition:PL-91': 29, // Prevent D
	'Alpha Edition:PL-93': 8, // Rebuild
	'Alpha Edition:PL-94': 4, // Waiver Wire Pickup
	'Alpha Edition:PL-95': 17, // Trash Bandit
	'Alpha Edition:PL-96': 11, // Worth The Risk?
	'Alpha Edition:PL-97': 6, // Opps' Choice
	'Alpha Edition:PL-98': 6, // Immunity
	'Alpha Edition:PL-99': 2, // Change The Future
	'Alpha Edition:PL-100': 4, // QB Sneak
	'Alpha Edition:BPL-1': 5, // Member Bounce
	'Alpha Edition:BPL-2': 5, // The 12th Man
	'Alpha Edition:BPL-3': 13, // The Heroes Favorite Hot Dogs
	'Alpha Edition:BPL-4': 13, // Instant Refund
	'Alpha Edition:BPL-5': 5, // Roller Dogs
	'Alpha Edition:BPL-6': 5, // 3 Weapon Streak
	'Alpha Edition:BPL-7': 1, // 5 Weapon Streak
	'Alpha Edition:BPL-8': 69, // Call it a Day
	'Alpha Edition:BPL-9': 5, // Power Drain
	'Alpha Edition:BPL-10': 2, // Hero's Resolve
	'Alpha Edition:BPL-11': 2, // Return from the Depths
	'Alpha Edition:BPL-12': 3, // Tear a Page
	'Alpha Edition:BPL-13': 3, // Strength in Numbers
	'Alpha Edition:BPL-14': 2, // Hex Draw Play
	'Alpha Edition:BPL-15': 5, // Glow Draw Play
	'Alpha Edition:BPL-16': 3, // Gum Draw Play
	'Alpha Edition:BPL-17': 3, // Bundle Deal
	'Alpha Edition:BPL-18': 7, // Sacrificed Heroes
	'Alpha Edition:BPL-19': 6, // Sacrifice it All to Win
	'Alpha Edition:BPL-20': 10, // Restricted List
	'Alpha Edition:BPL-21': 43, // Locked Playbook
	'Alpha Edition:BPL-22': 2, // Bench Lock
	'Alpha Edition:BPL-23': 47, // Play Reset
	'Alpha Edition:BPL-24': 1, // Risky Recovery
	'Alpha Edition:BPL-25': 13, // Cheap Draw

	// ── Griffey Edition (G) ──
	'Griffey Edition:PL-1': 44, // Grilled Bandit
	'Griffey Edition:PL-2': 8, // The Closer
	'Griffey Edition:PL-3': 15, // Banked Power
	'Griffey Edition:PL-4': 5, // Hero Reset
	'Griffey Edition:PL-5': 24, // One And Done
	'Griffey Edition:PL-6': 25, // Too Full To Fight
	'Griffey Edition:PL-7': 9, // Lineup Pressure
	'Griffey Edition:PL-8': 40, // Sacrifice And Scheme
	'Griffey Edition:PL-9': 37, // Momentum Breaker
	'Griffey Edition:PL-10': 28, // Drain And Deny
	'Griffey Edition:PL-11': 24, // Free Booster
	'Griffey Edition:PL-12': 25, // Momentum Meal
	'Griffey Edition:PL-13': 46, // Hero Tax
	'Griffey Edition:PL-14': 17, // Sack Streak
	'Griffey Edition:PL-15': 14, // Running On Fumes
	'Griffey Edition:PL-16': 33, // Rich Get Richer
	'Griffey Edition:PL-17': 15, // Overcommited
	'Griffey Edition:PL-18': 17, // Belly Buster
	'Griffey Edition:PL-19': 14, // Emergency Shutdown
	'Griffey Edition:PL-20': 17, // Double-Edged Flip
	'Griffey Edition:PL-21': 13, // Overextended
	'Griffey Edition:PL-22': 17, // Battle Back
	'Griffey Edition:PL-23': 22, // Weapon Tangle
	'Griffey Edition:PL-24': 10, // Hexvantage
	'Griffey Edition:PL-25': 39, // Trade-Up
	'Griffey Edition:PL-26': 17, // Baseline Bonus
	'Griffey Edition:PL-27': 31, // Consolation Combo
	'Griffey Edition:PL-28': 40, // Quick Draw
	'Griffey Edition:PL-29': 17, // Weapon-Sync
	'Griffey Edition:PL-30': 34, // Synergy Snacks
	'Griffey Edition:PL-31': 33, // Wildcard Wager
	'Griffey Edition:PL-32': 4, // Big Time Recruit
	'Griffey Edition:PL-33': 10, // Comeback Time
	'Griffey Edition:PL-34': 4, // Dice Duel
	'Griffey Edition:PL-35': 18, // High Stakes Pump-Up
	'Griffey Edition:PL-36': 34, // Pick Your Poison
	'Griffey Edition:PL-37': 38, // Snack Sanction
	'Griffey Edition:PL-38': 30, // Bun Shortage
	'Griffey Edition:PL-39': 30, // Burn To Burn
	'Griffey Edition:PL-40': 17, // Catch-Up Bonus
	'Griffey Edition:PL-41': 17, // Buff Or Debuff
	'Griffey Edition:PL-42': 20, // Glowaway
	'Griffey Edition:PL-43': 19, // Playbook Knowledge
	'Griffey Edition:PL-44': 18, // Scare Tactics
	'Griffey Edition:PL-45': 20, // Weapon Lineage
	'Griffey Edition:PL-46': 21, // Delayed Recovery
	'Griffey Edition:PL-47': 34, // Second Wind
	'Griffey Edition:PL-48': 18, // Protein Bar
	'Griffey Edition:PL-49': 12, // Different Leagues
	'Griffey Edition:PL-50': 38, // Refill And Reload
	'Griffey Edition:PL-51': 7, // Dog Gone Flip
	'Griffey Edition:PL-52': 18, // Combo Kick
	'Griffey Edition:PL-53': 13, // Overprepared
	'Griffey Edition:PL-54': 18, // More Plays, Less Power
	'Griffey Edition:PL-55': 19, // Lucky Discard
	'Griffey Edition:PL-56': 34, // Power Pick
	'Griffey Edition:PL-57': 7, // Toss And Trade
	'Griffey Edition:PL-58': 4, // Lucky Shot
	'Griffey Edition:PL-59': 16, // Bench Blocker
	'Griffey Edition:PL-60': 16, // Fallen Fighters
	'Griffey Edition:PL-61': 22, // Dead Red
	'Griffey Edition:PL-62': 6, // Play Surge
	'Griffey Edition:PL-63': 39, // First Draw
	'Griffey Edition:PL-64': 27, // Play Re-Order
	'Griffey Edition:PL-65': 6, // Discard Or 10
	'Griffey Edition:PL-66': 18, // Maximum Effort
	'Griffey Edition:PL-67': 10, // 3-Dog-Special
	'Griffey Edition:PL-68': 19, // Substitution Boost
	'Griffey Edition:PL-69': 5, // Bench Scout
	'Griffey Edition:PL-70': 11, // Good Guess
	'Griffey Edition:PL-71': 30, // Good Fortune
	'Griffey Edition:PL-72': 7, // 10 For A Sub
	'Griffey Edition:PL-73': 26, // Cheap Trick
	'Griffey Edition:PL-74': 7, // Weapon Mixer
	'Griffey Edition:PL-75': 21, // Streaky
	'Griffey Edition:BPL-1': 10, // Hot Dog Thief
	'Griffey Edition:BPL-2': 30, // Drought
	'Griffey Edition:BPL-3': 8, // Bonus Recovery
	'Griffey Edition:BPL-4': 4, // Called Shot
	'Griffey Edition:BPL-5': 13, // Plays Or Dogs?
	'Griffey Edition:BPL-6': 31, // Win or Weiners
	'Griffey Edition:BPL-7': 13, // Competitive Disadvantage
	'Griffey Edition:BPL-8': 22, // Lose And Discard
	'Griffey Edition:BPL-9': 14, // Rotten Dogs
	'Griffey Edition:BPL-10': 2, // Dumpster Battle
	'Griffey Edition:BPL-11': 2, // Head Start
	'Griffey Edition:BPL-12': 12, // Fair Trade
	'Griffey Edition:BPL-13': 1, // Storm The Field
	'Griffey Edition:BPL-14': 3, // Sub And Power-Up
	'Griffey Edition:BPL-15': 15, // Play Pluck
	'Griffey Edition:BPL-16': 7, // Surging Power
	'Griffey Edition:BPL-17': 3, // Honorable
	'Griffey Edition:BPL-18': 5, // A Game Of War
	'Griffey Edition:BPL-19': 1, // Big Spender Bonus
	'Griffey Edition:BPL-20': 1, // Super Draw
	'Griffey Edition:BPL-21': 5, // Hex Draw
	'Griffey Edition:BPL-22': 2, // Gum Draw
	'Griffey Edition:BPL-23': 49, // Clean Slate
	'Griffey Edition:BPL-24': 20, // Bull Market
	'Griffey Edition:BPL-25': 4, // Transparency Clause

	// ── Alpha Update (U) ──
	'Alpha Update:PL-1': 29, // Hot Dog Dominance
	'Alpha Update:PL-2': 37, // Cheap Addition
	'Alpha Update:PL-3': 24, // Edge Rush
	'Alpha Update:PL-4': 22, // Outside The Pocket
	'Alpha Update:PL-5': 21, // Dragging Anchor
	'Alpha Update:PL-6': 18, // Saving Bullets
	'Alpha Update:PL-7': 36, // 10 Per Play
	'Alpha Update:PL-8': 19, // Opening Strike
	'Alpha Update:PL-9': 60, // Roll Some Plays
	'Alpha Update:PL-10': 38, // Updog
	'Alpha Update:PL-11': 12, // Plan Ahead
	'Alpha Update:PL-12': 13, // Comeback Season
	'Alpha Update:PL-13': 17, // Line Drive
	'Alpha Update:PL-14': 17, // 1/6 For 15
	'Alpha Update:PL-15': 41, // Money Line
	'Alpha Update:PL-16': 24, // Make Up Meal
	'Alpha Update:PL-17': 36, // Combo Deal
	'Alpha Update:PL-18': 15, // Steel Shield
	'Alpha Update:PL-19': 5, // Unbreakable Ice
	'Alpha Update:PL-20': 8, // Eternal Flame
	'Alpha Update:PL-21': 17, // Heavy Swing
	'Alpha Update:PL-22': 39, // 1 For 10
	'Alpha Update:PL-23': 45, // 2 For 20
	'Alpha Update:PL-24': 41, // Overwhelm
	'Alpha Update:PL-25': 5, // Frozen Lineup
	'Alpha Update:PL-26': 4, // Torched
	'Alpha Update:PL-27': 5, // Steel Cage
	'Alpha Update:PL-28': 15, // Big Win Energy
	'Alpha Update:PL-29': 18, // Early Round Magic
	'Alpha Update:PL-30': 5, // Another Man's Treasure
	'Alpha Update:PL-31': 17, // Save It For Later
	'Alpha Update:PL-32': 5, // Double Replacement
	'Alpha Update:PL-33': 7, // Transfer Portal
	'Alpha Update:PL-34': 18, // Damage On Discard
	'Alpha Update:PL-35': 9, // Radiant Comeback
	'Alpha Update:PL-36': 9, // Icy Comeback
	'Alpha Update:PL-37': 9, // Fire Comeback
	'Alpha Update:PL-38': 16, // Polished Comeback
	'Alpha Update:PL-39': 14, // Contract Limitations
	'Alpha Update:PL-40': 13, // High Fastball
	'Alpha Update:PL-41': 14, // Greedy Gamble
	'Alpha Update:PL-42': 6, // Sticky Strength
	'Alpha Update:PL-43': 45, // Recycle
	'Alpha Update:PL-44': 15, // Make Up Call
	'Alpha Update:PL-45': 5, // Might Of The Underdog
	'Alpha Update:PL-46': 9, // Frozen Flip
	'Alpha Update:PL-47': 5, // Flaming Flip
	'Alpha Update:PL-48': 6, // Stainless Flip
	'Alpha Update:PL-49': 34, // Feast Or Famine
	'Alpha Update:PL-50': 18, // Winners Win
	'Alpha Update:PL-51': 7, // Hollow Bat
	'Alpha Update:PL-52': 39, // 2 Plays
	'Alpha Update:PL-53': 6, // Lost Plays
	'Alpha Update:PL-54': 6, // One-And-One
	'Alpha Update:PL-55': 18, // X-Ray Vision
	'Alpha Update:PL-56': 4, // Risky Substitution
	'Alpha Update:PL-57': 24, // Ice Crew
	'Alpha Update:PL-58': 25, // Steel Crew
	'Alpha Update:PL-59': 24, // Fire Crew
	'Alpha Update:PL-60': 6, // Steel Helmet
	'Alpha Update:PL-61': 5, // Blind Substitution
	'Alpha Update:PL-62': 4, // Double Down
	'Alpha Update:PL-63': 15, // Frost-Hardened
	'Alpha Update:PL-64': 11, // Nasty Or Nada
	'Alpha Update:PL-65': 20, // Frostbiter
	'Alpha Update:PL-66': 18, // Scrap Metal
	'Alpha Update:PL-67': 12, // Burnout
	'Alpha Update:PL-68': 9, // Molten Steel
	'Alpha Update:PL-69': 18, // Forced Retreat
	'Alpha Update:PL-70': 7, // Rusted Edge
	'Alpha Update:PL-71': 6, // Fire Hose
	'Alpha Update:PL-72': 7, // Icevantage
	'Alpha Update:PL-73': 6, // Late Hit
	'Alpha Update:PL-74': 4, // Pre-Game Ritual
	'Alpha Update:PL-75': 6, // Burning Fever
	'Alpha Update:PL-76': 4, // Frozen Resolve
	'Alpha Update:PL-77': 8, // Chrome Will
	'Alpha Update:PL-78': 2, // Super Lucky
	'Alpha Update:PL-79': 4, // Hex Flipper
	'Alpha Update:PL-80': 8, // Lucky Gum
	'Alpha Update:PL-81': 7, // Flip & Glow
	'Alpha Update:PL-82': 7, // Steel Smash
	'Alpha Update:PL-83': 7, // Firework
	'Alpha Update:PL-84': 7, // Ice Blast
	'Alpha Update:PL-85': 24, // Forced Substitution
	'Alpha Update:PL-86': 8, // Brothers In Arms
	'Alpha Update:PL-87': 17, // No Retreat
	'Alpha Update:PL-88': 11, // Cursed Coin
	'Alpha Update:PL-89': 4, // Fire Extinguisher
	'Alpha Update:PL-90': 4, // Ice Pick
	'Alpha Update:PL-91': 5, // Stain-Less-Steel
	'Alpha Update:PL-92': 5, // Roster Cuts
	'Alpha Update:PL-93': 5, // Ice Climber
	'Alpha Update:PL-94': 5, // Smitty
	'Alpha Update:PL-95': 6, // Last-Minute Re-Org
	'Alpha Update:PL-96': 35, // Over Under
	'Alpha Update:PL-97': 4, // Discard Rebate
	'Alpha Update:PL-98': 5, // Three Strikes You're Out
	'Alpha Update:PL-99': 4, // Even Money
	'Alpha Update:PL-100': 35, // Mutually Assured Dogstruction
	'Alpha Update:BPL-1': 25, // Copycat
	'Alpha Update:BPL-2': 5, // My Idol
	'Alpha Update:BPL-3': 20, // Student Loan
	'Alpha Update:BPL-4': 5, // Ghost Dog
	'Alpha Update:BPL-5': 4, // Incendiary Dog
	'Alpha Update:BPL-6': 3, // Ultimatum Dog
	'Alpha Update:BPL-7': 10, // Lunch Break
	'Alpha Update:BPL-8': 5, // Scorching Pressure
	'Alpha Update:BPL-9': 5, // Cold Pressure
	'Alpha Update:BPL-10': 5, // Steel Pressure
	'Alpha Update:BPL-11': 8, // Glow-Up
	'Alpha Update:BPL-12': 2, // Lineup Randomizer
	'Alpha Update:BPL-13': 45, // Play Lockdown
	'Alpha Update:BPL-14': 1, // The Perfect Offense
	'Alpha Update:BPL-15': 5, // Hot Dog Stock Exchange
	'Alpha Update:BPL-16': 3, // Sweet Relish
	'Alpha Update:BPL-17': 73, // A Hard Bargain
	'Alpha Update:BPL-18': 4, // Pre-Game Spy
	'Alpha Update:BPL-19': 34, // Hungry Demands
	'Alpha Update:BPL-20': 2, // Roll And Hope
	'Alpha Update:BPL-21': 1, // Turn the Tide
	'Alpha Update:BPL-22': 2, // Drop The Giant
	'Alpha Update:BPL-23': 2, // Low Turnover
	'Alpha Update:BPL-24': 3, // High Turnover
	'Alpha Update:BPL-25': 5, // Lunch Table

	// ── Alpha Blast (HTD) ──
	'Alpha Blast:HTD-1': 12, // Transfer Portal - htd
	'Alpha Blast:HTD-2': 51, // Recycle - htd
	'Alpha Blast:HTD-3': 17, // Contract Limitations - htd
	'Alpha Blast:HTD-4': 19, // Hollow Bat - htd
	'Alpha Blast:HTD-5': 8, // Lost Plays - htd
	'Alpha Blast:HTD-6': 8, // One-And-One - htd
	'Alpha Blast:HTD-7': 30, // Ice Crew - htd
	'Alpha Blast:HTD-8': 33, // Steel Crew - htd
	'Alpha Blast:HTD-9': 30, // Fire Crew - htd
	'Alpha Blast:HTD-10': 8, // Blind Substitution - htd
	'Alpha Blast:HTD-11': 19, // Frost-Hardened - htd
	'Alpha Blast:HTD-12': 15, // Nasty Or Nada - htd
	'Alpha Blast:HTD-13': 13, // Molten Steel - htd
	'Alpha Blast:HTD-14': 23, // Forced Retreat - htd
	'Alpha Blast:HTD-15': 8, // Burning Fever - htd
	'Alpha Blast:HTD-16': 5, // Frozen Resolve - htd
	'Alpha Blast:HTD-17': 28, // Forced Substitution - htd
	'Alpha Blast:HTD-18': 11, // Brothers In Arms - htd
	'Alpha Blast:HTD-19': 15, // Cursed Coin - htd
	'Alpha Blast:HTD-20': 5, // Fire Extinguisher - htd
	'Alpha Blast:HTD-21': 5, // Ice Pick - htd
	'Alpha Blast:HTD-22': 7, // Stain-Less-Steel - htd
	'Alpha Blast:HTD-23': 8, // Roster Cuts - htd
	'Alpha Blast:HTD-24': 7, // Ice Climber - htd
	'Alpha Blast:HTD-25': 7, // Smitty - htd
	'Alpha Blast:HTD-26': 7, // Last-Minute Re-Org
	'Alpha Blast:HTD-27': 43, // Over Under - htd
	'Alpha Blast:HTD-28': 13, // Radiant Comeback - htd
	'Alpha Blast:HTD-29': 13, // Icy Comeback - htd
	'Alpha Blast:HTD-30': 13, // Fire Comeback - htd
	'Alpha Blast:HTD-31': 13, // Gavel of Justice - htd
	'Alpha Blast:HTD-32': 13, // Heads I Win, Tails You Lose - htd
	'Alpha Blast:HTD-33': 31, // Only Upside - htd
	'Alpha Blast:HTD-34': 39, // 3rd Time Charm - htd
	'Alpha Blast:HTD-35': 12, // Only Fire - htd
	'Alpha Blast:HTD-36': 12, // Only Ice - htd
	'Alpha Blast:HTD-37': 15, // Only Steel - htd
	'Alpha Blast:HTD-38': 106, // Flame Wall - htd
	'Alpha Blast:HTD-39': 106, // Icy Shield - htd
	'Alpha Blast:HTD-40': 108, // Steel Defense - htd
	'Alpha Blast:HTD-41': 16, // Curveball - htd
	'Alpha Blast:HTD-42': 16, // Loan Sharked - htd
	'Alpha Blast:HTD-43': 15, // Shooters Shoot - htd
	'Alpha Blast:HTD-44': 15, // Heads-Up! - htd
	'Alpha Blast:HTD-45': 15, // To Fight Another Day - htd
	'Alpha Blast:HTD-46': 40, // 1-4-1 Play - htd
	'Alpha Blast:HTD-47': 38, // Adding Depth - htd
	'Alpha Blast:HTD-48': 10, // Late Game Lockdown - htd
	'Alpha Blast:HTD-49': 34, // Prevent D - htd
	'Alpha Blast:HTD-50': 12, // Rebuild - htd
	'Alpha Blast:HTD-51': 14, // Worth The Risk? - htd
	'Alpha Blast:HTD-52': 49, // Tough Call - htd
	'Alpha Blast:HTD-53': 5, // Indestructible - htd
	'Alpha Blast:HTD-54': 16, // Going Back to Back - htd
	'Alpha Blast:HTD-55': 20, // Easy Choice - htd
	'Alpha Blast:HTD-56': 24, // Pulling The Plug - htd
	'Alpha Blast:HTD-57': 13, // Rally Cap - htd
	'Alpha Blast:HTD-58': 23, // Rob Peter Pay Paul - htd
	'Alpha Blast:HTD-59': 13, // Make It, Take It - htd
	'Alpha Blast:HTD-60': 5, // QB Sneak - htd

};

/** Build a composite key from set_code and card_number */
function buildKey(cardNumber: string, setCode?: string): string {
	const num = cardNumber.trim().toUpperCase();
	if (setCode) {
		return setCode + ':' + num;
	}
	// HTD cards have unique numbers — no set prefix needed for lookup
	if (num.startsWith('HTD-')) {
		return 'Alpha Blast:' + num;
	}
	return num;
}

/**
 * Get the DBS score for a Play card.
 * @param cardNumber - e.g. "PL-1", "BPL-6", "HTD-12"
 * @param setCode - e.g. "Alpha Edition", "Griffey Edition" (required for PL/BPL cards)
 * Returns null if not in the lookup.
 */
export function getDbsScore(cardNumber: string, setCode?: string): number | null {
	const key = buildKey(cardNumber, setCode);
	return _dynamicDbs?.[key] ?? DBS_SCORES[key] ?? null;
}

/** Alias for getDbsScore — look up the DBS score for a single Play/Bonus Play card number. */
export function getDbs(cardNumber: string, setCode?: string): number | null {
	return getDbsScore(cardNumber, setCode);
}

/** Check if DBS data is available (enough cards have scores to be useful) */
function isDbsDataAvailable(): boolean {
	return Object.keys(DBS_SCORES).length >= 20;
}

/**
 * Calculate total DBS for a set of Play cards.
 * Each entry is { cardNumber, setCode } to uniquely identify the play.
 * Returns null if data is insufficient.
 */
export function calculateTotalDbs(
	cards: Array<{ cardNumber: string; setCode?: string }>
): { total: number; missing: string[] } | null {
	if (!isDbsDataAvailable()) return null;

	let total = 0;
	const missing: string[] = [];

	for (const { cardNumber, setCode } of cards) {
		const score = getDbsScore(cardNumber, setCode);
		if (score !== null) {
			total += score;
		} else {
			missing.push(setCode ? setCode + ':' + cardNumber : cardNumber);
		}
	}

	// If more than 25% of cards are missing scores, the total is unreliable
	if (missing.length > cards.length * 0.25) return null;

	return { total, missing };
}

export const DBS_CAP = 1000;

/** Return a copy of the DBS scores map (for server-side data passing) */
export function getDbsScoresMap(): Record<string, number> {
	return { ...DBS_SCORES, ..._dynamicDbs };
}

// ── Supabase overlay (updates without deployment) ──────────
let _dynamicDbs: Record<string, number> | null = null;
