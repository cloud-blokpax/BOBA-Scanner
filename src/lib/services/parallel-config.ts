/**
 * Parallel-to-Rarity Configuration Service
 *
 * Manages admin-configurable mappings from card parallel names to rarity tiers.
 * Falls back to hardcoded defaults when Supabase is unavailable.
 */

import { getSupabase } from './supabase';
import { mapParallelToRarity } from '$lib/data/static-cards';
import { PARALLEL_TYPES } from '$lib/data/boba-parallels';
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
	if (key === 'base' || key === 'foil') return 'common';
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
 * Seeds from PARALLEL_TYPES (canonical list) plus any discovered from the cards table.
 */
export async function seedMissingParallels(): Promise<number> {
	const supabase = getSupabase();
	if (!supabase) return 0;

	// Get already-configured parallels from Supabase
	const { data: existingData } = await supabase
		.from('parallel_rarity_config')
		.select('parallel_name');
	const existingNames = new Set((existingData || []).map((e: { parallel_name: string }) => e.parallel_name.toLowerCase()));

	// Collect all parallels to seed: from PARALLEL_TYPES + discovered from cards table
	const toSeed = new Map<string, { name: string; rarity: CardRarity }>();

	// Add all from PARALLEL_TYPES
	for (const pt of PARALLEL_TYPES) {
		if (!existingNames.has(pt.name.toLowerCase()) && !existingNames.has(pt.key)) {
			toSeed.set(pt.name.toLowerCase(), {
				name: pt.name,
				rarity: defaultRarityForParallel(pt.key, pt.name)
			});
		}
	}

	// Also discover from cards table
	const discovered = await discoverParallels();
	for (const p of discovered) {
		if (!existingNames.has(p.toLowerCase()) && !toSeed.has(p.toLowerCase())) {
			toSeed.set(p.toLowerCase(), {
				name: p,
				rarity: mapParallelToRarity(p) || 'common'
			});
		}
	}

	if (toSeed.size === 0) return 0;

	const baseOrder = (existingData || []).length;
	const rows = [...toSeed.values()].map((entry, i) => ({
		parallel_name: entry.name,
		rarity: entry.rarity,
		sort_order: baseOrder + i
	}));

	const { error } = await supabase
		.from('parallel_rarity_config')
		.insert(rows);

	if (error) return 0;

	// Reload cache
	await reloadParallelConfig();
	return rows.length;
}
