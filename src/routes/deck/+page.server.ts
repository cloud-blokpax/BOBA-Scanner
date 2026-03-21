import playCardsData from '$lib/data/play-cards.json';
import { getDbsScoresMap, type PlayCardData } from '$lib/data/boba-dbs-scores';
import { TOURNAMENT_FORMATS } from '$lib/data/tournament-formats';

/** Release letter to set_code mapping */
const RELEASE_TO_SET: Record<string, string> = {
	A: 'Alpha Edition',
	G: 'Griffey Edition',
	U: 'Alpha Update',
	HTD: 'Alpha Blast'
};

export function load() {
	const playCardsBySet: Record<string, PlayCardData[]> = {};
	for (const card of playCardsData as PlayCardData[]) {
		const setCode = RELEASE_TO_SET[card.release] || card.release;
		if (!playCardsBySet[setCode]) playCardsBySet[setCode] = [];
		playCardsBySet[setCode].push(card);
	}

	const formats = TOURNAMENT_FORMATS.map(f => ({ id: f.id, name: f.name }));

	return { playCardsBySet, dbsScores: getDbsScoresMap(), formats };
}
