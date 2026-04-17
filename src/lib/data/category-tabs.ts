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
];

export const MARKET_TABS: CategoryTab[] = [
	{ label: 'War Room', path: '/war-room' },
	{ label: 'Market Pulse', path: '/market' },
	{ label: 'Explorer', path: '/market/explore' },
	{ label: 'Pack Sim', path: '/packs' },
	{ label: 'Box EV', path: '/packs/ev' },
];

export const PLAYBOOK_TABS: CategoryTab[] = [
	{ label: 'My Decks', path: '/deck' },
	{ label: 'Architect', path: '/deck/architect' },
	{ label: 'Splitter', path: '/deck/splitter' },
	{ label: 'Deck Shop', path: '/deck/shop' },
];

export const SELL_TABS: CategoryTab[] = [
	{ label: 'Listings', path: '/sell' },
	{ label: 'eBay Export', path: '/sell?tab=export' },
];

/**
 * Map a pathname to its category and tab config.
 * Returns null for uncategorized pages (home, scan, tournaments, settings, admin).
 */
export function getCategoryForPath(pathname: string, search: string = ''): {
	category: string;
	tabs: CategoryTab[];
} | null {
	// /export always shows under Collection tabs
	if (pathname === '/export') {
		return { category: 'Collection', tabs: COLLECTION_TABS };
	}

	// Collection
	if (['/collection', '/set-completion', '/grader'].includes(pathname)) {
		return { category: 'Collection', tabs: COLLECTION_TABS };
	}

	// War Room
	if (
		['/market', '/war-room', '/packs', '/packs/ev'].includes(pathname) ||
		pathname.startsWith('/market/')
	) {
		return { category: 'War Room', tabs: MARKET_TABS };
	}

	// Playbook — deck routes (except /deck/verify which is tournament-related)
	if (pathname.startsWith('/deck') && !pathname.startsWith('/deck/verify')) {
		return { category: 'Playbook', tabs: PLAYBOOK_TABS };
	}
	// Sell
	if (pathname === '/sell') {
		return { category: 'Sell', tabs: SELL_TABS };
	}
	// /export without ?mode=ebay still shows under Collection tabs (handled above)

	return null;
}
