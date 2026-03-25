import { describe, it, expect } from 'vitest';
import {
	analyzeDBS,
	projectHDFlow,
	analyzeDrawProbability,
	detectCombos,
	recommendHeroes,
	matchArchetypes,
	evaluateBonusPlays,
	allocateForTwoTournaments,
	type PlayCard
} from '../src/lib/services/playbook-engine';
import { getFormat } from '../src/lib/data/tournament-formats';
import { categorizePlay } from '../src/lib/data/play-categories';

// ── Helpers ─────────────────────────────────────────────────

function makePlays(
	count: number,
	overrides: Partial<PlayCard> = {}
): PlayCard[] {
	return Array.from({ length: count }, (_, i) => ({
		id: `test-PL-${i + 1}`,
		card_number: `PL-${i + 1}`,
		name: `Test Play ${i + 1}`,
		release: 'A',
		type: 'PL' as const,
		number: i + 1,
		hot_dog_cost: 2,
		dbs: 20,
		ability: '',
		...overrides
	}));
}

function makePlay(name: string, overrides: Partial<PlayCard> = {}): PlayCard {
	return {
		id: `test-${name}`,
		card_number: 'PL-99',
		name,
		release: 'A',
		type: 'PL' as const,
		number: 99,
		hot_dog_cost: 2,
		dbs: 20,
		ability: '',
		...overrides
	};
}

// ── DBS Analysis ────────────────────────────────────────────

describe('analyzeDBS', () => {
	const specFormat = getFormat('spec_playmaker')!;

	it('calculates correct total, remaining, and percentUsed for plays under cap', () => {
		const plays = makePlays(30, { dbs: 30 });
		const result = analyzeDBS(plays, specFormat);

		expect(result.total).toBe(900);
		expect(result.cap).toBe(1000);
		expect(result.remaining).toBe(100);
		expect(result.percentUsed).toBe(90);
		expect(result.isOverCap).toBe(false);
		expect(result.filledSlots).toBe(30);
	});

	it('detects when plays exceed the DBS cap', () => {
		const plays = makePlays(30, { dbs: 40 });
		const result = analyzeDBS(plays, specFormat);

		expect(result.total).toBe(1200);
		expect(result.isOverCap).toBe(true);
		expect(result.percentUsed).toBe(100); // Capped at 100
		expect(result.remaining).toBe(0);
	});

	it('handles format with no DBS cap', () => {
		const eliteFormat = getFormat('elite_playmaker')!;
		const plays = makePlays(30, { dbs: 50 });
		const result = analyzeDBS(plays, eliteFormat);

		expect(result.cap).toBeNull();
		expect(result.remaining).toBe(Infinity);
		expect(result.percentUsed).toBe(0);
		expect(result.isOverCap).toBe(false);
	});

	it('computes avgPerSlot correctly', () => {
		const plays = makePlays(20, { dbs: 30 });
		const result = analyzeDBS(plays, specFormat);

		// 1000 - 600 = 400 remaining, 55 total slots - 20 = 35 empty
		expect(result.avgPerSlot).toBe(Math.round(400 / 35));
	});
});

// ── HD Flow Projection ──────────────────────────────────────

describe('projectHDFlow', () => {
	it('with all free plays, HD stays high and never runs out', () => {
		const freePlays = makePlays(30, { hot_dog_cost: 0 });
		const result = projectHDFlow(freePlays, 0.33);

		expect(result.runsOutAt).toBeNull();
		expect(result.hdEndOfGame).toBeGreaterThanOrEqual(5);
	});

	it('with expensive plays and no recovery, HD depletes early', () => {
		const expensivePlays = makePlays(30, { hot_dog_cost: 3 });
		const result = projectHDFlow(expensivePlays, 0.33);

		expect(result.runsOutAt).not.toBeNull();
		expect(result.runsOutAt).toBeLessThanOrEqual(5);
	});

	it('higher weapon concentration means fewer substitutions', () => {
		const plays = makePlays(30, { hot_dog_cost: 1 });
		const highConc = projectHDFlow(plays, 0.8);
		const lowConc = projectHDFlow(plays, 0.3);

		expect(highConc.totalSubstitutions).toBeLessThan(lowConc.totalSubstitutions);
	});
});

// ── Draw Probability ────────────────────────────────────────

describe('analyzeDrawProbability', () => {
	it('calculates ~54% for 5 draw plays in a 30-card deck', () => {
		const plays = makePlays(30);
		// Give 5 plays the draw ability
		for (let i = 0; i < 5; i++) {
			plays[i].ability = 'Draw a play from your playbook';
		}

		const result = analyzeDrawProbability(plays, 30);

		// P(at least 1 in 4 from 30 with 5) ≈ 0.534
		expect(result.drawPlayInOpening).toBeGreaterThan(0.45);
		expect(result.drawPlayInOpening).toBeLessThan(0.65);
	});

	it('returns 0% for empty categories', () => {
		const plays = makePlays(30);
		const result = analyzeDrawProbability(plays, 30);

		expect(result.categoryDrawRates['dice_roll'].count).toBe(0);
		expect(result.categoryDrawRates['dice_roll'].probInOpening4).toBe(0);
	});

	it('returns near 100% for a category with many cards', () => {
		const plays = makePlays(30, { hot_dog_cost: 0 });
		const result = analyzeDrawProbability(plays, 30);

		// All 30 plays are free (cost 0), so free_play category has 30 cards
		expect(result.categoryDrawRates['free_play'].probInOpening4).toBe(1);
	});
});

// ── Combo Detection ─────────────────────────────────────────

describe('detectCombos', () => {
	it('detects complete Dice Engine combo', () => {
		const plays = [
			makePlay('Deep In The Playbook'),
			makePlay('Pay The Price'),
			makePlay('Leave It To Chance')
		];
		const result = detectCombos(plays);

		expect(result.complete).toHaveLength(1);
		expect(result.complete[0].engine.id).toBe('dice_engine');
	});

	it('detects partial combo with missing card', () => {
		const plays = [
			makePlay('Deep In The Playbook'),
			makePlay('Pay The Price')
		];
		const result = detectCombos(plays);

		expect(result.partial).toHaveLength(1);
		expect(result.partial[0].engine.id).toBe('dice_engine');
		expect(result.partial[0].missing).toEqual(['Leave It To Chance']);
		expect(result.partial[0].present).toHaveLength(2);
	});

	it('detects enhancers for complete combos', () => {
		const plays = [
			makePlay('Deep In The Playbook'),
			makePlay('Pay The Price'),
			makePlay('Leave It To Chance'),
			makePlay('Dice Duel')
		];
		const result = detectCombos(plays);

		expect(result.complete[0].enhancersPresent).toContain('Dice Duel');
	});

	it('places unrelated engines in absent', () => {
		const plays = [makePlay('Random Play')];
		const result = detectCombos(plays);

		expect(result.absent.length).toBeGreaterThan(0);
	});
});

// ── Hero Weapon Recommendation ──────────────────────────────

describe('recommendHeroes', () => {
	it('recommends 50 heroes for 10 steel-specific plays', () => {
		const plays = makePlays(10, {
			ability: 'If your hero has a Steel weapon, hero gets +20'
		});
		const result = recommendHeroes(plays);

		expect(result.primaryWeapon).toBe('steel');
		expect(result.primaryCount).toBe(50);
	});

	it('recommends weapon-agnostic for 0 weapon-specific plays', () => {
		const plays = makePlays(10);
		const result = recommendHeroes(plays);

		expect(result.primaryWeapon).toBeNull();
		expect(result.primaryCount).toBe(0);
	});

	it('recommends weapon-agnostic for fewer than 3 weapon plays', () => {
		const plays = makePlays(10);
		plays[0].ability = 'If your hero has a Fire weapon, hero gets +20';
		plays[1].ability = 'If your hero has a Fire weapon, hero gets +10';
		const result = recommendHeroes(plays);

		expect(result.primaryWeapon).toBeNull();
	});

	it('detects secondary weapon', () => {
		const plays = [
			...makePlays(6, { ability: 'If your hero has a Steel weapon, hero gets +20' }),
			...makePlays(4, { ability: 'If your hero has a Fire weapon, hero gets +15' })
		];
		// Make names unique
		plays.forEach((p, i) => { p.name = `Play ${i}`; p.id = `id-${i}`; });

		const result = recommendHeroes(plays);

		expect(result.primaryWeapon).toBe('steel');
		expect(result.secondaryWeapon).toBe('fire');
		expect(result.secondaryCount).toBeGreaterThan(0);
	});
});

// ── Archetype Matching ──────────────────────────────────────

describe('matchArchetypes', () => {
	it('ranks Steel Fortress highest with many steel plays', () => {
		const plays = makePlays(20, {
			ability: 'If your hero has a Steel weapon, hero gets +20'
		});
		plays.forEach((p, i) => { p.name = `Steel Play ${i}`; p.id = `id-${i}`; });

		const specFormat = getFormat('spec_playmaker')!;
		const results = matchArchetypes(plays, specFormat);

		// Steel Fortress should be present and highly ranked
		const steelFortress = results.find(r => r.archetype.id === 'mono_steel_fortress');
		expect(steelFortress).toBeDefined();
		expect(steelFortress!.matchScore).toBeGreaterThan(0);
	});

	it('filters out archetypes incompatible with the format', () => {
		const plays = makePlays(10);
		// Blizzard Bowl doesn't appear in most archetype bestFormats
		const blizzardFormat = getFormat('blizzard_bowl')!;
		const results = matchArchetypes(plays, blizzardFormat);

		// Should have fewer results since many archetypes don't list blizzard_bowl
		expect(results.length).toBeLessThan(6);
	});
});

// ── Bonus Play Evaluation ───────────────────────────────────

describe('evaluateBonusPlays', () => {
	it('rates a persistent free play highly', () => {
		// Use a small deck so dilution cost is lower
		const deck = makePlays(10, { dbs: 10 });
		const bonusPlays: PlayCard[] = [
			makePlay('Bonus Recovery', {
				type: 'BPL',
				hot_dog_cost: 0,
				dbs: 8,
				ability: 'For the rest of the game, recover +10 extra hot dog'
			})
		];

		const result = evaluateBonusPlays(deck, bonusPlays, 10);

		expect(result).toHaveLength(1);
		// Persistent multiplier (3x) on +10 = 30 raw impact, dilution is low with 10 cards
		expect(result[0].verdict).toBe('add');
		expect(result[0].rawImpact).toBeGreaterThan(result[0].dilutionCost);
	});

	it('returns empty array when no bonus plays available', () => {
		const deck = makePlays(30);
		const result = evaluateBonusPlays(deck, [], 30);
		expect(result).toHaveLength(0);
	});
});

// ── Multi-Tournament Allocation ─────────────────────────────

describe('allocateForTwoTournaments', () => {
	it('splits plays across two decks without exceeding DBS cap', () => {
		const specFormat = getFormat('spec_playmaker')!;
		const apexFormat = getFormat('apex_playmaker')!;

		// Create 80 owned plays
		const plays = makePlays(80, { dbs: 25 });
		plays.forEach((p, i) => { p.name = `Play ${i}`; p.id = `id-${i}`; });

		const result = allocateForTwoTournaments(
			plays, specFormat, 'mono_steel_fortress', apexFormat, 'dice_aggro'
		);

		// Both decks should be at capacity (30 each)
		expect(result.deck1.length).toBe(30);
		expect(result.deck2.length).toBe(30);

		// DBS check
		const dbs1 = result.deck1.reduce((s, p) => s + p.dbs, 0);
		const dbs2 = result.deck2.reduce((s, p) => s + p.dbs, 0);
		expect(dbs1).toBeLessThanOrEqual(1000);
		expect(dbs2).toBeLessThanOrEqual(1000);
	});

	it('handles format with no DBS cap', () => {
		const eliteFormat = getFormat('elite_playmaker')!;
		const specFormat = getFormat('spec_playmaker')!;

		const plays = makePlays(100, { dbs: 30 });
		plays.forEach((p, i) => { p.name = `Play ${i}`; p.id = `id-${i}`; });

		const result = allocateForTwoTournaments(
			plays, eliteFormat, 'free_play_engine', specFormat, 'mono_steel_fortress'
		);

		expect(result.deck1.length).toBeLessThanOrEqual(45); // Elite has 45 play slots
		expect(result.deck2.length).toBeLessThanOrEqual(30);
	});
});

// ── Play Categorization ─────────────────────────────────────

describe('categorizePlay', () => {
	it('categorizes a free play correctly', () => {
		const cats = categorizePlay({ ability: '', hot_dog_cost: 0 });
		expect(cats).toContain('free_play');
	});

	it('categorizes by ability text patterns', () => {
		const cats = categorizePlay({
			ability: 'Flip a coin. Heads: your hero gets +20',
			hot_dog_cost: 1
		});
		expect(cats).toContain('coin_flip');
		expect(cats).toContain('power_boost');
	});

	it('categorizes dice roll plays', () => {
		const cats = categorizePlay({
			ability: 'Roll a die. On 4+, your hero gets +30',
			hot_dog_cost: 2
		});
		expect(cats).toContain('dice_roll');
	});

	it('categorizes persistent effects', () => {
		const cats = categorizePlay({
			ability: 'For the rest of the game, your heroes get +10',
			hot_dog_cost: 3
		});
		expect(cats).toContain('persistent');
	});

	it('returns empty array for paid play with no matching text', () => {
		const cats = categorizePlay({ ability: 'Something unusual', hot_dog_cost: 2 });
		expect(cats).toEqual([]);
	});
});
