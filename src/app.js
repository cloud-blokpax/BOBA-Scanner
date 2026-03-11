// App initialization — ES Module
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

import { loadAppConfig } from './core/state.js';
import { loadDatabase } from './core/database/database.js';
import { loadOpenCV } from './core/scanner/opencv.js';
import { handleFiles } from './core/scanner/scanner.js';
import { initGoogleAuth, restoreSession } from './core/auth/google-auth.js';
import { initUserManagement, updateLimitsUI } from './core/auth/user-management.js';
import { loadCollections, getCollections } from './core/collection/collections.js';
import { initUploadArea } from './ui/upload-area.js';
import { loadFeatureFlags, isFeatureEnabled } from './core/infra/feature-flags.js';
import { hasCameraSupport, openContinuousScanner } from './core/scanner/continuous-scanner.js';
import { showToast } from './ui/toast.js';

// ── Step 1: Wire fileInput immediately — before ANY async work ────────────────
// This runs synchronously as soon as the script tag is parsed.
// handleFiles is imported from scanner.js.
function attachFileInputNow() {
    const fileInput = document.getElementById('fileInput');
    if (fileInput) {
        fileInput.addEventListener('change', handleFiles);
        console.log('📎 File input wired immediately');
    } else {
        // DOM not ready yet — wait for it
        document.addEventListener('DOMContentLoaded', function onReady() {
            const fi = document.getElementById('fileInput');
            if (fi) {
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
        await loadAppConfig();

        // Initialize user management (needs appConfig.supabaseUrl)
        await initUserManagement();

        // Restore session from localStorage FIRST — independent of Google SDK.
        await restoreSession();

        // Load collections from localStorage
        loadCollections();

        // Initialize Google Auth (sets up sign-in button, handles new logins)
        await initGoogleAuth();

        // Load DB and OpenCV in parallel
        await Promise.all([
            loadDatabase(),
            loadOpenCV()
        ]);

        // Init upload area drag-and-drop (buttons already wired via onclick in HTML)
        initUploadArea();

        // Update scan limits display
        updateLimitsUI();

        // Load feature flags and wire magical feature buttons
        await loadFeatureFlags();
        wireMagicalFeatureButtons();

        // Show Live Scan option in scan panel (if device has camera)
        if (hasCameraSupport()) {
            const btnLiveScan = document.getElementById('btnLiveScan');
            if (btnLiveScan) btnLiveScan.style.display = '';
            btnLiveScan?.addEventListener('click', () => {
                const panel = document.getElementById('scanOptionsPanel');
                if (panel) panel.style.display = 'none';
                openContinuousScanner();
            });
        }

        // Remove skeleton loading placeholders
        document.body.classList.add('app-loaded');

        console.log('✅ Card Scanner Ready!');

    } catch (err) {
        console.error('❌ Initialization error:', err);
        // Still remove skeletons on error so the real UI is visible
        document.body.classList.add('app-loaded');
        showToast('Some features may not be available', '⚠️');
    }
}

// ── Magical feature button wiring ────────────────────────────────────────────
function wireMagicalFeatureButtons() {
    const hasGrader     = isFeatureEnabled('condition_grader');
    const hasSetComp    = isFeatureEnabled('set_completion');
    const hasEbayLister = isFeatureEnabled('ebay_lister');
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
    // These reference lazy-loaded functions, so keep typeof guards
    gradeBtn?.addEventListener('click', () => {
        if (typeof window.triggerGradeCard === 'function') window.triggerGradeCard();
    });
    setCompBtn?.addEventListener('click', () => {
        if (typeof window.analyzeSetCompletion === 'function') window.analyzeSetCompletion();
    });
    listBtn?.addEventListener('click', () => {
        const cards = getCollections().flatMap(c => c.cards).sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));
        if (typeof window.triggerEbayLister === 'function') window.triggerEbayLister(cards[0] || null);
    });

    // NOTE: More sheet items (moreGradeCard, moreSetCompletion, moreEbayLister)
    // are already wired via wireMoreItem() in bottom-nav.js.
    // Do NOT add duplicate click handlers here — it causes double-firing.

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
