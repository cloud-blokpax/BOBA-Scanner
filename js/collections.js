// Collections Management

const DEFAULT_COLLECTION = {
    id: 'default',
    name: 'Default Collection',
    cards: [],
    stats: {
        scanned: 0,
        free: 0,
        cost: 0,
        aiCalls: 0
    }
};

// Get all collections from localStorage
function getCollections() {
    try {
        const stored = localStorage.getItem('collections');
        if (stored) {
            const collections = JSON.parse(stored);
            // Ensure default collection exists
            if (!collections.find(c => c.id === 'default')) {
                collections.unshift(DEFAULT_COLLECTION);
            }
            return collections;
        }
    } catch (error) {
        console.error('Error loading collections:', error);
    }
    return [DEFAULT_COLLECTION];
}

// Save collections to localStorage
function saveCollections(collections) {
    try {
        localStorage.setItem('collections', JSON.stringify(collections));
    } catch (error) {
        console.error('Error saving collections:', error);
    }
}

// Get current collection ID
function getCurrentCollectionId() {
    return localStorage.getItem('currentCollectionId') || 'default';
}

// Set current collection ID
function setCurrentCollectionId(id) {
    localStorage.setItem('currentCollectionId', id);
}

// Get current collection
function getCurrentCollection() {
    const collections = getCollections();
    const currentId = getCurrentCollectionId();
    const collection = collections.find(c => c.id === currentId);
    return collection || DEFAULT_COLLECTION;
}

// Create new collection
function createCollection(name) {
    const collections = getCollections();
    const newCollection = {
        id: `collection_${Date.now()}`,
        name: name || `Collection ${collections.length + 1}`,
        cards: [],
        stats: {
            scanned: 0,
            free: 0,
            cost: 0,
            aiCalls: 0
        }
    };
    collections.push(newCollection);
    saveCollections(collections);
    renderCollections();
    return newCollection;
}

// Delete collection
function deleteCollection(id) {
    if (id === 'default') {
        if (typeof showToast === 'function') {
            showToast('Cannot delete default collection', '⚠️');
        }
        return;
    }
    
    if (!confirm('Delete this collection? All cards will be lost.')) {
        return;
    }
    
    let collections = getCollections();
    collections = collections.filter(c => c.id !== id);
    
    // If deleted collection was current, switch to default
    if (getCurrentCollectionId() === id) {
        setCurrentCollectionId('default');
    }
    
    saveCollections(collections);
    renderCollections();
    
    if (typeof renderCards === 'function') {
        renderCards();
    }
    
    if (typeof showToast === 'function') {
        showToast('Collection deleted', '🗑️');
    }
}

// Rename collection
function renameCollection(id, newName) {
    const collections = getCollections();
    const collection = collections.find(c => c.id === id);
    
    if (collection) {
        collection.name = newName;
        saveCollections(collections);
        renderCollections();
    }
}

// Switch to collection
function switchCollection(id) {
    const collections = getCollections();
    const collection = collections.find(c => c.id === id);
    
    if (!collection) {
        console.error('Collection not found:', id);
        return;
    }
    
    setCurrentCollectionId(id);
    renderCollections();
    
    if (typeof renderCards === 'function') {
        renderCards();
    }
    
    if (typeof updateStats === 'function') {
        updateStats();
    }
    
    if (typeof showToast === 'function') {
        showToast(`Switched to ${collection.name}`, '📂');
    }
}

// Add card to current collection
function addCardToCollection(card) {
    const collections = getCollections();
    const currentId = getCurrentCollectionId();
    const collection = collections.find(c => c.id === currentId);
    
    if (collection) {
        collection.cards.push(card);
        
        // Update stats
        collection.stats.scanned++;
        if (card.scanType === 'free') {
            collection.stats.free++;
        }
        if (card.cost) {
            collection.stats.cost += card.cost;
        }
        if (card.scanMethod === 'AI') {
            collection.stats.aiCalls++;
        }
        
        saveCollections(collections);
    }
}

// Remove card from current collection
function removeCardFromCollection(index) {
    const collections = getCollections();
    const currentId = getCurrentCollectionId();
    const collection = collections.find(c => c.id === currentId);
    
    if (collection && collection.cards[index]) {
        const card = collection.cards[index];
        
        // Update stats
        collection.stats.scanned--;
        if (card.scanType === 'free') {
            collection.stats.free--;
        }
        if (card.cost) {
            collection.stats.cost -= card.cost;
        }
        if (card.scanMethod === 'AI') {
            collection.stats.aiCalls--;
        }
        
        collection.cards.splice(index, 1);
        saveCollections(collections);
    }
}

// Update card in current collection
function updateCardInCollection(index, field, value) {
    const collections = getCollections();
    const currentId = getCurrentCollectionId();
    const collection = collections.find(c => c.id === currentId);
    
    if (collection && collection.cards[index]) {
        collection.cards[index][field] = value;
        saveCollections(collections);
    }
}

// Render collections bar
function renderCollections() {
    const container = document.getElementById('collectionsBar');
    
    // CRITICAL: Add null check to prevent errors
    if (!container) {
        console.warn('Collections bar element not found in DOM');
        return;
    }
    
    const collections = getCollections();
    const currentId = getCurrentCollectionId();
    
    // Only show if more than one collection
    if (collections.length <= 1) {
        container.style.display = 'none';
        return;
    }
    
    container.style.display = 'flex';
    container.innerHTML = collections.map(col => `
        <div class="collection-item ${col.id === currentId ? 'active' : ''}">
            <button class="collection-btn" onclick="switchCollection('${col.id}')">
                📂 ${col.name} (${col.cards.length})
            </button>
            ${col.id !== 'default' ? `
                <button class="collection-delete" onclick="deleteCollection('${col.id}')" title="Delete collection">
                    ×
                </button>
            ` : ''}
        </div>
    `).join('');
}

// Load collections on startup
function loadCollections(collectionsData) {
    // CRITICAL: Add null check
    const container = document.getElementById('collectionsBar');
    if (!container) {
        console.warn('Collections bar element not found');
        // Don't return - still process the data
    }
    
    if (collectionsData) {
        try {
            const collections = typeof collectionsData === 'string' 
                ? JSON.parse(collectionsData) 
                : collectionsData;
            
            // Ensure default collection exists
            if (!collections.find(c => c.id === 'default')) {
                collections.unshift(DEFAULT_COLLECTION);
            }
            
            saveCollections(collections);
        } catch (error) {
            console.error('Error loading collections:', error);
        }
    }
    
    renderCollections();
}

// Initialize collections
function initCollections() {
    const collections = getCollections();
    
    // Ensure default collection exists
    if (!collections.find(c => c.id === 'default')) {
        collections.unshift(DEFAULT_COLLECTION);
        saveCollections(collections);
    }
    
    // Ensure current collection ID is valid
    const currentId = getCurrentCollectionId();
    if (!collections.find(c => c.id === currentId)) {
        setCurrentCollectionId('default');
    }
    
    renderCollections();
}

// Export collections to JSON
function exportCollections() {
    const collections = getCollections();
    const dataStr = JSON.stringify(collections, null, 2);
    const dataBlob = new Blob([dataStr], { type: 'application/json' });
    const url = URL.createObjectURL(dataBlob);
    
    const link = document.createElement('a');
    link.href = url;
    link.download = `boba-collections-${Date.now()}.json`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
    
    if (typeof showToast === 'function') {
        showToast('Collections exported', '📥');
    }
}

// Import collections from JSON
function importCollections(file) {
    const reader = new FileReader();
    
    reader.onload = function(e) {
        try {
            const imported = JSON.parse(e.target.result);
            
            if (!Array.isArray(imported)) {
                throw new Error('Invalid collections format');
            }
            
            // Merge with existing collections
            const existing = getCollections();
            const merged = [...existing];
            
            imported.forEach(impCol => {
                // Don't override default collection
                if (impCol.id === 'default') return;
                
                // Check if collection already exists
                const existingIndex = merged.findIndex(c => c.id === impCol.id);
                if (existingIndex >= 0) {
                    // Ask user what to do
                    if (confirm(`Collection "${impCol.name}" already exists. Replace it?`)) {
                        merged[existingIndex] = impCol;
                    }
                } else {
                    merged.push(impCol);
                }
            });
            
            saveCollections(merged);
            renderCollections();
            
            if (typeof showToast === 'function') {
                showToast('Collections imported', '📤');
            }
        } catch (error) {
            console.error('Error importing collections:', error);
            if (typeof showToast === 'function') {
                showToast('Failed to import collections', '❌');
            }
        }
    };
    
    reader.readAsText(file);
}

// Show collections manager
function showCollectionsManager() {
    const collections = getCollections();
    const currentId = getCurrentCollectionId();
    
    // Create modal or use existing one
    const modal = document.getElementById('collectionsModal');
    if (!modal) {
        console.warn('Collections modal not found');
        return;
    }
    
    const content = `
        <div class="collections-manager">
            <h3>Manage Collections</h3>
            <div class="collections-list">
                ${collections.map(col => `
                    <div class="collection-row ${col.id === currentId ? 'active' : ''}">
                        <span class="collection-name">${col.name}</span>
                        <span class="collection-count">(${col.cards.length} cards)</span>
                        <div class="collection-actions">
                            <button onclick="switchCollection('${col.id}')">Switch</button>
                            ${col.id !== 'default' ? `
                                <button onclick="renameCollection('${col.id}', prompt('New name:', '${col.name}'))">Rename</button>
                                <button onclick="deleteCollection('${col.id}')">Delete</button>
                            ` : ''}
                        </div>
                    </div>
                `).join('')}
            </div>
            <div class="collections-actions">
                <button onclick="createCollection(prompt('Collection name:'))">Create New</button>
                <button onclick="exportCollections()">Export All</button>
                <button onclick="document.getElementById('importFile').click()">Import</button>
                <input type="file" id="importFile" accept=".json" style="display:none" onchange="importCollections(this.files[0])">
            </div>
        </div>
    `;
    
    const modalBody = modal.querySelector('.modal-body');
    if (modalBody) {
        modalBody.innerHTML = content;
    }
    
    modal.classList.add('active');
}

// Initialize on load
document.addEventListener('DOMContentLoaded', () => {
    initCollections();
});

console.log('✅ Collections module loaded');
