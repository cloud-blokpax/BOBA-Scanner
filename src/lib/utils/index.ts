/**
 * Shared utility functions.
 *
 * Replaces legacy src/ui/utils.js.
 */

/**
 * Format a number as currency.
 */
export function formatPrice(price: number | null | undefined): string {
	if (price == null) return 'N/A';
	return `$${price.toFixed(2)}`;
}

/**
 * Debounce a function call.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function debounce<T extends (...args: any[]) => void>(
	fn: T,
	delay: number
): (...args: Parameters<T>) => void {
	let timer: ReturnType<typeof setTimeout>;
	return (...args: Parameters<T>) => {
		clearTimeout(timer);
		timer = setTimeout(() => fn(...args), delay);
	};
}

