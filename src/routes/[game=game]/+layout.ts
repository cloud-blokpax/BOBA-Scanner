import { resolveGameConfig } from '$lib/games/resolver';
import { error } from '@sveltejs/kit';
import type { LayoutLoad } from './$types';

export const load: LayoutLoad = async ({ params }) => {
	try {
		const gameConfig = await resolveGameConfig(params.game);
		return {
			gameId: params.game,
			gameConfig: {
				id: gameConfig.id,
				name: gameConfig.name,
				shortName: gameConfig.shortName,
				icon: gameConfig.icon,
				theme: gameConfig.theme,
				navItems: gameConfig.navItems,
			},
		};
	} catch (err) {
		console.error('[game layout] Failed to resolve game config:', err);
		throw error(404, `Unknown game: ${params.game}`);
	}
};
