/**
 * Persona Store
 *
 * Manages user persona preferences (Collector, Deck Builder, Seller, Tournament Player).
 * Personas control home screen content block ordering.
 * Weights are stored as JSONB in the users table.
 */

import { user } from './auth.svelte';
import { getSupabase } from '$lib/services/supabase';

export type PersonaId = 'collector' | 'deck_builder' | 'seller' | 'tournament';

export interface PersonaWeights {
	collector: number;
	deck_builder: number;
	seller: number;
	tournament: number;
}

const DEFAULT_WEIGHTS: PersonaWeights = {
	collector: 0.5,
	deck_builder: 0,
	seller: 0,
	tournament: 0
};

let _weights = $state<PersonaWeights>({ ...DEFAULT_WEIGHTS });
let _loaded = $state(false);

export function personaWeights(): PersonaWeights {
	return _weights;
}
export function personaLoaded(): boolean {
	return _loaded;
}

/** Returns persona IDs sorted by weight (highest first), excluding zero-weight */
export function personaRanked(): PersonaId[] {
	return (Object.entries(_weights) as [PersonaId, number][])
		.filter(([, w]) => w > 0)
		.sort((a, b) => b[1] - a[1])
		.map(([id]) => id);
}

/** Returns the primary persona (highest weight) */
export function primaryPersona(): PersonaId {
	return personaRanked()[0] || 'collector';
}

/** Returns true if the user has never explicitly chosen a persona (still on defaults) */
export function isDefaultPersona(): boolean {
	return (
		_weights.collector === 0.5 &&
		_weights.deck_builder === 0 &&
		_weights.seller === 0 &&
		_weights.tournament === 0
	);
}

/** Load persona from Supabase user profile */
export async function loadPersona() {
	const currentUser = user();
	const client = getSupabase();
	if (!currentUser || !client) {
		_weights = { ...DEFAULT_WEIGHTS };
		_loaded = true;
		return;
	}

	try {
		const { data } = await client
			.from('users')
			.select('persona')
			.eq('auth_user_id', currentUser.id)
			.single();

		if (data?.persona && typeof data.persona === 'object') {
			_weights = { ...DEFAULT_WEIGHTS, ...(data.persona as Partial<PersonaWeights>) };
		}
	} catch {
		_weights = { ...DEFAULT_WEIGHTS };
	}
	_loaded = true;
}

/** Update persona weights and save to Supabase */
export async function updatePersona(newWeights: Partial<PersonaWeights>) {
	_weights = { ..._weights, ...newWeights };

	const currentUser = user();
	const client = getSupabase();
	if (!currentUser || !client) return;

	await client
		.from('users')
		.update({ persona: _weights } as Record<string, unknown>)
		.eq('auth_user_id', currentUser.id);
}

/** Toggle a persona on/off and save. Returns the new weights. */
export async function togglePersona(id: PersonaId): Promise<PersonaWeights> {
	const current = _weights[id];
	const newVal = current > 0 ? 0 : 1.0;
	await updatePersona({ [id]: newVal });
	return _weights;
}

/** Reset to defaults (used on sign-out) */
export function resetPersona() {
	_weights = { ...DEFAULT_WEIGHTS };
	_loaded = false;
}
