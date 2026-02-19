// ============================================================
// js/app.js — FIXED
// Changes:
//   - loadAppConfig() awaited first so all modules have credentials before init
//   - initUserManagement() called after config loads
//   - restoreSession() (google-auth) awaited properly — no setTimeout guesswork
//   - initGoogleAuth() awaited properly
//   - File input connected ONCE with clone trick (unchanged — was correct)
//   - OpenCV load no longer blocks startup (was never functional anyway)
// ============================================================

async function init() {
  console.log('🚀 Initializing BoBA Scanner...');

  try {
    // STEP 1: Load app config from /api/config FIRST.
    // Everything else depends on credentials in appConfig.
    await loadAppConfig();

    // STEP 2: Initialize Supabase with loaded credentials
    await initUserManagement();

    // STEP 3: Restore any existing Google session
    // (google-auth.js restoreSession handles auth UI + handleUserSignIn)
    const hasSession = await restoreSession();

    // STEP 4: Initialize Google Auth SDK
    // (renders the sign-in button; session was already restored above)
    await initGoogleAuth();

    // STEP 5: Load async dependencies in parallel
    await Promise.all([
      loadDatabase(),
      initTesseract()
      // OpenCV disabled — loadOpenCV() is a no-op but harmless
    ]);

    // STEP 6: Load collections from localStorage
    if (typeof loadCollections === 'function') {
      loadCollections();
    }

    // STEP 7: Connect the file input ONCE
    // Clone to guarantee zero stale event listeners from any earlier init attempts
    const fileInput = document.getElementById('fileInput');
    if (fileInput && typeof handleFiles === 'function') {
      const fresh = fileInput.cloneNode(true);
      fileInput.parentNode.replaceChild(fresh, fileInput);
      fresh.addEventListener('change', handleFiles);
      console.log('✅ File input connected');
    }

    // STEP 8: Initialize upload area (drag & drop)
    if (typeof initUploadArea === 'function') {
      initUploadArea();
    }

    // STEP 9: Update limits display
    if (typeof updateLimitsUI === 'function') {
      updateLimitsUI();
    }

    // STEP 10: Render existing cards (in case there are saved ones)
    if (typeof renderCards === 'function') {
      renderCards();
    }

    console.log('✅ BoBA Scanner ready!');

  } catch (err) {
    console.error('❌ Initialization error:', err);
    if (typeof showToast === 'function') {
      showToast('Some features may not be available', '⚠️');
    }
  }
}

// Start ONCE when DOM is ready
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', init);
} else {
  init();
}
