// ============================================================
// js/user-management.js — FIXED
// Changes:
//   - Supabase URL and key now loaded from appConfig (not hardcoded here)
//   - Supabase client initialized AFTER config is loaded
//   - isAdmin() client-side check kept for UI gating, but admin DB actions
//     are protected by Supabase RLS policies (see comments below)
//   - trackCardAdded() and canAddCard() use getCollections() (not bare var)
//   - updateLimitsUI() uses getCollections() (not bare var)
// ============================================================

let currentUser = null;
let userLimits  = null;

// Default limits — overwritten at runtime by loadSystemSettings() if a
// system_settings table exists in Supabase.  Hardcoded values serve as
// fallbacks when the DB is unreachable or the table hasn't been created yet.
const DEFAULT_LIMITS = {
  guest:         { maxCards: 5,  maxApiCalls: 1   },
  authenticated: { maxCards: 25, maxApiCalls: 50  },
  member:        { maxCards: 250, maxApiCalls: 250 }
};

// ── System-settings loader ─────────────────────────────────────────────────
// Fetches key/value pairs from the `system_settings` Supabase table and
// overwrites DEFAULT_LIMITS in place so every downstream reference picks up
// the admin-configured values automatically.
async function loadSystemSettings() {
  if (!window.supabaseClient) return;
  try {
    const { data, error } = await window.supabaseClient
      .from('system_settings')
      .select('key, value');
    if (error) throw error;
    if (!data || data.length === 0) return;

    const map = {};
    for (const row of data) map[row.key] = row.value;

    // Overwrite defaults — parse as int, keep existing if missing/NaN.
    // Use isNaN check instead of || to support intentional zero values
    // (e.g., admin sets guest_max_api=0 to disable a tier).
    const safeInt = (str, fallback) => { const v = parseInt(str); return isNaN(v) ? fallback : v; };
    if (map.guest_max_cards)    DEFAULT_LIMITS.guest.maxCards          = safeInt(map.guest_max_cards,  DEFAULT_LIMITS.guest.maxCards);
    if (map.guest_max_api)      DEFAULT_LIMITS.guest.maxApiCalls       = safeInt(map.guest_max_api,    DEFAULT_LIMITS.guest.maxApiCalls);
    if (map.auth_max_cards)     DEFAULT_LIMITS.authenticated.maxCards   = safeInt(map.auth_max_cards,   DEFAULT_LIMITS.authenticated.maxCards);
    if (map.auth_max_api)       DEFAULT_LIMITS.authenticated.maxApiCalls = safeInt(map.auth_max_api,   DEFAULT_LIMITS.authenticated.maxApiCalls);
    if (map.member_max_cards)   DEFAULT_LIMITS.member.maxCards          = safeInt(map.member_max_cards, DEFAULT_LIMITS.member.maxCards);
    if (map.member_max_api)     DEFAULT_LIMITS.member.maxApiCalls       = safeInt(map.member_max_api,  DEFAULT_LIMITS.member.maxApiCalls);

    console.log('✅ System settings loaded from DB:', DEFAULT_LIMITS);
  } catch (err) {
    // Table may not exist yet — that's fine, hardcoded defaults are used
    console.warn('System settings not available (using defaults):', err.message);
  }
}

// ── Initialization ────────────────────────────────────────────────────────────
// FIXED: Supabase credentials come from appConfig, not hardcoded strings.
// appConfig is populated by loadAppConfig() in state.js before init() runs.
async function initUserManagement() {
  if (typeof window.supabase === 'undefined') {
    console.warn('⚠️ Supabase library not loaded');
    return;
  }

  if (!appConfig.supabaseUrl || !appConfig.supabaseKey) {
    console.warn('⚠️ Supabase config not available — running in local-only mode');
    return;
  }

  try {
    window.supabaseClient = window.supabase.createClient(
      appConfig.supabaseUrl,
      appConfig.supabaseKey
    );
    console.log('✅ Supabase client initialized');

    // Load admin-configured limits from system_settings table (non-blocking)
    await loadSystemSettings();
  } catch (err) {
    console.error('❌ Supabase init failed:', err);
  }
}

// ── User sign-in ──────────────────────────────────────────────────────────────
async function handleUserSignIn(googleUser) {
  if (!window.supabaseClient) {
    // No DB — apply default authenticated limits locally
    userLimits = {
      maxCards:          DEFAULT_LIMITS.authenticated.maxCards,
      maxApiCalls:       DEFAULT_LIMITS.authenticated.maxApiCalls,
      apiCallsUsed:      0,
      cardsInCollection: 0
    };
    updateLimitsUI();
    return null;
  }

  try {
    const { data: existing, error: fetchError } = await window.supabaseClient
      .from('users')
      .select('*')
      .eq('google_id', googleUser.id)
      .single();

    // On mobile, Supabase may return network errors — treat them as soft failures
    // so the user stays logged in with defaults rather than getting signed out.
    if (fetchError && fetchError.code !== 'PGRST116') {
      if (fetchError.message?.includes('fetch') || fetchError.message?.includes('network') || fetchError.status === 0) {
        console.warn('Supabase unreachable, using defaults:', fetchError.message);
        userLimits = {
          maxCards:     DEFAULT_LIMITS.authenticated.maxCards,
          maxApiCalls:  DEFAULT_LIMITS.authenticated.maxApiCalls,
          apiCallsUsed: 0,
          cardsInCollection: 0
        };
        updateLimitsUI();
        return null;
      }
      throw fetchError;
    }

    if (existing) {
      currentUser = existing;
      window.currentUser = currentUser; // expose for image-storage.js
      await checkMembershipExpiry();
      await checkAndResetMonthlyLimits();
    } else {
      const { data: newUser, error: createError } = await window.supabaseClient
        .from('users')
        .insert({
          google_id:          googleUser.id,
          email:              googleUser.email,
          name:               googleUser.name,
          picture:            googleUser.picture,
          card_limit:         DEFAULT_LIMITS.authenticated.maxCards,
          api_calls_limit:    DEFAULT_LIMITS.authenticated.maxApiCalls,
          api_calls_used:     0,
          cards_in_collection: 0,
          is_admin:           false
        })
        .select()
        .single();

      if (createError) throw createError;
      currentUser = newUser;
      window.currentUser = currentUser; // expose for image-storage.js
      console.log('✅ New user created:', currentUser.email);
    }

    await loadUserLimits();
    updateLimitsUI();

    // Apply the user's saved theme (non-blocking)
    if (typeof window.loadUserTheme === 'function') {
      window.loadUserTheme().catch(e => console.warn('Theme load error:', e));
    }

    if (isAdmin()) {
      console.log('👑 Admin user detected');
      showAdminButton();
    }

    // Show tournament tools for users with can_invite role or admins
    if (currentUser?.can_invite || currentUser?.is_admin) {
      const tournamentRow = document.getElementById('tournamentToolsRow');
      if (tournamentRow) tournamentRow.style.display = '';
      // Also show admin section in More sheet
      const moreAdminSection = document.getElementById('moreAdminSection');
      if (moreAdminSection) moreAdminSection.style.display = '';
    }

    // Trigger sync now that currentUser is set
    // (setupAutoSync in app.js runs too early, before sign-in completes)
    if (typeof setupAutoSync === 'function') {
      setupAutoSync();
    }

    return currentUser;

  } catch (err) {
    console.error('User sign-in error:', err);
    // Graceful fallback — still upgrade from guest limits
    userLimits = {
      maxCards:          DEFAULT_LIMITS.authenticated.maxCards,
      maxApiCalls:       DEFAULT_LIMITS.authenticated.maxApiCalls,
      apiCallsUsed:      0,
      cardsInCollection: 0
    };
    updateLimitsUI();
    return null;
  }
}

// ── Membership expiry — runs at every sign-in ─────────────────────────────────
// If the user was a member but their date has passed, auto-revoke and revert limits.
async function checkMembershipExpiry() {
  if (!currentUser?.is_member || !currentUser?.member_until) return;

  const now    = new Date();
  const expiry = new Date(currentUser.member_until);
  if (expiry > now) return; // still active, nothing to do

  console.log('📅 Membership expired for', currentUser.email, '— revoking automatically');

  const { error } = await window.supabaseClient
    .from('users')
    .update({
      is_member:      false,
      member_until:   null,
      card_limit:     DEFAULT_LIMITS.authenticated.maxCards,
      api_calls_limit: DEFAULT_LIMITS.authenticated.maxApiCalls
    })
    .eq('id', currentUser.id);

  if (!error) {
    currentUser.is_member      = false;
    currentUser.member_until   = null;
    currentUser.card_limit     = DEFAULT_LIMITS.authenticated.maxCards;
    currentUser.api_calls_limit = DEFAULT_LIMITS.authenticated.maxApiCalls;
    console.log('✅ Membership revoked, limits reset to defaults');
  } else {
    console.error('Failed to revoke membership:', error);
  }
}

async function checkAndResetMonthlyLimits() {
  if (!currentUser?.last_reset_date) return;

  const today     = new Date();
  const lastReset = new Date(currentUser.last_reset_date);

  if (today.getMonth() !== lastReset.getMonth() ||
      today.getFullYear() !== lastReset.getFullYear()) {

    const { error } = await window.supabaseClient
      .from('users')
      .update({ api_calls_used: 0, last_reset_date: today.toISOString().split('T')[0] })
      .eq('id', currentUser.id);

    if (!error) {
      currentUser.api_calls_used = 0;
      showToast('Monthly limits reset!', '🔄');
    }
  }
}

async function loadUserLimits() {
  if (isGuestMode()) {
    userLimits = {
      maxCards:          DEFAULT_LIMITS.guest.maxCards,
      maxApiCalls:       DEFAULT_LIMITS.guest.maxApiCalls,
      apiCallsUsed:      parseInt(localStorage.getItem('guest_api_calls') || '0'),
      cardsInCollection: 0
    };
  } else {
    userLimits = {
      maxCards:          currentUser.card_limit          || DEFAULT_LIMITS.authenticated.maxCards,
      maxApiCalls:       currentUser.api_calls_limit     || DEFAULT_LIMITS.authenticated.maxApiCalls,
      apiCallsUsed:      currentUser.api_calls_used      || 0,
      cardsInCollection: currentUser.cards_in_collection || 0
    };
  }
}

// ── Helpers ───────────────────────────────────────────────────────────────────
function isGuestMode() { return !currentUser; }

// IMPORTANT: isAdmin() is a UI convenience check only.
// All privileged Supabase operations (updating is_admin, card_limit, etc.)
// MUST be protected by Row Level Security policies in Supabase:
//
//   -- Allow admins to update any user row
//   CREATE POLICY "Admins can update users" ON users
//   FOR UPDATE USING (
//     EXISTS (SELECT 1 FROM users WHERE id = auth.uid() AND is_admin = true)
//   );
//
//   -- Only admins can read all users (others see only themselves)
//   CREATE POLICY "Admins read all, users read self" ON users
//   FOR SELECT USING (id = auth.uid() OR EXISTS (
//     SELECT 1 FROM users WHERE id = auth.uid() AND is_admin = true
//   ));
function isAdmin() {
  return currentUser?.is_admin === true;
}

function showAdminButton() {
  if (document.getElementById('adminBtn')) return;

  const container = document.getElementById('userAuthenticated');
  if (!container) return;

  const btn = document.createElement('button');
  btn.id = 'adminBtn';
  btn.textContent = '👑 Admin';
  btn.style.cssText = `
    background: linear-gradient(135deg, #7c3aed, #4f46e5);
    color: white; border: none; border-radius: 8px;
    padding: 8px 16px; font-weight: 600;
    cursor: pointer; font-size: 14px; margin-left: 8px;
  `;
  btn.addEventListener('click', () => window.openAdminDashboard?.());
  container.appendChild(btn);
}

// ── Limit checks ──────────────────────────────────────────────────────────────
async function canAddCard() {
  // Tournament mode bypasses card limits entirely
  if (window._activeTournament) return true;

  // FIXED: Use getCollections() — bare `collections` was undefined
  const total = getCollections().reduce((sum, c) => sum + c.cards.length, 0);
  const limit = isGuestMode()
    ? DEFAULT_LIMITS.guest.maxCards
    : (userLimits?.maxCards || DEFAULT_LIMITS.authenticated.maxCards);

  if (total >= limit) {
    showLimitReachedModal('cards', total, limit);
    return false;
  }
  return true;
}

async function canMakeApiCall() {
  // Tournament mode bypasses API call limits entirely
  if (window._activeTournament) return true;

  if (isGuestMode()) {
    const used = parseInt(localStorage.getItem('guest_api_calls') || '0');
    if (used >= DEFAULT_LIMITS.guest.maxApiCalls) {
      showLimitReachedModal('api', used, DEFAULT_LIMITS.guest.maxApiCalls);
      return false;
    }
    return true;
  }

  const used  = userLimits?.apiCallsUsed || 0;
  const limit = userLimits?.maxApiCalls  || DEFAULT_LIMITS.authenticated.maxApiCalls;

  if (used >= limit) {
    showLimitReachedModal('api', used, limit);
    return false;
  }
  return true;
}

async function trackCardAdded() {
  // Tournament mode — don't count against user's card quota
  if (window._activeTournament) return;

  if (isGuestMode() || !window.supabaseClient) {
    updateLimitsUI();
    return;
  }

  // FIXED: Use getCollections() not bare `collections`
  const total = getCollections().reduce((sum, c) => sum + c.cards.length, 0);

  const { error } = await window.supabaseClient
    .from('users')
    .update({ cards_in_collection: total })
    .eq('id', currentUser.id);

  if (!error) {
    currentUser.cards_in_collection = total;
    if (userLimits) userLimits.cardsInCollection = total;
  }

  updateLimitsUI();
}

async function trackApiCall(callType, success, cost = 0, cardsProcessed = 1) {
  // Tournament mode — don't count against user's API quota
  if (window._activeTournament) return;

  if (isGuestMode()) {
    const current = parseInt(localStorage.getItem('guest_api_calls') || '0');
    localStorage.setItem('guest_api_calls', String(current + 1));
    updateLimitsUI();
    return;
  }

  if (!window.supabaseClient) return;

  await window.supabaseClient
    .from('api_call_logs')
    .insert({ user_id: currentUser.id, call_type: callType, success, cost, cards_processed: cardsProcessed });

  const newCount = (currentUser.api_calls_used || 0) + cardsProcessed;
  const { error } = await window.supabaseClient
    .from('users')
    .update({ api_calls_used: newCount })
    .eq('id', currentUser.id);

  if (!error) {
    currentUser.api_calls_used = newCount;
    if (userLimits) userLimits.apiCallsUsed = newCount;
  }

  updateLimitsUI();
}

// ── UI ─────────────────────────────────────────────────────────────────────────
function updateLimitsUI() {
  // FIXED: Use getCollections() not bare `collections`
  const allCollections = (typeof getCollections === 'function') ? getCollections() : [];
  const totalCards     = allCollections.reduce((sum, c) => sum + c.cards.length, 0);
  const guest          = isGuestMode();

  const cardLimit = guest
    ? DEFAULT_LIMITS.guest.maxCards
    : (userLimits?.maxCards || DEFAULT_LIMITS.authenticated.maxCards);

  const aiLimit = guest
    ? DEFAULT_LIMITS.guest.maxApiCalls
    : (userLimits?.maxApiCalls || DEFAULT_LIMITS.authenticated.maxApiCalls);

  const aiUsed = guest
    ? parseInt(localStorage.getItem('guest_api_calls') || '0')
    : (userLimits?.apiCallsUsed || 0);

  const statCards      = document.getElementById('statCards');
  const statCardsLabel = document.getElementById('statCardsLabel');
  const statAI         = document.getElementById('statAI');
  const statAILabel    = document.getElementById('statAILabel');

  if (statCards)      statCards.textContent      = `${totalCards} / ${cardLimit}`;
  if (statCardsLabel) statCardsLabel.textContent  = guest ? 'Guest limit' : 'Your limit';
  if (statAI)         statAI.textContent          = `${aiUsed} / ${aiLimit}`;
  if (statAILabel)    statAILabel.textContent      = guest ? 'Guest limit' : `${aiLimit - aiUsed} remaining`;
}

// ── Modals ─────────────────────────────────────────────────────────────────────
function showLimitReachedModal(type, current, max) {
  // FIXED: Guard against duplicate insertion
  if (document.getElementById('limitModal')) return;

  const messages = {
    cards: {
      title:   '🎴 Card Limit Reached',
      message: `You've reached your card limit (${current}/${max}).`,
      guest:   'Sign in with Google to increase your limit to 25 cards!',
      auth:    'Contact admin for a limit increase.'
    },
    api: {
      title:   '🤖 AI Limit Reached',
      message: `You've used all your AI lookups (${current}/${max}).`,
      guest:   'Sign in with Google to get 50 AI lookups per month!',
      auth:    'Your AI lookups reset on the 1st of next month.'
    }
  };

  const msg   = messages[type] || messages.api;
  const guest = isGuestMode();

  const wrapper = document.createElement('div');
  wrapper.innerHTML = `
    <div class="modal active" id="limitModal">
      <div class="modal-backdrop"></div>
      <div class="modal-content">
        <div class="modal-header">
          <h2>${msg.title}</h2>
          <button class="modal-close" id="limitModalClose">×</button>
        </div>
        <div class="modal-body">
          <p><strong>${msg.message}</strong></p>
          <p>${guest ? msg.guest : msg.auth}</p>
        </div>
        <div class="modal-footer">
          ${guest ? `<button class="btn-primary" id="limitSignInBtn">Sign In with Google</button>` : ''}
          <button class="btn-secondary" id="limitCloseBtn">${guest ? 'Stay as Guest' : 'OK'}</button>
        </div>
      </div>
    </div>
  `;

  document.body.appendChild(wrapper.firstElementChild);

  const modal = document.getElementById('limitModal');
  document.getElementById('limitModalClose')?.addEventListener('click', closeLimitModal);
  document.getElementById('limitCloseBtn')?.addEventListener('click', closeLimitModal);
  modal.querySelector('.modal-backdrop')?.addEventListener('click', closeLimitModal);

  const signInBtn = document.getElementById('limitSignInBtn');
  if (signInBtn) {
    signInBtn.addEventListener('click', () => {
      closeLimitModal();
      if (typeof google !== 'undefined' && google.accounts) {
        google.accounts.id.prompt();
      }
    });
  }
}

function closeLimitModal() {
  document.getElementById('limitModal')?.remove();
}

async function openUserProfile() {
  if (isGuestMode()) {
    showToast('Please sign in to view profile', '⚠️');
    return;
  }

  // FIXED: Guard against duplicate insertion
  if (document.getElementById('profileModal')) return;

  const totalCards = getCollections().reduce((sum, c) => sum + c.cards.length, 0);

  const modal = document.createElement('div');
  modal.innerHTML = `
    <div class="modal active" id="profileModal">
      <div class="modal-backdrop"></div>
      <div class="modal-content">
        <div class="modal-header">
          <h2>👤 User Profile</h2>
          <button class="modal-close" id="profileClose">×</button>
        </div>
        <div class="modal-body">
          <div style="display:flex;align-items:center;gap:16px;margin-bottom:24px;">
            <img src="${escapeHtml(currentUser.picture || '')}" alt="Profile"
                 style="width:64px;height:64px;border-radius:50%;">
            <div>
              <strong style="display:block;font-size:18px;">${escapeHtml(currentUser.name || '')}</strong>
              <span style="color:#666;">${escapeHtml(currentUser.email || '')}</span>
              ${currentUser.is_admin ? '<span style="background:#7c3aed;color:white;padding:2px 8px;border-radius:4px;font-size:12px;margin-left:8px;">Admin</span>' : ''}
            </div>
          </div>
          <div class="setting-group">
            <h3>Usage</h3>
            <p>Cards: ${totalCards} / ${userLimits?.maxCards || 25}</p>
            <p>AI Lookups this month: ${userLimits?.apiCallsUsed || 0} / ${userLimits?.maxApiCalls || 50}</p>
            <small style="color:#888;">Limits reset on the 1st of each month</small>
          </div>
          <div class="setting-group" style="margin-top:16px;">
            <h3>Discord ID</h3>
            <input type="text" id="discordIdInput"
                   value="${escapeHtml(currentUser.discord_id || '')}"
                   placeholder="username#1234"
                   style="width:100%;padding:10px;border:1px solid #ddd;border-radius:8px;font-size:16px;">
            <button class="btn-secondary" id="saveDiscordBtn" style="margin-top:8px;">Save</button>
          </div>
        </div>
        <div class="modal-footer">
          <button class="btn-secondary" id="profileCloseBtn">Close</button>
        </div>
      </div>
    </div>
  `;

  document.body.appendChild(modal.firstElementChild);

  document.getElementById('profileClose')?.addEventListener('click', closeProfileModal);
  document.getElementById('profileCloseBtn')?.addEventListener('click', closeProfileModal);
  document.querySelector('#profileModal .modal-backdrop')?.addEventListener('click', closeProfileModal);
  document.getElementById('saveDiscordBtn')?.addEventListener('click', saveDiscordId);
}

async function saveDiscordId() {
  const discordId = document.getElementById('discordIdInput')?.value?.trim() || '';
  if (!window.supabaseClient) {
    showToast('Database not available', '❌');
    return;
  }
  try {
    const { error } = await window.supabaseClient
      .from('users')
      .update({ discord_id: discordId })
      .eq('id', currentUser.id);
    if (error) throw error;
    currentUser.discord_id = discordId;
    showToast('Discord ID saved!', '✅');
  } catch (err) {
    showToast('Failed to save Discord ID', '❌');
  }
}

function closeProfileModal() {
  document.getElementById('profileModal')?.remove();
}

window.isAdmin = isAdmin;

console.log('✅ User management module loaded');
