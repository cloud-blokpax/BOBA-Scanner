/**
 * Speed Scanner Game State Store
 */

import { browser } from '$app/environment';
import type { ScanResult, CardRarity } from '$lib/types';

export const RARITY_POINTS: Record<string, number> = {
	common: 1, uncommon: 2, rare: 5, ultra_rare: 10, legendary: 25
};

export type GamePhase = 'idle' | 'countdown' | 'playing' | 'finished';

export interface SpeedScanEntry {
	cardId: string;
	heroName: string | null;
	rarity: CardRarity | null;
	points: number;
	scanMethod: string;
	processingMs: number;
	timestamp: number;
}

export interface HighScoreEntry {
	score: number;
	cardCount: number;
	duration: number;
	date: number;
}

export interface SpeedGameState {
	phase: GamePhase;
	countdownValue: number;
	timeRemaining: number;
	duration: number;
	entries: SpeedScanEntry[];
	score: number;
	bestRarity: CardRarity | null;
}

const INITIAL_STATE: SpeedGameState = {
	phase: 'idle', countdownValue: 3, timeRemaining: 60,
	duration: 60, entries: [], score: 0, bestRarity: null
};

let _speedGame = $state<SpeedGameState>({ ...INITIAL_STATE });
let _highScores = $state<HighScoreEntry[]>([]);

// ── Public reactive accessors ──────────────────────────────────
export function speedGame(): SpeedGameState { return _speedGame; }
export function gamePhase(): GamePhase { return _speedGame.phase; }
export function gameScore(): number { return _speedGame.score; }
export function scanCount(): number { return _speedGame.entries.length; }
export function timeRemaining(): number { return _speedGame.timeRemaining; }
export function highScores(): HighScoreEntry[] { return _highScores; }

const RARITY_RANK: Record<string, number> = {
	common: 0, uncommon: 1, rare: 2, ultra_rare: 3, legendary: 4
};

export function resetGame(duration = 60): void {
	_speedGame = { ...INITIAL_STATE, duration, timeRemaining: duration };
}

export function startCountdown(): void {
	_speedGame = { ..._speedGame, phase: 'countdown', countdownValue: 3 };
}

export function tickCountdown(): void {
	const next = _speedGame.countdownValue - 1;
	if (next <= 0) {
		_speedGame = { ..._speedGame, phase: 'playing', countdownValue: 0, timeRemaining: _speedGame.duration };
	} else {
		_speedGame = { ..._speedGame, countdownValue: next };
	}
}

export function setTimeRemaining(t: number): void {
	_speedGame = { ..._speedGame, timeRemaining: Math.max(0, t) };
}

export function finishGame(): void {
	_speedGame = { ..._speedGame, phase: 'finished' };
}

export function recordScan(result: ScanResult): number {
	if (!result.card) return 0;

	const rarity = result.card.rarity || 'common';
	const points = RARITY_POINTS[rarity] ?? 1;

	const entry: SpeedScanEntry = {
		cardId: result.card.id, heroName: result.card.hero_name,
		rarity: result.card.rarity, points,
		scanMethod: result.scan_method, processingMs: result.processing_ms,
		timestamp: Date.now()
	};

	const newBest =
		!_speedGame.bestRarity || (RARITY_RANK[rarity] ?? 0) > (RARITY_RANK[_speedGame.bestRarity] ?? 0)
			? (rarity as CardRarity) : _speedGame.bestRarity;

	_speedGame = {
		..._speedGame,
		entries: [..._speedGame.entries, entry],
		score: _speedGame.score + points,
		bestRarity: newBest
	};

	return points;
}

const HIGH_SCORES_KEY = 'speedHighScores';
const MAX_HIGH_SCORES = 5;

function saveHighScores(scores: HighScoreEntry[]): void {
	if (!browser) return;
	import('$lib/services/idb').then(({ idb }) => {
		idb.setMeta(HIGH_SCORES_KEY, scores).catch((err) => {
			console.debug('[speed-game] High scores save failed:', err);
		});
	});
}

if (browser) {
	(async () => {
		try {
			const { idb } = await import('$lib/services/idb');
			const entries = await idb.getMeta<HighScoreEntry[]>(HIGH_SCORES_KEY);
			if (Array.isArray(entries)) {
				_highScores = entries;
			}
			const legacyRaw = localStorage.getItem(HIGH_SCORES_KEY);
			if (legacyRaw) {
				const legacy = JSON.parse(legacyRaw);
				if (Array.isArray(legacy) && legacy.length > 0) {
					await idb.setMeta(HIGH_SCORES_KEY, legacy);
					_highScores = legacy;
					localStorage.removeItem(HIGH_SCORES_KEY);
				}
			}
		} catch (err) {
			console.debug('[speed-game] High scores load failed:', err);
		}
	})();
}

export function addHighScore(score: number, cardCount: number, duration: number): boolean {
	const entry: HighScoreEntry = { score, cardCount, duration, date: Date.now() };
	const updated = [..._highScores, entry]
		.sort((a, b) => b.score - a.score)
		.slice(0, MAX_HIGH_SCORES);
	const isNew = updated.indexOf(entry) !== -1;
	saveHighScores(updated);
	_highScores = updated;
	return isNew;
}
