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

import { escapeHtml } from '../../ui/utils.js';
import { currentUser, isGuestMode, isAdmin } from '../auth/user-management.js';
import { getCollections, getCurrentCollectionId, setCurrentCollectionId } from '../collection/collections.js';

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
  }
];

// ── In-memory cache ───────────────────────────────────────────────────────────
let _flagCache = null;           // Map<feature_key, flag object from DB>
let _overrideCache = null;       // Map<feature_key, boolean> for current user
let _cacheLoadedAt = 0;
const FLAG_CACHE_TTL = 5 * 60 * 1000; // 5 minutes

// ── Load flags from Supabase ──────────────────────────────────────────────────
export async function loadFeatureFlags() {
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
export async function ensureFlagsCurrent() {
  if (!_flagCache || Date.now() - _cacheLoadedAt > FLAG_CACHE_TTL) {
    await loadFeatureFlags();
  }
}

// ── Public API ────────────────────────────────────────────────────────────────

// isFeatureEnabled(key) — synchronous check using cached data.
// Call loadFeatureFlags() early in app init so cache is warm.
export function isFeatureEnabled(featureKey) {
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
export function getAllFeatureFlags() {
  if (!_flagCache) return [...FEATURE_DEFINITIONS];
  return [..._flagCache.values()];
}

// ── Admin: save flag changes ───────────────────────────────────────────────────
export async function saveFeatureFlag(featureKey, updates) {
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
export async function setUserFeatureOverride(userId, featureKey, enabled) {
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
export async function fetchAllUserOverrides() {
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

// ── Card picker modal ─────────────────────────────────────────────────────────
// Shared UI used by Grade and eBay Lister when no specific card is pre-selected.
// Shows cards from all collections so the user can pick one.

export function showCardPickerModal(title, subtitle, onPick) {
  document.getElementById('cardPickerModal')?.remove();

  const collections = getCollections();
  // Gather all cards across collections, most recently scanned first
  const allCards = [];
  for (const col of collections) {
    for (let i = 0; i < col.cards.length; i++) {
      allCards.push({ card: col.cards[i], colId: col.id, colName: col.name, localIndex: i });
    }
  }
  allCards.sort((a, b) => new Date(b.card.timestamp || 0) - new Date(a.card.timestamp || 0));

  const wrapper = document.createElement('div');
  wrapper.innerHTML = `
    <div class="modal active" id="cardPickerModal">
      <div class="modal-backdrop"></div>
      <div class="modal-content" style="max-width:480px;">
        <div class="modal-header">
          <div>
            <h2>${escapeHtml(title)}</h2>
            <div style="font-size:13px;color:#6b7280;margin-top:2px;">${escapeHtml(subtitle)}</div>
          </div>
          <button class="modal-close" id="cardPickerClose">×</button>
        </div>
        <div class="modal-body" style="padding:12px;max-height:60vh;overflow-y:auto;">
          ${allCards.length === 0
            ? `<p style="text-align:center;color:#9ca3af;padding:24px;">No cards in your collection yet — scan some cards first!</p>`
            : allCards.slice(0, 50).map(({ card, colId, colName, localIndex }) => `
              <button class="card-picker-item" data-col-id="${escapeHtml(colId)}" data-local-index="${localIndex}"
                style="display:flex;align-items:center;gap:10px;width:100%;background:#f9fafb;border:1px solid #e5e7eb;border-radius:10px;padding:10px 12px;margin-bottom:8px;cursor:pointer;text-align:left;">
                ${card.imageUrl && !card.imageUrl.startsWith('blob:')
                  ? `<img src="${escapeHtml(card.imageUrl)}" alt="" style="width:44px;height:60px;object-fit:cover;border-radius:6px;flex-shrink:0;" onerror="this.style.display='none'">`
                  : `<div style="width:44px;height:60px;background:#e5e7eb;border-radius:6px;flex-shrink:0;display:flex;align-items:center;justify-content:center;font-size:20px;">🃏</div>`}
                <div style="flex:1;min-width:0;">
                  <div style="font-weight:700;font-size:14px;color:#111827;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">${escapeHtml(card.hero || 'Unknown Card')}</div>
                  ${card.athlete ? `<div style="font-size:12px;color:#6b7280;">${escapeHtml(card.athlete)}</div>` : ''}
                  <div style="font-size:12px;color:#9ca3af;">${escapeHtml(card.cardNumber || '')}${card.set ? ' · ' + escapeHtml(card.set) : ''}</div>
                  <div style="font-size:11px;color:#d1d5db;margin-top:2px;">${escapeHtml(colName || colId)}</div>
                </div>
                ${card.condition ? `<div style="font-size:11px;background:#eff6ff;color:#1d4ed8;padding:2px 7px;border-radius:4px;flex-shrink:0;">${escapeHtml(card.condition)}</div>` : ''}
              </button>`).join('')
          }
          ${allCards.length > 50 ? `<p style="text-align:center;font-size:12px;color:#9ca3af;padding:8px 0;">Showing 50 most recent cards</p>` : ''}
        </div>
        <div class="modal-footer">
          <button class="btn-secondary" id="cardPickerCloseBtn">Cancel</button>
        </div>
      </div>
    </div>
  `;

  document.body.appendChild(wrapper.firstElementChild);

  const closeModal = () => document.getElementById('cardPickerModal')?.remove();
  document.getElementById('cardPickerClose')?.addEventListener('click', closeModal);
  document.getElementById('cardPickerCloseBtn')?.addEventListener('click', closeModal);
  document.querySelector('#cardPickerModal .modal-backdrop')?.addEventListener('click', closeModal);

  // When user picks a card, switch to that collection context then call onPick
  document.querySelectorAll('#cardPickerModal .card-picker-item').forEach(btn => {
    btn.addEventListener('click', async () => {
      const colId      = btn.dataset.colId;
      const localIndex = parseInt(btn.dataset.localIndex, 10);

      // Switch active collection if needed
      if (colId !== getCurrentCollectionId()) {
        setCurrentCollectionId(colId);
      }

      closeModal();
      await onPick(localIndex);
    });
  });
}

// ── Card grid "⋯ More" menu ───────────────────────────────────────────────────
// Shows an action sheet with eBay search + grade/list options (when enabled)

export function toggleCardMoreMenu(index, btn) {
  // Close any already-open menus
  document.querySelectorAll('.card-more-menu').forEach(m => m.remove());

  const menu = document.createElement('div');
  menu.className = 'card-more-menu';
  menu.style.cssText = 'position:absolute;right:0;bottom:100%;background:#fff;border:1px solid #e5e7eb;border-radius:10px;box-shadow:0 4px 12px rgba(0,0,0,.15);min-width:160px;z-index:100;overflow:hidden;';

  const items = [
    { icon: '🛒', label: 'Search eBay',  fn: () => { if (typeof window.openEbaySearch === 'function') window.openEbaySearch(index); } },
  ];

  if (typeof isFeatureEnabled === 'function') {
    if (isFeatureEnabled('condition_grader')) {
      items.push({ icon: '🔬', label: 'Grade Card',    fn: () => { if (typeof window.gradeCardFromDetail === 'function') window.gradeCardFromDetail(index); } });
    }
    if (isFeatureEnabled('ebay_lister')) {
      items.push({ icon: '🏷️', label: 'List on eBay',  fn: () => { if (typeof window.ebayListFromDetail === 'function') window.ebayListFromDetail(index); } });
    }
  }

  menu.innerHTML = items.map((item, i) => `
    <button data-menu-index="${i}" style="display:flex;align-items:center;gap:8px;width:100%;padding:11px 14px;border:none;background:none;cursor:pointer;font-size:13px;font-weight:500;color:#111827;text-align:left;border-top:${i > 0 ? '1px solid #f3f4f6' : 'none'};">
      <span>${item.icon}</span> ${escapeHtml(item.label)}
    </button>`).join('');

  // Position relative to button's parent card-footer
  const footer = btn.closest('.card-footer') || btn.parentElement;
  footer.style.position = 'relative';
  footer.appendChild(menu);

  // Wire button clicks
  menu.querySelectorAll('button').forEach(b => {
    b.addEventListener('click', (e) => {
      e.stopPropagation();
      const fn = items[parseInt(b.dataset.menuIndex)].fn;
      menu.remove();
      fn();
    });
  });

  // Close on outside click
  const closeMenu = (e) => {
    if (!menu.contains(e.target) && e.target !== btn) {
      menu.remove();
      document.removeEventListener('click', closeMenu, true);
    }
  };
  setTimeout(() => document.addEventListener('click', closeMenu, true), 0);
}

// ── Expose to lazy-loaded modules (they run in separate module scope) ─────────
window.isFeatureEnabled    = isFeatureEnabled;
window.showCardPickerModal = showCardPickerModal;
window.toggleCardMoreMenu  = toggleCardMoreMenu;

console.log('✅ Feature flags module loaded');
