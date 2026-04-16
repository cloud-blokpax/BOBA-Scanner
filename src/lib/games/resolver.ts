/**
 * Game config resolver — lazy-loads and caches GameConfig implementations.
 *
 * Each game module is dynamically imported on first access so that
 * Wonders/future game code isn't bundled when only BoBA is used.
 */

import type { GameConfig } from './types';

const GAME_CONFIGS = new Map<string, GameConfig>();

/** Valid game IDs. Extend this set as new games are added. */
const VALID_GAME_IDS = new Set(['boba', 'wonders']);

/**
 * Resolve a GameConfig by game ID. Lazily imports and caches the module.
 * Throws if the game ID is unknown.
 */
export async function resolveGameConfig(gameId: string): Promise<GameConfig> {
	const cached = GAME_CONFIGS.get(gameId);
	if (cached) return cached;

	let config: GameConfig;
	switch (gameId) {
		case 'boba':
			config = (await import('./boba/config')).default;
			break;
		case 'wonders':
			config = (await import('./wonders/config')).default;
			break;
		default:
			throw new Error(`Unknown game: ${gameId}`);
	}

	GAME_CONFIGS.set(gameId, config);
	return config;
}

/**
 * Load all registered GameConfigs in parallel.
 * Used when the scanner is in auto-detect mode and needs to try every game.
 */
export async function getAllGameConfigs(): Promise<GameConfig[]> {
	return Promise.all([...VALID_GAME_IDS].map((id) => resolveGameConfig(id)));
}

/**
 * Check if a game ID is valid (registered in the resolver).
 */
export function isValidGameId(gameId: string): boolean {
	return VALID_GAME_IDS.has(gameId);
}

/**
 * Get the default game ID. Returns 'boba' — all existing data uses this.
 */
export function getDefaultGameId(): string {
	return 'boba';
}
