/**
 * Game registry — lightweight metadata for all supported games.
 *
 * This is a static list used for UI rendering (game pickers, filters,
 * settings) without needing to load the full GameConfig modules.
 */

export interface GameEntry {
	id: string;
	name: string;
	shortName: string;
	icon: string;
}

/** All registered games, ordered by release date. */
export const ALL_GAMES: readonly GameEntry[] = [
	{ id: 'boba', name: 'Bo Jackson Battle Arena', shortName: 'BoBA', icon: '🏈' },
	{ id: 'wonders', name: 'Wonders of The First', shortName: 'Wonders', icon: '🐉' },
];

/** Quick lookup by game ID. */
export const GAME_MAP = new Map(ALL_GAMES.map(g => [g.id, g]));
