import playCardsData from '$lib/data/play-cards.json';
import { getDbsScoresMap, type PlayCardData } from '$lib/data/boba-dbs-scores';
import { RELEASE_TO_SET_NAME } from '$lib/data/boba-config';

export function load() {
	// Group play cards by set for the UI's set-filtered autocomplete
	const playCardsBySet: Record<string, PlayCardData[]> = {};
	for (const card of playCardsData as PlayCardData[]) {
		const setCode = RELEASE_TO_SET_NAME[card.release] || card.release;
		if (!playCardsBySet[setCode]) playCardsBySet[setCode] = [];
		playCardsBySet[setCode].push(card);
	}

	return { playCardsBySet, dbsScores: getDbsScoresMap() };
}
