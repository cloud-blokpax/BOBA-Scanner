/**
 * Wonders of The First — navigation items and protected routes.
 */

import type { GameNavItem } from '../types';

/** Wonders-specific navigation items (emoji icons to match BoBA pattern). */
export const wondersNavItems: readonly GameNavItem[] = [
	{
		id: 'wonders-collection',
		path: '/wonders/collection',
		icon: '\u{1F4DA}', // 📚
		label: 'Collection',
		matchPaths: ['/wonders/collection']
	},
	{
		id: 'wonders-set-completion',
		path: '/wonders/set-completion',
		icon: '\u{2705}', // ✅
		label: 'Sets',
		matchPaths: ['/wonders/set-completion']
	},
	{
		id: 'wonders-market',
		path: '/wonders/market',
		icon: '\u{1F4C8}', // 📈
		label: 'Market',
		matchPaths: ['/wonders/market']
	},
	// Phase 3:
	// { id: 'wonders-dragon-points', path: '/wonders/dragon-points', icon: '🔥', label: 'Dragon Points' },
];

/** Routes that require authentication for Wonders features. */
export const wondersProtectedRoutes: readonly string[] = [
	'/wonders/collection',
	'/wonders/set-completion',
	'/wonders/market',
];
