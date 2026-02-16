// FIX for collections.js - Add null checks to prevent errors

// Find your renderCollections function and update it like this:

function renderCollections() {
    const container = document.getElementById('collectionsBar');
    
    // CRITICAL: Add null check
    if (!container) {
        console.warn('Collections bar element not found in DOM');
        return; // Exit early if element doesn't exist
    }
    
    const collections = getCollections();
    const currentId = getCurrentCollectionId();
    
    // Rest of your existing code...
    container.innerHTML = collections.map(col => `
        <button class="collection-btn ${col.id === currentId ? 'active' : ''}"
                onclick="switchCollection('${col.id}')">
            ${col.name}
        </button>
    `).join('');
    
    // Show/hide the bar
    container.style.display = collections.length > 1 ? 'flex' : 'none';
}

// Also add null check to loadCollections function:

function loadCollections(collectionsData) {
    const container = document.getElementById('collectionsBar');
    
    // CRITICAL: Add null check
    if (!container) {
        console.warn('Collections bar element not found in DOM');
        return;
    }
    
    // Rest of your existing code...
}

// Add null check to any other function that accesses DOM elements:

function updateCollectionUI() {
    const bar = document.getElementById('collectionsBar');
    
    if (!bar) return; // Fail silently if element doesn't exist
    
    // Rest of code...
}
