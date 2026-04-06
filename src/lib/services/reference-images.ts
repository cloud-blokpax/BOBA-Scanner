/**
 * Reference Image Service
 *
 * Handles the gamified reference image submission flow:
 * 1. After a high-confidence scan, capture the frame
 * 2. Submit to /api/reference-image to challenge the current champion
 * 3. Show celebration or "nice try" feedback
 * 4. Track badges locally
 */

import { browser } from '$app/environment';
import { showToast } from '$lib/stores/toast.svelte';

export interface ReferenceSubmissionResult {
	accepted: boolean;
	is_new_card: boolean;
	old_confidence?: number;
	new_confidence?: number;
	previous_holder?: string;
	current_confidence?: number;
	your_confidence?: number;
	current_holder?: string;
	badge_awarded?: boolean;
}

// Minimum confidence to even attempt a reference image submission.
// Below this, the scan image quality isn't worth submitting.
const MIN_SUBMISSION_CONFIDENCE = 0.8;

// Track locally how many reference images this user holds (for profile display)
let _myTopImageCount: number | null = null;
let _myRank: number | null = null;

export function getMyTopImageCount(): number | null {
	return _myTopImageCount;
}

export function getMyRank(): number | null {
	return _myRank;
}

/**
 * Attempt to submit a scan as a reference image.
 * Called automatically after successful scans — the user doesn't need to
 * do anything special. The gamification happens passively.
 *
 * Returns the result or null if submission was skipped.
 */
export async function submitReferenceImage(
	cardId: string,
	confidence: number,
	imageBlob: Blob,
	blurVariance?: number
): Promise<ReferenceSubmissionResult | null> {
	if (!browser) return null;
	if (confidence < MIN_SUBMISSION_CONFIDENCE) return null;

	try {
		const formData = new FormData();
		formData.append('image', imageBlob, 'reference.jpg');
		formData.append('card_id', cardId);
		formData.append('confidence', String(confidence));
		if (blurVariance !== undefined) {
			formData.append('blur_variance', String(blurVariance));
		}

		const res = await fetch('/api/reference-image', {
			method: 'POST',
			body: formData
		});

		if (!res.ok) return null;

		const result: ReferenceSubmissionResult = await res.json();

		// Show feedback based on result
		if (result.accepted && result.is_new_card) {
			showToast('First reference image for this card! You\'re the champion.', 'check');
		} else if (result.accepted && result.previous_holder) {
			showToast(`New top image! You beat ${result.previous_holder}'s scan.`, 'check');
		} else if (result.accepted) {
			showToast('New top reference image captured!', 'check');
		}
		// Don't show anything for rejected submissions — keep it non-intrusive

		// Badge celebration gets special treatment
		if (result.badge_awarded) {
			// Small delay so it doesn't overlap with the reference image toast
			setTimeout(() => {
				showToast('Badge earned: Shutterbug! Your first top reference image.', 'check');
			}, 2000);
		}

		return result;
	} catch (err) {
		console.debug('[reference-images] Submission failed:', err);
		return null;
	}
}

/**
 * Fetch the user's reference image stats for profile display.
 */
export async function loadMyReferenceStats(userId: string): Promise<void> {
	if (!browser) return;
	try {
		const res = await fetch(`/api/reference-image/leaderboard?user_id=${userId}`);
		if (!res.ok) return;
		const data = await res.json();
		if (data.user_rank) {
			_myTopImageCount = data.user_rank.top_images;
			_myRank = data.user_rank.rank;
		} else {
			_myTopImageCount = 0;
			_myRank = null;
		}
	} catch {
		// Non-critical
	}
}
