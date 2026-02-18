// App initialization - COMPLETE FIXED VERSION

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
        
        // CRITICAL: Only connect file input ONCE
        const fileInput = document.getElementById('fileInput');
        if (fileInput && typeof handleFiles === 'function') {
            console.log('📎 Connecting file input...');
            
            // Remove any existing listeners by cloning
            const newInput = fileInput.cloneNode(true);
            fileInput.parentNode.replaceChild(newInput, fileInput);
            
            // Add ONE listener
            newInput.addEventListener('change', handleFiles);
            console.log('✅ File input connected');
        }
        
        // CRITICAL: Only init upload area ONCE
        if (typeof initUploadArea === 'function') {
            console.log('📤 Initializing upload area...');
            initUploadArea();
            console.log('✅ Upload area ready');
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
