/**
 * Feature flags store — role-based feature gating backed by Supabase.
 *
 * Replaces legacy src/core/infra/feature-flags.js.
 * Uses Svelte stores for reactive state.
 */

import { writable, derived, get } from 'svelte/store';
import { supabase } from '$lib/services/supabase';
import { user } from '$lib/stores/auth';

// Feature definitions (fallback defaults)
export interface FeatureFlag {
	feature_key: string;
	display_name: string;
	description: string;
	icon: string;
	enabled_globally: boolean;
	enabled_for_guest: boolean;
	enabled_for_authenticated: boolean;
	enabled_for_member: boolean;
	enabled_for_admin: boolean;
}

const FEATURE_DEFINITIONS: FeatureFlag[] = [
	{
		feature_key: 'condition_grader',
		display_name: 'AI Condition Grader',
		description: 'Estimate PSA/BGS card grade using Claude Vision',
		icon: '🔬',
		enabled_globally: false,
		enabled_for_guest: false,
		enabled_for_authenticated: false,
		enabled_for_member: true,
		enabled_for_admin: true
	},
	{
		feature_key: 'set_completion',
		display_name: 'Set Completion Engine',
		description: 'Analyzes your collection and shows which sets you are close to completing',
		icon: '🎯',
		enabled_globally: false,
		enabled_for_guest: false,
		enabled_for_authenticated: true,
		enabled_for_member: true,
		enabled_for_admin: true
	}
];

// Stores
export const featureFlags = writable<Map<string, FeatureFlag>>(
	new Map(FEATURE_DEFINITIONS.map((f) => [f.feature_key, f]))
);
export const userOverrides = writable<Map<string, boolean>>(new Map());
export const flagsLoaded = writable(false);

// User role helpers
interface UserProfile {
	is_member?: boolean;
	is_admin?: boolean;
}

let _userProfile: UserProfile | null = null;
let _userProfileForUserId: string | null = null;

function roleCheck(flag: FeatureFlag): boolean {
	if (flag.enabled_globally) return true;
	const currentUser = get(user);
	if (!currentUser) {
		// User logged out — clear stale profile
		if (_userProfile) {
			_userProfile = null;
			_userProfileForUserId = null;
		}
		return flag.enabled_for_guest === true;
	}
	// If user changed since last profile fetch, profile is stale — treat as authenticated
	if (_userProfileForUserId && _userProfileForUserId !== currentUser.id) {
		_userProfile = null;
		_userProfileForUserId = null;
	}
	if (_userProfile?.is_admin) return flag.enabled_for_admin !== false;
	if (_userProfile?.is_member) return flag.enabled_for_member !== false;
	return flag.enabled_for_authenticated !== false;
}

/**
 * Check if a feature is enabled for the current user.
 */
export function isFeatureEnabled(featureKey: string): boolean {
	const overrides = get(userOverrides);
	if (overrides.has(featureKey)) {
		return overrides.get(featureKey)!;
	}

	const flags = get(featureFlags);
	const flag = flags.get(featureKey);
	if (!flag) return false;

	return roleCheck(flag);
}

/**
 * Reactive derived store for a specific feature flag.
 */
export function featureEnabled(featureKey: string) {
	return derived([featureFlags, userOverrides, user], ([$flags, $overrides]) => {
		if ($overrides.has(featureKey)) return $overrides.get(featureKey)!;
		const flag = $flags.get(featureKey);
		if (!flag) return false;
		return roleCheck(flag);
	});
}

/**
 * Load feature flags from Supabase. Call early in app lifecycle.
 */
export async function loadFeatureFlags(): Promise<void> {
	try {
		const { data: flagsRaw, error: flagErr } = await supabase.from('feature_flags').select('*');
		const flags = (flagsRaw || []) as FeatureFlag[];

		const flagMap = new Map<string, FeatureFlag>();

		if (flagErr) {
			// Table may not exist — use defaults
			for (const def of FEATURE_DEFINITIONS) {
				flagMap.set(def.feature_key, def);
			}
		} else {
			// Merge DB flags with definitions
			for (const def of FEATURE_DEFINITIONS) {
				const dbFlag = flags.find((f) => f.feature_key === def.feature_key);
				flagMap.set(def.feature_key, dbFlag ? { ...def, ...dbFlag } : { ...def });
			}
			for (const dbFlag of flags) {
				if (!flagMap.has(dbFlag.feature_key)) {
					flagMap.set(dbFlag.feature_key, dbFlag);
				}
			}
		}

		featureFlags.set(flagMap);

		// Load per-user overrides
		const currentUser = get(user);
		if (currentUser) {
			// Fetch user profile for role check
			const { data: profile } = await supabase
				.from('users')
				.select('is_member, is_admin')
				.eq('id', currentUser.id)
				.single();
			_userProfile = profile || null;
			_userProfileForUserId = currentUser.id;

			const { data: overrides } = await supabase
				.from('user_feature_overrides')
				.select('feature_key, enabled')
				.eq('user_id', currentUser.id);

			userOverrides.set(
				new Map(
					(overrides || []).map((o: { feature_key: string; enabled: boolean }) => [
						o.feature_key,
						o.enabled
					])
				)
			);
		}

		flagsLoaded.set(true);
	} catch (err) {
		console.warn('Feature flags load error (using defaults):', err);
		featureFlags.set(new Map(FEATURE_DEFINITIONS.map((f) => [f.feature_key, f])));
		flagsLoaded.set(true);
	}
}

/**
 * Admin: save feature flag changes.
 */
export async function saveFeatureFlag(
	featureKey: string,
	updates: Partial<FeatureFlag>
): Promise<boolean> {
	try {
		// Get existing flag to ensure required fields are present for upsert
		const existing = get(featureFlags).get(featureKey);
		const displayName = updates.display_name || existing?.display_name || featureKey;
		// Strip non-DB fields (icon is local-only)
		const { icon: _icon, ...dbUpdates } = updates;
		const { error } = await supabase.from('feature_flags').upsert(
			{ feature_key: featureKey, display_name: displayName, ...dbUpdates, updated_at: new Date().toISOString() },
			{ onConflict: 'feature_key' }
		);
		if (error) throw error;
		await loadFeatureFlags();
		return true;
	} catch (err) {
		console.error('saveFeatureFlag error:', err);
		return false;
	}
}

/**
 * Get all feature flag definitions (for admin UI).
 */
export function getAllFeatureFlags(): FeatureFlag[] {
	return [...get(featureFlags).values()];
}
