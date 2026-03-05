// js/feature-flags.js — Feature flag engine for magical features
//
// Architecture:
//   - Feature flags are stored in Supabase `feature_flags` table
//   - Each flag has per-role defaults (guest / authenticated / member / admin)
//   - Per-user overrides stored in `user_feature_overrides` table
//   - Flags are cached in memory (refreshed on sign-in and every 5 min)
//   - isFeatureEnabled(key) is the single public API for feature checks
//
// SQL schema (run once in Supabase):
//   CREATE TABLE feature_flags (
//     feature_key           TEXT PRIMARY KEY,
//     display_name          TEXT NOT NULL,
//     description           TEXT,
//     enabled_globally      BOOLEAN DEFAULT false,
//     enabled_for_guest     BOOLEAN DEFAULT false,
//     enabled_for_authenticated BOOLEAN DEFAULT false,
//     enabled_for_member    BOOLEAN DEFAULT true,
//     enabled_for_admin     BOOLEAN DEFAULT true,
//     updated_at            TIMESTAMPTZ DEFAULT NOW()
//   );
//   CREATE TABLE user_feature_overrides (
//     user_id     UUID REFERENCES users(id) ON DELETE CASCADE,
//     feature_key TEXT NOT NULL,
//     enabled     BOOLEAN NOT NULL,
//     PRIMARY KEY (user_id, feature_key)
//   );

// ── Feature definitions ──────────────────────────────────────────────────────
// These serve as fallback defaults if the DB table doesn't exist yet.
const FEATURE_DEFINITIONS = [
  {
    feature_key: 'condition_grader',
    display_name: 'AI Condition Grader',
    description: 'Estimate PSA/BGS card grade using Claude Vision before submitting for grading',
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
    description: 'Analyzes your collection and shows which sets you\'re close to completing with shopping lists',
    icon: '🎯',
    enabled_globally: false,
    enabled_for_guest: false,
    enabled_for_authenticated: true,
    enabled_for_member: true,
    enabled_for_admin: true
  },
  {
    feature_key: 'ebay_lister',
    display_name: 'One-Tap eBay Lister',
    description: 'AI writes eBay listing title, description, and suggests pricing — one tap to open draft',
    icon: '🛒',
    enabled_globally: false,
    enabled_for_guest: false,
    enabled_for_authenticated: false,
    enabled_for_member: true,
    enabled_for_admin: true
  },
  {
    feature_key: 'portfolio_tracker',
    display_name: 'Portfolio Time Machine',
    description: 'Track your collection value over time with price history charts',
    icon: '📈',
    enabled_globally: false,
    enabled_for_guest: false,
    enabled_for_authenticated: false,
    enabled_for_member: true,
    enabled_for_admin: true
  },
  {
    feature_key: 'trade_advisor',
    display_name: 'Smart Trade Advisor',
    description: 'Claude analyzes market trends and tells you which cards to sell, hold, or trade',
    icon: '🧠',
    enabled_globally: false,
    enabled_for_guest: false,
    enabled_for_authenticated: false,
    enabled_for_member: true,
    enabled_for_admin: true
  }
];

// ── In-memory cache ───────────────────────────────────────────────────────────
let _flagCache = null;           // Map<feature_key, flag object from DB>
let _overrideCache = null;       // Map<feature_key, boolean> for current user
let _cacheLoadedAt = 0;
const FLAG_CACHE_TTL = 5 * 60 * 1000; // 5 minutes

// ── Load flags from Supabase ──────────────────────────────────────────────────
async function loadFeatureFlags() {
  if (!window.supabaseClient) return;

  try {
    const { data: flags, error: flagErr } = await window.supabaseClient
      .from('feature_flags')
      .select('*');

    if (flagErr) {
      // Table may not exist yet — use hardcoded defaults silently
      _flagCache = new Map(FEATURE_DEFINITIONS.map(f => [f.feature_key, f]));
    } else {
      // Merge DB flags with local definitions (DB wins for role toggles)
      _flagCache = new Map();
      for (const def of FEATURE_DEFINITIONS) {
        const dbFlag = (flags || []).find(f => f.feature_key === def.feature_key);
        _flagCache.set(def.feature_key, dbFlag ? { ...def, ...dbFlag } : { ...def });
      }
      // Also include any DB-only flags not in FEATURE_DEFINITIONS
      for (const dbFlag of (flags || [])) {
        if (!_flagCache.has(dbFlag.feature_key)) {
          _flagCache.set(dbFlag.feature_key, dbFlag);
        }
      }
    }

    // Load per-user overrides if signed in
    if (currentUser && !isGuestMode()) {
      const { data: overrides } = await window.supabaseClient
        .from('user_feature_overrides')
        .select('feature_key, enabled')
        .eq('user_id', currentUser.id);

      _overrideCache = new Map((overrides || []).map(o => [o.feature_key, o.enabled]));
    } else {
      _overrideCache = new Map();
    }

    _cacheLoadedAt = Date.now();
    console.log('✅ Feature flags loaded:', _flagCache.size, 'flags');

  } catch (err) {
    console.warn('Feature flags load error (using defaults):', err.message);
    _flagCache = new Map(FEATURE_DEFINITIONS.map(f => [f.feature_key, f]));
    _overrideCache = new Map();
    _cacheLoadedAt = Date.now();
  }
}

// Refresh if cache is stale
async function ensureFlagsCurrent() {
  if (!_flagCache || Date.now() - _cacheLoadedAt > FLAG_CACHE_TTL) {
    await loadFeatureFlags();
  }
}

// ── Public API ────────────────────────────────────────────────────────────────

// isFeatureEnabled(key) — synchronous check using cached data.
// Call loadFeatureFlags() early in app init so cache is warm.
function isFeatureEnabled(featureKey) {
  if (!_flagCache) {
    // Cache not loaded yet — fall back to FEATURE_DEFINITIONS defaults
    const def = FEATURE_DEFINITIONS.find(f => f.feature_key === featureKey);
    if (!def) return false;
    return _roleCheck(def);
  }

  // Per-user override takes highest priority
  if (_overrideCache && _overrideCache.has(featureKey)) {
    return _overrideCache.get(featureKey);
  }

  const flag = _flagCache.get(featureKey);
  if (!flag) return false;

  return _roleCheck(flag);
}

function _roleCheck(flag) {
  if (flag.enabled_globally) return true;
  if (isAdmin())    return flag.enabled_for_admin    !== false;
  if (currentUser?.is_member) return flag.enabled_for_member !== false;
  if (!isGuestMode()) return flag.enabled_for_authenticated !== false;
  return flag.enabled_for_guest === true;
}

// Returns all feature definitions (for admin UI)
function getAllFeatureFlags() {
  if (!_flagCache) return [...FEATURE_DEFINITIONS];
  return [..._flagCache.values()];
}

// ── Admin: save flag changes ───────────────────────────────────────────────────
async function saveFeatureFlag(featureKey, updates) {
  if (!isAdmin() || !window.supabaseClient) return false;
  try {
    const { error } = await window.supabaseClient
      .from('feature_flags')
      .upsert({ feature_key: featureKey, ...updates, updated_at: new Date().toISOString() }, { onConflict: 'feature_key' });
    if (error) throw error;
    // Invalidate cache so next check picks up changes
    _flagCache = null;
    await loadFeatureFlags();
    return true;
  } catch (err) {
    console.error('saveFeatureFlag error:', err);
    return false;
  }
}

// Admin: set per-user override
async function setUserFeatureOverride(userId, featureKey, enabled) {
  if (!isAdmin() || !window.supabaseClient) return false;
  try {
    if (enabled === null) {
      // null = remove override (revert to role-based default)
      await window.supabaseClient
        .from('user_feature_overrides')
        .delete()
        .eq('user_id', userId)
        .eq('feature_key', featureKey);
    } else {
      await window.supabaseClient
        .from('user_feature_overrides')
        .upsert({ user_id: userId, feature_key: featureKey, enabled }, { onConflict: 'user_id,feature_key' });
    }
    return true;
  } catch (err) {
    console.error('setUserFeatureOverride error:', err);
    return false;
  }
}

// Admin: fetch overrides for all users (for the admin Features tab)
async function fetchAllUserOverrides() {
  if (!window.supabaseClient) return [];
  try {
    const { data, error } = await window.supabaseClient
      .from('user_feature_overrides')
      .select('user_id, feature_key, enabled');
    if (error) throw error;
    return data || [];
  } catch {
    return [];
  }
}

console.log('✅ Feature flags module loaded');
