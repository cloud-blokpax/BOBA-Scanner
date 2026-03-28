/**
 * Deck Service — Supabase CRUD for user decks
 *
 * Replaces the localStorage-based single-deck persistence with
 * multi-deck storage in Supabase. Falls back to localStorage
 * for unauthenticated users (single deck only).
 */

import { getSupabase } from '$lib/services/supabase';
import { getFormat } from '$lib/data/tournament-formats';

// ── Supabase helper for user_decks table ────────────────────
function userDecksTable() {
	const client = getSupabase();
	if (!client) return null;
	return client.from('user_decks');
}

// ── Types ───────────────────────────────────────────────────

export interface UserDeck {
	id: string;
	user_id: string;
	name: string;
	format_id: string;
	is_custom_format: boolean;
	notes: string | null;
	hero_deck_min: number;
	hero_deck_max: number | null;
	play_deck_size: number;
	bonus_plays_max: number;
	hot_dog_deck_size: number;
	dbs_cap: number;
	spec_power_cap: number | null;
	combined_power_cap: number | null;
	hero_card_ids: string[];
	play_entries: PlayEntry[];
	hot_dog_count: number;
	is_shared: boolean;
	created_at: string;
	updated_at: string;
	last_edited_at: string;
}

export interface PlayEntry {
	cardNumber: string;
	setCode: string;
	name: string;
	dbs: number;
}

export interface CreateDeckParams {
	name: string;
	format_id: string;
	is_custom_format: boolean;
	notes?: string;
	hero_deck_min: number;
	hero_deck_max: number | null;
	play_deck_size: number;
	bonus_plays_max: number;
	hot_dog_deck_size: number;
	dbs_cap: number;
	spec_power_cap: number | null;
	combined_power_cap: number | null;
}

// ── Fetch all decks for the current user ────────────────────

export async function fetchUserDecks(
	formatFilter?: string
): Promise<UserDeck[]> {
	const table = userDecksTable();
	if (!table) return [];

	const client = getSupabase()!;
	const { data: { user } } = await client.auth.getUser();
	if (!user) return [];

	let query = table
		.select('*')
		.eq('user_id', user.id)
		.order('last_edited_at', { ascending: false });

	if (formatFilter && formatFilter !== 'all') {
		query = query.eq('format_id', formatFilter);
	}

	const { data, error } = await query;
	if (error) {
		console.debug('[deck-service] Fetch decks failed:', error);
		return [];
	}
	return (data || []) as UserDeck[];
}

// ── Fetch a single deck by ID ───────────────────────────────

export async function fetchDeck(deckId: string): Promise<UserDeck | null> {
	const table = userDecksTable();
	if (!table) return null;

	const { data, error } = await table
		.select('*')
		.eq('id', deckId)
		.single();

	if (error) {
		console.debug('[deck-service] Fetch deck failed:', error);
		return null;
	}
	return data as UserDeck;
}

// ── Create a new deck ───────────────────────────────────────

export async function createDeck(params: CreateDeckParams): Promise<string | null> {
	const table = userDecksTable();
	if (!table) return null;

	const client = getSupabase()!;
	const { data: { user } } = await client.auth.getUser();
	if (!user) return null;

	const { data, error } = await table
		.insert({
			user_id: user.id,
			name: params.name,
			format_id: params.format_id,
			is_custom_format: params.is_custom_format,
			notes: params.notes || null,
			hero_deck_min: params.hero_deck_min,
			hero_deck_max: params.hero_deck_max,
			play_deck_size: params.play_deck_size,
			bonus_plays_max: params.bonus_plays_max,
			hot_dog_deck_size: params.hot_dog_deck_size,
			dbs_cap: params.dbs_cap,
			spec_power_cap: params.spec_power_cap,
			combined_power_cap: params.combined_power_cap,
			hero_card_ids: [],
			play_entries: [],
			hot_dog_count: 0
		})
		.select('id')
		.single();

	if (error) {
		console.error('[deck-service] Create deck failed:', error);
		return null;
	}
	return data?.id || null;
}

// ── Update deck contents (auto-save) ────────────────────────

export async function updateDeckContents(
	deckId: string,
	updates: {
		hero_card_ids?: string[];
		play_entries?: PlayEntry[];
		hot_dog_count?: number;
		name?: string;
		notes?: string;
	}
): Promise<boolean> {
	const table = userDecksTable();
	if (!table) return false;

	const client = getSupabase()!;
	const { data: { user } } = await client.auth.getUser();
	if (!user) return false;

	const { error } = await table
		.update({
			...updates,
			last_edited_at: new Date().toISOString(),
			updated_at: new Date().toISOString()
		})
		.eq('id', deckId)
		.eq('user_id', user.id);

	if (error) {
		console.debug('[deck-service] Update deck failed:', error);
		return false;
	}
	return true;
}

// ── Update deck settings (format, requirements) ─────────────

export async function updateDeckSettings(
	deckId: string,
	settings: Partial<CreateDeckParams>
): Promise<boolean> {
	const table = userDecksTable();
	if (!table) return false;

	const client = getSupabase()!;
	const { data: { user } } = await client.auth.getUser();
	if (!user) return false;

	const { error } = await table
		.update({
			...settings,
			updated_at: new Date().toISOString()
		})
		.eq('id', deckId)
		.eq('user_id', user.id);

	if (error) {
		console.debug('[deck-service] Update settings failed:', error);
		return false;
	}
	return true;
}

// ── Delete a deck ───────────────────────────────────────────

export async function deleteDeck(deckId: string): Promise<boolean> {
	const table = userDecksTable();
	if (!table) return false;

	const client = getSupabase()!;
	const { data: { user } } = await client.auth.getUser();
	if (!user) return false;

	const { error } = await table
		.delete()
		.eq('id', deckId)
		.eq('user_id', user.id);

	if (error) {
		console.debug('[deck-service] Delete deck failed:', error);
		return false;
	}
	return true;
}

// ── Get default build requirements for a format ─────────────

export function getFormatDefaults(formatId: string): Omit<CreateDeckParams, 'name' | 'notes'> {
	const format = getFormat(formatId);
	if (!format) {
		// Custom format defaults
		return {
			format_id: 'custom',
			is_custom_format: true,
			hero_deck_min: 60,
			hero_deck_max: null,
			play_deck_size: 30,
			bonus_plays_max: 25,
			hot_dog_deck_size: 10,
			dbs_cap: 1000,
			spec_power_cap: null,
			combined_power_cap: null
		};
	}

	return {
		format_id: formatId,
		is_custom_format: false,
		hero_deck_min: format.heroDeckMin,
		hero_deck_max: format.heroDeckMax,
		play_deck_size: format.playDeckSize,
		bonus_plays_max: format.maxBonusPlays ?? 25,
		hot_dog_deck_size: format.hotDogDeckSize,
		dbs_cap: format.dbsCap ?? 1000,
		spec_power_cap: format.specPowerCap,
		combined_power_cap: format.combinedPowerCap
	};
}

// ── Compute deck completion stats ───────────────────────────

export interface DeckStats {
	heroCount: number;
	heroTarget: number;
	heroPercent: number;
	playCount: number;
	playTarget: number;
	playPercent: number;
	totalDbs: number;
	dbsCap: number;
	dbsPercent: number;
	isComplete: boolean;
}

export function computeDeckStats(deck: UserDeck): DeckStats {
	const heroCount = deck.hero_card_ids?.length || 0;
	const heroTarget = deck.hero_deck_min;
	const playCount = (deck.play_entries?.length || 0);
	const playTarget = deck.play_deck_size;
	const totalDbs = (deck.play_entries || []).reduce((sum, p) => sum + (p.dbs || 0), 0);
	const dbsCap = deck.dbs_cap;

	return {
		heroCount,
		heroTarget,
		heroPercent: heroTarget > 0 ? Math.min(100, Math.round((heroCount / heroTarget) * 100)) : 100,
		playCount,
		playTarget,
		playPercent: playTarget > 0 ? Math.min(100, Math.round((playCount / playTarget) * 100)) : 100,
		totalDbs,
		dbsCap,
		dbsPercent: dbsCap > 0 ? Math.min(100, Math.round((totalDbs / dbsCap) * 100)) : 0,
		isComplete: heroCount >= heroTarget && playCount >= playTarget && (dbsCap === 0 || totalDbs <= dbsCap)
	};
}
