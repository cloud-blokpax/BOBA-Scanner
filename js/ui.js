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
