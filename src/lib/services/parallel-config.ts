/**
 * Parallel-to-Rarity Configuration Service
 *
 * Manages admin-configurable mappings from card parallel names to rarity tiers.
 * Falls back to hardcoded defaults when Supabase is unavailable.
 */

import { getSupabase } from './supabase';
import { PARALLEL_TYPES } from '$lib/data/boba-parallels';
import type { Card, CardRarity } from '$lib/types';

/**
 * Best-effort mapping from parallel name to rarity.
 * Paper = common, standard Battlefoil = uncommon, named foils = rare,
 * Superfoil/Inspired Ink = ultra_rare, Promo = legendary.
 */
export function mapParallelToRarity(parallel: string | null): Card['rarity'] {
	if (!parallel) return 'common';
	const p = parallel.toLowerCase();
	if (p === 'paper' || p === 'play' || p === 'bonus play') return 'common';
	if (p === 'battlefoil') return 'uncommon';
	if (p.includes('superfoil') || p.includes('inspired ink')) return 'ultra_rare';
	if (p.includes('battlefoil')) return 'rare';
	return 'common';
}

// In-memory cache of parallel→rarity mappings
let configMap = new Map<string, CardRarity>();
let isLoaded = false;
let _loadPromise: Promise<Map<string, CardRarity>> | null = null;

const VALID_RARITIES: CardRarity[] = ['common', 'uncommon', 'rare', 'ultra_rare', 'legendary'];

/**
 * Load all parallel→rarity mappings from Supabase.
 * Returns the cached map (empty if Supabase unavailable).
 */
export async function loadParallelConfig(): Promise<Map<string, CardRarity>> {
	if (isLoaded) return configMap;
	if (_loadPromise) return _loadPromise;

	_loadPromise = _loadParallelConfigImpl();
	try {
		return await _loadPromise;
	} finally {
		_loadPromise = null;
	}
}

async function _loadParallelConfigImpl(): Promise<Map<string, CardRarity>> {
	try {
		const supabase = getSupabase();
		if (!supabase) return configMap;

		const { data, error } = await supabase
			.from('parallel_rarity_config')
			.select('parallel_name, rarity')
			.order('sort_order');

		if (error || !data) return configMap;

		configMap = new Map();
		for (const row of data) {
			const rarity = row.rarity as CardRarity;
			if (VALID_RARITIES.includes(rarity)) {
				configMap.set(row.parallel_name.toLowerCase(), rarity);
			}
		}
		isLoaded = true;
	} catch (err) {
		console.debug('[parallel-config] Supabase load failed, using hardcoded fallback:', err);
	}

	return configMap;
}

/**
 * Get rarity for a parallel name.
 * Priority: Supabase config → hardcoded mapping → 'common'
 */
export function getParallelRarity(parallel: string | null): CardRarity {
	if (!parallel) return 'common';

	// Check Supabase config first
	const configured = configMap.get(parallel.toLowerCase());
	if (configured) return configured;

	// Fall back to hardcoded mapping
	return mapParallelToRarity(parallel) || 'common';
}

/**
 * Check if config has been loaded from Supabase.
 */
export function isParallelConfigLoaded(): boolean {
	return isLoaded;
}

/**
 * Force reload config from Supabase (used after admin changes).
 */
export async function reloadParallelConfig(): Promise<Map<string, CardRarity>> {
	isLoaded = false;
	configMap = new Map();
	return loadParallelConfig();
}

// ── Admin Functions ──────────────────────────────────────────

export interface ParallelConfigEntry {
	id: string;
	parallel_name: string;
	rarity: CardRarity;
	sort_order: number;
}

/**
 * Default rarity for a parallel based on boba-parallels metadata.
 */
function defaultRarityForParallel(key: string, name: string): CardRarity {
	if (key === 'base' || key === 'battlefoil') return 'common';
	if (key === 'super_parallel') return 'legendary';
	if (key === 'inspired_ink') return 'ultra_rare';
	// Named inserts and color battlefoils
	if (key.includes('battlefoil')) return 'rare';
	// All other named inserts default to uncommon
	return 'uncommon';
}

/**
 * Get all config entries, merging Supabase overrides with the canonical PARALLEL_TYPES list.
 * Every parallel from boba-parallels.ts always appears.
 */
export async function getAllParallelConfig(): Promise<ParallelConfigEntry[]> {
	const supabase = getSupabase();

	// Load any existing overrides from Supabase
	const existingMap = new Map<string, ParallelConfigEntry>();
	if (supabase) {
		const { data, error } = await supabase
			.from('parallel_rarity_config')
			.select('id, parallel_name, rarity, sort_order')
			.order('sort_order');

		if (!error && data) {
			for (const row of data as ParallelConfigEntry[]) {
				existingMap.set(row.parallel_name.toLowerCase(), row);
			}
		}
	}

	// Merge: use Supabase entry if it exists, otherwise create a default from PARALLEL_TYPES
	const entries: ParallelConfigEntry[] = PARALLEL_TYPES.map((pt, i) => {
		const existing = existingMap.get(pt.key) || existingMap.get(pt.name.toLowerCase());
		if (existing) {
			return existing;
		}
		return {
			id: `local-${pt.key}`,
			parallel_name: pt.name,
			rarity: defaultRarityForParallel(pt.key, pt.name),
			sort_order: 1000 + i
		};
	});

	// Also include any Supabase entries not in PARALLEL_TYPES (discovered from cards table)
	const knownKeys = new Set(PARALLEL_TYPES.map(pt => pt.key));
	const knownNames = new Set(PARALLEL_TYPES.map(pt => pt.name.toLowerCase()));
	for (const [key, entry] of existingMap) {
		if (!knownKeys.has(key) && !knownNames.has(key)) {
			entries.push(entry);
		}
	}

	return entries;
}

/**
 * Update the rarity assignment for a parallel.
 * Routes through the admin API endpoint which uses the service-role client.
 */
export async function updateParallelRarity(
	parallelName: string,
	rarity: CardRarity
): Promise<boolean> {
	try {
		const res = await fetch('/api/admin/parallels', {
			method: 'PUT',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({ parallel_name: parallelName, rarity })
		});
		if (!res.ok) return false;
		// Update local cache
		configMap.set(parallelName.toLowerCase(), rarity);
		return true;
	} catch {
		return false;
	}
}


/**
 * Seed missing parallels into the config table.
 * Routes through the admin API endpoint which uses the service-role client.
 */
export async function seedMissingParallels(): Promise<number> {
	try {
		const res = await fetch('/api/admin/parallels', {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' }
		});
		if (!res.ok) return 0;
		const data = await res.json();
		if (data.seeded > 0) {
			await reloadParallelConfig();
		}
		return data.seeded ?? 0;
	} catch {
		return 0;
	}
}
