/**
 * Dragon Points admin config — fetch from the API and apply to the calculator.
 *
 * The dragon_points_config table stores partial overrides as a flat set of
 * (config_type, key, value) rows. This module shapes them into the
 * DragonPointsConfigOverrides type that setDragonPointsConfig() consumes.
 *
 * Schema (documented inline in api/admin/dragon-points):
 *   config_type  | key          | value
 *   -------------|--------------|-------------------------------
 *   base_table   | mythic_sf    | {"points": 600}
 *   class_multi… | stoneseeker  | {"multiplier": 3.5}
 *   year_bonus   | 2026         | {"multiplier": 1.4}
 *
 * The loader is best-effort — if the API returns an error, 404, or an
 * unparseable row, we silently fall back to hardcoded defaults via
 * setDragonPointsConfig(null).
 */

import {
	setDragonPointsConfig,
	type DragonPointsConfigOverrides,
} from './dragon-points';
import type { DragonRarity } from './dragon-points';
type FoilParallel = 'cf' | 'ff' | 'ocm' | 'sf';

interface ConfigRow {
	config_type: string;
	key: string;
	value: Record<string, unknown>;
	description?: string | null;
	updated_at?: string;
}

const DRAGON_RARITIES: readonly DragonRarity[] = ['common', 'uncommon', 'rare', 'epic', 'mythic'];
const FOIL_PARALLELS_LOCAL: readonly FoilParallel[] = ['cf', 'ff', 'ocm', 'sf'];

function parseBaseTableKey(key: string): { rarity: DragonRarity; parallel: FoilParallel } | null {
	// Format: "<rarity>_<parallel>" (e.g., "mythic_sf").
	const m = key.trim().toLowerCase().match(/^([a-z]+)_([a-z]+)$/);
	if (!m) return null;
	const [, rarity, parallel] = m;
	if (!DRAGON_RARITIES.includes(rarity as DragonRarity)) return null;
	if (!FOIL_PARALLELS_LOCAL.includes(parallel as FoilParallel)) return null;
	return { rarity: rarity as DragonRarity, parallel: parallel as FoilParallel };
}

/** Shape raw DB rows into DragonPointsConfigOverrides. */
export function rowsToOverrides(rows: ConfigRow[]): DragonPointsConfigOverrides {
	const overrides: DragonPointsConfigOverrides = {};

	for (const row of rows) {
		const val = row.value || {};
		switch (row.config_type) {
			case 'base_table': {
				const parsed = parseBaseTableKey(row.key);
				if (!parsed) continue;
				const points = Number(val.points);
				if (!Number.isFinite(points) || points < 0) continue;
				if (!overrides.baseTable) overrides.baseTable = {};
				if (!overrides.baseTable[parsed.rarity]) overrides.baseTable[parsed.rarity] = {};
				overrides.baseTable[parsed.rarity]![parsed.parallel] = points;
				break;
			}
			case 'class_multiplier': {
				// All class multipliers currently share one multiplier value (3×).
				// Future: support per-class multipliers if needed.
				const multiplier = Number(val.multiplier);
				if (Number.isFinite(multiplier) && multiplier > 0) {
					overrides.classMultiplier = multiplier;
				}
				break;
			}
			case 'year_bonus': {
				const year = parseInt(row.key, 10);
				const multiplier = Number(val.multiplier);
				if (Number.isFinite(year) && Number.isFinite(multiplier) && multiplier > 0) {
					overrides.freshnessYear = year;
					overrides.freshnessMultiplier = multiplier;
				}
				break;
			}
			// bonus_card: intentionally unused until Dragon Cup PDF publishes values.
		}
	}

	return overrides;
}

/**
 * Fetch Dragon Points config from the admin API and apply it to the calculator.
 * Silent on failure — falls back to hardcoded defaults. Returns `true` if
 * overrides were applied, `false` otherwise.
 *
 * Call once per page load that reads Dragon Points (e.g., /wonders/dragon-points,
 * /collection, card detail). Admin edits invalidate the DB rows; a page reload
 * picks up the new config.
 */
export async function loadDragonPointsConfig(): Promise<boolean> {
	try {
		const res = await fetch('/api/admin/dragon-points');
		if (!res.ok) {
			setDragonPointsConfig(null);
			return false;
		}
		const body = (await res.json()) as { config?: ConfigRow[] };
		const rows = Array.isArray(body.config) ? body.config : [];
		if (rows.length === 0) {
			setDragonPointsConfig(null);
			return false;
		}
		const overrides = rowsToOverrides(rows);
		setDragonPointsConfig(overrides);
		return true;
	} catch {
		setDragonPointsConfig(null);
		return false;
	}
}
