/**
 * Whatnot CSV Export Service
 *
 * Generates CSV files formatted for Whatnot's bulk import template.
 * Docs: https://help.whatnot.com/hc/en-us/articles/7440530071821
 */

import { buildEbayListingTitle } from '$lib/utils/ebay-title';
import { PARALLEL_FULL_NAME, normalizeParallel } from '$lib/data/parallels';

// ── Types ───────────────────────────────────────────────────

export interface WhatnotExportCard {
	// Card data (from cards table)
	id: string;
	hero_name?: string | null;
	name?: string | null;
	athlete_name?: string | null;
	card_number?: string | null;
	set_code?: string | null;
	parallel?: string | null;
	weapon_type?: string | null;
	power?: number | null;
	rarity?: string | null;

	// Price data (from price_cache)
	price_mid?: number | null;

	// Collection/scan data
	quantity?: number;
	condition?: string | null;

	// Image (Supabase public URL — NOT a blob URL)
	image_url?: string | null;

	// Phase 2.5: game id for cross-game listings.
	// (parallel is declared above — it's the human-readable DB name, e.g.
	// "Paper", "Classic Foil", "Battlefoil".)
	game_id?: string | null;
	metadata?: Record<string, unknown> | null;
}

export interface WhatnotExportOptions {
	/** 'Auction' | 'Buy It Now' | 'Giveaway' — default 'Buy It Now' */
	listingType?: string;
	/** Price multiplier vs market price — default 1.0 (100%) */
	priceMultiplier?: number;
	/** Fixed price override — if set, ignores market price */
	fixedPrice?: number | null;
	/** Shipping profile string — default '0-1 oz' for singles */
	shippingProfile?: string;
	/** Allow buyer offers on BIN items — default true */
	offerable?: boolean;
	/** Category — default 'Trading Card Games' */
	category?: string;
	/** Sub Category — default empty (coach fills in Whatnot) */
	subCategory?: string;
	/** Whether user is Pro — controls image URL inclusion in CSV */
	isPro?: boolean;
}

// ── CSV Column Headers ──────────────────────────────────────

const WHATNOT_CSV_HEADERS = [
	'Category',
	'Sub Category',
	'Title',
	'Description',
	'Quantity',
	'Type',
	'Price',
	'Shipping Profile',
	'Offerable',
	'Condition',
	'SKU',
	'COGS',
	'Image URL 1',
	'Image URL 2',
	'Image URL 3',
	'Image URL 4',
	'Image URL 5',
	'Image URL 6',
	'Image URL 7',
	'Image URL 8'
];

// ── Condition Mapping ───────────────────────────────────────
// Maps BOBA Scanner conditions to Whatnot's allowed values.
// Whatnot condition values for Trading Cards:
//   Near Mint, Lightly Played, Moderately Played, Heavily Played, Damaged

const CONDITION_MAP: Record<string, string> = {
	'near_mint': 'Near Mint',
	'Near Mint': 'Near Mint',
	'NM': 'Near Mint',
	'Mint': 'Near Mint',
	'excellent': 'Lightly Played',
	'Excellent': 'Lightly Played',
	'EX': 'Lightly Played',
	'very_good': 'Moderately Played',
	'Very Good': 'Moderately Played',
	'VG': 'Moderately Played',
	'good': 'Heavily Played',
	'Good': 'Heavily Played',
	'fair': 'Heavily Played',
	'Fair': 'Heavily Played',
	'poor': 'Damaged',
	'Poor': 'Damaged'
};

function mapCondition(condition?: string | null): string {
	if (!condition) return 'Near Mint';
	return CONDITION_MAP[condition] || 'Near Mint';
}

// ── Title Builder ───────────────────────────────────────────

function buildWhatnotTitle(card: WhatnotExportCard): string {
	return buildEbayListingTitle({
		hero_name: card.hero_name,
		name: card.name,
		athlete_name: card.athlete_name,
		parallel: card.parallel,
		weapon_type: card.weapon_type,
		card_number: card.card_number,
		game_id: card.game_id ?? null,
		metadata: card.metadata ?? null,
	});
}

// ── Description Builder ─────────────────────────────────────

function buildWhatnotDescription(card: WhatnotExportCard, condition: string): string {
	const gameId = card.game_id || 'boba';
	if (gameId === 'wonders') {
		return buildWondersWhatnotDescription(card, condition);
	}
	return buildBobaWhatnotDescription(card, condition);
}

function buildBobaWhatnotDescription(card: WhatnotExportCard, condition: string): string {
	const heroName = card.hero_name || card.name || 'Unknown';
	const parts = [
		`${heroName} - Bo Jackson Battle Arena Trading Card`,
		card.card_number ? `Card #${card.card_number}` : null,
		card.set_code ? `Set: ${card.set_code}` : null,
		card.parallel ? `Parallel: ${card.parallel}` : null,
		card.weapon_type ? `Weapon: ${card.weapon_type}` : null,
		card.athlete_name ? `Athlete: ${card.athlete_name}` : null,
		`Condition: ${condition}`,
		'Ships in penny sleeve + top loader.'
	];
	return parts.filter(Boolean).join(' | ');
}

function buildWondersWhatnotDescription(card: WhatnotExportCard, condition: string): string {
	const meta = (card.metadata ?? {}) as Record<string, unknown>;
	const setDisplay = (meta.set_name_display ?? meta.set_name ?? card.set_code ?? 'Wonders of The First') as string;
	const parallelName = PARALLEL_FULL_NAME[normalizeParallel(card.parallel)];
	const cardClass = typeof meta.card_class === 'string' ? meta.card_class : null;
	const rarityText = card.rarity ? String(card.rarity).replace('_', ' ') : null;

	const parts = [
		`${card.name || 'Unknown'} - Wonders of The First`,
		`Wonders of The First — ${setDisplay}`,
		`Parallel: ${parallelName}`,
		card.card_number ? `Collector Number: ${card.card_number}` : null,
		rarityText ? `Rarity: ${rarityText}` : null,
		cardClass ? `Class: ${cardClass}` : null,
		`Condition: ${condition}`,
		'Ships in penny sleeve + top loader.'
	];
	return parts.filter(Boolean).join(' | ');
}

// ── SKU Builder ─────────────────────────────────────────────

function buildWhatnotSku(card: WhatnotExportCard): string {
	const gameId = card.game_id || 'boba';
	const prefix = gameId === 'wonders' ? 'WOTF' : 'BOBA';
	const parallel = normalizeParallel(card.parallel);
	const parallelSuffix = parallel === 'paper' ? '' : `-${parallel.toUpperCase()}`;
	return `${prefix}-${card.id.substring(0, 8)}${parallelSuffix}`;
}

// ── CSV Escaping ────────────────────────────────────────────

function escapeCSV(value: string | number | boolean | null | undefined): string {
	if (value === null || value === undefined) return '';
	const str = String(value);
	if (str.includes(',') || str.includes('"') || str.includes('\n')) {
		return `"${str.replace(/"/g, '""')}"`;
	}
	return str;
}

// ── Main Export Function ────────────────────────────────────

export function generateWhatnotCSV(
	cards: WhatnotExportCard[],
	options: WhatnotExportOptions = {}
): string {
	const {
		listingType = 'Buy It Now',
		priceMultiplier = 1.0,
		fixedPrice = null,
		shippingProfile = '0-1 oz',
		offerable = true,
		category = 'Trading Card Games',
		subCategory = ''
	} = options;

	const rows: string[] = [
		WHATNOT_CSV_HEADERS.map(escapeCSV).join(',')
	];

	for (const card of cards) {
		const condition = mapCondition(card.condition);
		const price = fixedPrice ?? (card.price_mid ? Math.round(card.price_mid * priceMultiplier * 100) / 100 : 0.99);
		const title = buildWhatnotTitle(card);
		const description = buildWhatnotDescription(card, condition);
		const sku = buildWhatnotSku(card);

		// Image URL in CSV is Pro-only — free users get blank column
		const imageUrl = options.isPro && card.image_url && card.image_url.startsWith('https://')
			? card.image_url
			: '';

		const row = [
			category,
			subCategory,
			title,
			description,
			card.quantity || 1,
			listingType,
			price.toFixed(2),
			shippingProfile,
			listingType === 'Buy It Now' && offerable ? 'TRUE' : '',
			condition,
			sku,
			'',
			imageUrl,
			'',
			'',
			'',
			'',
			'',
			'',
			''
		];

		rows.push(row.map(escapeCSV).join(','));
	}

	return rows.join('\n');
}

// ── Download Helper ─────────────────────────────────────────

export function downloadWhatnotCSV(csvContent: string, filename?: string): void {
	const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
	const url = URL.createObjectURL(blob);
	const link = document.createElement('a');
	link.href = url;
	link.download = filename || `whatnot-export-${new Date().toISOString().split('T')[0]}.csv`;
	document.body.appendChild(link);
	link.click();
	document.body.removeChild(link);
	setTimeout(() => URL.revokeObjectURL(url), 10000);
}
