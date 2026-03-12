/**
 * Export template management.
 *
 * Replaces legacy src/features/export/templates.js.
 * Templates are stored in localStorage and synced to Supabase.
 */

import { browser } from '$app/environment';
import { supabase } from '$lib/services/supabase';

const STORAGE_KEY = 'exportTemplates';

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
	{ key: 'ebayAvgPrice', label: 'eBay Avg Price', default: false },
	{ key: 'ebayLowPrice', label: 'eBay Low Price', default: false },
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

/**
 * Get user templates from localStorage.
 */
export function getUserTemplates(): ExportTemplate[] {
	if (!browser) return [];
	try {
		const raw = localStorage.getItem(STORAGE_KEY);
		return raw ? JSON.parse(raw) : [];
	} catch {
		return [];
	}
}

/**
 * Save a user template.
 */
export function saveUserTemplate(template: Omit<ExportTemplate, 'isUser' | 'isAdmin'>): void {
	if (!browser) return;
	const templates = getUserTemplates();
	const idx = templates.findIndex((t) => t.id === template.id);
	const entry: ExportTemplate = { ...template, isUser: true, isAdmin: false };
	if (idx >= 0) {
		templates[idx] = entry;
	} else {
		templates.push(entry);
	}
	localStorage.setItem(STORAGE_KEY, JSON.stringify(templates));
}

/**
 * Delete a user template.
 */
export function deleteUserTemplate(id: string): void {
	if (!browser) return;
	const templates = getUserTemplates().filter((t) => t.id !== id);
	localStorage.setItem(STORAGE_KEY, JSON.stringify(templates));
}

/**
 * Push templates to Supabase cloud.
 */
export async function pushTemplatesToCloud(userId: string): Promise<void> {
	const templates = getUserTemplates();
	const { error } = await supabase
		.from('collections')
		.upsert({ user_id: userId, export_templates: templates }, { onConflict: 'user_id' });
	if (error) throw error;
}

/**
 * Pull templates from Supabase cloud.
 */
export async function pullTemplatesFromCloud(userId: string): Promise<ExportTemplate[]> {
	const { data, error } = await supabase
		.from('collections')
		.select('export_templates')
		.eq('user_id', userId)
		.single();
	if (error || !data?.export_templates) return [];

	const remote = data.export_templates as ExportTemplate[];
	const local = getUserTemplates();

	// Merge: local wins on conflicts
	const merged = [...local];
	for (const rt of remote) {
		if (!merged.some((t) => t.id === rt.id)) {
			merged.push(rt);
		}
	}
	if (browser) {
		localStorage.setItem(STORAGE_KEY, JSON.stringify(merged));
	}
	return merged;
}

/**
 * Load admin-assigned templates from Supabase.
 */
export async function loadAdminTemplates(userId: string): Promise<ExportTemplate[]> {
	const { data, error } = await supabase
		.from('user_admin_template_assignments')
		.select('admin_template_id, admin_templates(id, name, fields, description)')
		.eq('user_id', userId);

	if (error || !data) return [];

	return data
		.filter((d) => d.admin_templates)
		.map((d) => {
			const t = d.admin_templates as { id: string; name: string; fields: string[] };
			return {
				id: t.id,
				name: t.name,
				fields: t.fields,
				updatedAt: new Date().toISOString(),
				isUser: false,
				isAdmin: true
			};
		});
}

/**
 * Get all templates (user + admin).
 */
export async function getAllTemplates(userId: string): Promise<ExportTemplate[]> {
	const user = getUserTemplates();
	const admin = await loadAdminTemplates(userId);
	return [...user, ...admin];
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
	URL.revokeObjectURL(url);
}
