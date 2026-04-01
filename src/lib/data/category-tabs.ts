/**
 * Category tab configurations for the 4 top-level navigation categories.
 *
 * Each category has an ordered list of tabs. The first tab is the
 * default landing page for that category.
 */

export interface CategoryTab {
	label: string;
	path: string;
	badge?: string;
}

export const COLLECTION_TABS: CategoryTab[] = [
	{ label: 'My Cards', path: '/collection' },
	{ label: 'Set Progress', path: '/set-completion' },
	{ label: 'Grader', path: '/grader', badge: 'Pro' },
	{ label: 'Export', path: '/export' },
	{ label: 'Leaderboard', path: '/leaderboard' },
];

export const MARKET_TABS: CategoryTab[] = [
	{ label: 'Dashboard', path: '/market' },
	{ label: 'War Room', path: '/war-room' },
	{ label: 'Explorer', path: '/market/explore' },
	{ label: 'Pack Sim', path: '/packs' },
];

export const PLAYBOOK_TABS: CategoryTab[] = [
	{ label: 'My Decks', path: '/deck' },
	{ label: 'Architect', path: '/deck/architect' },
	{ label: 'Meta', path: '/deck/meta' },
	{ label: 'Splitter', path: '/deck/splitter' },
	{ label: 'Deck Shop', path: '/deck/shop' },
	{ label: 'Speed', path: '/speed' },
];

export const SELL_TABS: CategoryTab[] = [
	{ label: 'Listings', path: '/sell' },
	{ label: 'eBay Export', path: '/export?mode=ebay' },
	{ label: 'Monitor', path: '/marketplace/monitor' },
];

/**
 * Map a pathname to its category and tab config.
 * Returns null for uncategorized pages (home, scan, tournaments, settings, admin).
 */
export function getCategoryForPath(pathname: string): {
	category: string;
	tabs: CategoryTab[];
} | null {
	// Collection
	if (['/collection', '/set-completion', '/grader', '/leaderboard'].includes(pathname)) {
		return { category: 'Collection', tabs: COLLECTION_TABS };
	}
	// /export without ?mode=ebay → Collection
	if (pathname === '/export') {
		return { category: 'Collection', tabs: COLLECTION_TABS };
	}

	// Market Pulse
	if (['/market', '/war-room', '/packs'].includes(pathname) || pathname.startsWith('/market/')) {
		return { category: 'Market Pulse', tabs: MARKET_TABS };
	}

	// Playbook — deck routes (except /deck/verify which is tournament-related)
	if (pathname.startsWith('/deck') && !pathname.startsWith('/deck/verify')) {
		return { category: 'Playbook', tabs: PLAYBOOK_TABS };
	}
	if (pathname === '/speed') {
		return { category: 'Playbook', tabs: PLAYBOOK_TABS };
	}

	// Sell
	if (pathname === '/sell' || pathname.startsWith('/marketplace')) {
		return { category: 'Sell', tabs: SELL_TABS };
	}

	return null;
}
