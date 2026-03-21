/**
 * Haptic feedback utilities.
 *
 * Centralizes vibration patterns used across Scanner, BottomSheet, etc.
 */

export const HAPTIC_PATTERNS = {
	tap: [15],
	success: [30, 60, 30],
	successAdd: [30, 50, 30],
	rareReveal: [20, 30, 20, 30, 80],
	ultraRare: [20, 40, 30, 50],
	legendary: [20, 40, 20, 40, 60],
	error: [50, 30, 50]
} as const;

export type HapticPattern = keyof typeof HAPTIC_PATTERNS;

/**
 * Trigger haptic feedback if the device supports it.
 */
export function triggerHaptic(pattern: number[] | HapticPattern = 'tap'): void {
	if ('vibrate' in navigator) {
		const resolved = typeof pattern === 'string' ? HAPTIC_PATTERNS[pattern] : pattern;
		navigator.vibrate([...resolved]);
	}
}
