// UI Helper Functions

function setStatus(type, state) {
    const el = document.getElementById(`status${type.charAt(0).toUpperCase() + type.slice(1)}`);
    el.className = `status-dot ${state}`;
}

function showToast(message, icon = '✓') {
    const toast = document.getElementById('toast');
    document.getElementById('toastIcon').textContent = icon;
    document.getElementById('toastMessage').textContent = message;
    toast.classList.add('show');
    setTimeout(() => toast.classList.remove('show'), 3000);
}

function showLoading(show, text = 'Processing...') {
    const overlay = document.getElementById('loadingOverlay');
    document.getElementById('loadingText').textContent = text;
    overlay.classList.toggle('active', show);
}

function setProgress(percent) {
    document.getElementById('progressFill').style.width = `${percent}%`;
}

function openSettings() {
    document.getElementById('settingsModal').classList.add('active');
    document.getElementById('toggleAutoDetect').checked = config.autoDetect;
    document.getElementById('togglePerspective').checked = config.perspective;
    document.getElementById('toggleRegionOcr').checked = config.regionOcr;
    document.getElementById('selectQuality').value = config.quality;
    document.getElementById('rangeThreshold').value = config.threshold;
    document.getElementById('thresholdValue').textContent = config.threshold;
}

function closeSettings() {
    document.getElementById('settingsModal').classList.remove('active');
}

function updateStats() {
    const collection = getCurrentCollection();
    const stats = collection.stats;
    
    const paid = stats.scanned - stats.free;
    const rate = stats.scanned > 0 ? Math.round((stats.free / stats.scanned) * 100) : 0;
    
    document.getElementById('statFree').textContent = stats.free;
    document.getElementById('statPaid').textContent = paid;
    document.getElementById('statCost').textContent = `$${stats.cost.toFixed(2)}`;
    document.getElementById('statRate').textContent = `${rate}%`;
    
    document.getElementById('statsBar').classList.toggle('hidden', stats.scanned === 0);
}

function renderCards() {
    const collection = getCurrentCollection();
    const cards = collection.cards;
    
    const grid = document.getElementById('cardsGrid');
    const empty = document.getElementById('emptyState');
    const actionBar = document.getElementById('actionBar');
    
    if (cards.length === 0) {
        empty.classList.remove('hidden');
        actionBar.classList.add('hidden');
        grid.innerHTML = '';
        return;
    }
    
    empty.classList.add('hidden');
    actionBar.classList.remove('hidden');
    
    grid.innerHTML = cards.map((card, i) => `
        <div class="card">
            <img class="card-image" src="${card.imageUrl}" alt="${card.cardNumber}">
            <div class="card-body">
                <span class="card-badge ${card.scanType === 'free' ? 'badge-free' : 'badge-paid'}">
                    ${card.scanMethod}
                </span>
                <div class="card-fields">
                    ${renderField('Card ID', 'cardId', i, card.cardId, true)}
                    ${renderField('Name', 'hero', i, card.hero, true)}
                    ${renderField('Year', 'year', i, card.year, true)}
                    ${renderField('Set', 'set', i, card.set, true)}
                    ${renderField('Card #', 'cardNumber', i, card.cardNumber, false)}
                    ${renderField('Parallel', 'pose', i, card.pose, true)}
                    ${renderField('Weapon', 'weapon', i, card.weapon, true)}
                    ${renderField('Power', 'power', i, card.power, true)}
                </div>
                <button class="btn-remove" onclick="removeCard(${i})">Remove</button>
            </div>
        </div>
    `).join('');
}

function renderField(label, field, index, value, autoFilled) {
    return `
        <div class="field">
            <div class="field-label">${label}</div>
            <input class="field-input ${autoFilled ? 'auto-filled' : ''}" 
                   value="${value}" 
                   onchange="updateCard(${index}, '${field}', this.value)">
        </div>
    `;
}

// ==================== NEW: RECENT SCANS FUNCTIONS ====================

function renderRecentScans() {
    // Get all cards from all collections with timestamps
    const allCards = [];
    
    collections.forEach(collection => {
        collection.cards.forEach((card, index) => {
            allCards.push({
                ...card,
                collectionName: collection.name,
                collectionId: collection.id,
                // Use index as proxy for recency (last added = highest index)
                timestamp: index
            });
        });
    });
    
    // Sort by most recent (assuming cards are added in order)
    const recent = allCards.slice(-5).reverse();
    
    if (recent.length === 0) {
        return `
            <div class="recent-scans-empty">
                <div class="empty-icon">📷</div>
                <div class="empty-text">No recent scans</div>
            </div>
        `;
    }
    
    return `
        <div class="recent-scans-list">
            ${recent.map(card => `
                <div class="recent-scan-item">
                    <img src="${card.imageUrl}" alt="${card.cardNumber}" class="recent-scan-image">
                    <div class="recent-scan-info">
                        <div class="recent-scan-name">${card.hero}</div>
                        <div class="recent-scan-number">${card.cardNumber}</div>
                        <div class="recent-scan-collection">${card.collectionName}</div>
                    </div>
                    <div class="recent-scan-badge ${card.scanType === 'free' ? 'badge-free' : 'badge-paid'}">
                        ${card.scanType === 'free' ? '🎉' : '💰'}
                    </div>
                </div>
            `).join('')}
        </div>
    `;
}

function showRecentScansWidget() {
    const widget = `
        <div class="recent-scans-widget">
            <div class="widget-header">
                <h3>🕐 Recent Scans</h3>
                <button class="widget-close" onclick="closeRecentScans()">×</button>
            </div>
            <div class="widget-content">
                ${renderRecentScans()}
            </div>
        </div>
    `;
    
    // Remove existing widget if any
    const existing = document.querySelector('.recent-scans-widget');
    if (existing) existing.remove();
    
    document.querySelector('.main-content').insertAdjacentHTML('afterbegin', widget);
}

function closeRecentScans() {
    const widget = document.querySelector('.recent-scans-widget');
    if (widget) widget.remove();
}

function toggleRecentScans() {
    const existing = document.querySelector('.recent-scans-widget');
    if (existing) {
        closeRecentScans();
    } else {
        showRecentScansWidget();
    }
}

// Auto-refresh recent scans when cards change
function refreshRecentScans() {
    const widget = document.querySelector('.recent-scans-widget');
    if (widget) {
        const content = widget.querySelector('.widget-content');
        content.innerHTML = renderRecentScans();
    }
}

// ==================== NEW: ACTION BAR UPDATE ====================

function updateActionBar() {
    const collection = getCurrentCollection();
    const actionBar = document.getElementById('actionBar');
    
    if (collection.cards.length === 0) {
        actionBar.classList.add('hidden');
        return;
    }
    
    actionBar.classList.remove('hidden');
    actionBar.innerHTML = `
        <button class="btn btn-secondary" onclick="toggleRecentScans()">🕐</button>
        <button class="btn btn-stats" onclick="showStatsModal()">📊</button>
        <button class="btn btn-secondary" onclick="openSettings()">⚙️</button>
        <button class="btn btn-danger" onclick="clearCurrentCollection()">🗑️</button>
    `;
}
