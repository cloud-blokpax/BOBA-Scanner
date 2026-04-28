/**
 * Play cards loader.
 *
 * The bundled JSON stores the minimum fields needed to round-trip each card.
 * `type` and `number` are derived from `card_number` (e.g. "PL-12" → type=PL,
 * number=12) so the JSON doesn't have to ship duplicate data, and
 * `base_play_name` is derived from `name` (strip trailing " - htd").
 */

import rawPlayCards from './play-cards.generated.json';
import type { PlayCard } from '$lib/services/playbook-engine';

interface RawPlayCard {
	id: string;
	card_number: string;
	name: string;
	release: string;
	hot_dog_cost: number;
	dbs: number;
	ability: string;
}

const CARD_NUMBER_RE = /^([A-Z]+)-(\d+)$/;

function expand(raw: RawPlayCard): PlayCard {
	const m = CARD_NUMBER_RE.exec(raw.card_number);
	const type = (m?.[1] ?? '') as PlayCard['type'];
	const number = m ? parseInt(m[2], 10) : 0;
	return { ...raw, type, number };
}

let _cached: PlayCard[] | null = null;

export function getPlayCards(): PlayCard[] {
	if (!_cached) {
		_cached = (rawPlayCards as RawPlayCard[]).map(expand);
	}
	return _cached;
}

export function deriveBasePlayName(name: string): string {
	return name.replace(/\s*-\s*htd\s*$/i, '').trim() || name;
}
