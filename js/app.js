// App initialization - FIXED

async function init() {
    console.log('🚀 Initializing Card Scanner...');
    
    try {
        // Initialize user management first
        if (typeof initUserManagement === 'function') {
            await initUserManagement();
        }
        
        // Load collections
        if (typeof loadCollections === 'function') {
            loadCollections();
        }
        
        // Initialize Google Auth
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
        
        // Load all async dependencies
        await Promise.all([
            loadDatabase(),
            initTesseract(),
            loadOpenCV()
        ]);
        
        // Connect file input
        // ── FIX ──────────────────────────────────────────────────────────────
        // REMOVED: cloneNode on fileInput was redundant — the input starts
        // with no listeners, so there is nothing to clear. The clone also
        // ran AFTER initUploadArea(), which had already set up drag/drop on
        // the upload area. The clone itself is harmless but adds confusion.
        // Attach the change listener directly to the existing element.
        // ─────────────────────────────────────────────────────────────────────
        const fileInput = document.getElementById('fileInput');
        if (fileInput && typeof handleFiles === 'function') {
            console.log('📎 Connecting file input...');
            fileInput.addEventListener('change', handleFiles);
            console.log('✅ File input connected');
        }
        
        // Init upload area (drag & drop only — buttons use inline onclick)
        if (typeof initUploadArea === 'function') {
            console.log('📤 Initializing upload area...');
            initUploadArea();
        }
        
        // Update limits UI
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

// Start app ONCE when DOM is ready
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
} else {
    init();
}
