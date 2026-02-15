// Google Authentication & Drive Integration
// FIXED VERSION - Drive API disabled, proper error handling

const GOOGLE_CONFIG = {
    // Your actual Client ID from Google Cloud Console
    clientId: '572964589574-hn6786nf84q5joug9ts2vul0r9oql6f.apps.googleusercontent.com',
    apiKey: '', // Leave blank - not needed for basic OAuth
    discoveryDocs: ['https://www.googleapis.com/discovery/v1/apis/drive/v3/rest'],
    scopes: [
        'https://www.googleapis.com/auth/drive.file',
        'https://www.googleapis.com/auth/userinfo.profile',
        'https://www.googleapis.com/auth/userinfo.email'
    ],
    appFolderName: 'Card Scanner Data',
    autoSyncDelay: 2000
};

let googleUser = null;
let driveInitialized = false;
let appFolderId = null;
let syncTimeout = null;

// ==================== INITIALIZATION ====================

async function initGoogleAuth() {
    try {
        console.log('🔐 Initializing Google Auth...');
        
        // Load Google Identity Services
        await loadGoogleScript();
        
        // Check for stored user
        const user = getStoredUser();
        if (user) {
            googleUser = user;
            updateAuthUI(true);
            console.log('✅ Restored session:', user.email);
            
            // Call handleUserSignIn if it exists (for Supabase integration)
            if (typeof handleUserSignIn === 'function') {
                await handleUserSignIn(user).catch(err => {
                    console.warn('User management not available:', err.message);
                });
            }
        } else {
            updateAuthUI(false);
        }
        
        // Initialize sign-in button
        renderSignInButton();
        
        console.log('✅ Google Auth initialized');
        
    } catch (err) {
        console.error('❌ Google Auth failed:', err);
        showToast('Google Auth unavailable', '⚠️');
    }
}

function loadGoogleScript() {
    return new Promise((resolve, reject) => {
        if (typeof google !== 'undefined' && google.accounts) {
            resolve();
            return;
        }
        
        const script = document.createElement('script');
        script.src = 'https://accounts.google.com/gsi/client';
        script.async = true;
        script.defer = true;
        script.onload = resolve;
        script.onerror = () => reject(new Error('Failed to load Google script'));
        document.head.appendChild(script);
    });
}

function renderSignInButton() {
    const container = document.getElementById('googleSignInBtn');
    if (!container) {
        console.warn('Google sign-in button container not found');
        return;
    }
    
    try {
        google.accounts.id.initialize({
            client_id: GOOGLE_CONFIG.clientId,
            callback: handleCredentialResponse,
            auto_select: false,
            cancel_on_tap_outside: true
        });
        
        google.accounts.id.renderButton(
            container,
            {
                theme: 'outline',
                size: 'large',
                text: 'signin_with',
                shape: 'rectangular',
                width: 250
            }
        );
    } catch (err) {
        console.error('Error rendering sign-in button:', err);
    }
}

async function handleCredentialResponse(response) {
    try {
        const payload = parseJwt(response.credential);
        
        console.log('🔐 Credential received, requesting access token...');
        
        // Request access token
        const tokenResponse = await requestAccessToken();
        
        if (!tokenResponse || !tokenResponse.access_token) {
            throw new Error('Failed to get access token');
        }
        
        googleUser = {
            id: payload.sub,
            email: payload.email,
            name: payload.name,
            picture: payload.picture,
            access_token: tokenResponse.access_token,
            expires_at: Date.now() + (tokenResponse.expires_in * 1000)
        };
        
        storeUser(googleUser);
        updateAuthUI(true);
        
        // Call handleUserSignIn if available (Supabase integration)
        if (typeof handleUserSignIn === 'function') {
            await handleUserSignIn(googleUser).catch(err => {
                console.warn('User management not available:', err.message);
            });
        }
        
        showToast(`Welcome, ${googleUser.name}!`, '👋');
        
    } catch (err) {
        console.error('Sign-in error:', err);
        showToast('Sign-in failed', '❌');
    }
}

function requestAccessToken() {
    return new Promise((resolve, reject) => {
        const client = google.accounts.oauth2.initTokenClient({
            client_id: GOOGLE_CONFIG.clientId,
            scope: GOOGLE_CONFIG.scopes.join(' '),
            callback: (response) => {
                if (response.error) {
                    reject(new Error(response.error));
                } else {
                    resolve(response);
                }
            },
            error_callback: (error) => {
                reject(new Error(error.message || 'Token request failed'));
            }
        });
        
        client.requestAccessToken();
    });
}

function parseJwt(token) {
    try {
        const base64Url = token.split('.')[1];
        const base64 = base64Url.replace(/-/g, '+').replace(/_/g, '/');
        const jsonPayload = decodeURIComponent(
            atob(base64)
                .split('')
                .map(c => '%' + ('00' + c.charCodeAt(0).toString(16)).slice(-2))
                .join('')
        );
        return JSON.parse(jsonPayload);
    } catch (err) {
        console.error('JWT parse error:', err);
        return null;
    }
}

function storeUser(user) {
    try {
        localStorage.setItem('googleUser', JSON.stringify(user));
    } catch (err) {
        console.error('Error storing user:', err);
    }
}

function getStoredUser() {
    try {
        const stored = localStorage.getItem('googleUser');
        if (!stored) return null;
        
        const user = JSON.parse(stored);
        
        // Check if token expired
        if (user.expires_at && user.expires_at < Date.now()) {
            console.log('Token expired, clearing');
            localStorage.removeItem('googleUser');
            return null;
        }
        
        return user;
    } catch (err) {
        console.error('Error getting stored user:', err);
        return null;
    }
}

function signOut() {
    try {
        googleUser = null;
        driveInitialized = false;
        appFolderId = null;
        
        localStorage.removeItem('googleUser');
        
        if (typeof google !== 'undefined' && google.accounts) {
            google.accounts.id.disableAutoSelect();
        }
        
        updateAuthUI(false);
        showToast('Signed out', '👋');
        
        // Reload to reset state
        setTimeout(() => location.reload(), 500);
    } catch (err) {
        console.error('Sign out error:', err);
    }
}

function updateAuthUI(signedIn) {
    const signInContainer = document.getElementById('googleSignInBtn');
    const userInfo = document.getElementById('googleUserInfo');
    const signOutBtn = document.getElementById('googleSignOutBtn');
    const driveSection = document.getElementById('driveExportSection');
    
    if (signedIn && googleUser) {
        // Hide sign-in button
        if (signInContainer) {
            signInContainer.classList.add('hidden');
            signInContainer.style.display = 'none';
        }
        
        // Show user info
        if (userInfo) {
            userInfo.classList.remove('hidden');
            userInfo.style.display = 'flex';
        }
        
        if (signOutBtn) {
            signOutBtn.classList.remove('hidden');
            signOutBtn.style.display = 'block';
        }
        
        // Note: Drive section disabled for now
        if (driveSection) {
            driveSection.classList.add('hidden');
            driveSection.style.display = 'none';
        }
        
        // Update user info
        const userName = document.getElementById('userName');
        const userEmail = document.getElementById('userEmail');
        const userAvatar = document.getElementById('userAvatar');
        
        if (userName) userName.textContent = googleUser.name;
        if (userEmail) userEmail.textContent = googleUser.email;
        if (userAvatar) userAvatar.src = googleUser.picture;
    } else {
        // Show sign-in button
        if (signInContainer) {
            signInContainer.classList.remove('hidden');
            signInContainer.style.display = 'block';
        }
        
        // Hide user info
        if (userInfo) {
            userInfo.classList.add('hidden');
            userInfo.style.display = 'none';
        }
        
        if (signOutBtn) {
            signOutBtn.classList.add('hidden');
            signOutBtn.style.display = 'none';
        }
        
        if (driveSection) {
            driveSection.classList.add('hidden');
            driveSection.style.display = 'none';
        }
    }
}

// ==================== DRIVE API - DISABLED ====================
// Drive functionality is disabled to avoid errors
// Can be re-enabled after proper configuration

async function initDriveAPI(accessToken) {
    console.log('⚠️ Drive API disabled');
    return;
    
    // Original code commented out
    /*
    try {
        console.log('☁️ Initializing Drive API...');
        await loadGapiScript();
        await new Promise((resolve) => gapi.load('client', resolve));
        await gapi.client.init({
            apiKey: GOOGLE_CONFIG.apiKey,
            discoveryDocs: GOOGLE_CONFIG.discoveryDocs
        });
        gapi.client.setToken({ access_token: accessToken });
        appFolderId = await getOrCreateAppFolder();
        driveInitialized = true;
        console.log('✅ Drive API initialized');
    } catch (err) {
        console.error('❌ Drive API init failed:', err);
    }
    */
}

function loadGapiScript() {
    return Promise.resolve(); // Disabled
}

function setupAutoSync() {
    console.log('✅ Auto-sync enabled (local only - Drive disabled)');
}

function syncCollectionsToDrive() {
    console.log('⚠️ Drive sync disabled');
    return Promise.resolve();
}

function loadCollectionsFromDrive() {
    showToast('Drive sync temporarily disabled', '⚠️');
}

function exportToDriveCSV() {
    showToast('Drive export temporarily disabled', '⚠️');
}

function exportToDriveExcel() {
    showToast('Drive export temporarily disabled', '⚠️');
}

function showDriveFileBrowser() {
    showToast('Drive browser temporarily disabled', '⚠️');
}
