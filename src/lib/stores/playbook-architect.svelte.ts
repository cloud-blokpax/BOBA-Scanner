/**
 * Playbook Architect Reactive State
 *
 * Manages the player's playbook-in-progress with Svelte 5 runes.
 * All derived values (DBS analysis, HD flow, draw probability,
 * combo detection, hero recommendation) update automatically
 * when the selected plays change.
 */

import {
	analyzeDBS,
	projectHDFlow,
	analyzeDrawProbability,
	detectCombos,
	recommendHeroes,
	matchArchetypes,
	evaluateBonusPlays,
	type PlayCard,
	type DBSAnalysis,
	type HDFlowProjection,
	type DrawProbabilityAnalysis,
	type ComboDetectionResult,
	type HeroRecommendation,
	type ArchetypeMatchResult,
	type BonusPlayEvaluation
} from '$lib/services/playbook-engine';
import { getFormat, type FormatRules } from '$lib/data/tournament-formats';
import { getComboEngine } from '$lib/data/combo-engines';

// ── Primary state (user-modified) ───────────────────────────

let _selectedPlays = $state<PlayCard[]>([]);
let _ownedPlays = $state<PlayCard[]>([]);
let _formatId = $state<string>('spec_playmaker');
let _archetypeId = $state<string | null>(null);

// ── Derived state (auto-computed) ───────────────────────────

const format = $derived<FormatRules | undefined>(getFormat(_formatId));

const dbsAnalysis = $derived<DBSAnalysis | null>(
	format ? analyzeDBS(_selectedPlays, format) : null
);

const standardPlays = $derived(_selectedPlays.filter((p) => p.type === 'PL'));
const bonusPlays = $derived(_selectedPlays.filter((p) => p.type === 'BPL'));

const heroRec = $derived<HeroRecommendation>(recommendHeroes(_selectedPlays));

const weaponConcentration = $derived(
	heroRec.primaryWeapon ? heroRec.primaryCount / 60 : 0.33
);

const hdFlow = $derived<HDFlowProjection>(
	projectHDFlow(_selectedPlays, weaponConcentration)
);

const effectiveDeckSize = $derived(standardPlays.length + bonusPlays.length);

const drawProb = $derived<DrawProbabilityAnalysis>(
	analyzeDrawProbability(_selectedPlays, Math.max(30, effectiveDeckSize))
);

const combos = $derived<ComboDetectionResult>(detectCombos(_selectedPlays));

const archetypeMatches = $derived<ArchetypeMatchResult[]>(
	format ? matchArchetypes(_ownedPlays, format) : []
);

const availableBonusPlays = $derived(
	_ownedPlays.filter(
		(p) => p.type === 'BPL' && !_selectedPlays.some((s) => s.name === p.name)
	)
);

const bonusPlayEvaluations = $derived<BonusPlayEvaluation[]>(
	evaluateBonusPlays(_selectedPlays, availableBonusPlays, effectiveDeckSize)
);

// ── Public API ──────────────────────────────────────────────

export function selectedPlays(): PlayCard[] {
	return _selectedPlays;
}
export function ownedPlays(): PlayCard[] {
	return _ownedPlays;
}
export function currentFormat(): FormatRules | undefined {
	return format;
}
export function currentFormatId(): string {
	return _formatId;
}
export function currentArchetypeId(): string | null {
	return _archetypeId;
}
export function getDBSAnalysis(): DBSAnalysis | null {
	return dbsAnalysis;
}
export function getHDFlow(): HDFlowProjection {
	return hdFlow;
}
export function getDrawProbability(): DrawProbabilityAnalysis {
	return drawProb;
}
export function getCombos(): ComboDetectionResult {
	return combos;
}
export function getHeroRecommendation(): HeroRecommendation {
	return heroRec;
}
export function getArchetypeMatches(): ArchetypeMatchResult[] {
	return archetypeMatches;
}
export function getBonusPlayEvaluations(): BonusPlayEvaluation[] {
	return bonusPlayEvaluations;
}
export function getStandardPlays(): PlayCard[] {
	return standardPlays;
}
export function getBonusPlays(): PlayCard[] {
	return bonusPlays;
}

export function setFormat(formatId: string) {
	_formatId = formatId;
}

export function setArchetype(archetypeId: string | null) {
	_archetypeId = archetypeId;
}

export function setOwnedPlays(plays: PlayCard[]) {
	_ownedPlays = [...plays];
}

export function addPlay(play: PlayCard) {
	// Enforce unique names
	if (_selectedPlays.some((p) => p.name === play.name)) return;

	// Check DBS cap before adding
	if (format?.dbsCap) {
		const currentDBS = _selectedPlays.reduce((sum, p) => sum + p.dbs, 0);
		if (currentDBS + play.dbs > format.dbsCap) return;
	}

	// Check deck size limits
	const isBonus = play.type === 'BPL';
	if (isBonus) {
		const currentBPLs = _selectedPlays.filter((p) => p.type === 'BPL').length;
		if (format && currentBPLs >= format.maxBonusPlays) return;
	} else {
		const currentPLs = _selectedPlays.filter((p) => p.type === 'PL').length;
		if (format && currentPLs >= format.playDeckSize) return;
	}

	_selectedPlays = [..._selectedPlays, play];
}

export function removePlay(playName: string) {
	_selectedPlays = _selectedPlays.filter((p) => p.name !== playName);
}

export function clearPlaybook() {
	_selectedPlays = [];
}

export function loadFromDeck(plays: PlayCard[]) {
	_selectedPlays = [...plays];
}

/**
 * Pre-populate the playbook based on an archetype template.
 * Uses owned plays first, then marks missing plays.
 */
export function buildFromArchetype(
	archetypeId: string
): { selected: PlayCard[]; missing: string[] } {
	const match = archetypeMatches.find((m) => m.archetype.id === archetypeId);
	if (!match) return { selected: [], missing: [] };

	const selected: PlayCard[] = [];
	const missing: string[] = [];

	// First, add combo engine core cards
	const archetype = match.archetype;
	for (const engineId of archetype.comboEngines) {
		const engine = getComboEngine(engineId);
		if (!engine) continue;
		for (const cardName of engine.coreCards) {
			const owned = _ownedPlays.find((p) => p.name === cardName);
			if (owned && !selected.some((s) => s.name === owned.name)) {
				selected.push(owned);
			} else if (!owned) {
				missing.push(cardName);
			}
		}
	}

	_selectedPlays = selected;
	_archetypeId = archetypeId;

	return { selected, missing };
}
