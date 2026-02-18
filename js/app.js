// App initialization - COMPLETE FIXED VERSION

async function init() {
    console.log('🚀 Initializing Card Scanner...');
    
    try {
        // Initialize user management first (if Supabase is configured)
        if (typeof initUserManagement === 'function') {
            await initUserManagement();
        }
        
        // Load collections
        if (typeof loadCollections === 'function') {
            loadCollections();
        }
        
        // Initialize Google Auth (if configured)
        if (typeof initGoogleAuth === 'function') {
            await initGoogleAuth();
            
            // If user is signed in, handle sign-in
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
        
        // Set up upload area event listeners
        if (typeof initUploadArea === 'function') {
            initUploadArea();
        }
        
        // CRITICAL: Connect file input to handleFiles
        const fileInput = document.getElementById('fileInput');
        if (fileInput) {
            console.log('📎 Connecting file input to handleFiles...');
            
            // Check if handleFiles exists
            if (typeof handleFiles === 'function') {
                // Use addEventListener for better reliability
                fileInput.addEventListener('change', handleFiles);
                console.log('✅ File input connected successfully');
            } else {
                console.error('❌ handleFiles function not found!');
            }
        } else {
            console.error('❌ File input element not found!');
        }
        
        // Update limits UI if function exists
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

// Start app when DOM is ready
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
} else {
    init();
}
