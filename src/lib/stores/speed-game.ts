/**
 * Speed Scanner Game State Store
 *
 * Manages the lifecycle of a timed card-scanning challenge:
 * idle → countdown → playing → finished.
 */

import { writable, derived } from 'svelte/store';
import { browser } from '$app/environment';
import type { ScanResult, CardRarity } from '$lib/types';

// ── Point values per rarity ─────────────────────────────────────
export const RARITY_POINTS: Record<string, number> = {
	common: 1,
	uncommon: 2,
	rare: 5,
	ultra_rare: 10,
	legendary: 25
};

// ── Game phases ─────────────────────────────────────────────────
export type GamePhase = 'idle' | 'countdown' | 'playing' | 'finished';

// ── Per-scan record kept during a game ──────────────────────────
export interface SpeedScanEntry {
	cardId: string;
	heroName: string | null;
	rarity: CardRarity | null;
	points: number;
	scanMethod: string;
	processingMs: number;
	timestamp: number;
}

// ── High score entry ────────────────────────────────────────────
export interface HighScoreEntry {
	score: number;
	cardCount: number;
	duration: number;
	date: number;
}

// ── Full game state ─────────────────────────────────────────────
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
	phase: 'idle',
	countdownValue: 3,
	timeRemaining: 60,
	duration: 60,
	entries: [],
	score: 0,
	bestRarity: null
};

export const speedGame = writable<SpeedGameState>({ ...INITIAL_STATE });

// ── Derived convenience stores ──────────────────────────────────
export const gamePhase = derived(speedGame, ($g) => $g.phase);
export const gameScore = derived(speedGame, ($g) => $g.score);
export const scanCount = derived(speedGame, ($g) => $g.entries.length);
export const timeRemaining = derived(speedGame, ($g) => $g.timeRemaining);

// ── Rarity hierarchy for "best rarity" comparison ───────────────
const RARITY_RANK: Record<string, number> = {
	common: 0,
	uncommon: 1,
	rare: 2,
	ultra_rare: 3,
	legendary: 4
};

// ── Actions ─────────────────────────────────────────────────────

export function resetGame(duration = 60): void {
	speedGame.set({ ...INITIAL_STATE, duration, timeRemaining: duration });
}

export function startCountdown(): void {
	speedGame.update((s) => ({ ...s, phase: 'countdown', countdownValue: 3 }));
}

export function tickCountdown(): void {
	speedGame.update((s) => {
		const next = s.countdownValue - 1;
		if (next <= 0) {
			return { ...s, phase: 'playing', countdownValue: 0, timeRemaining: s.duration };
		}
		return { ...s, countdownValue: next };
	});
}

export function setTimeRemaining(t: number): void {
	speedGame.update((s) => ({ ...s, timeRemaining: Math.max(0, t) }));
}

export function finishGame(): void {
	speedGame.update((s) => ({ ...s, phase: 'finished' }));
}

/**
 * Record a successful scan during gameplay.
 * Returns the points earned (0 if card was null / failed).
 */
export function recordScan(result: ScanResult): number {
	if (!result.card) return 0;

	const rarity = result.card.rarity || 'common';
	const points = RARITY_POINTS[rarity] ?? 1;

	const entry: SpeedScanEntry = {
		cardId: result.card.id,
		heroName: result.card.hero_name,
		rarity: result.card.rarity,
		points,
		scanMethod: result.scan_method,
		processingMs: result.processing_ms,
		timestamp: Date.now()
	};

	speedGame.update((s) => {
		const newBest =
			!s.bestRarity || (RARITY_RANK[rarity] ?? 0) > (RARITY_RANK[s.bestRarity] ?? 0)
				? (rarity as CardRarity)
				: s.bestRarity;

		return {
			...s,
			entries: [...s.entries, entry],
			score: s.score + points,
			bestRarity: newBest
		};
	});

	return points;
}

// ── High Scores (IndexedDB) ─────────────────────────────────────
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

export const highScores = writable<HighScoreEntry[]>([]);

// Load from IDB asynchronously on startup
if (browser) {
	(async () => {
		try {
			const { idb } = await import('$lib/services/idb');
			const entries = await idb.getMeta<HighScoreEntry[]>(HIGH_SCORES_KEY);
			if (Array.isArray(entries)) {
				highScores.set(entries);
			}

			// One-time migration from localStorage
			const legacyRaw = localStorage.getItem(HIGH_SCORES_KEY);
			if (legacyRaw) {
				const legacy = JSON.parse(legacyRaw);
				if (Array.isArray(legacy) && legacy.length > 0) {
					await idb.setMeta(HIGH_SCORES_KEY, legacy);
					highScores.set(legacy);
					localStorage.removeItem(HIGH_SCORES_KEY);
				}
			}
		} catch (err) {
			console.debug('[speed-game] High scores load failed:', err);
		}
	})();
}

export function addHighScore(score: number, cardCount: number, duration: number): boolean {
	let isNew = false;
	highScores.update((scores) => {
		const entry: HighScoreEntry = { score, cardCount, duration, date: Date.now() };
		const updated = [...scores, entry]
			.sort((a, b) => b.score - a.score)
			.slice(0, MAX_HIGH_SCORES);
		isNew = updated.indexOf(entry) !== -1;
		saveHighScores(updated);
		return updated;
	});
	return isNew;
}
