/**
 * Community Corrections Service
 *
 * Shares OCR misread→correct card number mappings across all users.
 * After 3 confirmations, a correction is treated as authoritative.
 */

import { getSupabase } from '$lib/services/supabase';

/**
 * Look up a community-verified correction for an OCR reading.
 * Returns the corrected card number if 3+ users have confirmed it.
 */
export async function lookupCommunityCorrection(
	ocrReading: string
): Promise<string | null> {
	const client = getSupabase();
	if (!client) return null;

	try {
		const { data } = await client.rpc('lookup_correction', {
			p_ocr_reading: ocrReading.toUpperCase()
		});

		if (data && data.length > 0) {
			return data[0].correct_card_number;
		}
	} catch (err) {
		console.debug('[community-corrections] Lookup failed:', err);
	}
	return null;
}

/**
 * Submit a correction to the community pool.
 * Called when a user confirms a card correction via the UI.
 */
export async function submitCommunityCorrection(
	ocrReading: string,
	correctCardNumber: string
): Promise<void> {
	const client = getSupabase();
	if (!client) return;

	try {
		await client.rpc('submit_correction', {
			p_ocr_reading: ocrReading.toUpperCase(),
			p_correct_card_number: correctCardNumber.toUpperCase()
		});
	} catch (err) {
		console.debug('[community-corrections] Submit failed:', err);
	}
}
