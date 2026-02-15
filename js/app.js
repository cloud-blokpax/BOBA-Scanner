// App initialization
async function init() {
    console.log('🚀 Initializing Card Scanner...');
    
    try {
        // Initialize user management first (if Supabase is configured)
        if (typeof initUserManagement === 'function') {
            await initUserManagement();
        }
        
        // Load collections
        loadCollections();
        
        // Initialize Google Auth (if configured)
        if (typeof initGoogleAuth === 'function') {
            await initGoogleAuth();
            
            // If user is signed in, handle sign-in
            if (typeof googleUser !== 'undefined' && googleUser) {
                await handleUserSignIn(googleUser);
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
        
        // Set up event listeners
        initUploadArea();
        
        const fileInput = document.getElementById('fileInput');
        if (fileInput) {
            fileInput.onchange = handleFiles;
        }
        
        // Update limits UI if function exists
        if (typeof updateLimitsUI === 'function') {
            updateLimitsUI();
        }
        
        console.log('✅ Card Scanner Ready!');
        
    } catch (err) {
        console.error('❌ Initialization error:', err);
        showToast('Some features may not be available', '⚠️');
    }
}

// Start app when DOM is ready
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
} else {
    init();
}
