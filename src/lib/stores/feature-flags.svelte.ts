/**
 * Feature flags store — role-based feature gating backed by Supabase.
 */

import { getSupabase } from '$lib/services/supabase';
import { user } from '$lib/stores/auth.svelte';

export interface FeatureFlag {
	feature_key: string;
	display_name: string;
	description: string;
	icon: string;
	enabled_globally: boolean;
	enabled_for_guest: boolean;
	enabled_for_authenticated: boolean;
	enabled_for_pro: boolean;
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
		enabled_for_pro: true,
		enabled_for_admin: true
	},
	{
		feature_key: 'multi_game_ui',
		display_name: 'Multi-Game UI',
		description: 'Game selector pill, hub home screen, collection game filters, and Wonders-specific UI. Invisible while off — BoBA single-game experience stays unchanged.',
		icon: '🎮',
		enabled_globally: false,
		enabled_for_guest: false,
		enabled_for_authenticated: false,
		enabled_for_pro: false,
		enabled_for_admin: true
	},
	{
		feature_key: 'price_history',
		display_name: 'Price History & Alerts',
		description: '30-day price sparklines, trend badges, and price drop/spike alerts on every card',
		icon: '📈',
		enabled_globally: false,
		enabled_for_guest: false,
		enabled_for_authenticated: false,
		enabled_for_pro: true,
		enabled_for_admin: true
	},
	{
		feature_key: 'scan_to_list',
		display_name: 'Scan-to-List for eBay',
		description: 'Create eBay listings directly from scan results with AI-suggested titles and market pricing',
		icon: '🏷️',
		enabled_globally: false,
		enabled_for_guest: false,
		enabled_for_authenticated: false,
		enabled_for_pro: true,
		enabled_for_admin: true
	},
	{
		feature_key: 'new_scan_pipeline',
		display_name: 'New Scan Pipeline (Phase 0.3+)',
		description: 'Routes scan telemetry through the new scan_sessions / scans / scan_tier_results tables. Admin-only during Phase 1 evaluation.',
		icon: '📸',
		enabled_globally: false,
		enabled_for_guest: false,
		enabled_for_authenticated: false,
		enabled_for_pro: false,
		enabled_for_admin: true
	},
	{
		feature_key: 'embedding_tier1',
		display_name: 'Embedding-based Tier 1 (DINOv2)',
		description: 'Replaces pHash Tier 1 with DINOv2 vision embeddings for nearest-neighbor card matching. Admin-only until measured on real traffic.',
		icon: '🧠',
		enabled_globally: false,
		enabled_for_guest: false,
		enabled_for_authenticated: false,
		enabled_for_pro: false,
		enabled_for_admin: true
	}
];

// ── Private mutable state ──────────────────────────────────
let _featureFlags = $state<Map<string, FeatureFlag>>(
	new Map(FEATURE_DEFINITIONS.map((f) => [f.feature_key, f]))
);
let _userOverrides = $state<Map<string, boolean>>(new Map());
let _flagsLoaded = $state(false);

// ── Public reactive accessors ──────────────────────────────────
export function userOverrides(): Map<string, boolean> { return _userOverrides; }

interface UserProfile {
	is_pro?: boolean;
	is_admin?: boolean;
}

let _userProfile = $state<UserProfile | null>(null);
let _userProfileForUserId: string | null = null;
let _userProfileFetchedAt = 0;
let _refreshPromise: Promise<void> | null = null;
const PROFILE_MAX_AGE = 60_000;

function roleCheck(flag: FeatureFlag): boolean {
	if (flag.enabled_globally) return true;
	const currentUser = user();
	if (!currentUser) {
		if (_userProfile) {
			_userProfile = null;
			_userProfileForUserId = null;
			_userProfileFetchedAt = 0;
		}
		return flag.enabled_for_guest === true;
	}
	if (_userProfileForUserId && _userProfileForUserId !== currentUser.id) {
		// Different user signed in — must clear immediately to avoid
		// granting the new user the old user's admin/member permissions
		_userProfile = null;
		_userProfileForUserId = null;
		_userProfileFetchedAt = 0;
		_refreshProfile(currentUser.id);
	} else if (Date.now() - _userProfileFetchedAt > PROFILE_MAX_AGE) {
		// Same user, stale profile — keep existing profile active while
		// refreshing to prevent features from flickering off briefly
		_refreshProfile(currentUser.id);
	}
	if (_userProfile?.is_admin) return flag.enabled_for_admin === true;
	if (_userProfile?.is_pro) return flag.enabled_for_pro === true;
	return flag.enabled_for_authenticated === true;
}

/**
 * Get the cached user profile (is_pro, is_admin).
 * Returns null if not yet fetched.
 */
export function getUserProfile(): UserProfile | null {
	return _userProfile;
}

/**
 * Ensure the user profile (is_pro, is_admin) is loaded.
 * Call this from components that need role checks but don't go through feature flags.
 */
export async function ensureProfileLoaded(): Promise<void> {
	const currentUser = user();
	if (!currentUser) return;
	// Already loaded for this user and still fresh
	if (_userProfile && _userProfileForUserId === currentUser.id && Date.now() - _userProfileFetchedAt < PROFILE_MAX_AGE) return;
	await _refreshProfile(currentUser.id);
}

async function _refreshProfile(userId: string): Promise<void> {
	// Deduplicate: if a refresh is already in flight, piggyback on it
	if (_refreshPromise) return _refreshPromise;

	_refreshPromise = (async () => {
		try {
			const client = getSupabase();
			if (!client) return;
			const { data: profile } = await client
				.from('users')
				.select('is_pro, is_admin')
				.eq('auth_user_id', userId)
				.single();
			_userProfile = profile || null;
			_userProfileForUserId = userId;
			_userProfileFetchedAt = Date.now();
		} catch (err) {
			console.warn('[feature-flags] Profile refresh failed — role checks may be stale:', err);
		}
	})();

	try {
		await _refreshPromise;
	} finally {
		_refreshPromise = null;
	}
}

/**
 * Reactive check for a specific feature flag.
 * Returns a function — call in templates: {#if hasPriceHistory()}
 */
export function featureEnabled(featureKey: string): () => boolean {
	return () => {
		const flag = _featureFlags.get(featureKey);
		if (!flag) return false;
		const override = _userOverrides.get(featureKey);
		if (override !== undefined) return override;
		void user();
		return roleCheck(flag);
	};
}

export async function loadFeatureFlags(): Promise<void> {
	try {
		const client = getSupabase();
		if (!client) {
			_featureFlags = new Map(FEATURE_DEFINITIONS.map((f) => [f.feature_key, f]));
			_flagsLoaded = true;
			return;
		}

		const { data: flagsRaw, error: flagErr } = await client.from('feature_flags').select('*');
		const flags = (flagsRaw || []) as unknown as FeatureFlag[];

		const flagMap = new Map<string, FeatureFlag>();

		if (flagErr) {
			console.warn('[feature-flags] Supabase fetch failed, using hardcoded defaults:', flagErr.message ?? flagErr);
			for (const def of FEATURE_DEFINITIONS) {
				flagMap.set(def.feature_key, def);
			}
		} else {
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

		_featureFlags = flagMap;

		const currentUser = user();
		if (currentUser) {
			const { data: profile } = await client
				.from('users')
				.select('is_pro, is_admin')
				.eq('auth_user_id', currentUser.id)
				.single();
			_userProfile = profile || null;
			_userProfileForUserId = currentUser.id;
			_userProfileFetchedAt = Date.now();

			// user_feature_overrides.user_id references auth.users.id (same as currentUser.id).
			// If this table is later changed to reference users.id (public table PK),
			// resolve through the users table like tournaments do.
			const { data: overrides } = await client
				.from('user_feature_overrides')
				.select('feature_key, enabled')
				.eq('user_id', currentUser.id);

			_userOverrides = new Map(
				(overrides || []).map((o: { feature_key: string; enabled: boolean }) => [
					o.feature_key,
					o.enabled
				])
			);
		}

		_flagsLoaded = true;
	} catch (err) {
		console.warn('Feature flags load error (using defaults):', err);
		_featureFlags = new Map(FEATURE_DEFINITIONS.map((f) => [f.feature_key, f]));
		_flagsLoaded = true;
	}
}

export async function saveFeatureFlag(
	featureKey: string,
	updates: Partial<FeatureFlag>
): Promise<boolean> {
	try {
		const res = await fetch('/api/admin/feature-flags', {
			method: 'PUT',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({ feature_key: featureKey, updates })
		});
		if (!res.ok) return false;
		await loadFeatureFlags();
		return true;
	} catch (err) {
		console.error('saveFeatureFlag error:', err);
		return false;
	}
}

export function getAllFeatureFlags(): FeatureFlag[] {
	return [..._featureFlags.values()];
}
