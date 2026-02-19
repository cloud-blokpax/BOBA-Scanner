// UI Helper Functions - COMPLETE PRODUCTION VERSION

function setStatus(type, state) {
    const el = document.getElementById(`status${type.charAt(0).toUpperCase() + type.slice(1)}`);
    if (el) el.className = `status-dot ${state}`;
}

function showToast(message, icon = '✓') {
    const toast = document.getElementById('toast');
    const toastIcon = document.getElementById('toastIcon');
    const toastMessage = document.getElementById('toastMessage');
    
    if (!toast || !toastIcon || !toastMessage) {
        console.log('Toast elements not found, showing alert:', message);
        return;
    }
    
    toastIcon.textContent = icon;
    toastMessage.textContent = message;
    toast.classList.add('show');
    setTimeout(() => toast.classList.remove('show'), 3000);
}

function showLoading(show, text = 'Processing...') {
    const overlay = document.getElementById('loadingOverlay');
    const loadingText = document.getElementById('loadingText');
    
    if (!overlay || !loadingText) return;
    
    loadingText.textContent = text;
    overlay.classList.toggle('active', show);
}

function setProgress(percent) {
    const progressFill = document.getElementById('progressFill');
    if (progressFill) {
        progressFill.style.width = `${percent}%`;
    }
}

function updateStats() {
    // FIXED: Get collections properly instead of using reference
    const collections = getCollections();
    const currentId = getCurrentCollectionId();
    const collection = collections.find(c => c.id === currentId);
    
    if (!collection) {
        console.warn('No collection found for stats update');
        return;
    }
    
    const stats = collection.stats;
    const paid = stats.scanned - stats.free;
    const rate = stats.scanned > 0 ? Math.round((stats.free / stats.scanned) * 100) : 0;
    
    const statFree = document.getElementById('statFree');
    const statPaid = document.getElementById('statPaid');
    const statCost = document.getElementById('statCost');
    const statRate = document.getElementById('statRate');
    
    if (statFree) statFree.textContent = stats.free;
    if (statPaid) statPaid.textContent = paid;
    if (statCost) statCost.textContent = `$${stats.cost.toFixed(2)}`;
    if (statRate) statRate.textContent = `${rate}%`;
    
    const statsBar = document.getElementById('statsBar');
    if (statsBar) {
        statsBar.classList.toggle('hidden', stats.scanned === 0);
    }
}

function renderCards() {
    console.log('🎨 Rendering cards...');
    
    // FIXED: Get collections properly instead of using reference
    const collections = getCollections();
    const currentId = getCurrentCollectionId();
    const collection = collections.find(c => c.id === currentId);
    
    if (!collection) {
        console.error('❌ No collection found');
        return;
    }
    
    const cards = collection.cards || [];
    console.log(`📊 Rendering ${cards.length} card(s)`);
    
    const grid = document.getElementById('cardsGrid');
    const empty = document.getElementById('emptyState');
    const actionBar = document.getElementById('actionBar');
    
    if (!grid) {
        console.error('❌ Grid element not found');
        return;
    }
    
    // Show/hide empty state
    if (cards.length === 0) {
        if (empty) empty.classList.remove('hidden');
        if (actionBar) actionBar.classList.add('hidden');
        grid.innerHTML = '';
        grid.style.display = 'none';
        return;
    }
    
    if (empty) empty.classList.add('hidden');
    if (actionBar) actionBar.classList.remove('hidden');
    grid.style.display = 'grid';
    
    // Render cards
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
                <button class="btn-remove" onclick="removeCard(${i})">🗑️ Remove</button>
            </div>
        </div>
    `).join('');
    
    console.log('✅ Cards rendered successfully');
}

function renderField(label, field, index, value, autoFilled) {
    return `
        <div class="field">
            <div class="field-label">${label}</div>
            <input class="field-input ${autoFilled ? 'auto-filled' : ''}" 
                   type="text" 
                   value="${value || ''}" 
                   onchange="updateCard(${index}, '${field}', this.value)">
        </div>
    `;
}

function initUploadArea() {
    const uploadArea = document.getElementById('uploadArea');
    
    if (!uploadArea) {
        console.warn('Upload area element not found');
        return;
    }
    
    console.log('📤 Setting up upload area...');
    
    // Drag and drop handlers - attached directly, NO cloneNode
    // (cloneNode was stripping onclick attributes from the buttons inside,
    // making "Choose Image", "Take Photo" and "Settings" do nothing)
    uploadArea.addEventListener('dragover', function(e) {
        e.preventDefault();
        uploadArea.classList.add('dragover');
    });
    
    uploadArea.addEventListener('dragleave', function(e) {
        if (!uploadArea.contains(e.relatedTarget)) {
            uploadArea.classList.remove('dragover');
        }
    });
    
    uploadArea.addEventListener('drop', function(e) {
        e.preventDefault();
        uploadArea.classList.remove('dragover');
        
        const files = Array.from(e.dataTransfer.files).filter(f => 
            f.type.startsWith('image/')
        );
        
        if (files.length > 0) {
            const input = document.getElementById('fileInput');
            if (input) {
                const dataTransfer = new DataTransfer();
                files.forEach(file => dataTransfer.items.add(file));
                input.files = dataTransfer.files;
                input.dispatchEvent(new Event('change', { bubbles: true }));
            }
        }
    });
    
    console.log('✅ Upload area ready');
}

// ========================================
// COMPATIBILITY FUNCTIONS FOR REDESIGNED UI
// ========================================

window.openSettings = function() {
    const modal = document.getElementById('settingsModal');
    if (modal) {
        modal.classList.add('active');
        
        const toggleAutoDetect = document.getElementById('toggleAutoDetect');
        const togglePerspective = document.getElementById('togglePerspective');
        const toggleRegionOcr = document.getElementById('toggleRegionOcr');
        const selectQuality = document.getElementById('selectQuality');
        const rangeThreshold = document.getElementById('rangeThreshold');
        const thresholdValue = document.getElementById('thresholdValue');
        
        if (typeof config !== 'undefined') {
            if (toggleAutoDetect) toggleAutoDetect.checked = config.autoDetect;
            if (togglePerspective) togglePerspective.checked = config.perspective;
            if (toggleRegionOcr) toggleRegionOcr.checked = config.regionOcr;
            if (selectQuality) selectQuality.value = config.quality;
            if (rangeThreshold) rangeThreshold.value = config.threshold;
            if (thresholdValue) thresholdValue.textContent = config.threshold;
        }
    } else {
        showToast('Settings coming soon!', '⚙️');
    }
};

window.closeSettings = function() {
    const modal = document.getElementById('settingsModal');
    if (modal) {
        modal.classList.remove('active');
    }
};

window.capturePhoto = function(e) {
    if (e) e.stopPropagation();
    const fileInput = document.getElementById('fileInput');
    if (fileInput) {
        fileInput.setAttribute('capture', 'environment');
        fileInput.setAttribute('accept', 'image/*');
        fileInput.click();
        
        setTimeout(() => {
            fileInput.removeAttribute('capture');
        }, 100);
    }
};

window.chooseFromGallery = function(e) {
    if (e) e.stopPropagation();
    const fileInput = document.getElementById('fileInput');
    if (fileInput) {
        fileInput.removeAttribute('capture');
        fileInput.setAttribute('accept', 'image/*');
        fileInput.click();
    }
};

window.showSignInPrompt = function() {
    if (typeof google !== 'undefined' && google.accounts) {
        google.accounts.id.prompt();
    } else if (typeof initGoogleAuth === 'function') {
        initGoogleAuth();
    } else {
        showToast('Please enable Google Sign-In', '🔐');
    }
};

window.updateAuthUI = function(user) {
    const btnSignIn = document.getElementById('btnSignIn');
    const userAuthenticated = document.getElementById('userAuthenticated');
    const userName = document.getElementById('userName');
    const userEmail = document.getElementById('userEmail');
    const userAvatar = document.getElementById('userAvatar');
    
    if (user) {
        if (btnSignIn) btnSignIn.style.display = 'none';
        if (userAuthenticated) userAuthenticated.style.display = 'flex';
        
        if (userName) userName.textContent = user.name || 'User';
        if (userEmail) userEmail.textContent = user.email || '';
        if (userAvatar) {
            userAvatar.src = user.picture || user.profilePicture || '';
            userAvatar.alt = user.name || 'User';
        }
    } else {
        if (btnSignIn) btnSignIn.style.display = 'block';
        if (userAuthenticated) userAuthenticated.style.display = 'none';
    }
};

window.toggleUserMenu = function() {
    const dropdown = document.getElementById('userDropdown');
    if (dropdown) {
        dropdown.classList.toggle('active');
    } else {
        showToast('User menu', '👤');
    }
};

window.signOut = function() {
    if (!confirm('Sign out?')) return;
    
    if (typeof google !== 'undefined' && google.accounts) {
        google.accounts.id.disableAutoSelect();
    }
    
    localStorage.clear();
    sessionStorage.clear();
    
    if (typeof googleUser !== 'undefined') {
        window.googleUser = null;
    }
    if (typeof currentUser !== 'undefined') {
        window.currentUser = null;
    }
    
    updateAuthUI(null);
    showToast('Signed out successfully', '👋');
    
    setTimeout(() => {
        window.location.reload();
    }, 1000);
};

window.announceToScreenReader = function(message) {
    const announcement = document.createElement('div');
    announcement.setAttribute('role', 'status');
    announcement.setAttribute('aria-live', 'polite');
    announcement.setAttribute('aria-atomic', 'true');
    announcement.className = 'sr-only';
    announcement.style.position = 'absolute';
    announcement.style.left = '-10000px';
    announcement.style.width = '1px';
    announcement.style.height = '1px';
    announcement.style.overflow = 'hidden';
    announcement.textContent = message;
    document.body.appendChild(announcement);
    
    setTimeout(() => {
        if (announcement.parentNode) {
            document.body.removeChild(announcement);
        }
    }, 1000);
};

document.addEventListener('DOMContentLoaded', () => {
    setTimeout(() => {
        if (typeof googleUser !== 'undefined' && googleUser) {
            updateAuthUI(googleUser);
        } else if (typeof currentUser !== 'undefined' && currentUser) {
            updateAuthUI(currentUser);
        } else {
            updateAuthUI(null);
        }
    }, 500);
});

console.log('✅ UI helpers loaded');
