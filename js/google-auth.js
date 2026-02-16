// Google OAuth Authentication

let googleUser = null;
let authInitialized = false;

function initGoogleAuth() {
    if (authInitialized) {
        console.log('Google Auth already initialized');
        return;
    }
    
    console.log('🔐 Initializing Google Auth...');
    
    // Check if Google API is loaded
    if (typeof google === 'undefined' || !google.accounts) {
        console.warn('Google API not loaded yet, retrying...');
        setTimeout(initGoogleAuth, 1000);
        return;
    }
    
    try {
        // Initialize Google Sign-In
        google.accounts.id.initialize({
            client_id: '572964589574-hn6786nf84q5joug9ts2vuln0r9oql6f.apps.googleusercontent.com',
            callback: handleCredentialResponse,
            auto_select: false,
            cancel_on_tap_outside: true,
            use_fedcm_for_prompt: false 
        });
        
        // Render sign-in button if element exists
        const signInDiv = document.getElementById('googleSignInButton');
        if (signInDiv) {
            google.accounts.id.renderButton(
                signInDiv,
                { 
                    theme: 'outline', 
                    size: 'large',
                    width: 250,
                    text: 'signin_with',
                    shape: 'rectangular'
                }
            );
        }
        
        // Try to auto-sign in if previously signed in
        google.accounts.id.prompt((notification) => {
            if (notification.isNotDisplayed() || notification.isSkippedMoment()) {
                console.log('Auto sign-in not available');
                updateAuthUI(null);
            }
        });
        
        authInitialized = true;
        console.log('✅ Google Auth initialized');
        
    } catch (error) {
        console.error('❌ Google Auth initialization error:', error);
    }
}

function handleCredentialResponse(response) {
    console.log('📝 Received credential response');
    
    try {
        // Decode JWT token
        const credential = response.credential;
        const payload = parseJwt(credential);
        
        console.log('User signed in:', payload.email);
        
        // Store user info
        googleUser = {
            id: payload.sub,
            email: payload.email,
            name: payload.name,
            picture: payload.picture,
            credential: credential
        };
        
        // Save to localStorage for persistence
        localStorage.setItem('googleUser', JSON.stringify(googleUser));
        localStorage.setItem('googleCredential', credential);
        
        // Update UI
        updateAuthUI(googleUser);
        
        // Show success message
        if (typeof showToast === 'function') {
            showToast(`Welcome back, ${googleUser.name}!`, '👋');
        }
        
        // Initialize user management if available
        if (typeof handleUserSignIn === 'function') {
            handleUserSignIn(googleUser);
        }
        
        // Trigger user management initialization
        if (typeof initUserManagement === 'function') {
            setTimeout(() => {
                initUserManagement();
            }, 500);
        }
        
    } catch (error) {
        console.error('❌ Error handling credential:', error);
        if (typeof showToast === 'function') {
            showToast('Sign-in failed. Please try again.', '❌');
        }
    }
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
    } catch (error) {
        console.error('Error parsing JWT:', error);
        return null;
    }
}

function restoreSession() {
    console.log('🔍 Checking for existing session...');
    
    try {
        const savedUser = localStorage.getItem('googleUser');
        const savedCredential = localStorage.getItem('googleCredential');
        
        if (savedUser && savedCredential) {
            googleUser = JSON.parse(savedUser);
            console.log('✅ Restored session:', googleUser.email);
            
            // Update UI
            updateAuthUI(googleUser);
            
            if (typeof showToast === 'function') {
                showToast(`Welcome back, ${googleUser.name}!`, '👋');
            }
            
            // Initialize user management
            if (typeof handleUserSignIn === 'function') {
                handleUserSignIn(googleUser);
            }
            
            return true;
        } else {
            console.log('No saved session found');
            updateAuthUI(null);
            return false;
        }
    } catch (error) {
        console.error('Error restoring session:', error);
        updateAuthUI(null);
        return false;
    }
}

function signOutGoogle() {
    console.log('👋 Signing out...');
    
    try {
        // Disable auto-select
        if (typeof google !== 'undefined' && google.accounts) {
            google.accounts.id.disableAutoSelect();
        }
        
        // Clear stored data
        googleUser = null;
        localStorage.removeItem('googleUser');
        localStorage.removeItem('googleCredential');
        sessionStorage.clear();
        
        // Update UI
        updateAuthUI(null);
        
        if (typeof showToast === 'function') {
            showToast('Signed out successfully', '👋');
        }
        
        // Reload page to clear all state
        setTimeout(() => {
            window.location.reload();
        }, 1000);
        
    } catch (error) {
        console.error('Error signing out:', error);
    }
}

// Update authentication UI based on user state
function updateAuthUI(user) {
    console.log('🎨 Updating auth UI, user:', user ? user.email : 'none');
    
    const btnSignIn = document.getElementById('btnSignIn');
    const userAuthenticated = document.getElementById('userAuthenticated');
    const userName = document.getElementById('userName');
    const userEmail = document.getElementById('userEmail');
    const userAvatar = document.getElementById('userAvatar');
    
    if (user) {
        // User is signed in
        console.log('User signed in, showing authenticated UI');
        if (btnSignIn) btnSignIn.style.display = 'none';
        if (userAuthenticated) userAuthenticated.style.display = 'flex';
        
        if (userName) userName.textContent = user.name || 'User';
        if (userEmail) userEmail.textContent = user.email || '';
        if (userAvatar) {
            userAvatar.src = user.picture || '';
            userAvatar.alt = user.name || 'User';
        }
    } else {
        // User is not signed in
        console.log('User not signed in, showing sign-in button');
        if (btnSignIn) btnSignIn.style.display = 'block';
        if (userAuthenticated) userAuthenticated.style.display = 'none';
    }
}

// Initialize on page load
document.addEventListener('DOMContentLoaded', () => {
    console.log('🚀 Page loaded, initializing auth...');
    
    // First try to restore session
    const restored = restoreSession();
    
    // Then initialize Google Auth
    setTimeout(() => {
        initGoogleAuth();
    }, 100);
});

// Also try to restore session after a delay (in case DOM loads slowly)
setTimeout(() => {
    if (!googleUser) {
        restoreSession();
    }
}, 1000);

console.log('✅ Google Auth module loaded');
