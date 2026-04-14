/**
 * eBay condition mapping for trading cards.
 *
 * eBay Inventory API condition enums for Trading Card categories (261328):
 *   LIKE_NEW       = "Graded" (requires conditionDescriptors with grading info)
 *   USED_VERY_GOOD = "Ungraded"
 *
 * All ungraded cards use USED_VERY_GOOD regardless of physical condition.
 * When grading support is added, graded cards will use LIKE_NEW + conditionDescriptors.
 */

const CONDITION_MAP: Record<string, string> = {
	'mint': 'USED_VERY_GOOD',
	'nearmint': 'USED_VERY_GOOD',
	'near_mint': 'USED_VERY_GOOD',
	'excellent': 'USED_VERY_GOOD',
	'good': 'USED_VERY_GOOD',
	'fair': 'USED_VERY_GOOD',
	'poor': 'USED_VERY_GOOD'
};

export function conditionToEbay(condition: string): string {
	const key = (condition || '').toLowerCase().replace(/[_\s]/g, '');
	return CONDITION_MAP[key] || 'USED_VERY_GOOD';
}

const CONDITION_DESCRIPTOR_MAP: Record<string, string> = {
	'mint': '400010',
	'nearmint': '400010',
	'near_mint': '400010',
	'excellent': '400011',
	'good': '400012',
	'fair': '400013',
	'poor': '400013'
};

export function conditionToDescriptorId(condition: string): string {
	const key = (condition || '').toLowerCase().replace(/[_\s]/g, '');
	return CONDITION_DESCRIPTOR_MAP[key] || '400010';
}
