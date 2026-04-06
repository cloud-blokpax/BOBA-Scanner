/**
 * Typed wrappers for Supabase RPC calls that aren't in the generated types.
 *
 * These functions provide type safety for RPCs defined in custom migrations
 * that don't appear in the auto-generated Database type.
 */

import type { SupabaseClient } from '@supabase/supabase-js';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnySupabase = SupabaseClient<any, any, any>;

export async function submitReferenceImageRpc(
	client: AnySupabase,
	params: {
		p_card_id: string;
		p_image_path: string;
		p_confidence: number;
		p_user_id: string;
		p_user_name: string;
		p_blur_variance: number;
	}
): Promise<{ accepted: boolean; is_new_card: boolean; previous_holder?: string; old_confidence?: number }> {
	const { data, error } = await client.rpc('submit_reference_image', params);
	if (error) throw error;
	return data as { accepted: boolean; is_new_card: boolean; previous_holder?: string; old_confidence?: number };
}

export async function awardBadgeRpc(
	client: AnySupabase,
	params: {
		p_user_id: string;
		p_badge_key: string;
		p_badge_name: string;
		p_description: string;
		p_icon: string;
	}
): Promise<boolean> {
	const { data, error } = await client.rpc('award_badge_if_new', params);
	if (error) throw error;
	return data === true;
}

export async function incrementTournamentUsageRpc(
	client: AnySupabase,
	tournamentId: string
): Promise<void> {
	const { error } = await client.rpc('increment_tournament_usage', { tid: tournamentId });
	if (error) throw error;
}
