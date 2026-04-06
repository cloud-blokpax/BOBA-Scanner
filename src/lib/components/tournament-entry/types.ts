/**
 * Shared types for the tournament entry wizard.
 */

export interface TournamentInfo {
	id: string;
	code: string;
	name: string;
	max_heroes: number;
	max_plays: number;
	max_bonus: number;
	require_email: boolean;
	require_name: boolean;
	require_discord: boolean;
	format_id: string | null;
	deck_type: 'constructed' | 'sealed';
	description: string | null;
	venue: string | null;
	event_date: string | null;
	entry_fee: string | null;
	prize_pool: string | null;
	max_players: number | null;
	submission_deadline: string | null;
	registration_closed: boolean;
}

export interface HeroCardEntry {
	card_id: string;
	card_number: string;
	hero_name: string;
	power: number;
	weapon_type: string;
	parallel: string;
	set_code: string;
}

export interface PlayCardEntry {
	card_number: string;
	name: string;
	set_code: string;
	dbs_score: number;
}

export interface PlayerInfo {
	name: string;
	email: string;
	discord: string;
}

export interface DeckData {
	heroCards: HeroCardEntry[];
	playCards: PlayCardEntry[];
	hotDogCount: number;
	foilHotDogCount: number;
	sourceDeckId: string | null;
}

export interface SubmissionResult {
	verification_code: string;
	verify_url: string;
	is_valid: boolean;
}
