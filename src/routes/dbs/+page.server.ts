import playCardsData from '$lib/data/play-cards.json';
import { getDbsScoresMap, type PlayCardData } from '$lib/data/boba-dbs-scores';

/** Release letter to set_code mapping */
const RELEASE_TO_SET: Record<string, string> = {
	A: 'Alpha Edition',
	G: 'Griffey Edition',
	U: 'Alpha Update',
	HTD: 'Alpha Blast'
};

export function load() {
	// Group play cards by set for the UI's set-filtered autocomplete
	const playCardsBySet: Record<string, PlayCardData[]> = {};
	for (const card of playCardsData as PlayCardData[]) {
		const setCode = RELEASE_TO_SET[card.release] || card.release;
		if (!playCardsBySet[setCode]) playCardsBySet[setCode] = [];
		playCardsBySet[setCode].push(card);
	}

	return { playCardsBySet, dbsScores: getDbsScoresMap() };
}
