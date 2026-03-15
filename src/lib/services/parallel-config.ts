/**
 * Parallel-to-Rarity Configuration Service
 *
 * Manages admin-configurable mappings from card parallel names to rarity tiers.
 * Falls back to hardcoded defaults when Supabase is unavailable.
 */

import { getSupabase } from './supabase';
import { mapParallelToRarity } from '$lib/data/static-cards';
import type { CardRarity } from '$lib/types';

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
	} catch {
		// Supabase unavailable — use hardcoded fallback
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
 * Get all config entries grouped by rarity.
 */
export async function getAllParallelConfig(): Promise<ParallelConfigEntry[]> {
	const supabase = getSupabase();
	if (!supabase) return [];

	const { data, error } = await supabase
		.from('parallel_rarity_config')
		.select('id, parallel_name, rarity, sort_order')
		.order('sort_order');

	if (error || !data) return [];
	return data as ParallelConfigEntry[];
}

/**
 * Update the rarity assignment for a parallel.
 */
export async function updateParallelRarity(
	parallelName: string,
	rarity: CardRarity
): Promise<boolean> {
	const supabase = getSupabase();
	if (!supabase) return false;

	const { error } = await supabase
		.from('parallel_rarity_config')
		.upsert(
			{
				parallel_name: parallelName,
				rarity,
				updated_at: new Date().toISOString()
			},
			{ onConflict: 'parallel_name' }
		);

	if (error) return false;

	// Update local cache
	configMap.set(parallelName.toLowerCase(), rarity);
	return true;
}

/**
 * Discover all distinct parallel values from the cards table.
 */
export async function discoverParallels(): Promise<string[]> {
	const supabase = getSupabase();
	if (!supabase) return [];

	const { data, error } = await supabase
		.from('cards')
		.select('parallel')
		.not('parallel', 'is', null);

	if (error || !data) return [];

	const uniqueParallels = new Set<string>();
	for (const row of data) {
		if (row.parallel) uniqueParallels.add(row.parallel);
	}

	return [...uniqueParallels].sort();
}

/**
 * Seed missing parallels into the config table.
 * Uses the hardcoded mapping for initial rarity assignment.
 */
export async function seedMissingParallels(): Promise<number> {
	const supabase = getSupabase();
	if (!supabase) return 0;

	// Get all discovered parallels
	const allParallels = await discoverParallels();
	if (allParallels.length === 0) return 0;

	// Get already-configured parallels
	const existing = await getAllParallelConfig();
	const existingNames = new Set(existing.map((e) => e.parallel_name));

	// Find missing ones
	const missing = allParallels.filter((p) => !existingNames.has(p));
	if (missing.length === 0) return 0;

	// Insert with hardcoded rarity as default
	const rows = missing.map((parallelName, i) => ({
		parallel_name: parallelName,
		rarity: mapParallelToRarity(parallelName) || 'common',
		sort_order: existing.length + i
	}));

	const { error } = await supabase
		.from('parallel_rarity_config')
		.insert(rows);

	if (error) return 0;

	// Reload cache
	await reloadParallelConfig();
	return missing.length;
}
