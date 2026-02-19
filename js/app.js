// This runs synchronously as soon as the script tag is parsed.
// handleFiles is defined in scanner.js which loads before app.js.
function attachFileInputNow() {
    const fileInput = document.getElementById('fileInput');
    if (fileInput && typeof handleFiles === 'function') {
        fileInput.addEventListener('change', handleFiles);
        console.log('📎 File input wired immediately');
    } else {
        // DOM not ready yet — wait for it
        document.addEventListener('DOMContentLoaded', function onReady() {
            const fi = document.getElementById('fileInput');
            if (fi && typeof handleFiles === 'function') {
                fi.addEventListener('change', handleFiles);
                console.log('📎 File input wired on DOMContentLoaded');
            }
            document.removeEventListener('DOMContentLoaded', onReady);
        });
    }
}

attachFileInputNow();

// ── Step 2: Full async initialization ────────────────────────────────────────
async function init() {
    console.log('🚀 Initializing Card Scanner...');

    try {
        // FIXED: Load app config FIRST — everything downstream needs it.
        // appConfig.apiToken is required by /api/anthropic (returns 401 without it).
        // appConfig.supabaseUrl/Key needed by initUserManagement.
        // appConfig.googleClientId needed by initGoogleAuth.
        if (typeof loadAppConfig === 'function') {
            await loadAppConfig();
        }

        // Initialize user management (needs appConfig.supabaseUrl)
        if (typeof initUserManagement === 'function') {
            await initUserManagement();
        }

        // Load collections from localStorage
        if (typeof loadCollections === 'function') {
            loadCollections();
        }

        // Initialize Google Auth (needs appConfig.googleClientId)
        if (typeof initGoogleAuth === 'function') {
            await initGoogleAuth();

            if (typeof googleUser !== 'undefined' && googleUser) {
                if (typeof handleUserSignIn === 'function') {
                    await handleUserSignIn(googleUser);
                }
            }
        }

        // Setup auto-sync if available
        if (typeof setupAutoSync === 'function') {
            setupAutoSync();
        }

        // Load DB, OCR, and OpenCV in parallel
        await Promise.all([
            loadDatabase(),
            initTesseract(),
            loadOpenCV()
        ]);

        // Init upload area drag-and-drop (buttons already wired via onclick in HTML)
        if (typeof initUploadArea === 'function') {
            initUploadArea();
        }

        // Update scan limits display
        if (typeof updateLimitsUI === 'function') {
            updateLimitsUI();
        }

        console.log('✅ Card Scanner Ready!');

    } catch (err) {
        console.error('❌ Initialization error:', err);
        if (typeof showToast === 'function') {
            showToast('Some features may not be available', '⚠️');
        }
    }
}

// Start init when DOM is ready
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
} else {
    init();
}
