// User Management & Limits System

const SUPABASE_CONFIG = {
    url: 'https://rtffhhxuzkjzzvnsuroz.supabase.co',
    anonKey: 'sb_publishable_I2F2d2QxfVJuzqZxfRoF4g_tVTmxmgI'
};

// Current user state
let currentUser = null;
let userLimits = null;

// Default limits
const DEFAULT_LIMITS = {
    guest: {
        maxCards: 5,
        maxApiCalls: 1,
        apiCallsPerMonth: 1
    },
    authenticated: {
        maxCards: 25,
        maxApiCalls: 50,
        apiCallsPerMonth: 50
    }
};

// ==================== INITIALIZATION ====================

async function initUserManagement() {
    // Check if Supabase library is loaded
    if (typeof window.supabase === 'undefined') {
        console.warn('⚠️ Supabase library not loaded - user management disabled');
        return;
    }
    
    try {
        // Create Supabase client CORRECTLY
        const supabaseClient = window.supabase.createClient(
            SUPABASE_CONFIG.url,
            SUPABASE_CONFIG.anonKey
        );
        
        // Store globally
        window.supabaseClient = supabaseClient;
        
        console.log('✅ User management initialized');
        
    } catch (err) {
        console.error('❌ User management init failed:', err);
    }
}

// ==================== USER AUTHENTICATION ====================

async function handleUserSignIn(googleUser) {
    // Check if supabase is available
    if (typeof window.supabaseClient === 'undefined') {
        console.warn('User management not available');
        return null;
    }
    
    try {
        // Check if user exists in database
        const { data: existingUser, error: fetchError } = await window.supabaseClient
            .from('users')
            .select('*')
            .eq('google_id', googleUser.id)
            .single();
        
        if (fetchError && fetchError.code !== 'PGRST116') {
            throw fetchError;
        }
        
        if (existingUser) {
            // User exists - check if month reset needed
            currentUser = existingUser;
            await checkAndResetMonthlyLimits();
        } else {
            // Create new user
            const { data: newUser, error: createError } = await window.supabaseClient
                .from('users')
                .insert({
                    google_id: googleUser.id,
                    email: googleUser.email,
                    name: googleUser.name,
                    picture: googleUser.picture,
                    card_limit: DEFAULT_LIMITS.authenticated.maxCards,
                    api_calls_limit: DEFAULT_LIMITS.authenticated.apiCallsPerMonth,
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
        
        // Load user limits
        await loadUserLimits();
        
        // Update UI
        if (typeof updateLimitsUI === 'function') {
            updateLimitsUI();
        }
        
        return currentUser;
        
    } catch (err) {
        console.error('User sign-in error:', err);
        showToast('Failed to load user profile', '❌');
        return null;
    }
}

async function checkAndResetMonthlyLimits() {
    const today = new Date();
    const lastReset = new Date(currentUser.last_reset_date);
    
    // Check if it's a new month
    if (today.getMonth() !== lastReset.getMonth() || 
        today.getFullYear() !== lastReset.getFullYear()) {
        
        console.log('🔄 Resetting monthly limits...');
        
        const { error } = await window.supabaseClient
            .from('users')
            .update({
                api_calls_used: 0,
                last_reset_date: today.toISOString().split('T')[0]
            })
            .eq('id', currentUser.id);
        
        if (!error) {
            currentUser.api_calls_used = 0;
            currentUser.last_reset_date = today.toISOString().split('T')[0];
            showToast('Monthly limits reset!', '🔄');
        }
    }
}

async function loadUserLimits() {
    if (isGuestMode()) {
        userLimits = DEFAULT_LIMITS.guest;
    } else {
        userLimits = {
            maxCards: currentUser.card_limit,
            maxApiCalls: currentUser.api_calls_limit,
            apiCallsUsed: currentUser.api_calls_used,
            cardsInCollection: currentUser.cards_in_collection
        };
    }
}

function isGuestMode() {
    return !currentUser || typeof googleUser === 'undefined' || !googleUser;
}

function isAdmin() {
    return currentUser && currentUser.is_admin === true;
}

// ==================== LIMIT CHECKS ====================

async function canAddCard() {
    if (isGuestMode()) {
        const totalCards = collections.reduce((sum, c) => sum + c.cards.length, 0);
        
        if (totalCards >= DEFAULT_LIMITS.guest.maxCards) {
            showLimitReachedModal('cards', totalCards, DEFAULT_LIMITS.guest.maxCards);
            return false;
        }
        return true;
    }
    
    // Authenticated user
    const totalCards = collections.reduce((sum, c) => sum + c.cards.length, 0);
    
    if (totalCards >= userLimits.maxCards) {
        showLimitReachedModal('cards', totalCards, userLimits.maxCards);
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
    
    // Authenticated user
    if (userLimits.apiCallsUsed >= userLimits.maxApiCalls) {
        showLimitReachedModal('api', userLimits.apiCallsUsed, userLimits.maxApiCalls);
        return false;
    }
    
    return true;
}

async function trackCardAdded() {
    if (isGuestMode() || typeof window.supabaseClient === 'undefined') {
        return;
    }
    
    // Update user's card count
    const totalCards = collections.reduce((sum, c) => sum + c.cards.length, 0);
    
    const { error } = await window.supabaseClient
        .from('users')
        .update({ cards_in_collection: totalCards })
        .eq('id', currentUser.id);
    
    if (!error) {
        currentUser.cards_in_collection = totalCards;
        userLimits.cardsInCollection = totalCards;
        if (typeof updateLimitsUI === 'function') {
            updateLimitsUI();
        }
    }
}

async function trackApiCall(callType, success, cost = 0, cardsProcessed = 1) {
    if (isGuestMode()) {
        // Guest mode - increment local counter
        const current = parseInt(localStorage.getItem('guest_api_calls') || '0');
        localStorage.setItem('guest_api_calls', (current + 1).toString());
        if (typeof updateLimitsUI === 'function') {
            updateLimitsUI();
        }
        return;
    }
    
    if (typeof window.supabaseClient === 'undefined') {
        return;
    }
    
    // Log the API call
    const { error: logError } = await window.supabaseClient
        .from('api_call_logs')
        .insert({
            user_id: currentUser.id,
            call_type: callType,
            success: success,
            cost: cost,
            cards_processed: cardsProcessed
        });
    
    if (logError) {
        console.error('Failed to log API call:', logError);
    }
    
    // Increment user's API call counter
    const newCount = currentUser.api_calls_used + cardsProcessed;
    
    const { error: updateError } = await window.supabaseClient
        .from('users')
        .update({ api_calls_used: newCount })
        .eq('id', currentUser.id);
    
    if (!updateError) {
        currentUser.api_calls_used = newCount;
        userLimits.apiCallsUsed = newCount;
        if (typeof updateLimitsUI === 'function') {
            updateLimitsUI();
        }
    }
}

// ==================== UI UPDATES ====================

function updateLimitsUI() {
    const limitsContainer = document.getElementById('userLimits');
    if (!limitsContainer) return;
    
    if (isGuestMode()) {
        const totalCards = collections.reduce((sum, c) => sum + c.cards.length, 0);
        const apiCalls = parseInt(localStorage.getItem('guest_api_calls') || '0');
        
        limitsContainer.innerHTML = `
            <div class="limits-banner guest-mode">
                <div class="limit-item">
                    <span class="limit-icon">🎴</span>
                    <span class="limit-text">${totalCards} / ${DEFAULT_LIMITS.guest.maxCards} cards</span>
                </div>
                <div class="limit-item">
                    <span class="limit-icon">🤖</span>
                    <span class="limit-text">${apiCalls} / ${DEFAULT_LIMITS.guest.maxApiCalls} AI lookups</span>
                </div>
                <button class="btn-upgrade" onclick="showSignInPrompt()">
                    Sign In for More
                </button>
            </div>
        `;
    } else {
        const cardsPercent = (userLimits.cardsInCollection / userLimits.maxCards) * 100;
        const apiPercent = (userLimits.apiCallsUsed / userLimits.maxApiCalls) * 100;
        
        limitsContainer.innerHTML = `
            <div class="limits-banner authenticated-mode">
                <div class="limit-item">
                    <span class="limit-icon">🎴</span>
                    <div class="limit-details">
                        <div class="limit-text">
                            ${userLimits.cardsInCollection} / ${userLimits.maxCards} cards
                        </div>
                        <div class="limit-bar">
                            <div class="limit-fill" style="width: ${cardsPercent}%"></div>
                        </div>
                    </div>
                </div>
                <div class="limit-item">
                    <span class="limit-icon">🤖</span>
                    <div class="limit-details">
                        <div class="limit-text">
                            ${userLimits.apiCallsUsed} / ${userLimits.maxApiCalls} AI lookups
                        </div>
                        <div class="limit-bar">
                            <div class="limit-fill" style="width: ${apiPercent}%"></div>
                        </div>
                    </div>
                </div>
                ${isAdmin() ? `
                    <button class="btn-admin" onclick="openAdminDashboard()">
                        Admin Dashboard
                    </button>
                ` : ''}
            </div>
        `;
    }
}

function showLimitReachedModal(type, current, max) {
    const messages = {
        cards: {
            title: '🎴 Card Limit Reached',
            message: `You've reached your card limit (${current}/${max}).`,
            guest: 'Sign in with Google to increase your limit to 25 cards!',
            auth: 'Your collection is at maximum capacity. Contact admin for a limit increase.'
        },
        api: {
            title: '🤖 API Limit Reached',
            message: `You've used all your AI lookups this month (${current}/${max}).`,
            guest: 'Sign in with Google to get 50 AI lookups per month!',
            auth: 'Your AI lookups will reset on the 1st of next month.'
        }
    };
    
    const msg = messages[type];
    const isGuest = isGuestMode();
    
    const modal = `
        <div class="modal active" id="limitModal">
            <div class="modal-content">
                <div class="modal-header">
                    <div class="modal-title">${msg.title}</div>
                    <div class="modal-close" onclick="closeLimitModal()">×</div>
                </div>
                
                <div class="limit-modal-content" style="padding: 20px;">
                    <p><strong>${msg.message}</strong></p>
                    <p>${isGuest ? msg.guest : msg.auth}</p>
                    
                    ${isGuest ? `
                        <div class="modal-buttons">
                            <button class="btn btn-primary" onclick="showSignInPrompt(); closeLimitModal()">
                                Sign In with Google
                            </button>
                            <button class="btn btn-secondary" onclick="closeLimitModal()">
                                Stay in Guest Mode
                            </button>
                        </div>
                    ` : `
                        <div class="modal-buttons">
                            <button class="btn btn-secondary" onclick="closeLimitModal()">
                                OK
                            </button>
                        </div>
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

function showSignInPrompt() {
    if (typeof initGoogleAuth === 'function') {
        initGoogleAuth();
    } else {
        showToast('Google sign-in not configured', '⚠️');
    }
}

// ==================== USER PROFILE ====================

async function openUserProfile() {
    if (isGuestMode()) {
        showToast('Please sign in to view profile', '⚠️');
        return;
    }
    
    const modal = `
        <div class="modal active" id="profileModal">
            <div class="modal-content profile-modal">
                <div class="modal-header">
                    <div class="modal-title">👤 User Profile</div>
                    <div class="modal-close" onclick="closeProfileModal()">×</div>
                </div>
                
                <div class="profile-content">
                    <div class="profile-header">
                        <img src="${currentUser.picture}" alt="Profile" class="profile-avatar-large">
                        <div class="profile-info">
                            <h3>${currentUser.name}</h3>
                            <p>${currentUser.email}</p>
                            ${currentUser.is_admin ? '<span class="admin-badge">Admin</span>' : ''}
                        </div>
                    </div>
                    
                    <div class="profile-section">
                        <h4>Personal Information</h4>
                        <div class="profile-field">
                            <label>Discord ID</label>
                            <input type="text" id="discordIdInput" 
                                   value="${currentUser.discord_id || ''}" 
                                   placeholder="username#1234">
                        </div>
                        <button class="btn btn-primary" onclick="saveDiscordId()">
                            Save Discord ID
                        </button>
                    </div>
                    
                    <div class="profile-section">
                        <h4>Usage Limits</h4>
                        <div class="usage-stats">
                            <div class="usage-stat">
                                <div class="usage-label">Cards in Collection</div>
                                <div class="usage-value">
                                    ${userLimits.cardsInCollection} / ${userLimits.maxCards}
                                </div>
                                <div class="usage-bar">
                                    <div class="usage-fill" style="width: ${(userLimits.cardsInCollection / userLimits.maxCards) * 100}%"></div>
                                </div>
                            </div>
                            
                            <div class="usage-stat">
                                <div class="usage-label">AI Lookups This Month</div>
                                <div class="usage-value">
                                    ${userLimits.apiCallsUsed} / ${userLimits.maxApiCalls}
                                </div>
                                <div class="usage-bar">
                                    <div class="usage-fill" style="width: ${(userLimits.apiCallsUsed / userLimits.maxApiCalls) * 100}%"></div>
                                </div>
                            </div>
                            
                            <div class="usage-info">
                                <small>Limits reset on the 1st of each month</small>
                            </div>
                        </div>
                    </div>
                    
                    <div class="profile-section">
                        <h4>Collections</h4>
                        <div class="collection-stats">
                            <div class="stat-item">
                                <strong>${collections.length}</strong>
                                <span>Collections</span>
                            </div>
                            <div class="stat-item">
                                <strong>${collections.reduce((sum, c) => sum + c.cards.length, 0)}</strong>
                                <span>Total Cards</span>
                            </div>
                            <div class="stat-item">
                                <strong>${new Date(currentUser.created_at).toLocaleDateString()}</strong>
                                <span>Member Since</span>
                            </div>
                        </div>
                    </div>
                </div>
                
                <div class="modal-buttons">
                    <button class="btn btn-secondary" onclick="closeProfileModal()">Close</button>
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
        console.error('Save Discord ID error:', err);
        showToast('Failed to save Discord ID', '❌');
    }
}

function closeProfileModal() {
    const modal = document.getElementById('profileModal');
    if (modal) modal.remove();
}
