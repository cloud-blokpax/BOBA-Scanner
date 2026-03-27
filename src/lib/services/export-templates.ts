/**
 * Export template management.
 *
 * Templates are stored in IndexedDB via the idb meta store.
 */

import { browser } from '$app/environment';
import { idb } from '$lib/services/idb';

const IDB_KEY = 'exportTemplates';

/** Built-in export templates — always available, not editable. */
export const BUILT_IN_TEMPLATES: ExportTemplate[] = [
	{
		id: '__builtin_general',
		name: 'General Export',
		fields: ['hero', 'athlete', 'cardNumber', 'set', 'year', 'rarity', 'weapon', 'power', 'condition', 'ebayLowPrice'],
		updatedAt: '2026-01-01T00:00:00Z',
		isUser: false,
		isAdmin: false
	},
	{
		id: '__builtin_ebay',
		name: 'eBay Seller Hub',
		fields: ['hero', 'cardNumber', 'set', 'weapon', 'rarity', 'condition', 'ebayAvgPrice', 'ebaySearchUrl'],
		updatedAt: '2026-01-01T00:00:00Z',
		isUser: false,
		isAdmin: false
	},
	{
		id: '__builtin_insurance',
		name: 'Insurance / Inventory',
		fields: ['hero', 'athlete', 'cardNumber', 'set', 'year', 'rarity', 'weapon', 'power', 'condition', 'ebayAvgPrice', 'ebayLowPrice', 'tags', 'notes'],
		updatedAt: '2026-01-01T00:00:00Z',
		isUser: false,
		isAdmin: false
	}
];

/** Get a built-in template by ID. */
export function getBuiltInTemplate(id: string): ExportTemplate | undefined {
	return BUILT_IN_TEMPLATES.find(t => t.id === id);
}

export interface ExportTemplate {
	id: string;
	name: string;
	fields: string[];
	updatedAt: string;
	isUser: boolean;
	isAdmin: boolean;
}

export interface ExportField {
	key: string;
	label: string;
	default: boolean;
}

/** Available export fields. */
export const EXPORT_FIELDS: ExportField[] = [
	{ key: 'cardId', label: 'Card ID', default: true },
	{ key: 'hero', label: 'Hero Name', default: true },
	{ key: 'athlete', label: 'Athlete Name', default: true },
	{ key: 'year', label: 'Year', default: true },
	{ key: 'set', label: 'Set', default: true },
	{ key: 'cardNumber', label: 'Card Number', default: true },
	{ key: 'weapon', label: 'Weapon', default: false },
	{ key: 'power', label: 'Power', default: false },
	{ key: 'condition', label: 'Condition', default: false },
	{ key: 'notes', label: 'Notes', default: false },
	{ key: 'tags', label: 'Tags', default: false },
	{ key: 'ebayAvgPrice', label: 'Recommended Listing Price (Median)', default: false },
	{ key: 'ebayLowPrice', label: 'eBay Low Price', default: false },
	{ key: 'ebayBuyNowPrice', label: 'Buy Now Price (Lowest)', default: false },
	{ key: 'listingPrice', label: 'Listing Price', default: false },
	{ key: 'ebaySearchUrl', label: 'eBay Search URL', default: false },
	{ key: 'rarity', label: 'Rarity', default: false }
];

/** eBay condition code mapping. */
export const EBAY_CONDITION_MAP: Record<string, string> = {
	Raw: '3000',
	'PSA 10': '2750',
	'PSA 9': '2750',
	'PSA 8': '3000',
	'BGS 10': '2750',
	'BGS 9.5': '2750',
	'BGS 9': '2750',
	'Near Mint': '3000',
	Good: '4000',
	Fair: '5000',
	Poor: '6000'
};

// In-memory cache (loaded asynchronously from IDB)
let _templatesCache: ExportTemplate[] | null = null;

/**
 * Get user templates. Returns cached value or loads from IDB.
 */
export async function getUserTemplates(): Promise<ExportTemplate[]> {
	if (_templatesCache) return [...BUILT_IN_TEMPLATES, ..._templatesCache];
	if (!browser) return [...BUILT_IN_TEMPLATES];

	try {
		const stored = await idb.getMeta<ExportTemplate[]>(IDB_KEY);
		if (Array.isArray(stored)) {
			_templatesCache = stored;
			return stored;
		}
	} catch (err) {
		console.debug('[export-templates] IDB load failed:', err);
	}

	// One-time migration from localStorage
	try {
		const legacyRaw = localStorage.getItem('exportTemplates');
		if (legacyRaw) {
			const legacy = JSON.parse(legacyRaw);
			if (Array.isArray(legacy)) {
				await idb.setMeta(IDB_KEY, legacy);
				_templatesCache = legacy;
				localStorage.removeItem('exportTemplates');
				return legacy;
			}
		}
	} catch { /* ignore */ }

	_templatesCache = [];
	return [...BUILT_IN_TEMPLATES];
}

/**
 * Save a user template.
 */
export async function saveUserTemplate(template: Omit<ExportTemplate, 'isUser' | 'isAdmin'>): Promise<void> {
	const templates = await getUserTemplates();
	const idx = templates.findIndex((t) => t.id === template.id);
	const entry: ExportTemplate = { ...template, isUser: true, isAdmin: false };
	if (idx >= 0) {
		templates[idx] = entry;
	} else {
		templates.push(entry);
	}
	_templatesCache = templates;
	await idb.setMeta(IDB_KEY, templates);
}

/**
 * Delete a user template.
 */
export async function deleteUserTemplate(id: string): Promise<void> {
	const templates = (await getUserTemplates()).filter((t) => t.id !== id);
	_templatesCache = templates;
	await idb.setMeta(IDB_KEY, templates);
}

/**
 * Generate CSV content from card data.
 */
export function generateCSV(
	cards: Record<string, unknown>[],
	fields: string[]
): string {
	const header = fields.join(',');
	const rows = cards.map((card) =>
		fields
			.map((f) => {
				const val = card[f];
				if (val == null) return '';
				const str = String(val);
				if (str.includes(',') || str.includes('"') || str.includes('\n')) {
					return `"${str.replace(/"/g, '""')}"`;
				}
				return str;
			})
			.join(',')
	);
	return [header, ...rows].join('\n');
}

// ── eBay Seller Hub CSV Export ───────────────────────────────

export interface ExportCard {
	heroName?: string;
	name?: string;
	cardNumber?: string;
	setCode?: string;
	weaponType?: string;
	parallel?: string;
	rarity?: string;
	conditionId?: string;
	price?: number;
}

const CONDITION_MULTIPLIERS: Record<string, number> = {
	NM: 1.0,
	LP: 0.85,
	MP: 0.70,
	HP: 0.55,
	D: 0.35
};

export function getConditionMultiplier(condition: string): number {
	return CONDITION_MULTIPLIERS[condition] ?? 1.0;
}

/**
 * Generate an optimized eBay title (max 80 chars).
 * Structure: [Card Name] [Finish] [Number] [Rarity] [Set] [Game]
 */
export function generateEbayTitle(card: ExportCard): string {
	const parts = [
		card.heroName || card.name || '',
		card.parallel || '',
		card.cardNumber || '',
		card.weaponType || '',
		card.setCode || '',
		'BoBA Battle Arena'
	].filter(Boolean);

	let title = parts.join(' ');
	if (title.length > 80) {
		while (title.length > 80 && parts.length > 2) {
			parts.pop();
			title = parts.join(' ');
		}
		title = title.substring(0, 80);
	}
	return title;
}

function generateDescription(card: ExportCard): string {
	const lines = ['Bo Jackson Battle Arena (BoBA) Trading Card'];
	if (card.heroName) lines.push(`Hero: ${card.heroName}`);
	if (card.cardNumber) lines.push(`Card Number: ${card.cardNumber}`);
	if (card.setCode) lines.push(`Set: ${card.setCode}`);
	if (card.weaponType) lines.push(`Weapon: ${card.weaponType}`);
	if (card.parallel) lines.push(`Parallel: ${card.parallel}`);
	return lines.join(' | ');
}

function escapeCsvFieldExport(value: string): string {
	if (value.includes(',') || value.includes('"') || value.includes('\n')) {
		return '"' + value.replace(/"/g, '""') + '"';
	}
	return value;
}

/**
 * Generate eBay Seller Hub-compatible CSV for bulk upload.
 */
export function generateEbayCSV(cards: ExportCard[]): string {
	const headers = [
		'*Action(SiteID=US|Country=US|Currency=USD|Version=1193)',
		'*Category', '*Title', '*ConditionID', '*C:Card Name', '*C:Set',
		'*C:Card Number', 'PicURL', '*StartPrice', '*Quantity',
		'*Format', '*Duration', 'Description'
	];

	const rows = cards.map(card => [
		'Add',
		'183454',
		generateEbayTitle(card),
		card.conditionId || '1000',
		card.heroName || card.name || '',
		card.setCode || '',
		card.cardNumber || '',
		'',
		card.price?.toFixed(2) || '',
		'1',
		'FixedPrice',
		'GTC',
		generateDescription(card)
	]);

	return [
		headers.join(','),
		...rows.map(r => r.map(escapeCsvFieldExport).join(','))
	].join('\n');
}

/**
 * Download a file via blob URL.
 */
export function downloadFile(content: string, filename: string, type = 'text/csv'): void {
	if (!browser) return;
	const blob = new Blob([content], { type });
	const url = URL.createObjectURL(blob);
	const a = document.createElement('a');
	a.href = url;
	a.download = filename;
	a.click();
	// Delay revocation to ensure download starts on slow devices
	setTimeout(() => URL.revokeObjectURL(url), 10000);
}
