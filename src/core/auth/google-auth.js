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

import { appConfig } from '../state.js';
import { showToast } from '../../ui/toast.js';
import { handleUserSignIn } from './user-management.js';

let googleUser     = null;
let authInitialized = false;

// ── Initialize Google Identity Services ──────────────────────────────────────
export function initGoogleAuth() {
  return new Promise((resolve) => {
    if (authInitialized) {
      resolve();
      return;
    }

    const MAX_ATTEMPTS = 50; // 50 × 200ms = 10 seconds max
    let attempts = 0;

    const tryInit = async () => {
      if (typeof google === 'undefined' || !google.accounts) {
        attempts++;
        if (attempts >= MAX_ATTEMPTS) {
          console.warn('⚠️ Google SDK failed to load after 10s — sign-in unavailable');
          if (typeof showToast === 'function') {
            showToast('Google sign-in unavailable. Check your connection.', '⚠️');
          }
          resolve();
          return;
        }
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

      resolve();
    };

    tryInit();
  });
}

// ── Handle sign-in credential ─────────────────────────────────────────────────
export async function handleCredentialResponse(response) {
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

    // Close the sign-in modal now that the user is authenticated
    if (typeof window.closeSignInModal === 'function') window.closeSignInModal();

    showToast(`Welcome, ${googleUser.name}!`, '👋');

    // FIXED: Single sequential auth flow — no setTimeout race conditions.
    // handleUserSignIn in user-management.js handles everything from here.
    await handleUserSignIn(googleUser);

  } catch (err) {
    console.error('❌ Credential handling error:', err);
    showToast('Sign-in failed. Please try again.', '❌');
  }
}

// ── Restore existing session ──────────────────────────────────────────────────
export async function restoreSession() {
  // Step 1: Parse saved session — if corrupt, clear it.
  let saved;
  try {
    const raw = localStorage.getItem('googleUser');
    if (!raw) {
      updateAuthUI(null);
      return false;
    }
    saved = JSON.parse(raw);
  } catch (parseErr) {
    // Only remove if the data is genuinely unparseable
    console.warn('Corrupt session data, clearing:', parseErr.message);
    localStorage.removeItem('googleUser');
    updateAuthUI(null);
    return false;
  }

  // Step 2: Apply session to UI immediately — before any network calls.
  // User sees themselves as logged in right away.
  googleUser = saved;
  console.log('✅ Session restored:', googleUser.email);
  updateAuthUI(googleUser);

  // Step 3: Sync with Supabase in background.
  // If this fails (mobile network, timeout, etc.), the UI session is preserved.
  // We never delete the saved session just because a network call failed.
  try {
    await handleUserSignIn(googleUser);
  } catch (networkErr) {
    // Network/Supabase error — stay logged in with cached identity,
    // limits will use defaults until next successful sync.
    console.warn('Session sync failed (offline?), using cached identity:', networkErr.message);
  }

  return true;
}

// ── Sign out ──────────────────────────────────────────────────────────────────
export function signOutGoogle() {
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
export function parseJwt(token) {
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
export function updateAuthUI(user) {
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
