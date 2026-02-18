// User Management & Limits System

const SUPABASE_CONFIG = {
    url: 'https://rtffhhxuzkjzzvnsuroz.supabase.co',
    anonKey: 'sb_publishable_I2F2d2QxfVJuzqZxfRoF4g_tVTmxmgI'
};

let currentUser = null;
let userLimits = null;

const DEFAULT_LIMITS = {
    guest: { maxCards: 5, maxApiCalls: 1 },
    authenticated: { maxCards: 25, maxApiCalls: 50 }
};

// ==================== INITIALIZATION ====================

async function initUserManagement() {
    if (typeof window.supabase === 'undefined') {
        console.warn('⚠️ Supabase library not loaded');
        return;
    }
    try {
        window.supabaseClient = window.supabase.createClient(
            SUPABASE_CONFIG.url,
            SUPABASE_CONFIG.anonKey
        );
        console.log('✅ User management initialized');
    } catch (err) {
        console.error('❌ User management init failed:', err);
    }
}

// ==================== USER AUTHENTICATION ====================

async function handleUserSignIn(googleUser) {
    // Even if Supabase isn't available, upgrade limits immediately
    if (typeof window.supabaseClient === 'undefined') {
        console.warn('Supabase not available - applying default auth limits');
        userLimits = {
            maxCards: DEFAULT_LIMITS.authenticated.maxCards,
            maxApiCalls: DEFAULT_LIMITS.authenticated.maxApiCalls,
            apiCallsUsed: 0,
            cardsInCollection: 0
        };
        updateLimitsUI();
        return null;
    }

    try {
        const { data: existingUser, error: fetchError } = await window.supabaseClient
            .from('users')
            .select('*')
            .eq('google_id', googleUser.id)
            .single();

        if (fetchError && fetchError.code !== 'PGRST116') throw fetchError;

        if (existingUser) {
            currentUser = existingUser;
            await checkAndResetMonthlyLimits();
        } else {
            const { data: newUser, error: createError } = await window.supabaseClient
                .from('users')
                .insert({
                    google_id: googleUser.id,
                    email: googleUser.email,
                    name: googleUser.name,
                    picture: googleUser.picture,
                    card_limit: DEFAULT_LIMITS.authenticated.maxCards,
                    api_calls_limit: DEFAULT_LIMITS.authenticated.maxApiCalls,
                    api_calls_used: 0,
                    cards_in_collection: 0,
                    is_admin: false
                })
                .select()
                .single();

            if (createError) throw createError;
            currentUser = newUser;
            console.log('✅ New user created:', currentUser.email);
        }

        await loadUserLimits();
        updateLimitsUI();

        // Show admin button if admin user
        if (isAdmin()) {
            console.log('👑 Admin user detected');
            showAdminButton();
        }

        return currentUser;

    } catch (err) {
        console.error('User sign-in error:', err);
        // Fallback - still upgrade limits
        userLimits = {
            maxCards: DEFAULT_LIMITS.authenticated.maxCards,
            maxApiCalls: DEFAULT_LIMITS.authenticated.maxApiCalls,
            apiCallsUsed: 0,
            cardsInCollection: 0
        };
        updateLimitsUI();
        return null;
    }
}

async function checkAndResetMonthlyLimits() {
    if (!currentUser || !currentUser.last_reset_date) return;

    const today = new Date();
    const lastReset = new Date(currentUser.last_reset_date);

    if (today.getMonth() !== lastReset.getMonth() ||
        today.getFullYear() !== lastReset.getFullYear()) {

        const { error } = await window.supabaseClient
            .from('users')
            .update({
                api_calls_used: 0,
                last_reset_date: today.toISOString().split('T')[0]
            })
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
            maxCards: DEFAULT_LIMITS.guest.maxCards,
            maxApiCalls: DEFAULT_LIMITS.guest.maxApiCalls,
            apiCallsUsed: parseInt(localStorage.getItem('guest_api_calls') || '0'),
            cardsInCollection: 0
        };
    } else {
        userLimits = {
            maxCards: currentUser.card_limit || DEFAULT_LIMITS.authenticated.maxCards,
            maxApiCalls: currentUser.api_calls_limit || DEFAULT_LIMITS.authenticated.maxApiCalls,
            apiCallsUsed: currentUser.api_calls_used || 0,
            cardsInCollection: currentUser.cards_in_collection || 0
        };
    }
}

function isGuestMode() {
    return !currentUser;
}

function isAdmin() {
    return currentUser && currentUser.is_admin === true;
}

// Show admin button dynamically in header
function showAdminButton() {
    if (document.getElementById('adminBtn')) return;

    const userAuthenticated = document.getElementById('userAuthenticated');
    if (userAuthenticated) {
        const adminBtn = document.createElement('button');
        adminBtn.id = 'adminBtn';
        adminBtn.textContent = '👑 Admin';
        adminBtn.onclick = openAdminDashboard;
        adminBtn.style.cssText = `
            background: linear-gradient(135deg, #7c3aed, #4f46e5);
            color: white;
            border: none;
            border-radius: 8px;
            padding: 8px 16px;
            font-weight: 600;
            cursor: pointer;
            font-size: 14px;
            margin-left: 8px;
        `;
        userAuthenticated.appendChild(adminBtn);
    }
}

// ==================== LIMIT CHECKS ====================

async function canAddCard() {
    const allCollections = typeof getCollections === 'function' ? getCollections() : [];
    const totalCards = allCollections.reduce((sum, c) => sum + c.cards.length, 0);
    const limit = isGuestMode()
        ? DEFAULT_LIMITS.guest.maxCards
        : (userLimits?.maxCards || DEFAULT_LIMITS.authenticated.maxCards);

    if (totalCards >= limit) {
        showLimitReachedModal('cards', totalCards, limit);
        return false;
    }
    return true;
}

async function canMakeApiCall() {
    if (isGuestMode()) {
        const apiCallsUsed = parseInt(localStorage.getItem('guest_api_calls') || '0');
        if (apiCallsUsed >= DEFAULT_LIMITS.guest.maxApiCalls) {
            showLimitReachedModal('api', apiCallsUsed, DEFAULT_LIMITS.guest.maxApiCalls);
            return false;
        }
        return true;
    }

    const used = userLimits?.apiCallsUsed || 0;
    const limit = userLimits?.maxApiCalls || DEFAULT_LIMITS.authenticated.maxApiCalls;

    if (used >= limit) {
        showLimitReachedModal('api', used, limit);
        return false;
    }
    return true;
}

async function trackCardAdded() {
    if (isGuestMode() || typeof window.supabaseClient === 'undefined') {
        updateLimitsUI();
        return;
    }

    const allCollections = typeof getCollections === 'function' ? getCollections() : [];
    const totalCards = allCollections.reduce((sum, c) => sum + c.cards.length, 0);

    const { error } = await window.supabaseClient
        .from('users')
        .update({ cards_in_collection: totalCards })
        .eq('id', currentUser.id);

    if (!error) {
        currentUser.cards_in_collection = totalCards;
        if (userLimits) userLimits.cardsInCollection = totalCards;
    }

    updateLimitsUI();
}

async function trackApiCall(callType, success, cost = 0, cardsProcessed = 1) {
    if (isGuestMode()) {
        const current = parseInt(localStorage.getItem('guest_api_calls') || '0');
        localStorage.setItem('guest_api_calls', (current + 1).toString());
        updateLimitsUI();
        return;
    }

    if (typeof window.supabaseClient === 'undefined') return;

    await window.supabaseClient
        .from('api_call_logs')
        .insert({
            user_id: currentUser.id,
            call_type: callType,
            success: success,
            cost: cost,
            cards_processed: cardsProcessed
        });

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

// ==================== UI UPDATES ====================

function updateLimitsUI() {
    console.log('🎨 Updating limits UI...');

    const guest = isGuestMode();

    const cardLimit = guest
        ? DEFAULT_LIMITS.guest.maxCards
        : (userLimits?.maxCards || DEFAULT_LIMITS.authenticated.maxCards);

    const aiLimit = guest
        ? DEFAULT_LIMITS.guest.maxApiCalls
        : (userLimits?.maxApiCalls || DEFAULT_LIMITS.authenticated.maxApiCalls);

    const allCollections = typeof getCollections === 'function' ? getCollections() : [];
    const totalCards = allCollections.reduce((sum, c) => sum + c.cards.length, 0);

    const aiUsed = guest
        ? parseInt(localStorage.getItem('guest_api_calls') || '0')
        : (userLimits?.apiCallsUsed || 0);

    console.log(`Limits: ${guest ? 'Guest' : 'Auth'} — Cards: ${totalCards}/${cardLimit}, AI: ${aiUsed}/${aiLimit}`);

    // Update stat cards (the 4 boxes at top of page)
    const statCards = document.getElementById('statCards');
    if (statCards) statCards.textContent = `${totalCards} / ${cardLimit}`;

    const statCardsLabel = document.getElementById('statCardsLabel');
    if (statCardsLabel) statCardsLabel.textContent = guest ? 'Guest limit' : 'Your limit';

    const statAI = document.getElementById('statAI');
    if (statAI) statAI.textContent = `${aiUsed} / ${aiLimit}`;

    const statAILabel = document.getElementById('statAILabel');
    if (statAILabel) statAILabel.textContent = guest ? 'Guest limit' : 'Remaining';

    console.log('✅ Limits UI updated');
}

// ==================== MODALS ====================

function showLimitReachedModal(type, current, max) {
    const messages = {
        cards: {
            title: '🎴 Card Limit Reached',
            message: `You've reached your card limit (${current}/${max}).`,
            guest: 'Sign in with Google to increase your limit to 25 cards!',
            auth: 'Contact admin for a limit increase.'
        },
        api: {
            title: '🤖 AI Limit Reached',
            message: `You've used all your AI lookups (${current}/${max}).`,
            guest: 'Sign in with Google to get 50 AI lookups per month!',
            auth: 'Your AI lookups reset on the 1st of next month.'
        }
    };

    const msg = messages[type];
    const guest = isGuestMode();

    const modal = `
        <div class="modal active" id="limitModal">
            <div class="modal-backdrop" onclick="closeLimitModal()"></div>
            <div class="modal-content">
                <div class="modal-header">
                    <h2>${msg.title}</h2>
                    <button class="modal-close" onclick="closeLimitModal()">×</button>
                </div>
                <div class="modal-body">
                    <p><strong>${msg.message}</strong></p>
                    <p>${guest ? msg.guest : msg.auth}</p>
                </div>
                <div class="modal-footer">
                    ${guest ? `
                        <button class="btn-primary" onclick="showSignInPrompt(); closeLimitModal()">
                            Sign In with Google
                        </button>
                        <button class="btn-secondary" onclick="closeLimitModal()">
                            Stay as Guest
                        </button>
                    ` : `
                        <button class="btn-secondary" onclick="closeLimitModal()">OK</button>
                    `}
                </div>
            </div>
        </div>
    `;

    document.body.insertAdjacentHTML('beforeend', modal);
}

function closeLimitModal() {
    const modal = document.getElementById('limitModal');
    if (modal) modal.remove();
}

async function openUserProfile() {
    if (isGuestMode()) {
        showToast('Please sign in to view profile', '⚠️');
        return;
    }

    const allCollections = typeof getCollections === 'function' ? getCollections() : [];
    const totalCards = allCollections.reduce((sum, c) => sum + c.cards.length, 0);

    const modal = `
        <div class="modal active" id="profileModal">
            <div class="modal-backdrop" onclick="closeProfileModal()"></div>
            <div class="modal-content">
                <div class="modal-header">
                    <h2>👤 User Profile</h2>
                    <button class="modal-close" onclick="closeProfileModal()">×</button>
                </div>
                <div class="modal-body">
                    <div style="display:flex;align-items:center;gap:16px;margin-bottom:24px;">
                        <img src="${currentUser.picture}" alt="Profile"
                             style="width:64px;height:64px;border-radius:50%;">
                        <div>
                            <strong style="display:block;font-size:18px;">${currentUser.name}</strong>
                            <span style="color:#666;">${currentUser.email}</span>
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
                               value="${currentUser.discord_id || ''}"
                               placeholder="username#1234"
                               style="width:100%;padding:10px;border:1px solid #ddd;border-radius:8px;font-size:16px;">
                        <button class="btn-secondary" onclick="saveDiscordId()" style="margin-top:8px;">
                            Save
                        </button>
                    </div>
                </div>
                <div class="modal-footer">
                    <button class="btn-secondary" onclick="closeProfileModal()">Close</button>
                </div>
            </div>
        </div>
    `;

    document.body.insertAdjacentHTML('beforeend', modal);
}

async function saveDiscordId() {
    const discordId = document.getElementById('discordIdInput').value.trim();
    if (typeof window.supabaseClient === 'undefined') {
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
    const modal = document.getElementById('profileModal');
    if (modal) modal.remove();
}

console.log('✅ User management module loaded');
