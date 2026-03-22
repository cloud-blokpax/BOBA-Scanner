import { TOURNAMENT_FORMATS } from '$lib/data/tournament-formats';

export function load() {
	return {
		formats: TOURNAMENT_FORMATS.map(f => ({
			id: f.id,
			name: f.name,
			description: f.description,
			heroDeckMin: f.heroDeckMin,
			heroDeckMax: f.heroDeckMax,
			playDeckSize: f.playDeckSize,
			maxBonusPlays: f.maxBonusPlays ?? 25,
			hotDogDeckSize: f.hotDogDeckSize,
			dbsCap: f.dbsCap,
			specPowerCap: f.specPowerCap,
			combinedPowerCap: f.combinedPowerCap
		}))
	};
}
