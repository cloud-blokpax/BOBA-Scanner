import { page } from '$app/stores';
import { get } from 'svelte/store';

// Modal visibility — set to true to open the Go Pro modal from anywhere
let _showGoProModal = $state(false);

export function showGoProModal(): boolean { return _showGoProModal; }
export function setShowGoProModal(val: boolean): void { _showGoProModal = val; }

// Derived Pro status from layout data
export function isPro(): boolean {
	const user = get(page).data?.user;
	if (!user?.is_pro) return false;
	// Check client-side expiry
	if (user.pro_until && new Date(user.pro_until) < new Date()) return false;
	return true;
}

export function proUntil(): Date | null {
	const user = get(page).data?.user;
	if (!user?.pro_until) return null;
	return new Date(user.pro_until);
}

export function daysRemaining(): number {
	const until = proUntil();
	if (!until) return 0;
	const diff = until.getTime() - Date.now();
	return Math.max(0, Math.ceil(diff / (1000 * 60 * 60 * 24)));
}

export function proExpired(): boolean {
	const user = get(page).data?.user;
	// User was Pro (has a pro_until date) but it's now in the past
	if (!user?.pro_until) return false;
	return new Date(user.pro_until) < new Date();
}

// Expiry warning states
export function showExpiryWarning(): boolean {
	const days = daysRemaining();
	return isPro() && days <= 7 && days > 1;
}

export function showFinalWarning(): boolean {
	const days = daysRemaining();
	return isPro() && days <= 1 && days > 0;
}
