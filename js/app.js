// Main Application Initialization

window.addEventListener('load', init);

async function init() {
    console.log('🚀 Initializing Card Scanner...');
    
    // Initialize API key if exists
    if (apiKey) {
        document.getElementById('apiKeyInput').value = apiKey;
        updateApiToggle(true);
    }
    
    // Load collections first
    loadCollections();
    
    // Load all async dependencies in parallel
    await Promise.all([
        loadDatabase(),
        initTesseract(),
        loadOpenCV()
    ]);
    
    // Set up event listeners
    document.getElementById('uploadArea').onclick = () => document.getElementById('fileInput').click();
    document.getElementById('fileInput').onchange = handleFiles;
    
    console.log('✅ Card Scanner Ready!');
    console.log('📊 Stats:', {
        database: database.length + ' cards',
        collections: collections.length,
        currentCollection: getCurrentCollection()?.name
    });
}
