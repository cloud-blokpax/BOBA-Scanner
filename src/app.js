// App initialization — FIXED
//
// Fix 1: fileInput 'change' listener is now attached immediately on
//         DOMContentLoaded, NOT after the async init chain completes.
//         Previously the user could pick an image during the 5-15s load
//         window (Tesseract download + DB fetch + Google Auth polling)
//         and the change event fired with zero listeners — silently dropped.
//
// Fix 2: loadAppConfig() is now called FIRST in init().
//         It was never called before, so appConfig stayed {} forever.
//         Without appConfig.apiToken the API returned 401 Unauthorized
//         on every scan attempt, silently failing in the catch block.

// ── Step 1: Wire fileInput immediately — before ANY async work ────────────────
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

        // Restore session from localStorage FIRST — independent of Google SDK.
        // restoreSession() only needs localStorage, not the Google library.
        // This runs on every page load/refresh so the user stays logged in.
        if (typeof restoreSession === 'function') {
            await restoreSession();
        }

        // Load collections from localStorage
        if (typeof loadCollections === 'function') {
            loadCollections();
        }

        // Initialize Google Auth (sets up sign-in button, handles new logins)
        if (typeof initGoogleAuth === 'function') {
            await initGoogleAuth();
        }

        // Load DB and OpenCV in parallel
        await Promise.all([
            loadDatabase(),
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

        // Load feature flags and wire magical feature buttons
        if (typeof loadFeatureFlags === 'function') {
            await loadFeatureFlags();
            wireMagicalFeatureButtons();
        }

        // Show Live Scan option in scan panel (if device has camera)
        if (typeof hasCameraSupport === 'function' && hasCameraSupport()) {
            const btnLiveScan = document.getElementById('btnLiveScan');
            if (btnLiveScan) btnLiveScan.style.display = '';
            btnLiveScan?.addEventListener('click', () => {
                const panel = document.getElementById('scanOptionsPanel');
                if (panel) panel.style.display = 'none';
                if (typeof openContinuousScanner === 'function') openContinuousScanner();
            });
        }

        // Remove skeleton loading placeholders
        document.body.classList.add('app-loaded');

        console.log('✅ Card Scanner Ready!');

    } catch (err) {
        console.error('❌ Initialization error:', err);
        // Still remove skeletons on error so the real UI is visible
        document.body.classList.add('app-loaded');
        if (typeof showToast === 'function') {
            showToast('Some features may not be available', '⚠️');
        }
    }
}

// ── Magical feature button wiring ────────────────────────────────────────────
function wireMagicalFeatureButtons() {
    const hasGrader     = typeof isFeatureEnabled === 'function' && isFeatureEnabled('condition_grader');
    const hasSetComp    = typeof isFeatureEnabled === 'function' && isFeatureEnabled('set_completion');
    const hasEbayLister = typeof isFeatureEnabled === 'function' && isFeatureEnabled('ebay_lister');
    const hasAny        = hasGrader || hasSetComp || hasEbayLister;

    // Show/hide the magical features row in Tools & Export
    const row = document.getElementById('magicalFeaturesRow');
    if (row) row.style.display = hasAny ? '' : 'none';

    // Show/hide in More sheet
    const moreSection = document.getElementById('moreMagicalSection');
    if (moreSection) moreSection.style.display = hasAny ? '' : 'none';

    // Show/hide individual buttons based on their flag
    const gradeBtn   = document.getElementById('btnGradeCard');
    const setCompBtn = document.getElementById('btnSetCompletion');
    const listBtn    = document.getElementById('btnEbayLister');
    if (gradeBtn)   gradeBtn.style.display   = hasGrader     ? '' : 'none';
    if (setCompBtn) setCompBtn.style.display  = hasSetComp   ? '' : 'none';
    if (listBtn)    listBtn.style.display     = hasEbayLister ? '' : 'none';

    // Wire click handlers (main toolbar)
    gradeBtn?.addEventListener('click', () => {
        if (typeof triggerGradeCard === 'function') triggerGradeCard();
    });
    setCompBtn?.addEventListener('click', () => {
        if (typeof analyzeSetCompletion === 'function') analyzeSetCompletion();
    });
    listBtn?.addEventListener('click', () => {
        // Use the most recently scanned card from collections
        const cards = (typeof getCollections === 'function')
            ? getCollections().flatMap(c => c.cards).sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp))
            : [];
        if (typeof triggerEbayLister === 'function') triggerEbayLister(cards[0] || null);
    });

    // Wire click handlers (More sheet) — use pickers so user can choose which card
    document.getElementById('moreGradeCard')?.addEventListener('click', () => {
        if (typeof triggerGradeCardWithPicker === 'function') triggerGradeCardWithPicker();
        else if (typeof triggerGradeCard === 'function') triggerGradeCard();
    });
    document.getElementById('moreSetCompletion')?.addEventListener('click', () => {
        if (typeof analyzeSetCompletion === 'function') analyzeSetCompletion();
    });
    document.getElementById('moreEbayLister')?.addEventListener('click', () => {
        if (typeof triggerEbayListerWithPicker === 'function') triggerEbayListerWithPicker();
        else if (typeof triggerEbayLister === 'function') triggerEbayLister(null);
    });

    // Expose card "⋯ More" button globally (called from renderCards inline HTML)
    if (hasGrader || hasEbayLister) {
        // Show the ⋯ button on all already-rendered cards
        document.querySelectorAll('.btn-card-more').forEach(btn => {
            btn.style.display = '';
        });
        // Also reveal new ones as cards are rendered via a MutationObserver
        if (!window._cardMoreObserver) {
            window._cardMoreObserver = new MutationObserver(() => {
                if (isFeatureEnabled('condition_grader') || isFeatureEnabled('ebay_lister')) {
                    document.querySelectorAll('.btn-card-more[style*="display:none"]').forEach(b => {
                        b.style.display = '';
                    });
                }
            });
            const grid = document.getElementById('cardsGrid');
            if (grid) window._cardMoreObserver.observe(grid, { childList: true, subtree: true });
        }
    }
}

// Start init when DOM is ready
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
} else {
    init();
}
