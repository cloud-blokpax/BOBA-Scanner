// ============================================================
// js/google-auth.js — FIXED
// Changes:
//   - Raw Google JWT credential NO LONGER stored in localStorage
//     (was accessible to any 3rd-party CDN script)
//   - Only parsed payload stored, never the raw token
//   - Removed setTimeout(initUserManagement, 500) and similar hacks
//   - Auth flow is now deterministic: one path, no race conditions
//   - Google Client ID loaded from appConfig (from /api/config) instead of hardcoded
//   - initGoogleAuth() returns a Promise so app.js can await it properly
// ============================================================

let googleUser     = null;
let authInitialized = false;

// ── Initialize Google Identity Services ──────────────────────────────────────
function initGoogleAuth() {
  return new Promise((resolve) => {
    if (authInitialized) {
      resolve();
      return;
    }

    const tryInit = async () => {
      if (typeof google === 'undefined' || !google.accounts) {
        setTimeout(tryInit, 200);
        return;
      }

      // FIXED: Google Client ID comes from appConfig (loaded via /api/config)
      // instead of being hardcoded in this file.
      const clientId = appConfig.googleClientId;
      if (!clientId) {
        console.warn('⚠️ No Google Client ID in config — auth disabled');
        updateAuthUI(null);
        resolve();
        return;
      }

      try {
        google.accounts.id.initialize({
          client_id:               clientId,
          callback:                handleCredentialResponse,
          auto_select:             false,
          cancel_on_tap_outside:   true,
          use_fedcm_for_prompt:    false,
          itp_support:             true
        });

        const signInDiv = document.getElementById('googleSignInButton');
        if (signInDiv) {
          google.accounts.id.renderButton(signInDiv, {
            theme: 'outline', size: 'large', width: 250,
            text: 'signin_with', shape: 'rectangular'
          });
        }

        authInitialized = true;
        console.log('✅ Google Auth initialized');
      } catch (err) {
        console.error('❌ Google Auth init error:', err);
      }

      // Restore session from localStorage BEFORE resolving
      // so app.js sees googleUser immediately after await initGoogleAuth()
      await restoreSession();
      resolve();
    };

    tryInit();
  });
}

// ── Handle sign-in credential ─────────────────────────────────────────────────
async function handleCredentialResponse(response) {
  try {
    const payload = parseJwt(response.credential);
    if (!payload) throw new Error('Invalid JWT payload');

    console.log('✅ Google sign-in:', payload.email);

    // FIXED: Store only the parsed payload, NEVER the raw credential token.
    // The raw token (response.credential) is discarded after parsing.
    googleUser = {
      id:             payload.sub,
      google_id:      payload.sub,
      email:          payload.email,
      name:           payload.name,
      picture:        payload.picture,
      profilePicture: payload.picture
    };

    // Persist parsed payload only (not the raw JWT)
    localStorage.setItem('googleUser', JSON.stringify(googleUser));

    updateAuthUI(googleUser);
    showToast(`Welcome, ${googleUser.name}!`, '👋');

    // FIXED: Single sequential auth flow — no setTimeout race conditions.
    // handleUserSignIn in user-management.js handles everything from here.
    if (typeof handleUserSignIn === 'function') {
      await handleUserSignIn(googleUser);
    }

  } catch (err) {
    console.error('❌ Credential handling error:', err);
    showToast('Sign-in failed. Please try again.', '❌');
  }
}

// ── Restore existing session ──────────────────────────────────────────────────
async function restoreSession() {
  try {
    const saved = localStorage.getItem('googleUser');
    if (!saved) {
      updateAuthUI(null);
      return false;
    }

    googleUser = JSON.parse(saved);
    console.log('✅ Session restored:', googleUser.email);

    updateAuthUI(googleUser);

    // Re-run user management setup with restored user
    if (typeof handleUserSignIn === 'function') {
      await handleUserSignIn(googleUser);
    }

    return true;
  } catch (err) {
    console.error('Session restore error:', err);
    localStorage.removeItem('googleUser');
    updateAuthUI(null);
    return false;
  }
}

// ── Sign out ──────────────────────────────────────────────────────────────────
function signOutGoogle() {
  if (typeof google !== 'undefined' && google.accounts) {
    google.accounts.id.disableAutoSelect();
  }

  googleUser = null;
  localStorage.removeItem('googleUser');
  // FIXED: No longer need to remove 'googleCredential' (we stopped storing it)
  sessionStorage.clear();

  updateAuthUI(null);
  showToast('Signed out', '👋');

  setTimeout(() => window.location.reload(), 800);
}

// ── Parse JWT ─────────────────────────────────────────────────────────────────
// NOTE: This decodes without signature verification (Google's library already
// validated the signature before giving us the token). The parsed data is
// treated as trusted only within the same session.
function parseJwt(token) {
  try {
    const b64 = token.split('.')[1].replace(/-/g, '+').replace(/_/g, '/');
    return JSON.parse(decodeURIComponent(
      atob(b64).split('').map(c => '%' + ('00' + c.charCodeAt(0).toString(16)).slice(-2)).join('')
    ));
  } catch {
    return null;
  }
}

// ── Update auth UI ────────────────────────────────────────────────────────────
function updateAuthUI(user) {
  const btnSignIn       = document.getElementById('btnSignIn');
  const userAuthenticated = document.getElementById('userAuthenticated');
  const userName        = document.getElementById('userName');
  const userEmail       = document.getElementById('userEmail');
  const userAvatar      = document.getElementById('userAvatar');

  if (user) {
    if (btnSignIn)         btnSignIn.style.display        = 'none';
    if (userAuthenticated) userAuthenticated.style.display = 'flex';
    if (userName)          userName.textContent            = user.name  || 'User';
    if (userEmail)         userEmail.textContent           = user.email || '';
    if (userAvatar) {
      userAvatar.src = user.picture || '';
      userAvatar.alt = user.name || 'User';
    }
  } else {
    if (btnSignIn)         btnSignIn.style.display        = 'block';
    if (userAuthenticated) userAuthenticated.style.display = 'none';
  }
}

console.log('✅ Google Auth module loaded');
