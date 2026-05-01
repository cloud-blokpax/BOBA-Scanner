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
 * Escape HTML special characters to prevent XSS.
 * Covers the basic five (& < > " ') plus backtick for IE9 attribute-context safety.
 */
const HTML_ESCAPE_MAP: Record<string, string> = {
	'&': '&amp;',
	'<': '&lt;',
	'>': '&gt;',
	'"': '&quot;',
	"'": '&#x27;',
	'`': '&#x60;',
};

const HTML_ESCAPE_RE = /[&<>"'`]/g;

export function escapeHtml(str: string): string {
	return str.replace(HTML_ESCAPE_RE, (ch) => HTML_ESCAPE_MAP[ch]);
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

