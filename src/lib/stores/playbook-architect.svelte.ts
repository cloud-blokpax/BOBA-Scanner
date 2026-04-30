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
	buildOptimalPlaybook,
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

// ── Primary state (user-modified) ───────────────────────────

let _selectedPlays = $state<PlayCard[]>([]);
let _ownedPlays = $state<PlayCard[]>([]);
let _formatId = $state<string>('spec_playmaker');
let _archetypeId = $state<string | null>(null);

// ── Filter state — universe-first ───────────────────────────
// Default mode: ALL plays in the database are eligible. Filters narrow the
// universe; ownedPlays is just one optional filter, off by default.

let _useOwnedFilter = $state<boolean>(false);
let _allowedReleases = $state<Set<string>>(new Set()); // empty = all allowed
let _bonusPlayMode = $state<'off' | 'limited' | 'unlimited'>('unlimited');
let _excludedPlayNames = $state<Set<string>>(new Set());
let _universe = $state<PlayCard[]>([]); // full play catalog (not filtered)

// ── Derived state (auto-computed) ───────────────────────────

const format = $derived<FormatRules | undefined>(getFormat(_formatId));

/**
 * The play universe after all filters are applied. This replaces _ownedPlays
 * as the source of truth for what's "available" to the Architect.
 *
 * Filter precedence (each narrows the previous):
 *   1. Start from full catalog (_universe)
 *   2. If _useOwnedFilter: intersect with _ownedPlays
 *   3. Apply _allowedReleases (empty set = no filter)
 *   4. Apply _bonusPlayMode (off = drop all BPLs)
 *   5. Apply _excludedPlayNames
 */
const availablePlays = $derived<PlayCard[]>(
	(() => {
		let pool = _universe;
		if (_useOwnedFilter) {
			const ownedNames = new Set(_ownedPlays.map((p) => p.name));
			pool = pool.filter((p) => ownedNames.has(p.name));
		}
		if (_allowedReleases.size > 0) {
			pool = pool.filter((p) => _allowedReleases.has(p.release));
		}
		if (_bonusPlayMode === 'off') {
			pool = pool.filter((p) => p.type !== 'BPL');
		}
		if (_excludedPlayNames.size > 0) {
			pool = pool.filter((p) => !_excludedPlayNames.has(p.name));
		}
		return pool;
	})()
);

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

// Match scoring runs against availablePlays. In default mode this is the full
// catalog and every archetype trivially matches at 100%. The UI suppresses
// the match bar when _useOwnedFilter is false (see ArchetypeSelector).
const archetypeMatches = $derived<ArchetypeMatchResult[]>(
	format ? matchArchetypes(availablePlays, format) : []
);

const availableBonusPlays = $derived(
	availablePlays.filter(
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

// ── Universe / filter API ───────────────────────────────────

/** Initialize the play catalog. Called once on mount with full play list. */
export function setUniverse(plays: PlayCard[]) {
	_universe = [...plays];
}

export function getAvailablePlays(): PlayCard[] {
	return availablePlays;
}

export function getUniverse(): PlayCard[] {
	return _universe;
}

export function isOwnedFilterEnabled(): boolean {
	return _useOwnedFilter;
}

export function setOwnedFilterEnabled(enabled: boolean) {
	_useOwnedFilter = enabled;
}

export function getAllowedReleases(): Set<string> {
	return _allowedReleases;
}

export function setAllowedReleases(releases: Set<string>) {
	_allowedReleases = new Set(releases);
}

export function getBonusPlayMode(): 'off' | 'limited' | 'unlimited' {
	return _bonusPlayMode;
}

export function setBonusPlayMode(mode: 'off' | 'limited' | 'unlimited') {
	_bonusPlayMode = mode;
}

export function getExcludedPlayNames(): Set<string> {
	return _excludedPlayNames;
}

export function addExcludedPlayName(name: string) {
	_excludedPlayNames = new Set([..._excludedPlayNames, name]);
	// Also remove from currently-selected if present
	if (_selectedPlays.some((p) => p.name === name)) {
		_selectedPlays = _selectedPlays.filter((p) => p.name !== name);
	}
}

export function removeExcludedPlayName(name: string) {
	const next = new Set(_excludedPlayNames);
	next.delete(name);
	_excludedPlayNames = next;
}

export function clearExcludedPlayNames() {
	_excludedPlayNames = new Set();
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
 * Build the optimal playbook for the given archetype from the filtered universe.
 *
 * Universe-first behavior: pulls from `availablePlays` (full catalog by default,
 * narrowed by active filters). The user can still manually swap plays via the
 * Add Plays browser after the engine seeds the deck.
 *
 * Returns:
 *   - selected: the 30 (or fewer) standard plays + any BPLs the engine added
 *   - missing: combo engine core cards that aren't in the filtered universe
 *              (e.g., excluded by user, not in chosen sets, or owned-filter
 *              is on and they don't have it). UI surfaces these as gaps.
 */
export function buildFromArchetype(
	archetypeId: string
): { selected: PlayCard[]; missing: string[] } {
	if (!format) return { selected: [], missing: [] };
	const match = archetypeMatches.find((m) => m.archetype.id === archetypeId);
	if (!match) return { selected: [], missing: [] };

	const result = buildOptimalPlaybook(
		match.archetype,
		availablePlays,
		format,
		_bonusPlayMode
	);

	_selectedPlays = result.selected;
	_archetypeId = archetypeId;

	return { selected: result.selected, missing: result.missing };
}
