/**
 * BoBA navigation items and protected routes.
 *
 * Extracted from the existing layout and hooks.server.ts auth guard
 * so they can be accessed via GameConfig.
 */

import type { GameNavItem } from '../types';

/** BoBA-specific navigation items for the bottom nav bar. */
export const bobaNavItems: readonly GameNavItem[] = [
	{ id: 'home', path: '/', icon: '\u{1F3E0}', label: 'Home' },
	{
		id: 'collection',
		path: '/collection',
		icon: '\u{1F4DA}',
		label: 'Collection',
		matchPaths: ['/collection', '/set-completion', '/grader', '/export']
	},
	{
		id: 'playbook',
		path: '/deck',
		icon: '\u{1F9E0}',
		label: 'Playbook',
		matchPaths: ['/deck']
	},
];

/** Routes that require authentication for BoBA features. */
export const bobaProtectedRoutes: readonly string[] = [
	'/collection',
	'/sell',
	'/admin',
	'/grader',
	'/export',
	'/market',
	'/set-completion',
	'/tournaments',
	'/settings',
	'/organize',
	'/war-room',
];
