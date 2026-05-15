/**
 * Classify a raw scan-failure string into a structured display payload.
 *
 * Producers (Scanner.svelte, ScanHeroCard, recognition.ts) write free-text
 * failReason strings. The UI surfaces them via ScanFailState. To give the
 * user a consistent, scannable error layout (icon + title + help), we
 * classify the string here rather than threading a kind enum through every
 * producer. Keyword matching is deliberate: it lets new producers ship
 * without ceremony and stays decoupled from the recognition pipeline's
 * internal vocabulary.
 *
 * Unmatched strings fall through to `unknown`, which still renders the raw
 * message as the title so we never swallow information.
 */

export type ScanFailKind =
	| 'blur'
	| 'glare'
	| 'lighting'
	| 'no_match'
	| 'ocr_fail'
	| 'network'
	| 'image'
	| 'unknown';

export interface ScanFailDisplay {
	kind: ScanFailKind;
	icon: string;
	title: string;
	helpText: string;
}

const UNKNOWN_HELP = 'Try adjusting the angle or lighting and scan again.';

export function classifyScanFailure(message: string | null | undefined): ScanFailDisplay {
	if (!message) {
		return {
			kind: 'unknown',
			icon: '⚠️',
			title: 'Card Not Identified',
			helpText: UNKNOWN_HELP
		};
	}

	const m = message.toLowerCase();

	if (m.includes('blur') || m.includes('steady')) {
		return {
			kind: 'blur',
			icon: '📷',
			title: 'Image too blurry',
			helpText: 'Hold the camera steady and make sure the card is in focus.'
		};
	}

	if (m.includes('glare') || m.includes('reflect')) {
		return {
			kind: 'glare',
			icon: '✨',
			title: 'Glare detected',
			helpText: 'Tilt the card or move to softer light to reduce reflections.'
		};
	}

	if (m.includes('overexposed') || m.includes('underexposed') || m.includes('lighting') || m.includes('too dark') || m.includes('too bright')) {
		return {
			kind: 'lighting',
			icon: '💡',
			title: 'Lighting needs adjustment',
			helpText: 'Try a more evenly-lit spot — avoid direct sunlight or shadow.'
		};
	}

	if (m.includes('offline') || m.includes('network') || m.includes('check your connection')) {
		return {
			kind: 'network',
			icon: '🌐',
			title: 'Network error',
			helpText: 'Check your connection — we’ll retry when you’re back online.'
		};
	}

	if (
		m.includes('not yet in database') ||
		m.includes('could not identify') ||
		m.includes('not identified') ||
		m.includes('no match')
	) {
		return {
			kind: 'no_match',
			icon: '🔍',
			title: 'Card not recognized',
			helpText: 'Make sure the full card is in frame and try a clearer photo.'
		};
	}

	if (m.includes('could not read') || m.includes('ocr') || m.includes('read card')) {
		return {
			kind: 'ocr_fail',
			icon: '📝',
			title: 'Couldn’t read the card text',
			helpText: 'Get closer and ensure the card number and name are sharp.'
		};
	}

	if (
		m.includes('image buffer') ||
		m.includes('different photo') ||
		m.includes('process image') ||
		m.includes('failed to process')
	) {
		return {
			kind: 'image',
			icon: '🖼️',
			title: 'Couldn’t process this image',
			helpText: 'Try a different photo, or scan with the camera directly.'
		};
	}

	return {
		kind: 'unknown',
		icon: '⚠️',
		title: message,
		helpText: UNKNOWN_HELP
	};
}
