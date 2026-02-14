// Collection Management Functions

function loadCollections() {
    const saved = localStorage.getItem('card_collections');
    if (saved) {
        collections = JSON.parse(saved);
    }
    
    if (collections.length === 0) {
        collections.push({
            id: Date.now(),
            name: 'Default Collection',
            cards: [],
            stats: { scanned: 0, free: 0, cost: 0 }
        });
    }
    
    currentCollectionId = collections[0].id;
    saveCollections();
    renderCollections();
    renderCurrentCollection();
}

function saveCollections() {
    localStorage.setItem('card_collections', JSON.stringify(collections));
}

function createNewCollection() {
    collectionModalMode = 'create';
    document.getElementById('collectionModalTitle').textContent = 'New Collection';
    document.getElementById('collectionNameInput').value = '';
    document.getElementById('collectionNameModal').classList.add('active');
    document.getElementById('collectionNameInput').focus();
}

function renameCollection(id) {
    const collection = collections.find(c => c.id === id);
    if (!collection) return;
    
    collectionModalMode = 'rename';
    editingCollectionId = id;
    document.getElementById('collectionModalTitle').textContent = 'Rename Collection';
    document.getElementById('collectionNameInput').value = collection.name;
    document.getElementById('collectionNameModal').classList.add('active');
    document.getElementById('collectionNameInput').focus();
}

function deleteCollection(id) {
    if (collections.length === 1) {
        showToast('Cannot delete the only collection', '⚠️');
        return;
    }
    
    const collection = collections.find(c => c.id === id);
    if (!collection) return;
    
    if (!confirm(`Delete "${collection.name}"? This cannot be undone.`)) return;
    
    collections = collections.filter(c => c.id !== id);
    
    if (currentCollectionId === id) {
        currentCollectionId = collections[0].id;
    }
    
    saveCollections();
    renderCollections();
    renderCurrentCollection();
    showToast('Collection deleted');
}

function switchCollection(id) {
    currentCollectionId = id;
    renderCollections();
    renderCurrentCollection();
}

function closeCollectionModal() {
    document.getElementById('collectionNameModal').classList.remove('active');
}

function saveCollectionName() {
    const name = document.getElementById('collectionNameInput').value.trim();
    
    if (!name) {
        showToast('Please enter a name', '⚠️');
        return;
    }
    
    if (collectionModalMode === 'create') {
        collections.push({
            id: Date.now(),
            name,
            cards: [],
            stats: { scanned: 0, free: 0, cost: 0 }
        });
        currentCollectionId = collections[collections.length - 1].id;
        showToast(`Created "${name}"`);
    } else {
        const collection = collections.find(c => c.id === editingCollectionId);
        if (collection) {
            collection.name = name;
            showToast(`Renamed to "${name}"`);
        }
    }
    
    saveCollections();
    renderCollections();
    renderCurrentCollection();
    closeCollectionModal();
}

function renderCollections() {
    const list = document.getElementById('collectionList');
    list.innerHTML = collections.map(c => {
        // NEW: Get stats for quick display
        const stats = typeof getCollectionStats === 'function' ? getCollectionStats(c) : null;
        
        return `
            <div class="collection-item ${c.id === currentCollectionId ? 'active' : ''}" 
                 onclick="switchCollection(${c.id})">
                <div class="collection-info">
                    <div class="collection-name">${c.name}</div>
                    <div class="collection-count">
                        🎴 ${c.cards.length} cards
                        ${stats && stats.uniqueSets > 0 ? ` · 📦 ${stats.uniqueSets} sets` : ''}
                    </div>
                </div>
                <div class="collection-actions">
                    <button class="btn-collection-action" onclick="event.stopPropagation(); renameCollection(${c.id})">✏️</button>
                    <button class="btn-collection-action" onclick="event.stopPropagation(); deleteCollection(${c.id})">🗑️</button>
                </div>
            </div>
        `;
    }).join('');
}

function renderCurrentCollection() {
    const collection = getCurrentCollection();
    if (!collection) return;
    
    document.getElementById('currentCollectionBadge').textContent = collection.name;
    
    updateStats();
    renderCards();
    updateActionBar();  // NEW: Update action bar with new buttons
}

function clearCurrentCollection() {
    const collection = getCurrentCollection();
    if (!confirm(`Clear all cards in "${collection.name}"?`)) return;
    
    collection.cards.forEach(c => c.imageUrl && URL.revokeObjectURL(c.imageUrl));
    collection.cards = [];
    collection.stats = { scanned: 0, free: 0, cost: 0 };
    
    saveCollections();
    renderCollections();
    renderCurrentCollection();
    showToast('Collection cleared');
}
