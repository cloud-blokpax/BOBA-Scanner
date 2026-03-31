/**
 * Haptic feedback utilities.
 *
 * Centralizes vibration patterns used across Scanner, BottomSheet, etc.
 */

const HAPTIC_PATTERNS = {
	tap: [15],
	success: [30, 60, 30],
	successAdd: [30, 50, 30],
	rareReveal: [20, 30, 20, 30, 80],
	ultraRare: [20, 40, 30, 50],
	legendary: [20, 40, 20, 40, 60],
	error: [50, 30, 50]
} as const;

type HapticPattern = keyof typeof HAPTIC_PATTERNS;

let hasUserActivation = false;
let listenerAttached = false;

function ensureActivationListener(): void {
	if (listenerAttached || typeof document === 'undefined') return;
	listenerAttached = true;
	document.addEventListener('pointerdown', () => { hasUserActivation = true; }, { once: true });
}

/**
 * Trigger haptic feedback if the device supports it.
 * Requires a prior user gesture (tap/click) to satisfy Chrome's autoplay policy.
 */
export function triggerHaptic(pattern: number[] | HapticPattern = 'tap'): void {
	ensureActivationListener();
	if (!hasUserActivation) return;
	if ('vibrate' in navigator) {
		const resolved = typeof pattern === 'string' ? HAPTIC_PATTERNS[pattern] : pattern;
		navigator.vibrate([...resolved]);
	}
}
