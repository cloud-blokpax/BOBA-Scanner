// UI Helper Functions - COMPLETE PRODUCTION VERSION

// Sanitize user-controlled strings before inserting into HTML
function escapeHtml(str) {
    if (str == null) return '';
    return String(str)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}


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
    const collections = getCollections();
    const currentId   = getCurrentCollectionId();
    const collection  = collections.find(c => c.id === currentId);
    if (!collection) return;

    const stats  = collection.stats;
    const aiUsed = stats.aiCalls || 0;
    const rate   = stats.scanned > 0 ? Math.round((stats.free / stats.scanned) * 100) : 0;

    // Use actual user limits from userLimits (set after sign-in) or guest defaults
    const isGuest    = typeof userLimits === 'undefined' || !userLimits;
    const cardLimit  = isGuest ? 5  : (userLimits.maxCards    || 5);
    const aiLimit    = isGuest ? 1  : (userLimits.maxApiCalls || 1);
    const sublabel   = isGuest ? 'Guest limit' : 'Your limit';

    const statCards      = document.getElementById('statCards');
    const statAI         = document.getElementById('statAI');
    const statCost       = document.getElementById('statCost');
    const statRate       = document.getElementById('statRate');
    const statCardsLabel = document.getElementById('statCardsLabel');
    const statAILabel    = document.getElementById('statAILabel');

    if (statCards)      statCards.textContent      = `${stats.scanned} / ${cardLimit}`;
    if (statAI)         statAI.textContent          = `${aiUsed} / ${aiLimit}`;
    if (statCost)       statCost.textContent        = `$${(stats.cost || 0).toFixed(2)}`;
    if (statRate)       statRate.textContent        = `${rate}%`;
    if (statCardsLabel) statCardsLabel.textContent  = sublabel;
    if (statAILabel)    statAILabel.textContent     = `${aiLimit - aiUsed} remaining`;
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
        if (empty) empty.style.display = '';
        if (actionBar) actionBar.style.display = 'none';
        grid.innerHTML = '';
        grid.style.display = 'none';
        return;
    }
    
    if (empty) empty.style.display = 'none';
    if (actionBar) actionBar.style.display = '';
    grid.style.display = 'grid';
    
    // Render cards
    grid.innerHTML = cards.map((card, i) => {
        const lowConfBadge = card.lowConfidence
            ? `<span class="conf-badge conf-low" title="Low confidence scan — please verify">⚠️ Verify</span>`
            : (card.confidence && card.scanType === 'free'
                ? `<span class="conf-badge conf-ok" title="OCR confidence: ${Math.round(card.confidence)}%">${Math.round(card.confidence)}%</span>`
                : '');

        const listingBadge = card.listingStatus === 'listed' && card.listingUrl
            ? `<a href="${escapeHtml(card.listingUrl)}" target="_blank" rel="noopener noreferrer"
                  class="listing-badge listed" title="View your eBay listing${card.listingPrice ? ': ' + card.listingPrice : ''}">
                 🟢 Listed${card.listingPrice ? ' ' + escapeHtml(card.listingPrice) : ''}
               </a>`
            : card.listingStatus === 'listed'
            ? `<span class="listing-badge listed">🟢 Listed</span>`
            : card.listingStatus === 'sold'
            ? `<span class="listing-badge sold">🔴 Sold${card.soldAt ? ' ' + new Date(card.soldAt).toLocaleDateString() : ''}</span>`
            : '';

        const rtlActive = card.readyToList ? 'active' : '';

        const conditionOptions = [
            '', 'Raw', 'PSA 1', 'PSA 2', 'PSA 3', 'PSA 4', 'PSA 5',
            'PSA 6', 'PSA 7', 'PSA 8', 'PSA 9', 'PSA 10',
            'BGS 7', 'BGS 7.5', 'BGS 8', 'BGS 8.5', 'BGS 9', 'BGS 9.5', 'BGS 10',
            'SGC 7', 'SGC 8', 'SGC 9', 'SGC 10'
        ].map(opt => `<option value="${opt}" ${card.condition === opt ? 'selected' : ''}>${opt || 'Condition...'}</option>`).join('');

        return `
        <div class="card-item" id="card_item_${i}">
            <div class="card-image-container" onclick="openCardDetail(${i})" style="cursor:pointer;" title="View details">
                <img class="card-image"
                     src="${card.imageUrl && !card.imageUrl.startsWith('blob:') ? card.imageUrl : ''}"
                     alt="${escapeHtml(card.cardNumber)}"
                     onerror="this.style.display='none'"
                     style="${(!card.imageUrl || card.imageUrl.startsWith('blob:')) ? 'display:none' : ''}">
                <span class="card-badge ${card.scanType === 'free' ? 'badge-free' : 'badge-paid'}">
                    ${escapeHtml(card.scanMethod || '')}
                </span>
                ${lowConfBadge}
                ${listingBadge}
            </div>
            <div class="card-content">
                <div class="card-title-row">
                    <div class="card-title">${escapeHtml(card.hero || 'Unknown Card')}</div>
                    <span id="rtl_badge_${i}" class="rtl-badge" style="${card.readyToList ? '' : 'display:none'}">🏷️ List</span>
                </div>
                ${(card.ebayAvgPrice || card.ebayLowPrice) ? `
                <div class="card-price-row">
                    ${card.ebayAvgPrice ? `<span class="price-avg" title="eBay avg price">⌀ $${Number(card.ebayAvgPrice).toFixed(2)}</span>` : ''}
                    ${card.ebayLowPrice ? `<span class="price-low" title="eBay lowest price">↓ $${Number(card.ebayLowPrice).toFixed(2)}</span>` : ''}
                </div>` : ''}
                <div class="card-meta" style="margin-top:4px;">
                    <span class="meta-tag">${escapeHtml(card.year || '')}</span>
                    <span class="meta-tag">${escapeHtml(card.set || '')}</span>
                    <span class="meta-tag">${escapeHtml(card.cardNumber || '')}</span>
                </div>
                <div style="margin:2px 0 8px;">
                    <button class="btn-ebay" onclick="openEbaySearch(${i})" title="Search eBay"
                            style="width:100%;justify-content:center;">
                        <span class="btn-ebay-icon">🛒</span><span>Search eBay</span>
                    </button>
                </div>
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
                <div class="card-condition-row">
                    <div class="field" style="flex:1;">
                        <div class="field-label">Condition</div>
                        <select class="field-input" onchange="updateCard(${i}, 'condition', this.value)">
                            ${conditionOptions}
                        </select>
                    </div>
                </div>
                <div class="card-notes-row">
                    <div class="field-label">Notes</div>
                    <textarea class="field-notes" rows="2" placeholder="Purchase price, provenance, notes..."
                              onchange="updateCard(${i}, 'notes', this.value)">${escapeHtml(card.notes || '')}</textarea>
                </div>
                <div class="card-actions">
                    <button id="rtl_btn_${i}" class="btn-rtl ${rtlActive}"
                            onclick="toggleReadyToList(${i})" title="${card.readyToList ? 'Remove from listing queue' : 'Mark ready to list'}">
                        🏷️
                    </button>
                    <button class="btn-detail" onclick="openCardDetail(${i})" title="View full details">🔍</button>
                    <button class="btn-remove" onclick="removeCard(${i})">🗑️</button>
                </div>
            </div>
        </div>`;
    }).join('');

    console.log('Cards rendered successfully');
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
    // Show the sign-in modal which contains the rendered Google button.
    // google.accounts.id.prompt() does not work on iOS Safari (blocked by ITP).
    // The rendered button opens a proper popup/tab that iOS allows.
    const modal = document.getElementById('signInModal');
    if (modal) {
        modal.classList.add('active');
        // Render Google button inside modal if not already rendered
        const container = document.getElementById('googleSignInButton');
        if (container && typeof google !== 'undefined' && google.accounts) {
            container.innerHTML = '';
            google.accounts.id.renderButton(container, {
                theme: 'outline', size: 'large', width: 280,
                text: 'signin_with', shape: 'rectangular'
            });
        }
    } else if (typeof google !== 'undefined' && google.accounts) {
        // Fallback: try prompt (works on desktop)
        google.accounts.id.prompt();
    } else {
        showToast('Sign-in not available — try refreshing', '🔐');
    }
};

window.closeSignInModal = function() {
    const modal = document.getElementById('signInModal');
    if (modal) modal.classList.remove('active');
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
    
    // Only clear auth data — preserve collections and settings
    localStorage.removeItem('googleUser');
    localStorage.removeItem('currentCollectionId');
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


// ========================================
// WIRE UP EVENTS — safety net for buttons
// Called on DOMContentLoaded as backup to 
// inline onclick handlers in index.html
// ========================================
function wireUpEvents() {
    const fi = () => document.getElementById('fileInput');

    const btnChooseImage = document.getElementById('btnChooseImage');
    if (btnChooseImage) btnChooseImage.addEventListener('click', function(e) {
        e.stopPropagation();
        const input = fi();
        if (input) { input.removeAttribute('capture'); input.click(); }
    });

    const btnCapture = document.getElementById('btnCapture');
    if (btnCapture) btnCapture.addEventListener('click', function(e) {
        e.stopPropagation();
        const input = fi();
        if (input) {
            input.setAttribute('capture', 'environment');
            input.setAttribute('accept', 'image/*');
            input.click();
            setTimeout(() => input.removeAttribute('capture'), 100);
        }
    });

    const btnSettings = document.getElementById('btnSettings');
    if (btnSettings) btnSettings.addEventListener('click', function(e) {
        e.stopPropagation();
        openSettings();
    });

    const btnExportCSV = document.getElementById('btnExportCSV');
    if (btnExportCSV) btnExportCSV.addEventListener('click', function() {
        if (typeof exportCurrentCSV === 'function') exportCurrentCSV();
    });

    const btnExportExcel = document.getElementById('btnExportExcel');
    if (btnExportExcel) btnExportExcel.addEventListener('click', function() {
        if (typeof exportExcel === 'function') exportExcel();
    });

    const btnSignIn = document.getElementById('btnSignIn');
    if (btnSignIn) btnSignIn.addEventListener('click', showSignInPrompt);

    const btnSignOut = document.getElementById('btnSignOut');
    if (btnSignOut) btnSignOut.addEventListener('click', function() {
        if (typeof signOut === 'function') signOut();
    });

    const settingsModalClose = document.getElementById('settingsModalClose');
    if (settingsModalClose) settingsModalClose.addEventListener('click', closeSettings);

    const settingsCloseBtn = document.getElementById('settingsCloseBtn');
    if (settingsCloseBtn) settingsCloseBtn.addEventListener('click', closeSettings);

    const settingsModalBackdrop = document.getElementById('settingsModalBackdrop');
    if (settingsModalBackdrop) settingsModalBackdrop.addEventListener('click', closeSettings);

    // Tool buttons — wired here (not inline onclick) to survive SES lockdown from browser extensions
    const btnBatchScan = document.getElementById('btnBatchScan');
    if (btnBatchScan) btnBatchScan.addEventListener('click', function() {
        if (typeof openBatchScanner === 'function') openBatchScanner();
        else if (typeof window.openBatchScanner === 'function') window.openBatchScanner();
    });

    const btnReadyToList = document.getElementById('btnReadyToList');
    if (btnReadyToList) btnReadyToList.addEventListener('click', function() {
        if (typeof openReadyToListView === 'function') openReadyToListView();
        else if (typeof window.openReadyToListView === 'function') window.openReadyToListView();
    });

    const btnCollectionStats = document.getElementById('btnCollectionStats');
    if (btnCollectionStats) btnCollectionStats.addEventListener('click', function() {
        if (typeof openStatsModal === 'function') openStatsModal();
        else if (typeof showStatsModal === 'function') showStatsModal();
    });

    const btnScanHistory = document.getElementById('btnScanHistory');
    if (btnScanHistory) btnScanHistory.addEventListener('click', function() {
        if (typeof openScanHistoryModal === 'function') openScanHistoryModal();
    });

    console.log('✅ Button events wired');
}

// ── Card Detail Modal ────────────────────────────────────────────────────────

window.openCardDetail = function(index) {
    const collections = getCollections();
    const currentId   = getCurrentCollectionId();
    const collection  = collections.find(c => c.id === currentId);
    if (!collection?.cards[index]) return;

    const card = collection.cards[index];
    document.getElementById('cardDetailModal')?.remove();

    const ebayUrl  = (typeof buildEbaySearchUrl === 'function') ? buildEbaySearchUrl(card) : null;
    const ebayBtn  = ebayUrl
        ? `<a href="${ebayUrl}" target="_blank" rel="noopener" class="btn-ebay" style="display:inline-flex;align-items:center;gap:6px;text-decoration:none;">🛒 Search eBay</a>`
        : '';

    const conditionOptions = [
        '', 'Raw', 'PSA 1','PSA 2','PSA 3','PSA 4','PSA 5',
        'PSA 6','PSA 7','PSA 8','PSA 9','PSA 10',
        'BGS 7','BGS 7.5','BGS 8','BGS 8.5','BGS 9','BGS 9.5','BGS 10',
        'SGC 7','SGC 8','SGC 9','SGC 10'
    ].map(o => `<option value="${o}" ${card.condition===o?'selected':''}>${o||'Select condition...'}</option>`).join('');

    const scannedDate = card.timestamp
        ? new Date(card.timestamp).toLocaleDateString('en-US', { year:'numeric', month:'short', day:'numeric' })
        : 'Unknown';

    // ── Listing status with clear button ──────────────────────────────────
    const listingHtml = card.listingStatus === 'listed'
        ? `<div style="background:#d1fae5;border:1px solid #6ee7b7;border-radius:8px;padding:10px 14px;margin-bottom:12px;">
             <div style="display:flex;align-items:flex-start;justify-content:space-between;gap:8px;">
               <div>
                 <div style="font-weight:700;color:#065f46;margin-bottom:4px;">🟢 Currently Listed on eBay</div>
                 ${card.listingTitle ? `<div style="font-size:12px;color:#374151;margin-bottom:6px;">${escapeHtml(card.listingTitle)}</div>` : ''}
                 <div style="display:flex;align-items:center;gap:12px;flex-wrap:wrap;">
                   ${card.listingPrice ? `<span style="font-size:16px;font-weight:800;color:#065f46;">${escapeHtml(card.listingPrice)}</span>` : ''}
                   ${card.listingUrl ? `<a href="${escapeHtml(card.listingUrl)}" target="_blank" rel="noopener" style="color:#2563eb;font-size:13px;font-weight:600;text-decoration:none;">View Listing →</a>` : ''}
                 </div>
               </div>
               <button onclick="clearCardListingStatus(${index})" title="Clear listing status"
                       style="background:none;border:1px solid #6ee7b7;border-radius:6px;padding:3px 8px;font-size:11px;color:#065f46;cursor:pointer;white-space:nowrap;flex-shrink:0;">
                 Clear ✕
               </button>
             </div>
           </div>`
        : card.listingStatus === 'sold'
        ? `<div style="background:#fee2e2;border:1px solid #fca5a5;border-radius:8px;padding:10px 14px;margin-bottom:12px;">
             <div style="display:flex;align-items:center;justify-content:space-between;gap:8px;">
               <strong>🔴 Sold${card.soldAt ? ` on ${new Date(card.soldAt).toLocaleDateString()}` : ''}</strong>
               <button onclick="clearCardListingStatus(${index})" title="Remove sold status"
                       style="background:none;border:1px solid #fca5a5;border-radius:6px;padding:3px 8px;font-size:11px;color:#991b1b;cursor:pointer;white-space:nowrap;flex-shrink:0;">
                 Clear ✕
               </button>
             </div>
           </div>`
        : '';

    // ── Tags editor ───────────────────────────────────────────────────────
    const cardTags = Array.isArray(card.tags) ? card.tags.filter(Boolean) : [];
    const tagsHtml = `
        <div style="margin-bottom:12px;">
            <label style="display:block;font-size:12px;font-weight:600;color:#374151;margin-bottom:6px;">Tags</label>
            <div id="detailTagsContainer" style="display:flex;flex-wrap:wrap;gap:6px;margin-bottom:8px;min-height:24px;">
                ${cardTags.map(t => `
                    <span class="tag-chip" style="display:inline-flex;align-items:center;gap:4px;">
                        ${escapeHtml(t)}
                        <button onclick="removeDetailTag(${index},'${escapeHtml(t).replace(/'/g,"\\'")}',this)"
                                style="background:none;border:none;cursor:pointer;padding:0;font-size:11px;color:#6b7280;line-height:1;">✕</button>
                    </span>`).join('')}
                ${cardTags.length === 0 ? '<span style="font-size:12px;color:#9ca3af;">No tags yet</span>' : ''}
            </div>
            <div style="display:flex;gap:6px;">
                <input type="text" id="detailTagInput" placeholder="Add tag..."
                       style="flex:1;padding:6px 10px;border:1px solid #d1d5db;border-radius:8px;font-size:13px;"
                       onkeydown="if(event.key==='Enter'){addDetailTag(${index});event.preventDefault();}">
                <button onclick="addDetailTag(${index})" class="btn-tag-add" style="padding:6px 12px;">Add</button>
            </div>
        </div>`;

    // ── eBay avg price (loads async after render) ─────────────────────────
    const priceHtml = `
        <div id="detailEbayPrice" style="background:#f0fdf4;border:1px solid #bbf7d0;border-radius:8px;padding:10px 14px;margin-bottom:12px;display:flex;align-items:center;justify-content:space-between;">
            <div>
                <div style="font-size:11px;font-weight:600;color:#6b7280;text-transform:uppercase;letter-spacing:.05em;margin-bottom:2px;">eBay Market Price</div>
                <div id="detailEbayPriceValue" style="font-size:15px;font-weight:700;color:#111827;">Loading...</div>
            </div>
            <a id="detailEbayPriceLink" href="${escapeHtml(ebayUrl || '#')}" target="_blank" rel="noopener"
               style="font-size:12px;color:#2563eb;text-decoration:none;font-weight:600;">View listings →</a>
        </div>`;

    const html = `
    <div class="modal active" id="cardDetailModal">
        <div class="modal-backdrop" onclick="document.getElementById('cardDetailModal').remove()"></div>
        <div class="modal-content" style="max-width:520px;max-height:90vh;display:flex;flex-direction:column;">
            <div class="modal-header">
                <h2>${escapeHtml(card.hero || 'Card Detail')}</h2>
                <button class="modal-close" onclick="document.getElementById('cardDetailModal').remove()">×</button>
            </div>
            <div class="modal-body" style="flex:1;overflow-y:auto;padding:20px;">
                ${card.imageUrl && !card.imageUrl.startsWith('blob:')
                    ? `<img src="${card.imageUrl}" alt="${escapeHtml(card.cardNumber)}"
                           style="width:100%;max-height:220px;object-fit:contain;border-radius:10px;margin-bottom:16px;background:#f9fafb;"
                           onerror="this.style.display='none'">`
                    : ''}

                ${listingHtml}
                ${priceHtml}

                <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px;margin-bottom:16px;">
                    ${[
                        ['Card #', card.cardNumber], ['Year', card.year],
                        ['Set', card.set], ['Parallel', card.pose],
                        ['Weapon', card.weapon], ['Power', card.power]
                    ].map(([label, val]) => val ? `
                        <div style="background:#f9fafb;border-radius:8px;padding:10px;">
                            <div style="font-size:11px;color:#6b7280;font-weight:600;text-transform:uppercase;letter-spacing:.05em;">${label}</div>
                            <div style="font-size:14px;font-weight:600;color:#111827;margin-top:2px;">${escapeHtml(String(val))}</div>
                        </div>` : '').join('')}
                </div>

                <div style="margin-bottom:12px;">
                    <label style="display:block;font-size:12px;font-weight:600;color:#374151;margin-bottom:6px;">Condition</label>
                    <select class="field-input" onchange="updateCard(${index},'condition',this.value);updateCardDetailField(${index},'condition',this.value)"
                            style="width:100%;">
                        ${conditionOptions}
                    </select>
                </div>

                <div style="margin-bottom:12px;">
                    <label style="display:block;font-size:12px;font-weight:600;color:#374151;margin-bottom:6px;">Notes</label>
                    <textarea class="field-notes" rows="3" style="width:100%;box-sizing:border-box;"
                              placeholder="Purchase price, provenance, grading notes..."
                              onchange="updateCard(${index},'notes',this.value)">${escapeHtml(card.notes || '')}</textarea>
                </div>

                ${tagsHtml}

                <div style="display:flex;align-items:center;justify-content:space-between;padding:10px 0;border-top:1px solid #f3f4f6;">
                    <div style="font-size:12px;color:#9ca3af;">
                        Scanned ${scannedDate} via ${escapeHtml(card.scanMethod || card.scanType || '')}
                        ${card.confidence ? ` · ${Math.round(card.confidence)}% confidence` : ''}
                    </div>
                    <label style="display:flex;align-items:center;gap:6px;cursor:pointer;font-size:13px;font-weight:600;color:#2563eb;">
                        <input type="checkbox" ${card.readyToList ? 'checked' : ''}
                               onchange="toggleReadyToList(${index})" style="width:16px;height:16px;">
                        Ready to List
                    </label>
                </div>
            </div>
            <div class="modal-footer" style="gap:8px;">
                ${ebayBtn}
                <button class="btn-secondary" style="flex:1;" onclick="document.getElementById('cardDetailModal').remove()">Close</button>
                <button class="btn-secondary" style="color:#ef4444;border-color:#ef4444;" onclick="removeCardFromDetail(${index})">🗑️ Remove</button>
            </div>
        </div>
    </div>`;

    document.body.insertAdjacentHTML('beforeend', html);

    // Async: fetch eBay avg price after modal renders
    if (typeof fetchEbayAvgPrice === 'function') {
        fetchEbayAvgPrice(card).then(result => {
            const el = document.getElementById('detailEbayPriceValue');
            if (!el) return;
            if (!result || result.count === 0) {
                el.textContent = 'N/A';
                el.style.color = '#9ca3af';
                document.getElementById('detailEbayPriceLink').style.display = 'none';
                // Cache as null so we don't refetch every open
                updateCard(index, 'ebayAvgPrice', null);
                updateCard(index, 'ebayLowPrice', null);
                updateCard(index, 'ebayPriceFetched', new Date().toISOString());
            } else {
                const avg = result.avgPrice;
                const low = result.lowPrice;
                const high = result.highPrice;
                const count = result.count;
                el.innerHTML = `$${avg.toFixed(2)} avg`
                    + (low !== null ? ` &nbsp;·&nbsp; <span style="color:#065f46;font-weight:700;">↓ $${low.toFixed(2)} low</span>` : '')
                    + (count > 1 ? ` <span style="font-size:11px;color:#6b7280;font-weight:400;">(${count} listings · $${low}–$${high})</span>` : '');

                // Save to card so grid + stats can use without re-fetching
                updateCard(index, 'ebayAvgPrice',    avg);
                updateCard(index, 'ebayLowPrice',    low);
                updateCard(index, 'ebayHighPrice',   high);
                updateCard(index, 'ebayListingCount', count);
                updateCard(index, 'ebayPriceFetched', new Date().toISOString());
                renderCards(); // refresh grid price row
            }
        }).catch(() => {
            const el = document.getElementById('detailEbayPriceValue');
            if (el) { el.textContent = 'Unavailable'; el.style.color = '#9ca3af'; }
        });
    } else {
        const el = document.getElementById('detailEbayPriceValue');
        if (el) { el.textContent = 'N/A'; el.style.color = '#9ca3af'; }
    }
};

// Open card detail from collection modal — takes colId + index directly
// (collection modal shows cards from all collections, not just current)
window.openCollectionCardDetail = function(colId, index) {
    const collections = getCollections();
    const collection  = collections.find(c => c.id === colId);
    if (!collection?.cards[index]) return;

    // Temporarily switch active collection so updateCard() / toggleReadyToList()
    // write back to the correct place, then restore previous on close
    const prevId = getCurrentCollectionId();
    if (colId !== prevId) setCurrentCollectionId(colId);

    // Reuse the standard card detail modal — openCardDetail uses getCurrentCollectionId
    if (typeof openCardDetail === 'function') {
        openCardDetail(index);
    }

    // When the detail modal is closed, restore previous active collection
    if (colId !== prevId) {
        const observer = new MutationObserver(() => {
            if (!document.getElementById('cardDetailModal')) {
                setCurrentCollectionId(prevId);
                observer.disconnect();
            }
        });
        observer.observe(document.body, { childList: true, subtree: false });
    }
};

window.removeCardFromDetail = function(index) {
    if (!confirm('Remove this card from your collection?')) return;
    document.getElementById('cardDetailModal')?.remove();
    removeCard(index);
};

// Scroll to a specific card in the grid and briefly highlight it
window.scrollToCard = function(index) {
    const el = document.getElementById(`card_item_${index}`);
    if (!el) return;
    el.scrollIntoView({ behavior: 'smooth', block: 'center' });
    el.style.transition = 'box-shadow 0.3s ease';
    el.style.boxShadow = '0 0 0 3px #10b981, 0 4px 20px rgba(16,185,129,.3)';
    setTimeout(() => { el.style.boxShadow = ''; }, 2500);
};

window.updateCardDetailField = function(index, field, value) {
    // Keep the main card grid select in sync
    const sel = document.querySelector(`#card_item_${index} select`);
    if (sel && field === 'condition') sel.value = value;
};

// Clear sold/listed status from card detail — removes status, dates, listing metadata,
// and removes the "Listed on eBay" / "Sold" tags automatically added by the monitor
window.clearCardListingStatus = function(index) {
    const collections = getCollections();
    const currentId   = getCurrentCollectionId();
    const collection  = collections.find(c => c.id === currentId);
    if (!collection?.cards[index]) return;

    const card = collection.cards[index];

    // Clear all listing fields
    card.listingStatus  = null;
    card.listingUrl     = null;
    card.listingTitle   = null;
    card.listingPrice   = null;
    card.listingItemId  = null;
    card.soldAt         = null;

    // Remove auto-applied eBay tags
    if (Array.isArray(card.tags)) {
        card.tags = card.tags.filter(t =>
            t !== 'Listed on eBay' && t !== 'Sold'
        );
    }

    saveCollections(collections);
    if (typeof syncToCloud === 'function') syncToCloud();

    // Re-render the modal with updated card state
    document.getElementById('cardDetailModal')?.remove();
    openCardDetail(index);
    renderCards();
};

// Add tag from detail modal input
window.addDetailTag = function(index) {
    const input = document.getElementById('detailTagInput');
    if (!input) return;
    const tag = input.value.trim();
    if (!tag) return;

    const collections = getCollections();
    const currentId   = getCurrentCollectionId();
    const collection  = collections.find(c => c.id === currentId);
    if (!collection?.cards[index]) return;

    const card = collection.cards[index];
    if (!Array.isArray(card.tags)) card.tags = [];
    if (!card.tags.includes(tag)) {
        card.tags.push(tag);
        saveCollections(collections);
        if (typeof syncToCloud === 'function') syncToCloud();
    }

    input.value = '';

    // Re-render tags container in-place
    const container = document.getElementById('detailTagsContainer');
    if (container) {
        container.innerHTML = card.tags.filter(Boolean).map(t => `
            <span class="tag-chip" style="display:inline-flex;align-items:center;gap:4px;">
                ${escapeHtml(t)}
                <button onclick="removeDetailTag(${index},'${escapeHtml(t).replace(/'/g,"\\'")}',this)"
                        style="background:none;border:none;cursor:pointer;padding:0;font-size:11px;color:#6b7280;line-height:1;">✕</button>
            </span>`).join('') || '<span style="font-size:12px;color:#9ca3af;">No tags yet</span>';
    }
    renderCards();
};

// Remove a single tag from the card via the detail modal ✕ button
window.removeDetailTag = function(index, tag, btnEl) {
    const collections = getCollections();
    const currentId   = getCurrentCollectionId();
    const collection  = collections.find(c => c.id === currentId);
    if (!collection?.cards[index]) return;

    const card = collection.cards[index];
    if (Array.isArray(card.tags)) {
        card.tags = card.tags.filter(t => t !== tag);
    }
    saveCollections(collections);
    if (typeof syncToCloud === 'function') syncToCloud();

    // Remove the chip from the DOM directly (no full re-render needed)
    btnEl?.closest('.tag-chip')?.remove();
    const container = document.getElementById('detailTagsContainer');
    if (container && !container.querySelector('.tag-chip')) {
        container.innerHTML = '<span style="font-size:12px;color:#9ca3af;">No tags yet</span>';
    }
    renderCards();
};

// Scripts load at bottom of <body>, so DOM is already ready when this runs.
// DOMContentLoaded has already fired — addEventListener for it would never trigger.
// Call directly instead.
(function() {
    wireUpEvents();
    initUploadArea();
    setTimeout(() => {
        const user = (typeof googleUser !== 'undefined' && googleUser) ||
                     (typeof currentUser !== 'undefined' && currentUser) || null;
        updateAuthUI(user);
    }, 500);
})();

console.log('✅ UI helpers loaded');
